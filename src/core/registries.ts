import type { Lyrics, SearchFilters, SearchResults, Track, TrackSource, PlaybackFailureReason } from './types';
import { playbackFailureReason } from './audio-engine';
import { errorDetails } from './diagnostics';
import { ImportFailure } from './imports';
import type { ImportChoice, ImportCollection, ImportRequest } from './imports';
import type { MusicLink } from './links';
import type { EventBus } from './events';
/** A provider that does not answer in time is treated as failed; it never holds up playback or lyrics. */
export class ProviderTimeout extends Error { constructor(readonly provider: string, ms: number) { super(`Provider ${provider} timed out after ${ms} ms`); this.name = 'ProviderTimeout'; } }
export function withTimeout<T>(task: Promise<T>, ms: number, provider: string, controller?: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([task, new Promise<never>((_, reject) => { timer = setTimeout(() => { controller?.abort(); reject(new ProviderTimeout(provider, ms)); }, ms); })]).finally(() => clearTimeout(timer));
}
export const LYRICS_TIMEOUT = 15_000, STREAM_TIMEOUT = 30_000;
export class Registry<T extends { id: string }> {
  protected entries = new Map<string, T>();
  constructor(readonly name: string, protected events: EventBus) {}
  register(entry: T): () => void {
    if (!entry.id || this.entries.has(entry.id)) throw new Error(`Duplicate or empty provider: ${entry.id}`);
    this.entries.set(entry.id, entry); this.events.emit('registry:change', { registry: this.name });
    return () => { if (this.entries.get(entry.id) === entry) { this.entries.delete(entry.id); this.events.emit('registry:change', { registry: this.name }); } };
  }
  get(id: string): T | undefined { return this.entries.get(id); }
  list(): readonly T[] { return [...this.entries.values()]; }
}
export interface SourceProvider {
  id: string; titleKey: string;
  streamFamily?: string;
  supportsPlayback?: boolean;
  fallback?: boolean;
  search(query: string, filters: SearchFilters, signal?: AbortSignal): Promise<SearchResults>;
  getTrack(id: string, signal?: AbortSignal): Promise<Track | undefined>;
  resolveStream(track: Track, signal?: AbortSignal): Promise<{ uri: string; source: TrackSource; headers?: Readonly<Record<string, string>> } | null>;
  parseLink(input: string): MusicLink | null;
}
/**
 * A service that cannot give a track (DRM-only, preview-only, removed, region-blocked) is
 * remembered for that track for a while, so the next play goes straight to a service that
 * can. SoundCloud DRM-only tracks cost 0.5–1 s on every start before (beta trace, Nov 2026).
 */
const SKIP_KEY = 'ss_source_skip_v1', SKIP_LIMIT = 600;
const SKIP_MS: Partial<Record<PlaybackFailureReason, number>> = { protected: 7 * 86_400_000, preview: 7 * 86_400_000, unavailable: 86_400_000, region: 86_400_000 };
export class SourceRegistry extends Registry<SourceProvider> {
  private attemptSequence = 0;
  private skip = new Map<string, number>();
  private storage: Pick<Storage, 'getItem' | 'setItem'> | undefined;
  constructor(events: EventBus) { super('sources', events); }
  /** Keeps the "service cannot give this track" memory across restarts. */
  remember(storage: Pick<Storage, 'getItem' | 'setItem'>) {
    this.storage = storage;
    try { const saved = JSON.parse(storage.getItem(SKIP_KEY) ?? '{}'); const now = Date.now(); for (const [key, until] of Object.entries(saved)) if (typeof until === 'number' && until > now) this.skip.set(key, until); } catch { /* Start empty. */ }
  }
  private note(provider: string, trackId: string, reason: PlaybackFailureReason) {
    const ms = SKIP_MS[reason]; if (!ms) return;
    this.skip.delete(`${provider}:${trackId}`); this.skip.set(`${provider}:${trackId}`, Date.now() + ms);
    while (this.skip.size > SKIP_LIMIT) this.skip.delete(this.skip.keys().next().value!);
    try { this.storage?.setItem(SKIP_KEY, JSON.stringify(Object.fromEntries(this.skip))); } catch { /* Memory only. */ }
  }
  /** Forget remembered failures of a track (e.g. the user retries it on purpose). */
  forget(trackId: string) { for (const key of [...this.skip.keys()]) if (key.endsWith(`:${trackId}`)) this.skip.delete(key); }
  parseLink(text: string): MusicLink | null { for (const source of this.list()) { const link = source.parseLink(text); if (link) return link; } return null; }
  async search(query: string, filters: SearchFilters, signal?: AbortSignal, partial?: (results: SearchResults) => void): Promise<SearchResults> {
    const providers = this.list().filter(source => filters.source === 'all' || source.id === filters.source);
    const unique = <T extends { id: string }>(values: T[]) => [...new Map(values.map(value => [value.id, value])).values()];
    const combined = (values: readonly SearchResults[]): SearchResults => ({ tracks: unique(values.flatMap(result => [...result.tracks])), artists: unique(values.flatMap(result => [...result.artists])), playlists: unique(values.flatMap(result => [...result.playlists])) });
    const arrived = new Map<string, SearchResults>();
    const results = await Promise.allSettled(providers.map(async source => {
      const controller = new AbortController(), abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const found = await Promise.race([source.search(query, filters, controller.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Search request timed out')); }, 12000); })]);
        signal?.throwIfAborted(); arrived.set(source.id, found);
        partial?.(combined(providers.flatMap(provider => arrived.get(provider.id) ?? []))); return found;
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    }));
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const successes = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    if (!successes.length && results.length) throw (results[0] as PromiseRejectedResult).reason;
    if (!successes.some(result => result.tracks.length || result.artists.length || result.playlists.length) && results.some(result => result.status === 'rejected')) throw (results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason;
    return combined(successes);
  }
  async resolve(track: Track, signal?: AbortSignal): Promise<{ source: TrackSource | null; uri?: string; headers?: Readonly<Record<string, string>>; switchedFrom?: TrackSource['kind']; reason?: PlaybackFailureReason; code?: string; status?: number; message?: string; provider?: string }> {
    const preferred = track.sources[0]?.kind;
    const known = new Set(track.sources.map(source => source.kind)), attemptId = ++this.attemptSequence;
    const candidates = [...this.list()].filter(provider => provider.supportsPlayback !== false && (provider.fallback !== false || known.has(provider.id)))
      .sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred) || Number(known.has(b.id)) - Number(known.has(a.id)));
    const now = Date.now(), usable = candidates.filter(provider => (this.skip.get(`${provider.id}:${track.id}`) ?? 0) <= now);
    // If every service was ruled out, try them all again rather than give up.
    const ordered = usable.length ? usable : candidates;
    if (usable.length !== candidates.length && usable.length) this.events.emit('source:resolve', { trackId: track.id, attemptId, provider: candidates.filter(provider => !usable.includes(provider)).map(provider => provider.id).join(','), outcome: 'unmatched', ms: 0, code: 'SKIPPED_REMEMBERED' });
    let failure: { reason: PlaybackFailureReason; provider: string; message?: string; status?: number; code?: string } | undefined;
    const failedFamilies = new Set<string>();
    for (const provider of ordered) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (provider.streamFamily && failedFamilies.has(provider.streamFamily)) continue;
      const started = performance.now();
      try {
        const controller = new AbortController(), abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
        let stream: Awaited<ReturnType<SourceProvider['resolveStream']>>;
        try { stream = await withTimeout(provider.resolveStream(track, controller.signal), STREAM_TIMEOUT, provider.id, controller); } finally { signal?.removeEventListener('abort', abort); }
        signal?.throwIfAborted();
        this.events.emit('source:resolve', { trackId: track.id, attemptId, provider: provider.id, outcome: stream ? 'selected' : 'unmatched', ms: Math.round(performance.now() - started), ...(!stream ? { code: 'NO_MATCHING_RECORDING' } : {}) });
        if (stream) return { ...stream, ...(provider.id !== preferred ? { switchedFrom: preferred } : {}) };
      } catch (error) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (provider.streamFamily) failedFamilies.add(provider.streamFamily);
        const reason = playbackFailureReason(error), detail = errorDetails(error);
        this.note(provider.id, track.id, reason);
        const failed = { reason, provider: provider.id, ...(typeof detail.message === 'string' ? { message: detail.message } : {}), ...(typeof detail.code === 'string' ? { code: detail.code } : {}), ...(typeof detail.status === 'number' ? { status: detail.status } : {}) };
        this.events.emit('source:resolve', { trackId: track.id, attemptId, ...failed, outcome: 'failed', ms: Math.round(performance.now() - started) });
        // A preview/DRM restriction of an alternative must not overwrite the
        // actual failure of the track's original service.
        if (!failure || provider.id === preferred) failure = failed;
      }
    }
    return { source: null, ...failure };
  }
}
export interface LyricsProvider { id: string; titleKey: string; find(trackId: string, signal?: AbortSignal): Promise<Lyrics | null> }
/** How precise a text is: word timings > line timings > plain text. */
export function lyricsRank(lyrics: Lyrics | null | undefined): number { return !lyrics ? 0 : lyrics.synced === false ? 1 : lyrics.words ? 3 : 2; }
/**
 * Saved provider order: ids in priority order, a leading "-" marks a provider the user
 * turned off. Providers missing from the list (new ones, plugins) keep registration order
 * after the listed ones and are on.
 */
export function parseLyricsOrder(value: string): { order: string[]; disabled: Set<string> } {
  const order: string[] = [], disabled = new Set<string>();
  for (const raw of value.split(',')) { const item = raw.trim(), id = item.replace(/^-/, ''); if (!id || order.includes(id)) continue; order.push(id); if (item.startsWith('-')) disabled.add(id); }
  return { order, disabled };
}
const LYRICS_GRACE = 1500, LYRICS_MEMORY = 60;
export class LyricsRegistry extends Registry<LyricsProvider> {
  constructor(events: EventBus) { super('lyrics', events); }
  private running = new Map<string, Promise<Lyrics | null>>();
  /** Texts that replaced an earlier answer, so the next find() does not go back to the less precise one. */
  private answers = new Map<string, Lyrics | null>();
  private listeners = new Set<(trackId: string, lyrics: Lyrics) => void>();
  private orderSource: () => string = () => '';
  /** Where the saved order comes from (the settings value). Changing it drops remembered answers. */
  setOrder(source: () => string) { this.orderSource = source; this.answers.clear(); }
  orderChanged() { this.answers.clear(); }
  override register(entry: LyricsProvider): () => void { const dispose = super.register(entry); this.answers.clear(); return () => { dispose(); this.answers.clear(); }; }
  /** Providers in priority order, with the ones turned off marked. */
  ordered(): { provider: LyricsProvider; enabled: boolean }[] {
    const { order, disabled } = parseLyricsOrder(this.orderSource()), all = this.list();
    const rank = (id: string) => { const index = order.indexOf(id); return index < 0 ? order.length + all.findIndex(item => item.id === id) : index; };
    return [...all].sort((a, b) => rank(a.id) - rank(b.id)).map(provider => ({ provider, enabled: !disabled.has(provider.id) }));
  }
  onUpdate(listener: (trackId: string, lyrics: Lyrics) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  /**
   * All enabled providers are asked at once. The most precise text wins (word timings >
   * line timings > plain text); between equally precise texts the user's order decides.
   * A line-timed text is answered as soon as it cannot lose to a provider above it (or
   * after a short grace), and is swapped for a word-timed one if that arrives later:
   * listeners of onUpdate get it and the next find() returns it.
   * Concurrent requests for one track share one lookup; a caller's signal only stops that caller's wait.
   */
  async find(trackId: string, signal?: AbortSignal): Promise<Lyrics | null> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (this.answers.has(trackId)) return this.answers.get(trackId)!;
    let shared = this.running.get(trackId);
    if (!shared) { shared = this.lookup(trackId).finally(() => this.running.delete(trackId)); this.running.set(trackId, shared); }
    if (!signal) return shared;
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      shared.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  private remember(trackId: string, value: Lyrics | null) {
    this.answers.delete(trackId); this.answers.set(trackId, value);
    while (this.answers.size > LYRICS_MEMORY) this.answers.delete(this.answers.keys().next().value!);
  }
  private lookup(trackId: string): Promise<Lyrics | null> {
    const providers = this.ordered().filter(item => item.enabled).map(item => item.provider);
    if (!providers.length) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const results: (Lyrics | null | undefined)[] = providers.map(() => undefined);
      let pending = providers.length, failed: unknown, answered: Lyrics | null | undefined, graceTimer: ReturnType<typeof setTimeout> | undefined;
      const best = () => { let index = -1, rank = 0; results.forEach((value, i) => { const r = lyricsRank(value); if (r > rank) { rank = r; index = i; } }); return { index, rank }; };
      const answer = (value: Lyrics | null) => { answered = value; clearTimeout(graceTimer); resolve(value); };
      const settle = () => {
        const { index, rank } = best(), winner = index >= 0 ? results[index]! : null;
        if (answered !== undefined) {
          // Only a strictly more precise text replaces what is already shown.
          if (winner && lyricsRank(winner) > lyricsRank(answered)) { answered = winner; this.remember(trackId, winner); for (const listener of this.listeners) listener(trackId, winner); }
          return;
        }
        if (!pending) { if (winner) answer(winner); else if (failed) { clearTimeout(graceTimer); reject(failed); } else answer(null); return; }
        // Everything above the winner has answered: nothing can beat it on equal precision.
        const above = results.slice(0, Math.max(0, index)).every(value => value !== undefined);
        if (rank === 3 && above) answer(winner);
        else if (rank === 2 && above) answer(winner);
        else if (rank >= 2 && !graceTimer) graceTimer = setTimeout(() => { graceTimer = undefined; if (answered === undefined) { const current = best(); if (current.rank >= 2) answer(results[current.index]!); } }, LYRICS_GRACE);
      };
      providers.forEach((provider, i) => {
        withTimeout(Promise.resolve().then(() => provider.find(trackId)), LYRICS_TIMEOUT, provider.id)
          .then(value => { results[i] = value ?? null; }, (error: unknown) => { results[i] = null; failed ??= error; })
          .finally(() => { pending--; settle(); });
      });
    });
  }
}
export interface ImportProvider {
  id: string; titleKey: string; accepts(request: ImportRequest): boolean; run(request: ImportRequest): void;
  inspect?(link?: MusicLink, signal?: AbortSignal): Promise<readonly ImportChoice[]>;
  load?(link: MusicLink, signal?: AbortSignal): Promise<ImportCollection>;
}
export class ImportRegistry extends Registry<ImportProvider> {
  constructor(events: EventBus) { super('imports', events); }
  run(request: ImportRequest): void { const provider = this.list().find(provider => provider.accepts(request)); if (!provider) throw new Error('No import provider'); provider.run(request); }
  inspect(source: string, link?: MusicLink, signal?: AbortSignal): Promise<readonly ImportChoice[]> { const provider = this.get(source); if (!provider?.inspect) throw new ImportFailure('invalid_link'); return provider.inspect(link, signal); }
  load(link: MusicLink, signal?: AbortSignal): Promise<ImportCollection> { const provider = this.get(link.source); if (!provider?.load) throw new ImportFailure('invalid_link'); return provider.load(link, signal); }
}
export interface SettingDescriptor {
  key: string; section: string; type: 'toggle' | 'select' | 'slider' | 'text' | 'appearance'; axis?: 'style' | 'colors' | 'motion';
  default: string | number | boolean; options?: readonly { value: string; label: string }[];
  min?: number; max?: number; step?: number; sync: boolean; label: string; disabled?: boolean; hidden?: boolean; /** Beta-only feature: hidden and off in stable. */ beta?: boolean; unit?: string;
  /** Optional one-line explanation under the label. */
  hint?: string;
  /** App version that introduced the setting: shown with a "new" badge for a few days after updating. */
  since?: string;
}
export class SettingsRegistry extends Registry<SettingDescriptor & { id: string }> {
  constructor(events: EventBus) { super('settings', events); }
}
export interface UiAction { id: string; titleKey: string; icon: string; command: string; location?: 'side' | 'transport' }
export interface UiSlots {
  trackMenu: UiAction;
  playerButtons: UiAction;
  settingsSections: { id: string; titleKey: string; section: string };
  screens: { id: string; titleKey: string; route: string; component: string };
}
export class UiSlotRegistry {
  private slots: { [K in keyof UiSlots]: Registry<UiSlots[K]> };
  constructor(events: EventBus) { this.slots = { trackMenu: new Registry('ui.trackMenu', events), playerButtons: new Registry('ui.playerButtons', events), settingsSections: new Registry('ui.settingsSections', events), screens: new Registry('ui.screens', events) }; }
  register<K extends keyof UiSlots>(slot: K, entry: UiSlots[K]): () => void { return this.slots[slot].register(entry); }
  list<K extends keyof UiSlots>(slot: K): readonly UiSlots[K][] { return this.slots[slot].list(); }
}
