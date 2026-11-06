import { describe, expect, it, vi } from 'vitest';
import { createExtensions } from '../../src/core/runtime';
import { PlaybackFailure } from '../../src/core/audio-engine';
import type { Track } from '../../src/core/types';

const track = { id: 'sc-1', title: 'Song', artist: { id: 'a', name: 'Artist', artwork: { seed: 1, variant: 'terrain' } }, artwork: { seed: 1, variant: 'terrain' }, duration: 100, sources: [{ kind: 'sc', externalId: '1' }], liked: false, downloaded: false, addedAt: 0 } as unknown as Track;
const memory = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } }; };

describe('source memory', () => {
  it('skips a service that could not give the track, across restarts, and still tries it when nothing else is left', async () => {
    const storage = memory();
    const setup = () => {
      const extensions = createExtensions();
      const sc = vi.fn(async () => { throw new PlaybackFailure('protected', 'DRM only'); });
      const ya = vi.fn(async () => ({ uri: 'https://ya/1.mp3', source: { kind: 'ya' as const, externalId: '9' } }));
      const base = { titleKey: 't', search: async () => ({ tracks: [], artists: [], playlists: [] }), getTrack: async () => undefined, parseLink: () => null };
      extensions.sources.register({ id: 'sc', ...base, resolveStream: sc });
      extensions.sources.register({ id: 'ya', ...base, resolveStream: ya });
      extensions.sources.remember(storage);
      return { extensions, sc, ya };
    };
    const first = setup();
    expect((await first.extensions.sources.resolve(track)).uri).toBe('https://ya/1.mp3'); expect(first.sc).toHaveBeenCalledTimes(1);
    expect((await first.extensions.sources.resolve(track)).uri).toBe('https://ya/1.mp3'); expect(first.sc).toHaveBeenCalledTimes(1);
    const restarted = setup();
    await restarted.extensions.sources.resolve(track); expect(restarted.sc).not.toHaveBeenCalled();
    // Network errors are not remembered.
    const offline = setup(); offline.ya.mockRejectedValueOnce(new Error('network down'));
    await offline.extensions.sources.resolve({ ...track, id: 'sc-2' });
    await offline.extensions.sources.resolve({ ...track, id: 'sc-2' }); expect(offline.ya).toHaveBeenCalledTimes(2);
  });
});
