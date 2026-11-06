import { mount } from 'svelte';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { createHaptics } from './core/haptics';
import { createEnvironment } from './core/environment-live';
import { createExtensions, bindCoreEvents } from './core/runtime';
import { registerProviders } from './core/providers';
import { registerBuiltInUi } from './ui/extensions';
import { createImports } from './core/import-engine';
import { createSoundCloud } from './core/soundcloud';
import { createCharts } from './core/charts';
import { createRecommendations } from './core/recommendations';
import { registerLyrics } from './core/lyrics';
import { createLiveCovers } from './core/live-covers';
import { ImportFailure } from './core/imports';
import { parseMusicLink } from './core/links';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { bindNativeInsets, configureViewport, SystemUi } from './platform/system-ui';
import { createFiles } from './platform/files';
import { createHttp } from './platform/http';
import { createAudioEngine, NativeAudio } from './platform/audio-engine';
import { PlaybackFailure } from './core/audio-engine';
import { APP_CHANNEL, BETA_FEATURES, DEBUG_TOOLS, storeReleaseChannel } from './core/build';
import { createWaveforms } from './platform/waveforms';
import { bindMediaSession } from './platform/media-session';
import { translate } from './ui/i18n';
import App from './ui/App.svelte';
import { applyAppearance, createAppearanceLoader } from './ui/appearance/loader';
import './ui/appearance/tokens.css';
import './ui/appearance/motion/effects.css';
import { defaultSettings, settingsSchema } from './ui/settings/schema';
import { createSync } from './core/sync/engine';
import { peerTransport } from './platform/sync-transport';
import { createLibrary } from './core/library';
import { createPlayer } from './core/player';
import { createSettings } from './core/settings';
import type { AppApi } from './core/api';
import { createUpdates, DEFAULT_UPDATE_URL } from './core/updates';
import { createUpdateInstaller } from './platform/updates';
import { APP_VERSION, APP_VERSION_CODE } from './core/version';
import { createStorage } from './platform/storage';
import { desktop } from './platform/desktop';
import { createAudioSettings } from './core/audio-settings';
import { createOffline } from './core/offline';
import { createOfflinePort, offlineSource } from './platform/offline';
import { createPlaybackPower } from './platform/playback-power';
import { accountPorts } from './platform/accounts';
import { createYandexAccount } from './core/accounts';
import { createYandex } from './core/yandex';
import { createYouTube } from './core/youtube';
import { createApple, createDeezer, createSpotify } from './core/catalogues';
import type { MusicService } from './core/music-service';

configureViewport();
/** 'android', 'desktop' or 'web' (browser preview while developing the UI). */
const PLATFORM = desktop ? 'desktop' : Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web';
const storage = await createStorage();
const diagnostics = DEBUG_TOOLS ? (await import('./debug/diagnostics')).createDiagnostics({ storage, version: APP_VERSION, platform: PLATFORM, native: Capacitor.isNativePlatform() ? () => NativeAudio.getDiagnostics() : undefined }) : undefined;
const extensions = createExtensions(), files = createFiles();
const settings = createSettings(defaultSettings, storage);
applyAppearance(createAppearanceLoader().resolve(settings.getSnapshot()));
const haptics = createHaptics({ selectionStart: () => Haptics.selectionStart(), selectionChanged: () => Haptics.selectionChanged(), selectionEnd: () => Haptics.selectionEnd(), impact: strength => Haptics.impact({ style: strength === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light }), tick: Capacitor.isNativePlatform() ? () => SystemUi.tick() : undefined }, () => settings.getSnapshot().haptics !== false, Capacitor.isNativePlatform());
let api: AppApi, unregisterProviders: () => void, flush = () => {}, disposePlatform = () => {};
// Explicit fixtures exist only in development. Production eliminates this branch.
if (DEBUG_TOOLS && import.meta.env.DEV && new URLSearchParams(location.search).get('demo') === '1') {
  const [libraryModule, playerModule, environmentModule, importsModule, providersModule, lyricsModule] = await Promise.all([import('./mock/library'), import('./mock/player'), import('./mock/environment'), import('./mock/imports'), import('./mock/providers'), import('./mock/lyrics')]);
  const environment = environmentModule.createEnvironment(new URLSearchParams(location.search).get('scenario') ?? 'normal', navigator.onLine);
  const library = libraryModule.createLibrary(storage, environment), player = playerModule.createPlayer(library, storage, environment, settings), imports = importsModule.createImports(library, environment, storage);
  unregisterProviders = providersModule.registerBuiltInProviders(extensions, library, lyricsModule.mockLyrics, imports, environment);
  api = { audioSettings: createAudioSettings(storage), library, player, imports, environment, settings, files, haptics, extensions, search: { search: extensions.sources.search.bind(extensions.sources), getRecent: library.getRecent, remember: library.remember, clearRecent: library.clearRecent }, lyrics: { getLyrics: extensions.lyrics.find.bind(extensions.lyrics) } };
} else {
  const environment = createEnvironment(navigator.onLine), library = createLibrary(storage), http = createHttp(), sc = createSoundCloud(http, storage, diagnostics);
  const ports = accountPorts(), account = createYandexAccount(http, ports.secrets, ports.open), ya = createYandex(http, account.getToken, diagnostics), youtube = createYouTube(http);
  // The Yandex sign-in state explains "auth" failures and missing Yandex lyrics in reports.
  if (diagnostics) { let last = ''; const note = (value: ReturnType<typeof account.api.getSnapshot>) => { const key = `${value.phase}:${'error' in value && value.error ? (value.error as { kind?: string }).kind ?? 'error' : ''}`; if (key !== last) { last = key; diagnostics.record('account', 'yandex', { phase: value.phase, error: key.split(':')[1] || null }); } }; note(account.api.getSnapshot()); account.api.subscribe(note); }
  const services: readonly MusicService[] = [{ id: 'sc', inspect: sc.inspect, collection: sc.collection,
    async getTrack(id, signal) { const track = await sc.getTrack(id, signal); if (!track) throw new ImportFailure('not_found'); return track; },
    async search(query, signal) { const tracks = await sc.search(query, signal); return { tracks, artists: [...new Map(tracks.map(track => [track.artist.id, track.artist])).values()], playlists: [] }; },
    async stream(track, signal) { const source = track.sources.find(source => source.kind === 'sc'); if (!source) return null; const uri = await sc.stream(track, signal); return uri ? { uri, source } : null; },
  }, { id: 'ya', ...ya }, youtube.youtube, youtube.music, createApple(http), createDeezer(http), createSpotify(http)];
  const service = (id: string) => { const found = services.find(value => value.id === id); if (!found) throw new ImportFailure('invalid_link'); return found; };
  const imports = createImports(library, environment, {
    async resolveLink(link, signal) { if (link.source !== 'sc' || link.kind !== 'short') return link; const data = await sc.resolve(link.url, signal); const resolved = data.permalink_url && parseMusicLink(data.permalink_url); if (!resolved) throw new ImportFailure('not_found'); return resolved; },
    getTrack: (link, signal) => link.source === 'sc' ? sc.fromLink(link, signal) : service(link.source).getTrack(link.id, signal), getCollection: (link, signal) => extensions.imports.load(link, signal),
    inspect: (source, link, signal) => extensions.imports.inspect(source, link, signal),
    async authorize(source) { if (source !== 'ya') throw new ImportFailure('auth'); await account.api.login(); const profile = await ya.account(); await account.identify(profile.uid, profile.name); },
    find: (original, signal) => sc.search(`${original.artist} ${original.title}`, signal),
  }, storage);
  const unregisterCoreProviders = registerProviders(extensions, library, imports, services, http);
  if (storage) extensions.sources.remember(storage);
  const unregisterLyrics = registerLyrics(extensions, library, http, { lyrics: ya.lyrics, search: ya.search, signedIn: async () => !!(await account.getToken().catch(() => undefined)) }, diagnostics, storage);
  unregisterProviders = () => { unregisterLyrics(); unregisterCoreProviders(); };
  const localWaves = createWaveforms(library, diagnostics);
  let cacheLimit = 0;
  const applyCacheLimit = () => { const bytes = Number(settings.getSnapshot().waveCacheLimit ?? 32) * 1024 * 1024; if (bytes === cacheLimit) return; if (desktop) { cacheLimit = bytes; void desktop.waves.setLimit(bytes).catch(() => {}); } else if (Capacitor.isNativePlatform()) { cacheLimit = bytes; void SystemUi.setWaveCacheLimit({ bytes }).catch(() => {}); } };
  applyCacheLimit();
  const unsubscribeCache = settings.subscribe(applyCacheLimit);
  disposePlatform = () => { unsubscribeCache(); localWaves.dispose(); };
  library.getWaveform = (id, signal) => { const source = library.getTrack(id)?.sources.find(source => source.kind === 'sc'); return source ? sc.waveform(`sc-${source.externalId}`, signal).catch(() => null).then(wave => wave ?? localWaves.get(id, signal)) : localWaves.get(id, signal); };
  library.getLoudness = id => localWaves.loudness(id);
  library.subscribeWaveform = localWaves.subscribe; library.setWaveformTargets = localWaves.setTargets; library.getRhythm = id => localWaves.rhythm(id);
  // Resolved stream links are kept briefly so skipping back and forth starts instantly.
  // An entry is used once: if that link fails, the player's retry resolves a fresh one.
  const resolvedStreams = new Map<string, { value: { uri: string; headers?: Readonly<Record<string, string>> }; until: number }>();
  const linkLifetime = (uri: string) => { try { const expire = Number(new URL(uri).searchParams.get('expire')); if (expire > 0) return Math.min(expire * 1000 - 120_000, Date.now() + 60 * 60_000); } catch {} return Date.now() + 4 * 60_000; };
  const resolveFresh = async (track: import('./core/types').Track, signal?: AbortSignal) => { const result = await extensions.sources.resolve(track, signal); if (!result.uri) throw new PlaybackFailure(result.reason ?? 'unavailable', result.message ?? 'No playable full stream', result.status, result.code); return { uri: result.uri, headers: result.headers }; };
  const pendingStreams = new Map<string, Promise<{ uri: string; headers?: Readonly<Record<string, string>> }>>();
  const preresolve = (track: import('./core/types').Track) => {
    if (resolvedStreams.has(track.id) || pendingStreams.has(track.id) || track.downloaded || track.sources.some(source => source.kind === 'local')) return;
    const task = resolveFresh(track).then(value => { resolvedStreams.set(track.id, { value, until: linkLifetime(value.uri) }); if (resolvedStreams.size > 8) resolvedStreams.delete(resolvedStreams.keys().next().value!); return value; }).finally(() => pendingStreams.delete(track.id));
    pendingStreams.set(track.id, task); task.catch(() => {});
  };
  const resolve = async (track: import('./core/types').Track, signal?: AbortSignal) => { const cached = await offlineSource(track.id); signal?.throwIfAborted(); if (cached) return cached;
    const ready = resolvedStreams.get(track.id); resolvedStreams.delete(track.id);
    if (ready && ready.until > Date.now()) return ready.value;
    const pending = pendingStreams.get(track.id); if (pending) { try { return await pending; } catch { signal?.throwIfAborted(); } finally { resolvedStreams.delete(track.id); } }
    const result = await extensions.sources.resolve(track, signal); if (!result.uri) throw new PlaybackFailure(result.reason ?? 'unavailable', result.message ?? 'No playable full stream', result.status, result.code); return { uri: result.uri, headers: result.headers }; };
  // Desktop: the waveform of a streamed track is decoded from the same address the player uses
  // (Android reads it from the playback cache, which registers it the same way).
  const playbackResolve: typeof resolve = desktop ? async (track, signal) => { const value = await resolve(track, signal); const stream = typeof value === 'string' ? { uri: value } : value; if (/^https:/.test(stream.uri)) void desktop!.waves.register(track.id, stream.uri, stream.headers).catch(() => {}); return value; } : resolve;
  const audio = createAudioEngine(playbackResolve, { diagnostics, errorText: reason => translate(String(settings.getSnapshot().language), `player.error.${reason}`) });
  const audioSettings = createAudioSettings(storage);
  const player = createPlayer(library, settings, audio, storage, diagnostics, audioSettings);
  // Look ahead: once the current track is playing, resolve links for the track after next and the previous one.
  let lookahead: ReturnType<typeof setTimeout> | undefined, lookaheadTrack: string | null = null;
  player.subscribe(state => {
    if (state.trackId === lookaheadTrack || state.resolving || !state.playing) return; lookaheadTrack = state.trackId; clearTimeout(lookahead);
    // Lyrics of the playing track are looked up right away, so the lyrics screen opens filled.
    const playing = state.trackId; if (playing) setTimeout(() => { if (player.getSnapshot().trackId === playing) void extensions.lyrics.find(playing).catch(() => undefined); }, 600);
    lookahead = setTimeout(() => { for (const offset of [2, -1]) { const id = state.queue[state.currentIndex + offset]?.trackId, track = id ? library.getTrack(id) : undefined; if (track) preresolve(track); } }, 5000);
  });
  api = { account: account.api, ...(ports.encrypted ? { accountEncrypted: ports.encrypted } : {}), audioSettings, library, player, imports, environment, settings, files, haptics, extensions, charts: createCharts(http, sc, library, storage), liveCovers: createLiveCovers(http, { storage }), recommendations: createRecommendations({ http, library, storage, searchMusic: (query, signal) => youtube.music.search!(query, signal).then(result => result.tracks) }), capabilities: { downloads: false, soundProcessing: Capacitor.isNativePlatform() || !!desktop }, search: { search: extensions.sources.search.bind(extensions.sources), getRecent: library.getRecent, remember: library.remember, clearRecent: library.clearRecent }, lyrics: { getLyrics: extensions.lyrics.find.bind(extensions.lyrics) } };
  const offlinePort = createOfflinePort(); if (offlinePort) { api.offline = createOffline(library, settings, offlinePort, async track => { const result = await extensions.sources.resolve(track); if (!result.uri) throw new PlaybackFailure(result.reason ?? 'unavailable', 'No downloadable full stream'); return { uri: result.uri, headers: result.headers }; }, diagnostics); api.capabilities!.downloads = true; }
  if (desktop) { const bridge = desktop; api.waveCache = { getStats: () => bridge.waves.stats(), clear: () => bridge.waves.clear() }; }
  else if (Capacitor.isNativePlatform()) api.waveCache = { getStats: () => SystemUi.getWaveCache(), clear: () => SystemUi.clearWaveCache() };
  const installed = Capacitor.isNativePlatform() ? await NativeApp.getInfo().then(info => ({ version: info.version, versionCode: Number(info.build) })) : { version: APP_VERSION, versionCode: APP_VERSION_CODE };
  api.updates = createUpdates({ http, installed, platform: desktop ? 'linux-appimage' : 'android', channel: APP_CHANNEL, installer: createUpdateInstaller(), storage,
    urls: () => [DEFAULT_UPDATE_URL],
  });
  if (BETA_FEATURES && typeof Worker !== 'undefined') {
    const [{ createPluginHost }, { spawnPluginWorker }] = await Promise.all([import('./core/plugins/host'), import('./platform/plugins')]);
    api.pluginCatalog = (await import('./core/plugins/catalog')).createPluginCatalog(http);
    api.plugins = createPluginHost({ storage: storage ?? localStorage, extensions, player, library, http, spawn: spawnPluginWorker, diagnostics, locale: () => String(settings.getSnapshot().language ?? 'ru'), notify: text => window.dispatchEvent(new CustomEvent('app:notify', { detail: text })) });
  }
  // Device sync: on when this device has joined a group (Settings → Sync).
  if (typeof RTCPeerConnection !== 'undefined' && typeof crypto?.subtle !== 'undefined') {
    const syncedSettings = settingsSchema.filter(definition => definition.sync).map(definition => definition.key);
    api.sync = createSync({ library, settings, storage, open: peerTransport(), diagnostics, syncedSettings: () => syncedSettings,
      device: { name: desktop?.hostname ? `${translate(String(settings.getSnapshot().language), 'sync.name.desktop')} ${desktop.hostname}` : translate(String(settings.getSnapshot().language), desktop ? 'sync.name.desktop' : PLATFORM === 'android' ? 'sync.name.phone' : 'sync.name.web'), kind: desktop ? 'desktop' : PLATFORM === 'android' ? 'phone' : 'web' },
      nowPlaying: () => { const state = player.getSnapshot(), track = state.trackId ? library.getTrack(state.trackId) : undefined; return track ? { track, position: player.livePosition?.().position ?? state.position, playing: state.playing } : null; },
      subscribePlayer: listener => player.subscribe(listener),
      play: (track, position) => { if (!library.getTrack(track.id)) library.addTracks([track]); player.play([track.id]); player.seek(position); },
    });
  }
  flush = () => { try { library.flush(); audioSettings.flush(); } catch { /* Storage can become unavailable while closing. */ } };
}
window.addEventListener('online', () => api.environment.setOnline(true)); window.addEventListener('offline', () => api.environment.setOnline(false));
api.diagnostics = diagnostics;
api.playbackPower = createPlaybackPower();
if (DEBUG_TOOLS && Capacitor.isNativePlatform()) api.performance = { sampleTransition: duration => SystemUi.sampleFrames({ duration }).then(stats => ({ ...stats })) };
diagnostics?.record('app', 'start', { platform: PLATFORM, version: APP_VERSION, channel: APP_CHANNEL });
// Native diagnostics follow the channel chosen here; report it on every start.
if (Capacitor.isNativePlatform()) void SystemUi.setReleaseChannel({ channel: APP_CHANNEL }).catch(() => {});
api.releaseChannel = {
  current: APP_CHANNEL,
  set(channel) {
    if (channel === APP_CHANNEL) return;
    storeReleaseChannel(channel);
    const native = Capacitor.isNativePlatform() ? SystemUi.setReleaseChannel({ channel }).catch(() => undefined) : Promise.resolve();
    void native.then(() => { flush(); location.reload(); });
  },
};
window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
const unregisterUi = registerBuiltInUi(extensions);
api.library.resolvePlayback = async id => { const track = api.library.getTrack(id); return track ? extensions.sources.resolve(track) : { source: null }; };
api.imports.start = request => extensions.imports.run(request);
const unbindEvents = bindCoreEvents(api, extensions);
const unbindMedia = bindMediaSession(api, key => translate(String(settings.getSnapshot().language), key));
// Updates are checked on their own: shortly after start, every few hours while
// the app is open, and when it returns to the foreground. The prompt is in App.
const UPDATE_INTERVAL = 3 * 60 * 60_000, UPDATE_RETRY = 20 * 60_000, UPDATE_CHECK_KEY = 'ss_update_last_check';
let lastUpdateCheck = Number(localStorage.getItem(UPDATE_CHECK_KEY)) || 0;
const checkUpdates = (force = false) => {
  const updates = api.updates; if (!updates || settings.getSnapshot().autoUpdateCheck === false || document.hidden) return;
  const phase = updates.getSnapshot().phase;
  if (!['idle', 'current', 'error', 'available'].includes(phase)) return;
  const wait = phase === 'error' || phase === 'idle' && !lastUpdateCheck ? UPDATE_RETRY : UPDATE_INTERVAL;
  if (!force && Date.now() - lastUpdateCheck < wait) return;
  lastUpdateCheck = Date.now(); try { localStorage.setItem(UPDATE_CHECK_KEY, String(lastUpdateCheck)); } catch {}
  void updates.check({ silent: true });
};
const updateCheckTimer = setTimeout(() => checkUpdates(true), 8_000);
const updateCheckInterval = setInterval(() => checkUpdates(), 10 * 60_000);
const checkOnResume = () => { if (!document.hidden) checkUpdates(); };
document.addEventListener('visibilitychange', checkOnResume);
mount(App, { target: document.getElementById('app')!, props: { api } });
if (Capacitor.isNativePlatform()) {
  void SystemUi.addListener('incomingLink', data => window.dispatchEvent(new CustomEvent('app:link', { detail: data.text })));
  void SystemUi.getPendingLink().then(data => { if (data.text) window.dispatchEvent(new CustomEvent('app:link', { detail: data.text })); });
  const updateSystemBars = () => { void SystemUi.setStyle({ light: document.documentElement.dataset.colorScheme === 'light' }); };
  void bindNativeInsets().then(dispose => window.addEventListener('pagehide', dispose, { once: true }));
  updateSystemBars(); window.addEventListener('app:appearance', updateSystemBars);
  void NativeApp.addListener('backButton', () => window.dispatchEvent(new Event('app:back')));
  window.addEventListener('app:root-back', () => { void NativeApp.minimizeApp(); });
}
if (import.meta.hot) import.meta.hot.dispose(() => { flush(); clearTimeout(updateCheckTimer); clearInterval(updateCheckInterval); document.removeEventListener('visibilitychange', checkOnResume); api.updates?.cancel(); unbindMedia(); disposePlatform(); api.player.dispose(); api.audioSettings?.dispose(); api.offline?.dispose(); api.imports.dispose(); api.environment.dispose(); unbindEvents(); unregisterProviders(); unregisterUi(); });
