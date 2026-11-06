import { afterEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(async (_options: { key: string; value: string }) => {}), remove: vi.fn(async (_options: { key: string }) => {}), writeChunk: vi.fn(async (_options: { key: string; id: string; index: number; count: number; data: string }) => {}) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true }, registerPlugin: () => native }));
import { createStorage } from '../../src/platform/storage';
function memory(entries: [string, string][] = []): Storage {
  const values = new Map(entries);
  return { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null, getItem: key => values.get(key) ?? null, setItem(key, value) { values.set(key, value); }, removeItem(key) { values.delete(key); }, clear() { values.clear(); } };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('Android state persistence', () => {
  it('recovers committed native state when WebView localStorage has an older snapshot', async () => {
    const localStorage = memory([['ss_library_v2', 'old']]);
    vi.stubGlobal('window', { localStorage }); native.read.mockResolvedValue({ ss_library_v2: 'committed' });
    const storage = await createStorage(); expect(storage?.getItem('ss_library_v2')).toBe('committed'); expect(localStorage.getItem('ss_library_v2')).toBe('committed');
  });
  it('migrates existing 0.2 WebView state before initializing the core', async () => {
    vi.stubGlobal('window', { localStorage: memory([['ss_library_v2', 'library'], ['other', 'unrelated']]) }); native.read.mockResolvedValue({});
    const storage = await createStorage(); expect(native.write).toHaveBeenCalledExactlyOnceWith({ key: 'ss_library_v2', value: 'library' }); expect(storage?.getItem('other')).toBeNull();
    vi.useFakeTimers(); storage?.setItem('ss_settings_v1', 'new'); await vi.advanceTimersByTimeAsync(1100); expect(native.write).toHaveBeenLastCalledWith({ key: 'ss_settings_v1', value: 'new' });
    storage?.clear(); expect(storage?.length).toBe(0); expect(native.remove.mock.calls.map(call => call[0].key)).toEqual(['ss_library_v2', 'ss_settings_v1']);
  });
  it('still restores native state when WebView storage is denied', async () => {
    vi.stubGlobal('window', { get localStorage() { throw Error('Denied'); } }); native.read.mockResolvedValue({ ss_settings_v1: 'saved' });
    expect((await createStorage())?.getItem('ss_settings_v1')).toBe('saved');
  });
  it('keeps new state readable without blocking on a second WebView storage write', async () => {
    const localStorage = memory([['ss_library_v2', 'old']]);
    vi.stubGlobal('window', { localStorage }); native.read.mockResolvedValue({ ss_library_v2: 'committed' });
    const storage = await createStorage();
    const browserWrite = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw Error('Synchronous WebView storage is unavailable'); });
    vi.useFakeTimers(); storage!.setItem('ss_library_v2', 'updated');
    expect(storage!.getItem('ss_library_v2')).toBe('updated');
    await vi.advanceTimersByTimeAsync(1100); vi.useRealTimers();
    expect(native.write).toHaveBeenLastCalledWith({ key: 'ss_library_v2', value: 'updated' });
    expect(browserWrite).not.toHaveBeenCalled();
    native.read.mockResolvedValue({ ss_library_v2: 'updated' }); browserWrite.mockRestore();
    expect((await createStorage())!.getItem('ss_library_v2')).toBe('updated');
  });
  it('coalesces rapid writes and sends large values in pieces', async () => {
    vi.stubGlobal('window', { localStorage: memory() }); native.read.mockResolvedValue({ ss_x: 'a' });
    const storage = (await createStorage())!; vi.useFakeTimers();
    for (let i = 0; i < 20; i++) { storage.setItem('ss_library_v2', `v${i}`); await vi.advanceTimersByTimeAsync(300); }
    // Never more than 4 s late even while changes keep coming, and never once per change.
    expect(native.write.mock.calls.length).toBeGreaterThan(0); expect(native.write.mock.calls.length).toBeLessThan(5);
    await vi.advanceTimersByTimeAsync(1100); expect(native.write).toHaveBeenLastCalledWith({ key: 'ss_library_v2', value: 'v19' });
    const big = 'x'.repeat(250 * 1024); storage.setItem('ss_library_v2', big); await vi.advanceTimersByTimeAsync(1500);
    const pieces = native.writeChunk.mock.calls.map(call => call[0]);
    expect(pieces.length).toBe(3); expect(pieces.map(piece => piece.data).join('')).toBe(big); expect(pieces.every(piece => piece.count === 3)).toBe(true);
    const before = native.write.mock.calls.length; storage.setItem('ss_library_v2', big); await vi.advanceTimersByTimeAsync(1500); expect(native.write.mock.calls.length).toBe(before); expect(native.writeChunk.mock.calls.length).toBe(3);
  });
});
