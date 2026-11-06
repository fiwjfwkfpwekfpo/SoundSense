import { Capacitor, registerPlugin } from '@capacitor/core';
import { desktop } from './desktop';
interface NativeState {
  read(): Promise<Record<string, string>>;
  write(options: { key: string; value: string }): Promise<void>;
  writeChunk(options: { key: string; id: string; index: number; count: number; data: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}
const android = registerPlugin<NativeState>('StateStore');
/** Desktop: one file per key in the XDG folders (desktop/state.mjs); the main process serializes writes per key. */
function desktopState(): NativeState | undefined {
  const bridge = desktop; if (!bridge) return undefined;
  return { read: () => bridge.state.read(), write: ({ key, value }) => bridge.state.write(key, value), remove: ({ key }) => bridge.state.remove(key),
    writeChunk: () => Promise.reject(new Error('Not used on desktop')) };
}
/** Core keeps a synchronous port; Android (AtomicFile) and desktop (files) persist commits off the UI thread. */
export async function createStorage(): Promise<Storage | undefined> {
  let browser: Storage | undefined;
  try { browser = window.localStorage; } catch { /* Native storage still works if WebView storage is disabled. */ }
  const native = desktopState() ?? (Capacitor.isNativePlatform() ? android : undefined);
  if (!native) return browser;
  const values = new Map<string, string>();
  if (browser) for (let index = 0; index < browser.length; index++) { const key = browser.key(index); if (key?.startsWith('ss_')) { const value = browser.getItem(key); if (value !== null) values.set(key, value); } }
  try {
    const saved = await native.read();
    if (Object.keys(saved).length) for (const [key, value] of Object.entries(saved)) values.set(key, value);
    else await Promise.all([...values].map(([key, value]) => native.write({ key, value })));
    // Keep WebView's view consistent for diagnostics and migration from older builds.
    // (Desktop skips it: Chromium's 10 MB localStorage quota would reject a large library.)
    if (browser && !desktop) for (const [key, value] of values) browser.setItem(key, value);
  } catch { return browser; }
  const failed = () => window.dispatchEvent(new Event('app:storage-error'));
  /*
   * Every bridge message is parsed on the Android UI thread. Writing the whole library
   * (megabytes) on each change froze input for seconds. So writes are coalesced per key
   * (1 s of quiet, at most 4 s late, immediately when the app goes to the background),
   * unchanged values are skipped, and large values travel in 96 KB pieces, one per task,
   * so input and frames get through in between.
   */
  const written = new Map<string, string>(values), dirty = new Map<string, { since: number; timer: ReturnType<typeof setTimeout> }>();
  let chain: Promise<void> = Promise.resolve();
  // Android parses bridge messages on the UI thread, so large values go in pieces there.
  // Electron IPC has no such cost, and one message keeps a desktop write atomic.
  const CHUNK = desktop ? Infinity : 96 * 1024;
  const commit = (key: string) => {
    const entry = dirty.get(key); if (entry) clearTimeout(entry.timer); dirty.delete(key);
    const value = values.get(key); if (value === undefined || written.get(key) === value) return;
    written.set(key, value);
    chain = chain.then(async () => {
      if (values.get(key) !== value) return; // A newer value is already scheduled.
      if (value.length <= CHUNK) { await native.write({ key, value }); return; }
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, count = Math.ceil(value.length / CHUNK);
      for (let index = 0; index < count; index++) {
        await native.writeChunk({ key, id, index, count, data: value.slice(index * CHUNK, (index + 1) * CHUNK) });
        if (index < count - 1) await new Promise(resolve => setTimeout(resolve, 0));
      }
    }).catch(() => { written.delete(key); failed(); });
  };
  const schedule = (key: string) => {
    const now = Date.now(), entry = dirty.get(key), since = entry?.since ?? now;
    if (entry) clearTimeout(entry.timer);
    const wait = Math.max(0, Math.min(1000, since + 4000 - now));
    dirty.set(key, { since, timer: setTimeout(() => commit(key), wait) });
  };
  const flush = () => { for (const key of [...dirty.keys()]) commit(key); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener?.('pagehide', flush);
  // Desktop: the window waits for this before it closes, so nothing written in the last second is lost.
  desktop?.onFlush(async () => { flush(); await chain; });
  const store: Storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    // AtomicFile is authoritative after migration. A second synchronous WebView
    // localStorage commit can block the first frames of a transition for large libraries.
    setItem(key, value) { values.set(key, value); schedule(key); },
    removeItem(key) { values.delete(key); written.delete(key); const entry = dirty.get(key); if (entry) clearTimeout(entry.timer); dirty.delete(key); try { browser?.removeItem(key); } catch {} void native.remove({ key }).catch(failed); },
    clear() { for (const key of [...values.keys()]) this.removeItem(key); },
  };
  return store;
}
