import { getContext, setContext } from 'svelte';
import type { AppApi } from '../core/api';
import type { LibrarySnapshot, PlayerState, Playlist, Track } from '../core/types';
import { SettingsStore } from './settings/store.svelte';
import { Navigation } from './navigation.svelte';
import { DEBUG_TOOLS } from '../core/build';
import type { Profiler as BetaProfiler } from '../debug/profiler.svelte';
import type { Trace as BetaTrace } from '../debug/trace.svelte';
import { translate } from './i18n';
import { trackCount } from '../core/format';
import { createAppearanceLoader } from './appearance/loader';
import type { ColorPack } from './appearance/schema';
import { extractMusicLink } from '../core/links';
import type { SettingDescriptor, UiSlots } from '../core/registries';
import type { ImportJob } from '../core/imports';
import type { EnvironmentState } from '../core/environment';
import type { UpdateState } from '../core/updates';
import { defaultSettings } from './settings/schema';
const CONTEXT = Symbol('app-context');
const Profiler = DEBUG_TOOLS ? (await import('../debug/profiler.svelte')).Profiler : undefined;
const Trace = DEBUG_TOOLS ? (await import('../debug/trace.svelte')).Trace : undefined;
export interface PlayerClock { position: number; at: number; playing: boolean; crossfade?: PlayerState['crossfade']; sleepTimer?: PlayerState['sleepTimer'] }
function clockOf(state: PlayerState): PlayerClock { return { position: state.position, at: performance.now(), playing: state.playing && !state.resolving, crossfade: state.crossfade, sleepTimer: state.sleepTimer }; }
/** True when two snapshots differ only in clock fields (position, crossfade progress, sleep countdown). */
export function sameStructure(a: PlayerState, b: PlayerState): boolean {
  if (a.queue !== b.queue || a.currentIndex !== b.currentIndex || a.trackId !== b.trackId || a.playing !== b.playing || a.shuffle !== b.shuffle || a.repeat !== b.repeat || a.transition !== b.transition || a.resolving !== b.resolving || a.notice !== b.notice) return false;
  if (!!a.crossfade !== !!b.crossfade || a.crossfade && (a.crossfade.from !== b.crossfade!.from || a.crossfade.to !== b.crossfade!.to || a.crossfade.duration !== b.crossfade!.duration)) return false;
  if (!!a.sleepTimer !== !!b.sleepTimer || a.sleepTimer && a.sleepTimer.endOfTrack !== b.sleepTimer!.endOfTrack) return false;
  return true;
}
export class UiModel {
  extensionRevision = $state(0);
  library = $state.raw<LibrarySnapshot>();
  /** Structural player state. Position-only ticks do not replace it (see `clock`). */
  player = $state.raw<PlayerState>();
  /** Fast-changing playback clock, updated on every player tick. */
  clock = $state.raw<PlayerClock>({ position: 0, at: 0, playing: false });
  get position(): number { return this.clock.position; }
  settings: SettingsStore;
  readonly appearanceLoader = createAppearanceLoader();
  appearance = $state.raw(this.appearanceLoader.resolve(defaultSettings));
  colorTransition = $state.raw<{ id: number; from: ColorPack; duration: number; transitionId?: number }>();
  appearanceEditors = $state({
    style: { editing: false, draft: '', error: '', scrollTop: 0 },
    colors: { editing: false, draft: '', error: '', scrollTop: 0 },
    motion: { editing: false, draft: '', error: '', scrollTop: 0 },
  });
  nav = new Navigation();
  profiler?: BetaProfiler;
  /** Beta clock/beat trace (Diagnostics screen). */
  trace?: BetaTrace;
  toast = $state('');
  toastAction = $state<(() => void) | null>(null);
  environment = $state.raw<EnvironmentState>();
  importJob = $state.raw<ImportJob | null>(null);
  updateState = $state.raw<UpdateState>();
  /** Service that actually streams each recently prepared track (it can differ from the track's own source). */
  streams = $state.raw<Readonly<Record<string, string>>>({});
  recommendationState = $state.raw<import('../core/recommendations').RecommendationState>();
  audioState = $state.raw<import('../core/audio-settings').AudioSettingsState>();
  offlineState = $state.raw<import('../core/offline').OfflineState>();
  pendingMatch = $state<{ index: number; kind: 'uncertain' | 'missing' } | null>(null);
  coverRelease = $state({ transitionId: -1, offset: 0, velocity: 0 });
  scrollElement = $state<HTMLElement>();
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private subscriptions: (() => void)[];
  constructor(readonly api: AppApi) {
    if (Profiler) this.profiler = new Profiler(api, () => ({ route: this.nav.state.route.name, overlay: this.nav.overlay ?? '', settings: this.settings?.values ?? {} }));
    if (Trace) this.trace = new Trace(api, () => ({ settings: this.settings?.values ?? {}, streams: this.streams, motion: this.appearance.groups.general.duration }));
    this.library = api.library.getSnapshot(); this.player = api.player.getSnapshot(); this.clock = clockOf(this.player);
    this.settings = new SettingsStore(api.settings, () => api.extensions.settings.list());
    this.appearance = this.appearanceLoader.resolve(this.settings.values);
    this.environment = api.environment.getSnapshot(); this.importJob = api.imports.getSnapshot();
    let previousPhase = this.importJob?.phase;
    this.subscriptions = [api.extensions.events.on('registry:change', () => this.extensionRevision++), api.extensions.events.on('source:resolve', result => { if (result.outcome !== 'selected' || this.streams[result.trackId] === result.provider) return; const next = { ...this.streams, [result.trackId]: result.provider }; const keys = Object.keys(next); if (keys.length > 50) delete next[keys[0]!]; this.streams = next; }), api.environment.subscribe(state => this.environment = state), api.imports.subscribe(job => {
      this.importJob = job;
      if (job?.phase === 'done' && previousPhase !== 'done') this.notify('import.finished', undefined, () => this.nav.go({ name: 'import' }));
      previousPhase = job?.phase;
    }),api.library.subscribe(data => this.library = data), api.player.subscribe(state => this.acceptPlayer(state))];
    // Plain text from plugins (already prefixed with the plugin's name).
    const notify = (event: Event) => this.notify(String((event as CustomEvent).detail ?? '').slice(0, 260)); window.addEventListener('app:notify', notify); this.subscriptions.push(() => window.removeEventListener('app:notify', notify));
    if (api.audioSettings) { this.audioState = api.audioSettings.getSnapshot(); this.subscriptions.push(api.audioSettings.subscribe(value => this.audioState = value)); }
    if (api.offline) { this.offlineState = api.offline.getSnapshot(); this.subscriptions.push(api.offline.subscribe(value => this.offlineState = value)); }
    if (api.recommendations) { this.recommendationState = api.recommendations.getSnapshot(); this.subscriptions.push(api.recommendations.subscribe(value => this.recommendationState = value)); }
    if (api.updates) { this.updateState = api.updates.getSnapshot(); this.subscriptions.push(api.updates.subscribe(value => { this.updateState = value; this.followUpdate(value); })); }
  }
  private acceptPlayer(state: PlayerState) {
    const previous = this.player;
    this.clock = clockOf(state);
    // Ticks only move the clock. Replacing `player` would re-run every
    // component that reads queue, flags, or the active track 12 times a second.
    if (previous && sameStructure(previous, state)) return;
    if (state.notice && state.notice.id !== previous?.notice?.id) this.notify(state.notice.key, { from: this.t(`source.${state.notice.from ?? 'sc'}`), to: this.t(`source.${state.notice.to ?? 'yt'}`) });
    this.player = state;
  }
  contributions<K extends keyof UiSlots>(slot: K): readonly UiSlots[K][] { void this.extensionRevision; return this.api.extensions.ui.list(slot); }
  get settingDefinitions(): readonly SettingDescriptor[] { void this.extensionRevision; return this.api.extensions.settings.list(); }
  get locale(): string { return String(this.settings.values.language ?? 'ru'); }
  get track(): Track | undefined { const snapshot = this.library; return snapshot && this.player?.trackId ? this.api.library.getTrack(this.player.trackId) : undefined; }
  t = (key: string, params?: Record<string, string | number>) => translate(this.locale, key, params);
  count = (n: number) => trackCount(n, this.locale);
  playlistTitle = (playlist: Playlist) => playlist.titleKey ? this.t(playlist.titleKey) : playlist.title;
  notify(key: string, params?: Record<string, string | number>, action: (() => void) | null = null) {
    this.toast = this.t(key, params); this.toastAction = action; clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast = '', 2600);
  }
  /** Download the offered update and open the system installer as soon as it is verified. */
  private autoInstall = false;
  installUpdate() {
    const updates = this.api.updates; if (!updates) return;
    this.autoInstall = true; this.notify('update.phase.downloading');
    void updates.download();
  }
  private followUpdate(state: UpdateState) {
    if (!this.autoInstall) return;
    if (state.phase === 'ready') { this.autoInstall = false; void this.api.updates?.install(); }
    else if (state.phase === 'permission' || state.phase === 'error') { this.autoInstall = false; this.notify(state.phase === 'error' ? `update.error.${state.error ?? 'download'}` : 'update.phase.permission', undefined, () => this.nav.go({ name: 'updates' })); }
  }
  like(track: Track) { this.api.library.setLiked(track.id, !track.liked); this.api.haptics.pulse(); }
  play(ids: readonly string[], index = 0) {
    const track = this.api.library.getTrack(ids[index] ?? '');
    if (!track) return;
    this.api.player.play(ids, index);
  }
  async openLink(text: string) {
    const parsed = extractMusicLink(text);
    if (!parsed) { this.nav.go({ name: 'import', link: text }); return; }
    try {
      const link = await this.api.imports.resolveLink(parsed);
      this.settings.set('onboardingDone', true);
      if (link.kind === 'track') { const id = await this.api.imports.openTrack(link); this.play([id]); this.nav.open('player'); }
      else this.nav.go({ name: 'import', link: link.url, source: link.source });
    } catch { this.notify('search.failed'); }
  }
  dispose() { this.profiler?.stop(); this.trace?.dispose(); this.subscriptions.forEach(fn => fn()); this.settings.dispose(); clearTimeout(this.toastTimer); }
}
export function provideModel(model: UiModel): void { setContext(CONTEXT, model); }
export function useModel(): UiModel { return getContext<UiModel>(CONTEXT); }
