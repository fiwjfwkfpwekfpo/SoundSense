import type { LibraryApi, PlayerApi } from '../api';
import type { DiagnosticsApi } from '../diagnostics';
import type { HttpClient } from '../http';
import { HttpFailure } from '../http';
import type { Extensions } from '../runtime';
import type { Lyrics, Track, Unsubscribe } from '../types';
import { networkAllowed, readPackage, validateScreen } from './manifest';
import { PLUGIN_ICONS, PluginError } from './types';
import type { HostMessage, PluginEventName, PluginManifest, PluginPermission, PluginRecord, PluginScreen, PluginState, PluginTrack, WorkerMessage } from './types';

/** The platform starts a sandboxed worker; tests pass a fake. */
export interface PluginWorker { post(message: HostMessage): void; onMessage(listener: (message: WorkerMessage) => void): void; onError(listener: (error: string) => void): void; terminate(): void }
export interface PluginHostDeps {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  extensions: Extensions; player: PlayerApi; library: LibraryApi; http: HttpClient;
  spawn(): PluginWorker; notify(text: string): void; locale(): string;
  diagnostics?: DiagnosticsApi;
  /** Timings, overridable in tests. */
  limits?: Partial<typeof LIMITS>;
}
export interface PluginsApi {
  getSnapshot(): readonly PluginState[];
  subscribe(listener: (plugins: readonly PluginState[]) => void): Unsubscribe;
  /** Installs or updates a package. New plugins start disabled; enabling is the user's consent. */
  install(bytes: Uint8Array): Promise<PluginState>;
  remove(id: string): void;
  setEnabled(id: string, enabled: boolean): void;
  setPermission(id: string, permission: PluginPermission, granted: boolean): void;
  getSettings(id: string): Record<string, string | boolean>;
  setSetting(id: string, key: string, value: string | boolean): void;
  /** The plugin's own icon.svg, if it has one (already checked to contain no scripts or links). */
  getIcon(id: string): string | undefined;
  /** The plugin's own screen, if it set one while running. */
  getScreen(id: string): PluginScreen | undefined;
  subscribeScreens(listener: () => void): Unsubscribe;
  /** A tap, toggle or input on the plugin's screen; the plugin usually answers with a new screen. */
  act(id: string, action: string, value?: string | boolean): Promise<void>;
  dispose(): void;
}
const LIMITS = { startMs: 10_000, pingMs: 5_000, hangMs: 15_000, callMs: 12_000, storageBytes: 512 * 1024, responseBytes: 2 * 1024 * 1024, requestsPer10s: 300, errorsPerMinute: 10, netConcurrent: 4, netPerMinute: 120, menuItems: 5, playerButtons: 2, lyricsProviders: 3 };
const INDEX_KEY = 'ss_plugins_v1', codeKey = (id: string) => `ss_plugin_code_${id}`, dataKey = (id: string) => `ss_plugin_data_${id}`, settingsKey = (id: string) => `ss_plugin_settings_${id}`;
const EVENT_PERMISSION: Record<PluginEventName, PluginPermission> = { 'track:change': 'player.read', 'player:play': 'player.read', 'player:pause': 'player.read', 'player:seek': 'player.read', 'library:like': 'library.read', 'library:unlike': 'library.read' };
const METHOD_PERMISSION: Record<string, PluginPermission | null> = {
  'events.subscribe': null, 'player.state': 'player.read', 'player.play': 'player.control', 'player.pause': 'player.control', 'player.next': 'player.control', 'player.previous': 'player.control', 'player.seek': 'player.control',
  'library.isLiked': 'library.read', 'library.likes': 'library.read', 'library.playlists': 'library.read', 'library.setLiked': 'library.write',
  'net.fetch': null, 'storage.get': null, 'storage.set': null, 'storage.delete': null, 'storage.keys': null, 'settings.set': null,
  'ui.toast': 'notify', 'ui.trackMenu.add': 'ui.trackMenu', 'ui.playerButton.add': 'ui.playerButton', 'ui.screen.set': 'ui.screen', 'provider.lyrics.register': 'provider.lyrics', 'log': null,
};
interface Running {
  id: string; worker: PluginWorker; pending: Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>; sequence: number;
  disposers: (() => void)[]; subscribed: Set<string>; timers: ReturnType<typeof setTimeout | typeof setInterval>[];
  lastPong: number; requests: number[]; errors: number[]; net: number[]; netActive: number; menuItems: number; buttons: number; lyrics: number; lastToast: number; stopped: boolean;
}
const plain = (track: Track | undefined): PluginTrack | null => track ? { id: track.id, title: track.title, artist: track.artist.name, ...(track.albumId ? { album: track.albumId } : {}), duration: track.duration, liked: track.liked, source: track.sources[0]?.kind ?? '' } : null;
const json = (value: unknown) => { try { return JSON.stringify(value) ?? 'null'; } catch { throw new PluginError('api', 'Value is not JSON-serializable'); } };

export function createPluginHost(deps: PluginHostDeps): PluginsApi {
  const limits = { ...LIMITS, ...deps.limits };
  let records: PluginRecord[] = [];
  try { const saved = JSON.parse(deps.storage.getItem(INDEX_KEY) ?? '[]'); if (Array.isArray(saved)) records = saved.filter(item => item?.manifest?.id && Array.isArray(item.granted)); } catch { /* No plugins. */ }
  const status = new Map<string, { status: PluginState['status']; error?: string }>(), running = new Map<string, Running>(), listeners = new Set<(plugins: readonly PluginState[]) => void>();
  const screens = new Map<string, PluginScreen>(), screenListeners = new Set<() => void>();
  const screensChanged = () => { for (const listener of screenListeners) listener(); };
  let snapshot: readonly PluginState[] = [], disposed = false;
  const record = (scope: string, data: Record<string, unknown>, level: 'info' | 'warn' | 'error' = 'info') => deps.diagnostics?.record('plugins', scope, data, level);
  function publish() {
    snapshot = records.map(item => ({ ...item, ...(status.get(item.manifest.id) ?? { status: item.enabled ? 'starting' : 'disabled' }) }));
    for (const listener of listeners) listener(snapshot);
  }
  function save() { try { deps.storage.setItem(INDEX_KEY, JSON.stringify(records)); } catch { /* Kept for this session. */ } }
  const find = (id: string) => records.find(item => item.manifest.id === id);
  const settingsOf = (manifest: PluginManifest): Record<string, string | boolean> => {
    let saved: Record<string, unknown> = {}; try { saved = JSON.parse(deps.storage.getItem(settingsKey(manifest.id)) ?? '{}'); } catch {}
    return Object.fromEntries((manifest.settings ?? []).map(setting => [setting.key, typeof saved[setting.key] === typeof setting.default ? saved[setting.key] as string | boolean : setting.default]));
  };
  const has = (plugin: PluginRecord, permission: PluginPermission) => plugin.granted.includes(permission);

  function stop(id: string, next: { status: PluginState['status']; error?: string } = { status: 'disabled' }) {
    const run = running.get(id);
    if (run) {
      run.stopped = true; running.delete(id);
      for (const timer of run.timers) { clearTimeout(timer as ReturnType<typeof setTimeout>); clearInterval(timer as ReturnType<typeof setInterval>); }
      for (const dispose of run.disposers.reverse()) try { dispose(); } catch { /* Keep stopping. */ }
      for (const entry of run.pending.values()) { clearTimeout(entry.timer); entry.reject(new PluginError('crashed', 'Plugin stopped')); }
      if (screens.delete(id)) screensChanged();
      if (next.status === 'crashed') run.worker.terminate();
      else { try { run.worker.post({ type: 'stop' }); } catch {} setTimeout(() => run.worker.terminate(), 1000); }
    }
    status.set(id, next);
    if (next.status === 'crashed') record('crashed', { id, error: next.error }, 'warn');
    publish();
  }
  const crash = (id: string, error: string) => { if (running.has(id)) stop(id, { status: 'crashed', error }); };

  function call(run: Running, method: 'lyrics.find' | 'menu.select' | 'ui.action', args: readonly unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (run.stopped) { reject(new PluginError('crashed', 'Plugin stopped')); return; }
      const id = ++run.sequence;
      const timer = setTimeout(() => { run.pending.delete(id); reject(new PluginError('timeout', `${method} took longer than ${limits.callMs} ms`)); }, limits.callMs);
      run.pending.set(id, { resolve, reject, timer });
      run.worker.post({ type: 'call', id, method, args });
    });
  }
  function emit(run: Running, name: PluginEventName, data: unknown) { if (!run.stopped && run.subscribed.has(name)) run.worker.post({ type: 'event', name, data }); }
  function subscribe(run: Running, plugin: PluginRecord, name: string) {
    if (!(name in EVENT_PERMISSION)) throw new PluginError('api', `Unknown event ${name}`);
    const event = name as PluginEventName;
    if (!has(plugin, EVENT_PERMISSION[event])) throw new PluginError('permission', `${name} needs ${EVENT_PERMISSION[event]}`);
    if (run.subscribed.has(event)) return; run.subscribed.add(event);
    const bus = deps.extensions.events, track = () => plain(deps.library.getTrack(deps.player.getSnapshot().trackId ?? ''));
    if (event === 'track:change') run.disposers.push(bus.on('track:change', change => emit(run, event, { track: plain(deps.library.getTrack(change.trackId ?? '')), previous: change.previous })));
    if (event === 'player:play') run.disposers.push(bus.on('player:play', state => emit(run, event, { track: track(), position: state.position })));
    if (event === 'player:pause') run.disposers.push(bus.on('player:pause', state => emit(run, event, { track: track(), position: state.position })));
    if (event === 'player:seek') run.disposers.push(bus.on('player:seek', seek => emit(run, event, { position: seek.position })));
    if (event === 'library:like') run.disposers.push(bus.on('library:like', liked => emit(run, event, { track: plain(liked) })));
    if (event === 'library:unlike') run.disposers.push(bus.on('library:unlike', liked => emit(run, event, { track: plain(liked) })));
  }
  function lyricsFrom(value: unknown, trackId: string, credit: string): Lyrics | null {
    if (!value) return null;
    const raw = value as { lines?: unknown; text?: unknown; synced?: unknown };
    if (Array.isArray(raw.lines)) {
      const lines = raw.lines.slice(0, 2000).flatMap(line => { const item = line as { time?: unknown; text?: unknown }; return Number.isFinite(item?.time) && Number(item.time) >= 0 && typeof item.text === 'string' ? [{ time: Number(item.time), text: item.text.slice(0, 500) }] : []; }).sort((a, b) => a.time - b.time);
      if (lines.some(line => line.text.trim())) return { trackId, language: lines.some(line => /[а-яё]/i.test(line.text)) ? 'ru' : 'en', lines, creditKey: credit, synced: true };
    }
    if (typeof raw.text === 'string' && raw.text.trim()) {
      const text = raw.text.slice(0, 100_000);
      return { trackId, language: /[а-яё]/i.test(text) ? 'ru' : 'en', lines: text.split(/\r?\n/).slice(0, 2000).map(line => ({ time: 0, text: line })), creditKey: credit, synced: false };
    }
    return null;
  }
  async function fetchFor(run: Running, plugin: PluginRecord, url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) {
    if (!networkAllowed(plugin.granted, url)) throw new PluginError('permission', `No network permission for ${(() => { try { return new URL(url).hostname; } catch { return 'this address'; } })()}`);
    const now = Date.now(); run.net = run.net.filter(at => now - at < 60_000);
    if (run.net.length >= limits.netPerMinute || run.netActive >= limits.netConcurrent) throw new PluginError('limit', 'Too many network requests');
    const method = init.method === 'POST' ? 'POST' : init.method === 'GET' || init.method === undefined ? 'GET' : (() => { throw new PluginError('api', 'Only GET and POST are supported'); })();
    if (init.body !== undefined && init.body.length > 256 * 1024) throw new PluginError('limit', 'Request body is larger than 256 KB');
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).filter(([key, value]) => typeof value === 'string' && !/^(cookie|host|content-length|origin|referer)$/i.test(key)).slice(0, 30)) as Record<string, string>;
    run.net.push(now); run.netActive++;
    try {
      const body = await deps.http.text(url, undefined, { method, headers, ...(init.body === undefined ? {} : { body: init.body }) });
      if (body.length > limits.responseBytes) throw new PluginError('limit', 'Response is larger than 2 MB');
      return { status: 200, ok: true, body };
    } catch (error) {
      if (error instanceof HttpFailure) return { status: error.status, ok: false, body: error.responseText.slice(0, limits.responseBytes) };
      if (error instanceof PluginError) throw error;
      throw new PluginError('network', error instanceof Error ? error.message : 'Network error');
    } finally { run.netActive--; }
  }
  function storageOf(id: string): Record<string, string> { try { const value = JSON.parse(deps.storage.getItem(dataKey(id)) ?? '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } }
  async function handle(run: Running, plugin: PluginRecord, method: string, args: readonly unknown[]): Promise<unknown> {
    if (!(method in METHOD_PERMISSION)) throw new PluginError('api', `Unknown method ${method}`);
    const permission = METHOD_PERMISSION[method]; if (permission && !has(plugin, permission)) throw new PluginError('permission', `${method} needs ${permission}`);
    const id = plugin.manifest.id, player = deps.player, library = deps.library;
    switch (method) {
      case 'events.subscribe': subscribe(run, plugin, String(args[0])); return true;
      case 'player.state': { const state = player.getSnapshot(), live = player.livePosition?.(); return { track: plain(library.getTrack(state.trackId ?? '')), playing: state.playing, position: live?.position ?? state.position, index: state.currentIndex, queueLength: state.queue.length }; }
      case 'player.play': if (!player.getSnapshot().playing) player.toggle(); return true;
      case 'player.pause': if (player.getSnapshot().playing) player.toggle(); return true;
      case 'player.next': player.next(); return true;
      case 'player.previous': player.previous(); return true;
      case 'player.seek': { const seconds = Number(args[0]); if (!Number.isFinite(seconds)) throw new PluginError('api', 'seek needs seconds'); player.seek(seconds); return true; }
      case 'library.isLiked': return !!library.getTrack(String(args[0]))?.liked;
      case 'library.likes': return library.getSnapshot().tracks.filter(track => track.liked).sort((a, b) => b.addedAt - a.addedAt).slice(0, Math.max(1, Math.min(1000, Number(args[0]) || 100))).map(plain);
      case 'library.playlists': return library.getSnapshot().playlists.filter(item => item.kind === 'playlist').map(item => ({ id: item.id, title: item.title, count: item.trackIds.length }));
      case 'library.setLiked': { const trackId = String(args[0]); if (!library.getTrack(trackId)) throw new PluginError('api', 'Unknown track'); library.setLiked(trackId, !!args[1]); return true; }
      case 'net.fetch': return fetchFor(run, plugin, String(args[0]), (args[1] ?? {}) as { method?: string; headers?: Record<string, string>; body?: string });
      case 'storage.get': { const value = storageOf(id)[String(args[0])]; return value === undefined ? null : JSON.parse(value); }
      case 'storage.keys': return Object.keys(storageOf(id));
      case 'storage.delete': { const data = storageOf(id); delete data[String(args[0])]; deps.storage.setItem(dataKey(id), JSON.stringify(data)); return true; }
      case 'storage.set': {
        const key = String(args[0]); if (!key || key.length > 120) throw new PluginError('api', 'Invalid storage key');
        const data = { ...storageOf(id), [key]: json(args[1]) }, serialized = JSON.stringify(data);
        if (serialized.length > limits.storageBytes) throw new PluginError('limit', 'Plugin storage is full (512 KB)');
        deps.storage.setItem(dataKey(id), serialized); return true;
      }
      case 'ui.toast': { const now = Date.now(); if (now - run.lastToast < 2000) throw new PluginError('limit', 'Too many notifications'); run.lastToast = now; deps.notify(`${plugin.manifest.name}: ${String(args[0]).slice(0, 200)}`); return true; }
      case 'ui.trackMenu.add': case 'ui.playerButton.add': {
        const menu = method === 'ui.trackMenu.add', item = args[0] as { id?: unknown; title?: unknown; icon?: unknown };
        if (menu ? ++run.menuItems > limits.menuItems : ++run.buttons > limits.playerButtons) throw new PluginError('limit', menu ? `At most ${limits.menuItems} menu items` : `At most ${limits.playerButtons} player buttons`);
        const itemId = String(item?.id ?? '').slice(0, 40), title = String(item?.title ?? '').trim().slice(0, 40); if (!itemId || !title) throw new PluginError('api', 'Item needs id and title');
        const icon = (PLUGIN_ICONS as readonly string[]).includes(String(item?.icon)) ? String(item.icon) : 'sliders', kind = menu ? 'menu' : 'button';
        run.disposers.push(menu
          ? deps.extensions.ui.register('trackMenu', { id: `plugin.${id}.${kind}.${itemId}`, command: `plugin:${id}:${kind}:${itemId}`, titleKey: title, icon })
          : deps.extensions.ui.register('playerButtons', { id: `plugin.${id}.${kind}.${itemId}`, command: `plugin:${id}:${kind}:${itemId}`, titleKey: title, icon, location: 'side' }));
        if (!run.subscribed.has('ui:command')) {
          run.subscribed.add('ui:command');
          run.disposers.push(deps.extensions.events.on('ui:command', command => {
            const prefix = `plugin:${id}:`; if (!command.command.startsWith(prefix) || run.stopped) return;
            const trackId = command.trackId ?? deps.player.getSnapshot().trackId ?? '';
            void call(run, 'menu.select', [command.command.slice(prefix.length), plain(library.getTrack(trackId))]).catch(error => record('menu.failed', { id, error: String(error) }, 'warn'));
          }));
        }
        return true;
      }
      case 'settings.set': { const key = String(args[0]), definition = plugin.manifest.settings?.find(item => item.key === key); if (!definition || typeof args[1] !== typeof definition.default) throw new PluginError('api', `Unknown setting ${key}`); api.setSetting(id, key, args[1] as string | boolean); return true; }
      case 'ui.screen.set': { screens.set(id, validateScreen(args[0])); screensChanged(); return true; }
      case 'provider.lyrics.register': {
        const item = args[0] as { id?: unknown; name?: unknown };
        if (++run.lyrics > limits.lyricsProviders) throw new PluginError('limit', `At most ${limits.lyricsProviders} lyrics providers`);
        const providerId = String(item?.id ?? '').slice(0, 40), name = String(item?.name ?? plugin.manifest.name).slice(0, 60); if (!providerId) throw new PluginError('api', 'Lyrics provider needs id');
        run.disposers.push(deps.extensions.lyrics.register({ id: `plugin.${id}.${providerId}`, titleKey: name, async find(trackId) {
          const track = plain(library.getTrack(trackId)); if (!track) return null;
          return lyricsFrom(await call(run, 'lyrics.find', [providerId, track]), trackId, name);
        } }));
        return true;
      }
      case 'log': record('log', { id, text: String(args[0]).slice(0, 1000) }); return true;
    }
    throw new PluginError('api', `Unknown method ${method}`);
  }
  function start(plugin: PluginRecord) {
    const id = plugin.manifest.id; if (running.has(id) || disposed) return;
    let stored: { code?: string };
    try { stored = JSON.parse(deps.storage.getItem(codeKey(id)) ?? '{}'); } catch { stored = {}; }
    if (typeof stored.code !== 'string') { status.set(id, { status: 'crashed', error: 'Plugin files are missing; install it again' }); publish(); return; }
    let worker: PluginWorker;
    try { worker = deps.spawn(); } catch (error) { status.set(id, { status: 'crashed', error: `Cannot start: ${String(error)}` }); publish(); return; }
    const run: Running = { id, worker, pending: new Map(), sequence: 0, disposers: [], subscribed: new Set(), timers: [], lastPong: Date.now(), requests: [], errors: [], net: [], netActive: 0, menuItems: 0, buttons: 0, lyrics: 0, lastToast: 0, stopped: false };
    running.set(id, run); status.set(id, { status: 'starting' }); publish();
    worker.onError(error => crash(id, `Error: ${error}`));
    worker.onMessage(message => {
      if (run.stopped) return;
      if (message.type === 'ready') { status.set(id, { status: 'running' }); publish(); record('started', { id, version: plugin.manifest.version }); }
      else if (message.type === 'failed') crash(id, message.error);
      else if (message.type === 'pong') run.lastPong = Date.now();
      else if (message.type === 'error') {
        const now = Date.now(); run.errors = [...run.errors.filter(at => now - at < 60_000), now];
        record('error', { id, error: message.error }, 'warn');
        if (run.errors.length > limits.errorsPerMinute) crash(id, `Too many errors. Last: ${message.error}`);
      }
      else if (message.type === 'reply') { const entry = run.pending.get(message.id); if (!entry) return; run.pending.delete(message.id); clearTimeout(entry.timer); if (message.ok) entry.resolve(message.value); else entry.reject(new PluginError('api', message.error ?? 'Plugin error')); }
      else if (message.type === 'request') {
        const now = Date.now(); run.requests = [...run.requests.filter(at => now - at < 10_000), now];
        if (run.requests.length > limits.requestsPer10s) { crash(id, 'Too many requests'); return; }
        const current = find(id) ?? plugin;
        void handle(run, current, message.method, Array.isArray(message.args) ? message.args : []).then(
          value => { if (!run.stopped) run.worker.post({ type: 'reply', id: message.id, ok: true, value }); },
          error => { if (!run.stopped) run.worker.post({ type: 'reply', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }); });
      }
    });
    run.timers.push(setTimeout(() => { if (status.get(id)?.status === 'starting') crash(id, `Did not start within ${limits.startMs / 1000} s`); }, limits.startMs));
    let ping = 0;
    run.timers.push(setInterval(() => {
      // A hidden WebView may pause timers: judge a hang only by pings that had time to be answered.
      if (Date.now() - run.lastPong > limits.hangMs && !(typeof document !== 'undefined' && document.hidden)) { crash(id, 'Not responding'); return; }
      worker.post({ type: 'ping', n: ++ping });
    }, limits.pingMs));
    worker.post({ type: 'load', manifest: plugin.manifest, code: stored.code, locale: deps.locale(), settings: settingsOf(plugin.manifest) });
  }
  function restart(id: string) { const plugin = find(id); stop(id); if (plugin?.enabled) start(plugin); }

  const api: PluginsApi = {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async install(bytes) {
      const pack = readPackage(bytes), id = pack.manifest.id, existing = find(id);
      const added = pack.manifest.permissions.filter(permission => !existing?.manifest.permissions.includes(permission));
      // An update keeps the user's choices; permissions it newly asks for need a new consent (the plugin stays off until then).
      const next: PluginRecord = existing
        ? { manifest: pack.manifest, enabled: existing.enabled && !added.length, granted: [...existing.granted.filter(permission => pack.manifest.permissions.includes(permission)), ...added], installedAt: existing.installedAt }
        : { manifest: pack.manifest, enabled: false, granted: [...pack.manifest.permissions], installedAt: Date.now() };
      stop(id);
      deps.storage.setItem(codeKey(id), JSON.stringify({ code: pack.code, icon: pack.icon, i18n: pack.i18n }));
      records = existing ? records.map(item => item.manifest.id === id ? next : item) : [...records, next];
      save(); status.delete(id); record('installed', { id, version: pack.manifest.version, update: !!existing });
      if (next.enabled) start(next); else publish();
      return snapshot.find(item => item.manifest.id === id)!;
    },
    remove(id) {
      stop(id); records = records.filter(item => item.manifest.id !== id); status.delete(id);
      for (const key of [codeKey(id), dataKey(id), settingsKey(id)]) try { deps.storage.removeItem(key); } catch {}
      save(); publish(); record('removed', { id });
    },
    setEnabled(id, enabled) {
      const plugin = find(id); if (!plugin) return;
      records = records.map(item => item.manifest.id === id ? { ...item, enabled } : item); save();
      if (enabled) { stop(id); start(find(id)!); } else stop(id);
    },
    setPermission(id, permission, granted) {
      const plugin = find(id); if (!plugin || !plugin.manifest.permissions.includes(permission)) return;
      const set = new Set(plugin.granted); if (granted) set.add(permission); else set.delete(permission);
      records = records.map(item => item.manifest.id === id ? { ...item, granted: plugin.manifest.permissions.filter(value => set.has(value)) } : item); save();
      // Registrations made under the old permissions are dropped by a restart.
      if (running.has(id)) restart(id); else publish();
    },
    getSettings(id) { const plugin = find(id); return plugin ? settingsOf(plugin.manifest) : {}; },
    setSetting(id, key, value) {
      const plugin = find(id), definition = plugin?.manifest.settings?.find(item => item.key === key); if (!plugin || !definition || typeof value !== typeof definition.default) return;
      if (definition.type === 'select' && !definition.options.some(option => option.value === value)) return;
      const values = { ...settingsOf(plugin.manifest), [key]: typeof value === 'string' ? value.slice(0, 500) : value };
      deps.storage.setItem(settingsKey(id), JSON.stringify(values));
      running.get(id)?.worker.post({ type: 'settings', settings: values }); publish();
    },
    getScreen: id => screens.get(id),
    subscribeScreens(listener) { screenListeners.add(listener); return () => { screenListeners.delete(listener); }; },
    async act(id, action, value) {
      const run = running.get(id); if (!run) throw new PluginError('crashed', 'Plugin is not running');
      await call(run, 'ui.action', [String(action).slice(0, 60), typeof value === 'string' ? value.slice(0, 500) : value ?? null]);
    },
    getIcon(id) { try { return JSON.parse(deps.storage.getItem(codeKey(id)) ?? '{}').icon; } catch { return undefined; } },
    dispose() { disposed = true; for (const id of [...running.keys()]) stop(id); listeners.clear(); },
  };
  publish();
  for (const plugin of records) if (plugin.enabled) start(plugin);
  return api;
}
