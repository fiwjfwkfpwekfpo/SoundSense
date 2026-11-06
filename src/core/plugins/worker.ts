/**
 * Runs inside the plugin's own Worker. First it removes every way to reach the network or
 * the app's storage directly (fetch, XHR, sockets, IndexedDB, caches, nested workers...), then
 * loads the plugin module and gives it the API object. Every API call becomes a message to the
 * app, which checks it against the permissions the user granted.
 */
import { PLUGIN_API_VERSION } from './types';
import type { HostMessage, PluginManifest, WorkerMessage } from './types';

interface Scope { postMessage(message: WorkerMessage): void; onmessage: ((event: MessageEvent<HostMessage>) => void) | null; addEventListener(type: string, listener: (event: Event & { message?: string; reason?: unknown }) => void): void }
const scope = self as unknown as Scope;
const post = (message: WorkerMessage) => scope.postMessage(message);
const createObjectURL = URL.createObjectURL.bind(URL), revokeObjectURL = URL.revokeObjectURL.bind(URL), BlobType = Blob;

const BLOCKED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'WebTransport', 'indexedDB', 'IDBFactory', 'caches', 'CacheStorage', 'importScripts', 'Worker', 'SharedWorker', 'BroadcastChannel', 'RTCPeerConnection', 'FileSystemHandle', 'FileReaderSync'];
for (const name of BLOCKED) {
  for (let target: object | null = scope; target && target !== Object.prototype; target = Object.getPrototypeOf(target)) {
    if (!Object.prototype.hasOwnProperty.call(target, name)) continue;
    try { delete (target as Record<string, unknown>)[name]; } catch { /* Shadowed below. */ }
    if (Object.prototype.hasOwnProperty.call(target, name)) try { Object.defineProperty(target, name, { value: undefined, writable: false, configurable: false }); } catch { /* Best effort. */ }
  }
}
try { Object.defineProperty(navigator, 'storage', { value: undefined }); } catch { /* Not present everywhere. */ }

const errorText = (error: unknown) => error instanceof Error ? `${error.name}: ${error.message}` : String(error);
scope.addEventListener('error', event => post({ type: 'error', error: String(event.message ?? 'error') }));
scope.addEventListener('unhandledrejection', event => post({ type: 'error', error: errorText(event.reason) }));

let sequence = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
function request<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: no answer`)); }, 30_000);
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    post({ type: 'request', id, method, args });
  });
}
const listeners = new Map<string, Set<(data: unknown) => void>>();
const lyricsProviders = new Map<string, (track: unknown) => unknown>();
const menuHandlers = new Map<string, (track: unknown) => unknown>();
const actionHandlers = new Set<(action: string, value: unknown) => unknown>();
const settingsListeners = new Set<(settings: Record<string, string | boolean>) => void>();
let settings: Record<string, string | boolean> = {}, plugin: { deactivate?: () => unknown } | undefined;

function createApi(manifest: PluginManifest, locale: string) {
  return Object.freeze({
    apiVersion: PLUGIN_API_VERSION, locale,
    plugin: Object.freeze({ id: manifest.id, name: manifest.name, version: manifest.version }),
    on(event: string, handler: (data: unknown) => void) {
      if (typeof handler !== 'function') throw new TypeError('handler must be a function');
      let set = listeners.get(event);
      if (!set) { set = new Set(); listeners.set(event, set); void request('events.subscribe', event).catch(error => post({ type: 'error', error: errorText(error) })); }
      set.add(handler);
      return () => { set!.delete(handler); };
    },
    player: Object.freeze({
      state: () => request('player.state'), play: () => request('player.play'), pause: () => request('player.pause'),
      next: () => request('player.next'), previous: () => request('player.previous'), seek: (seconds: number) => request('player.seek', Number(seconds)),
    }),
    library: Object.freeze({
      isLiked: (trackId: string) => request<boolean>('library.isLiked', String(trackId)), likes: (limit = 100) => request('library.likes', Number(limit)),
      setLiked: (trackId: string, liked: boolean) => request('library.setLiked', String(trackId), !!liked), playlists: () => request('library.playlists'),
    }),
    net: Object.freeze({
      async fetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
        const response = await request<{ status: number; ok: boolean; body: string }>('net.fetch', String(url), { method: init.method ?? 'GET', headers: { ...init.headers }, ...(init.body === undefined ? {} : { body: String(init.body) }) });
        return Object.freeze({ status: response.status, ok: response.ok, text: async () => response.body, json: async () => JSON.parse(response.body) });
      },
    }),
    storage: Object.freeze({
      get: (key: string) => request('storage.get', String(key)), set: (key: string, value: unknown) => request('storage.set', String(key), value),
      delete: (key: string) => request('storage.delete', String(key)), keys: () => request<string[]>('storage.keys'),
    }),
    settings: Object.freeze({
      get: (key: string) => settings[key], all: () => ({ ...settings }),
      set: async (key: string, value: string | boolean) => { await request('settings.set', String(key), value); settings = { ...settings, [key]: value }; },
      onChange(handler: (values: Record<string, string | boolean>) => void) { settingsListeners.add(handler); return () => { settingsListeners.delete(handler); }; },
    }),
    ui: Object.freeze({
      toast: (text: string) => request('ui.toast', String(text)),
      addTrackMenuItem(item: { id: string; title: string; onSelect: (track: unknown) => unknown }) {
        if (typeof item?.onSelect !== 'function') throw new TypeError('onSelect must be a function');
        menuHandlers.set(`menu:${String(item.id)}`, item.onSelect);
        return request('ui.trackMenu.add', { id: String(item.id), title: String(item.title), icon: (item as { icon?: string }).icon });
      },
      addPlayerButton(item: { id: string; title: string; icon?: string; onPress: (track: unknown) => unknown }) {
        if (typeof item?.onPress !== 'function') throw new TypeError('onPress must be a function');
        menuHandlers.set(`button:${String(item.id)}`, item.onPress);
        return request('ui.playerButton.add', { id: String(item.id), title: String(item.title), icon: item.icon });
      },
      setScreen: (screen: { title: string; content: readonly unknown[] }) => request('ui.screen.set', screen),
      onAction(handler: (action: string, value: unknown) => unknown) {
        if (typeof handler !== 'function') throw new TypeError('handler must be a function');
        actionHandlers.add(handler); return () => { actionHandlers.delete(handler); };
      },
    }),
    registerLyrics(provider: { id: string; name: string; find: (track: unknown) => unknown }) {
      if (typeof provider?.find !== 'function') throw new TypeError('find must be a function');
      lyricsProviders.set(String(provider.id), provider.find);
      return request('provider.lyrics.register', { id: String(provider.id), name: String(provider.name) });
    },
    log: (...values: unknown[]) => { void request('log', values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ')).catch(() => {}); },
  });
}
async function answer(id: number, task: () => unknown) {
  try { post({ type: 'reply', id, ok: true, value: await task() }); }
  catch (error) { post({ type: 'reply', id, ok: false, error: errorText(error) }); }
}
scope.onmessage = async event => {
  const message = event.data;
  if (message.type === 'ping') post({ type: 'pong', n: message.n });
  else if (message.type === 'reply') { const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id); clearTimeout(entry.timer); if (message.ok) entry.resolve(message.value); else entry.reject(new Error(message.error ?? 'Request failed')); }
  else if (message.type === 'event') { for (const handler of [...listeners.get(message.name) ?? []]) try { await handler(message.data); } catch (error) { post({ type: 'error', error: errorText(error) }); } }
  else if (message.type === 'settings') { settings = message.settings; for (const handler of [...settingsListeners]) try { handler({ ...settings }); } catch (error) { post({ type: 'error', error: errorText(error) }); } }
  else if (message.type === 'call') {
    const [key, value] = message.args;
    if (message.method === 'ui.action') void answer(message.id, async () => { for (const handler of [...actionHandlers]) await handler(String(key), value); return true; });
    else {
      const handler = message.method === 'lyrics.find' ? lyricsProviders.get(String(key)) : menuHandlers.get(String(key));
      void answer(message.id, () => { if (!handler) throw new Error('Unknown handler'); return handler(value); });
    }
  }
  else if (message.type === 'stop') { try { await Promise.race([plugin?.deactivate?.(), new Promise(resolve => setTimeout(resolve, 800))]); } catch { /* Stopping anyway. */ } post({ type: 'stopped' }); }
  else if (message.type === 'load') {
    settings = message.settings;
    const url = createObjectURL(new BlobType([message.code], { type: 'text/javascript' }));
    try {
      const module = await import(/* @vite-ignore */ url) as { activate?: (api: unknown) => unknown; deactivate?: () => unknown };
      plugin = module;
      if (typeof module.activate !== 'function') throw new Error('The entry module must export activate(api)');
      await module.activate(createApi(message.manifest, message.locale));
      post({ type: 'ready' });
    } catch (error) { post({ type: 'failed', error: errorText(error) }); }
    finally { revokeObjectURL(url); }
  }
};
