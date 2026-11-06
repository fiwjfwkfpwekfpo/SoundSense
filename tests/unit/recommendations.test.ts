import { describe, expect, it } from 'vitest';
import { buildProfile, createRecommendations, pickSeeds, rankCandidates, trackKey } from '../../src/core/recommendations';
import { createLibrary } from '../../src/core/library';
import type { Track } from '../../src/core/types';

const track = (id: string, artist: string, title: string, extra: Partial<Track> = {}): Track => ({ id, title, artist: { id: `a-${artist}`, name: artist, artwork: { seed: 1, variant: 'orbit' } }, duration: 200, sources: [{ kind: 'ytm', externalId: id }], liked: false, downloaded: false, explicit: false, addedAt: 0, artwork: { seed: 1, variant: 'terrain' }, ...extra });

describe('recommendations', () => {
  it('normalizes keys like Riff (feat, brackets, official)', () => {
    expect(trackKey('Artist feat. Other', 'Song (Official Video) [HD]')).toBe(trackKey('artist', 'song'));
  });
  it('weights likes above history and adds repeat bonus', () => {
    const library = createLibrary();
    library.addTracks([track('1', 'A', 'One', { liked: true }), track('2', 'B', 'Two'), track('3', 'C', 'Three')]);
    library.recordPlay('2'); library.recordPlay('3'); library.recordPlay('2');
    const profile = buildProfile(library);
    const weight = (id: string) => profile.seeds.find(seed => seed.trackId === id)!.weight;
    expect(weight('1')).toBeGreaterThan(weight('3'));
    expect(weight('2')).toBeGreaterThan(weight('3'));
    expect(profile.heard.has(trackKey('A', 'One'))).toBe(true);
  });
  it('picks distinct weighted seeds', () => {
    const seeds = pickSeeds([{ trackId: 'a', artist: 'A', title: 'x', weight: 10 }, { trackId: 'b', artist: 'B', title: 'y', weight: 1 }], 2, () => .5);
    expect(new Set(seeds.map(seed => seed.trackId)).size).toBe(2);
  });
  it('ranks: skips heard, caps two per artist and favours new artists', () => {
    const profile = { topArtists: new Set(['top']), cyrillic: false, heard: new Set([trackKey('new', 'heard')]) };
    const candidates = [
      ...['a', 'b', 'c'].map(title => ({ artist: 'New', title, match: 1, source: 'deezer' as const, seedWeight: 1 })),
      { artist: 'New', title: 'heard', match: 1, source: 'deezer' as const, seedWeight: 1 },
      { artist: 'Top', title: 'hit', match: 1, source: 'deezer' as const, seedWeight: 1 },
      { artist: 'Other', title: 'z', match: 1, source: 'deezer' as const, seedWeight: 1 },
    ];
    const ranked = rankCandidates(candidates, profile, new Set(), 10, () => 0);
    expect(ranked.filter(item => item.artist === 'New')).toHaveLength(2);
    expect(ranked.some(item => item.title === 'heard')).toBe(false);
    expect(ranked.at(-1)!.artist).toBe('Top');
  });
  it('builds a playable list on the device from Deezer and YouTube Music', async () => {
    const library = createLibrary(); library.addTracks([track('seed', 'Seed', 'Song', { liked: true })]);
    const responses: Record<string, unknown> = {
      'search/artist': { data: [{ id: 1 }] }, 'artist/1/related': { data: [{ id: 2, name: 'Rel' }] },
      'artist/2/top': { data: [{ title: 'Deep', duration: 200, artist: { name: 'Rel' } }] }, 'artist/1/radio': { data: [] },
    };
    const http = { text: async (url: string) => { const path = new URL(url).pathname.slice(1); const key = Object.keys(responses).find(prefix => path.startsWith(prefix)); expect(new URL(url).hostname).toBe('api.deezer.com'); return JSON.stringify(key ? responses[key] : {}); } };
    const searchMusic = async (query: string) => query.endsWith(' mix') ? [track('mix-1', 'Mixer', 'Wave')] : query.includes('Deep') ? [track('yt-deep', 'Rel', 'Deep')] : [];
    const api = createRecommendations({ http, library, searchMusic });
    await api.refresh({ force: true });
    expect(api.getSnapshot().phase).toBe('ready');
    expect([...library.getSnapshot().recommendations].sort()).toEqual(['mix-1', 'yt-deep']);
  });
});
