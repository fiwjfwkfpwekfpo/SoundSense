import type { LibraryApi, SettingsApi } from './api';
import type { Track } from './types';
import type { DiagnosticsApi } from './diagnostics';
export interface OfflineEntry { id: string; state: 'queued' | 'downloading' | 'complete' | 'partial'; progress: number; bytes: number; error?: string }
export interface OfflineState { entries: readonly OfflineEntry[]; bytes: number; limit: number }
export interface OfflineApi {
  getSnapshot(): OfflineState;
  subscribe(listener: (state: OfflineState) => void): () => void;
  download(track: Track): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  dispose(): void;
}
export interface OfflinePort {
  getSnapshot(): Promise<OfflineState>;
  configure(options: { automatic: boolean; wifiOnly: boolean; limitMb: number }): Promise<void>;
  download(options: { id: string; uri: string; headers?: Readonly<Record<string, string>> }): Promise<void>;
  remove(options: { id: string }): Promise<void>;
  clear(): Promise<void>;
  /** Liked tracks are evicted last. */
  setPreferred?(options: { ids: readonly string[] }): Promise<void>;
  subscribe(listener: (state: OfflineState) => void): () => void;
}
/** Native/web storage adapters own bytes. Core reconciles only verified complete files with the library. */
export function createOffline(library: LibraryApi, settings: SettingsApi, port: OfflinePort, resolve: (track: Track) => Promise<string | import('./audio-engine').AudioStream>, diagnostics?: DiagnosticsApi): OfflineApi {
  let state: OfflineState = { entries: [], bytes: 0, limit: 0 }, disposed = false;
  const listeners = new Set<(state: OfflineState) => void>();
  const accept = (value: OfflineState) => {
    if (disposed) return;
    state = value; const complete = new Set(value.entries.filter(entry => entry.state === 'complete').map(entry => entry.id));
    const updates = library.getSnapshot().tracks.filter(track => !track.sources.some(source => source.kind === 'local') && track.downloaded !== complete.has(track.id)).map(track => ({ id: track.id, downloaded: complete.has(track.id) }));
    if (updates.length) { if (library.setDownloadedBatch) library.setDownloadedBatch(updates); else for (const update of updates) library.setDownloaded(update.id, update.downloaded); }
    for (const listener of listeners) listener(state);
  };
  let configured = '';
  const configure = () => {
    const values = settings.getSnapshot(), options = { automatic: values.autoCache !== false, wifiOnly: values.wifiOnly !== false, limitMb: Number(values.storageLimit ?? 4) * 1024 }, key = JSON.stringify(options);
    if (key === configured) return; configured = key;
    void port.configure(options).catch(error => { if (configured === key) configured = ''; diagnostics?.record('offline', 'configure.failed', { message: String(error) }, 'error'); });
  };
  let preferredKey = '';
  const prefer = () => { const ids = library.getSnapshot().tracks.filter(track => track.liked).map(track => track.id), key = ids.join(','); if (key === preferredKey || !port.setPreferred) return; preferredKey = key; void port.setPreferred({ ids }).catch(() => { preferredKey = ''; }); };
  const unsubscribeLibrary = library.subscribe(prefer); prefer();
  configure(); const unsubscribe = port.subscribe(accept), unsubscribeSettings = settings.subscribe(configure);
  void port.getSnapshot().then(accept).catch(error => diagnostics?.record('offline', 'index.failed', { message: String(error) }, 'error'));
  return {
    getSnapshot: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async download(track) { const stream = await resolve(track); await port.download({ id: track.id, ...(typeof stream === 'string' ? { uri: stream } : stream) }); diagnostics?.record('offline', 'requested', { trackId: track.id }); },
    async remove(id) { await port.remove({ id }); }, async clear() { await port.clear(); },
    dispose() { disposed = true; unsubscribe(); unsubscribeSettings(); unsubscribeLibrary(); listeners.clear(); },
  };
}
