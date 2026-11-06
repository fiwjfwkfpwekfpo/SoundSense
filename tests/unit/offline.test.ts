import { describe, expect, it, vi } from 'vitest';
import { createOffline } from '../../src/core/offline';
import type { OfflineState, OfflinePort } from '../../src/core/offline';
import { createLibrary } from '../../src/core/library';
import { createSettings } from '../../src/core/settings';
import { defaultSettings } from '../../src/ui/settings/schema';
import { localTrack } from '../../src/core/local';
import { catalogueTrack } from '../../src/core/music-service';
describe('verified offline library', () => {
  it('clears a large downloaded collection with one library update and only reconfigures on cache settings', async () => {
    const library = createLibrary(), tracks = Array.from({ length: 1500 }, (_, index) => ({ ...catalogueTrack('sc', { id: String(index), title: `Track ${index}`, artist: 'Artist', duration: 180 }), downloaded: true })); library.addTracks(tracks);
    const settings = createSettings(defaultSettings), changed = vi.fn(); library.subscribe(changed);
    const port: OfflinePort = { configure: vi.fn(async () => {}), download: vi.fn(async () => {}), remove: vi.fn(async () => {}), clear: vi.fn(async () => {}), getSnapshot: async () => ({ entries: [], bytes: 0, limit: 100 }), subscribe() { return () => {}; } };
    const offline = createOffline(library, settings, port, async () => 'https://audio.test/file'); await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(1); expect(library.getSnapshot().tracks.every(track => !track.downloaded)).toBe(true);
    settings.set('language', 'en'); settings.set('crossfade', 5); expect(port.configure).toHaveBeenCalledTimes(1);
    settings.set('autoCache', false); expect(port.configure).toHaveBeenCalledTimes(2); offline.dispose(); library.dispose();
  });
  it('lists complete remote downloads beside local originals and removes evicted remote tracks', async () => {
    const library = createLibrary(), local = localTrack({ uri: 'content://files/one.mp3', name: 'one.mp3', title: 'Local', artist: 'Test', duration: 5 }, 'Unknown')!;
    const remote = { ...local, id: 'sc-1', downloaded: false, sources: [{ kind: 'sc' as const, externalId: '1' }] }; library.addTracks([local, remote]);
    let receive: (state: OfflineState) => void = () => {};
    const port: OfflinePort = { configure: vi.fn(async () => {}), download: vi.fn(async () => {}), remove: vi.fn(async () => {}), clear: vi.fn(async () => {}), getSnapshot: async () => ({ entries: [], bytes: 0, limit: 100 }), subscribe(listener) { receive = listener; return () => {}; } };
    const offline = createOffline(library, createSettings(defaultSettings), port, async () => 'https://audio.test/file'); await Promise.resolve(); await offline.download(remote);
    expect(library.getTrack(remote.id)?.downloaded).toBe(false);
    receive({ entries: [{ id: remote.id, state: 'partial', progress: .7, bytes: 70 }], bytes: 70, limit: 100 }); expect(library.getTrack(remote.id)?.downloaded).toBe(false);
    receive({ entries: [{ id: remote.id, state: 'complete', progress: 1, bytes: 100 }], bytes: 100, limit: 100 }); expect(library.getTrack(remote.id)?.downloaded).toBe(true);
    receive({ entries: [], bytes: 0, limit: 100 }); expect(library.getTrack(remote.id)?.downloaded).toBe(false); expect(library.getTrack(local.id)?.downloaded).toBe(true);
    expect(port.download).toHaveBeenCalledWith({ id: remote.id, uri: 'https://audio.test/file' }); offline.dispose(); library.dispose();
  });
});
