import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createUpdates, UPDATE_CONTEXT, verifyUpdate } from '../../src/core/updates';
import type { UpdateManifest } from '../../src/core/updates';

const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
function manifest(code = 2): UpdateManifest {
  return { schema: 1, version: `0.${code}.0`, versionCode: code, publishedAt: '2026-11-03T00:00:00Z', notes: { ru: ['Исправления'], en: ['Fixes'] }, artifacts: { android: { filename: 'SoundSense.apk', sha256: 'ab'.repeat(32), size: 1234, urls: ['https://mirror.test/SoundSense.apk'] } } };
}
function signed(value = manifest()) {
  const bytes = Buffer.from(JSON.stringify(value));
  return JSON.stringify({ schema: 1, payload: bytes.toString('base64'), signature: sign(null, Buffer.concat([Buffer.from(UPDATE_CONTEXT), bytes]), keys.privateKey).toString('hex') });
}
describe('signed update trust and fallback', () => {
  it('rejects another channel before storing its version, then accepts the matching mirror', async () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const beta = { ...manifest(99), channel: 'beta' as const };
    const stable = { ...manifest(2), channel: 'stable' as const };
    const text = vi.fn(async (url: string) => signed(url.includes('beta') ? beta : stable));
    const updates = createUpdates({ http: { text }, channel: 'stable', installed: { version: '0.1.0', versionCode: 1 }, platform: 'android', publicKey, storage, urls: () => ['https://release.test/beta.json', 'https://release.test/stable.json'] });
    await updates.check();
    expect(text).toHaveBeenCalledTimes(2);
    expect(updates.getSnapshot()).toMatchObject({ phase: 'available', manifest: { channel: 'stable', versionCode: 2 } });
    expect(data.get('ss_update_highest_seen')).toBe('2');
  });
  it('keeps beta rollback protection separate and rejects legacy stable manifests in beta', async () => {
    const data = new Map([['ss_update_highest_seen', '99']]);
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const options = { channel: 'beta' as const, installed: { version: '0.1.0', versionCode: 1 }, platform: 'android' as const, publicKey, storage, urls: () => ['https://release.test/beta.json'] };
    const legacy = createUpdates({ ...options, http: { text: async () => signed() } });
    await legacy.check(); expect(legacy.getSnapshot()).toMatchObject({ phase: 'error', error: 'channel' });
    const beta = createUpdates({ ...options, http: { text: async () => signed({ ...manifest(), channel: 'beta' }) } });
    await beta.check(); expect(beta.getSnapshot()).toMatchObject({ phase: 'available', manifest: { channel: 'beta' } });
    expect(data.get('ss_update_highest_seen')).toBe('99');
    expect(data.get('ss_update_highest_seen_beta')).toBe('2');
  });
  it('accepts the signed payload but rejects changes to the release or signer', async () => {
    expect(await verifyUpdate(signed(), publicKey)).toEqual(manifest());
    const tampered = JSON.parse(signed()); tampered.payload = Buffer.from(JSON.stringify(manifest(99))).toString('base64');
    await expect(verifyUpdate(JSON.stringify(tampered), publicKey)).rejects.toMatchObject({ code: 'signature' });
    const stranger = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
    await expect(verifyUpdate(signed(), stranger)).rejects.toMatchObject({ code: 'signature' });
  });
  it('rejects unsafe artifact URLs even in an authentic manifest', async () => {
    const value = manifest(); value.artifacts.android!.urls = ['http://mirror.test/unsafe.apk'];
    await expect(verifyUpdate(signed(value), publicKey)).rejects.toMatchObject({ code: 'invalid' });
  });
  it('tries mirrors sequentially after network and signature failures', async () => {
    const text = vi.fn(async (url: string) => { if (url.includes('offline')) throw Error('Offline'); if (url.includes('hacked')) return '{}'; return signed(); });
    const updates = createUpdates({ http: { text }, installed: { version: '0.1.0', versionCode: 1 }, platform: 'android', publicKey, urls: () => ['https://offline.test/stable.json', 'https://hacked.test/stable.json', 'https://backup.test/stable.json'] });
    await updates.check(); expect(text.mock.calls.map(call => call[0])).toEqual(['https://offline.test/stable.json', 'https://hacked.test/stable.json', 'https://backup.test/stable.json']);
    expect(updates.getSnapshot()).toMatchObject({ phase: 'available', manifest: { versionCode: 2 }, source: 'https://backup.test/stable.json' });
  });
  it('remembers the highest authenticated version across restarts and rejects rollback', async () => {
    const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const options = { installed: { version: '0.1.0', versionCode: 1 }, platform: 'android' as const, publicKey, storage, urls: () => ['https://release.test/stable.json'] };
    const first = createUpdates({ ...options, http: { text: async () => signed(manifest(3)) } }); await first.check();
    const next = createUpdates({ ...options, http: { text: async () => signed(manifest(2)) } }); await next.check(); expect(next.getSnapshot()).toMatchObject({ phase: 'error', error: 'rollback' });
  });
  it('passes only verified artifacts to the installer and requires a separate installation action', async () => {
    const download = vi.fn(async (_artifact, progress) => { progress(1234); return 'opaque-native-token'; }), install = vi.fn(async () => 'permission' as const);
    const options = { installed: { version: '0.1.0', versionCode: 1 }, platform: 'android' as const, publicKey, urls: () => ['https://release.test/stable.json'], installer: { download, install } };
    const bad = createUpdates({ ...options, http: { text: async () => '{}' } }); await bad.check(); await bad.download(); await bad.install(); expect(download).not.toHaveBeenCalled(); expect(install).not.toHaveBeenCalled();
    const updates = createUpdates({ ...options, http: { text: async () => signed() } }); await updates.check(); await updates.download();
    expect(download.mock.calls[0]?.[0]).toEqual(manifest().artifacts.android); expect(updates.getSnapshot()).toMatchObject({ phase: 'ready', downloaded: 1234 }); expect(install).not.toHaveBeenCalled();
    await updates.check(); expect(updates.getSnapshot().phase).toBe('ready');
    await updates.install(); expect(install).toHaveBeenCalledWith('opaque-native-token'); expect(updates.getSnapshot().phase).toBe('permission');
    await updates.check(); expect(updates.getSnapshot().phase).toBe('permission');
  });
  it('cancels an in-flight download without surfacing stale completion as ready', async () => {
    let finish!: (value: string) => void;
    const updates = createUpdates({ http: { text: async () => signed() }, installed: { version: '0.1.0', versionCode: 1 }, platform: 'android', publicKey, urls: () => ['https://release.test/stable.json'], installer: { download: () => new Promise(resolve => finish = resolve), install: async () => 'opened' } });
    await updates.check(); const pending = updates.download(); updates.cancel(); finish('unused'); await pending;
    expect(updates.getSnapshot().phase).toBe('available');
  });
});
