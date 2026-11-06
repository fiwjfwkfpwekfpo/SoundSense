import { describe, expect, it } from 'vitest';
import { localTrack } from '../../src/core/local';
import { albums, artists } from '../../src/ui/library-groups';
import type { Track } from '../../src/core/types';

const file = (name: string, tags: Record<string, unknown>) => localTrack({ uri: `file:///music/${name}`, name, duration: 120, ...tags }, 'Unknown');

describe('local albums and artists from tags', () => {
  it('groups tracks by album artist and album, in disc and track order', () => {
    const tracks = [
      file('b2.flac', { title: 'B2', artist: 'Guest', albumArtist: 'Band', album: 'Record', trackNo: 2, discNo: 1, year: 2020 }),
      file('d2.flac', { title: 'D2-1', artist: 'Band', albumArtist: 'Band', album: 'Record', trackNo: 1, discNo: 2 }),
      file('b1.flac', { title: 'B1', artist: 'Band', album: 'Record', trackNo: 1, discNo: 1 }),
      file('x.mp3', { title: 'Loose', artist: 'Band' }),
      file('o.mp3', { title: 'Other', artist: 'Solo', album: 'Record', trackNo: 1 }),
    ].filter((track): track is Track => !!track);
    const grouped = albums(tracks);
    expect(grouped.map(album => [album.artist, album.title, album.tracks.map(track => track.title)])).toEqual([
      ['Band', 'Record', ['B1', 'B2', 'D2-1']], ['Solo', 'Record', ['Other']],
    ]);
    expect(grouped[0]!.year).toBe(2020);
    expect(artists(tracks).map(item => [item.artist.name, item.tracks, item.albums])).toEqual([['Band', 3, 1], ['Guest', 1, 1], ['Solo', 1, 1]]);
  });
  it('ignores impossible track numbers and years', () => {
    const track = file('a.mp3', { title: 'A', artist: 'X', album: 'Y', trackNo: 0, discNo: 5000, year: 3 })!;
    expect(track.trackNo).toBeUndefined(); expect(track.discNo).toBeUndefined(); expect(track.album).toEqual({ title: 'Y', artist: 'X' });
  });
});
