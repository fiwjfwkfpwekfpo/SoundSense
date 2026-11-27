import type { LocalAudioFile, LocalAudioMetadata, LocalFileSelection } from '../core/local';
import type { Waveform } from '../core/types';
import type { OfflineState } from '../core/offline';
interface WaveRequest { duration: number; loudness?: boolean; rhythm?: boolean }
/** Errors cross IPC as values: NOT_READY (stream not prepared yet), UNAVAILABLE (no ffmpeg), CANCELLED. */
type WaveReply = Waveform | { error: 'NOT_READY' | 'UNAVAILABLE' | 'CANCELLED' };
/** What desktop/preload.cjs exposes to the window (Electron only). */
export interface DesktopBridge {
  platform: string;
  /** Computer name, used as the default device name in sync. */
  hostname: string;
  state: { read(): Promise<Record<string, string>>; write(key: string, value: string): Promise<void>; remove(key: string): Promise<void> };
  http: {
    request(id: string, options: { url: string; method?: 'GET' | 'POST'; headers?: Readonly<Record<string, string>>; body?: string }): Promise<{ status: number; text: string; retryAfter?: string }>;
    cancel(id: string): Promise<void>;
  };
  /** Encrypted by the system keyring when there is one, otherwise a file only this user can read. */
  secrets: { read(name: string): Promise<{ value?: string | null }>; write(name: string, value: string): Promise<object>; remove(name: string): Promise<void>; encrypted(): Promise<boolean> };
  accounts: { open(url: string): Promise<void> };
  files: {
    pickAudio(kind: 'files' | 'folder'): Promise<LocalFileSelection | { files: null }>;
    readAudioMetadata(file: LocalAudioFile): Promise<LocalAudioMetadata>;
    saveJson(filename: string, text: string): Promise<{ status: 'saved' | 'cancelled' }>;
  };
  clipboard: { read(): Promise<string> };
  waves: {
    read(options: WaveRequest & { uri: string }): Promise<WaveReply>; readStream(options: WaveRequest & { id: string }): Promise<WaveReply>;
    register(id: string, uri: string, headers?: Readonly<Record<string, string>>, provider?: string): Promise<void>; cancel(key: string): Promise<void>;
    stats(): Promise<{ bytes: number; count: number; limit: number }>; clear(): Promise<void>; setLimit(bytes: number): Promise<void>;
    onProgress(listener: (value: { uri: string; samples: readonly number[]; progress: number; status: 'building' | 'ready' | 'deferred' }) => void): () => void;
  };
  /** Listened and downloaded tracks on disk (desktop/music-cache.mjs). Absent in the browser stand-in. */
  cache?: {
    snapshot(): Promise<OfflineState>; configure(options: { automatic: boolean; wifiOnly: boolean; limitMb: number }): Promise<void>;
    download(options: { id: string; uri: string; headers?: Readonly<Record<string, string>> }): Promise<void>; remove(options: { id: string }): Promise<void>; clear(): Promise<void>;
    setPreferred(ids: readonly string[]): Promise<void>; source(id: string): Promise<{ available: boolean; uri?: string; provider?: string }>;
    onChange(listener: (value: OfflineState) => void): () => void;
  };
  /** Self-update of the AppImage (desktop/updater.mjs). `available` is false outside an AppImage. */
  updates: {
    available: boolean;
    download(id: string, artifact: { filename: string; size: number; sha256: string; urls: readonly string[] }): Promise<string>;
    cancel(id: string): Promise<void>; install(token: string): Promise<'opened'>;
    onProgress(listener: (value: { id: string; bytes: number }) => void): () => void;
  };
  /** Frameless window controls for the app's own title bar. Absent in the browser stand-in. */
  window?: { minimize(): void; toggleMaximize(): void; close(): void; maximized(): boolean; onMaximized(listener: (maximized: boolean) => void): () => void };
  /** Called before the window closes; pending state must be handed over before it resolves. */
  onFlush(handler: () => void | Promise<void>): void;
}
export const desktop: DesktopBridge | undefined = (globalThis as { soundsenseDesktop?: DesktopBridge }).soundsenseDesktop;
export const isDesktop = (): boolean => !!desktop;

/** Local files and app covers are file: URIs; the window reads them through ss-media://. */
export function desktopMediaUrl(uri: string, headers?: Readonly<Record<string, string>>, id?: string): string {
  if (uri.startsWith('file:')) {
    const path = decodeURIComponent(new URL(uri).pathname).replace(/^\/([A-Za-z]:\/)/, '$1');
    return `ss-media://file/?p=${encodeURIComponent(path)}`;
  }
  // With a track id the stream is also kept in the cache while it plays.
  if ((id || headers && Object.keys(headers).length) && /^https:/.test(uri) && !/\.m3u8(?:\?|$)/i.test(uri)) return `ss-media://stream/?u=${encodeURIComponent(uri)}${headers && Object.keys(headers).length ? `&h=${encodeURIComponent(JSON.stringify(headers))}` : ''}${id ? `&id=${encodeURIComponent(id)}` : ''}`;
  return uri;
}

/**
 * The waveform port in the shape of the Android SystemUi plugin, so src/platform/waveforms.ts
 * runs the same code on both. Error replies become thrown errors with the same `code`.
 */
export function desktopWaves(bridge: DesktopBridge) {
  const unwrap = async (reply: Promise<WaveReply>): Promise<Waveform> => { const value = await reply; if ('error' in value) throw Object.assign(new Error(value.error), { code: value.error }); return value; };
  return {
    readWaveform: (options: WaveRequest & { uri: string }) => unwrap(bridge.waves.read(options)),
    readStreamWaveform: (options: WaveRequest & { id: string }) => unwrap(bridge.waves.readStream(options)),
    cancelWaveform: ({ uri }: { uri: string }) => bridge.waves.cancel(uri),
    addListener(_event: 'waveformProgress', listener: Parameters<DesktopBridge['waves']['onProgress']>[0]) { const remove = bridge.waves.onProgress(listener); return Promise.resolve({ remove: async () => remove() }); },
  };
}
