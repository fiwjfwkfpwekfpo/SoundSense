import type { Artist, Artwork, Track } from '../core/types';
/** Albums and artists built from track tags (local music), as Poweramp-style players show them. */
export interface AlbumGroup { id: string; title: string; artist: string; year?: number; artwork: Artwork; tracks: Track[] }
export interface ArtistGroup { artist: Artist; tracks: number; albums: number }
/** Disc, then track number, then title — the order of the album itself. */
export const albumOrder = (a: Track, b: Track) => (a.discNo ?? 1) - (b.discNo ?? 1) || (a.trackNo ?? 9999) - (b.trackNo ?? 9999) || a.title.localeCompare(b.title);
export function albums(tracks: readonly Track[]): AlbumGroup[] {
  const groups = new Map<string, AlbumGroup>();
  for (const track of tracks) {
    if (!track.albumId || !track.album) continue;
    const group = groups.get(track.albumId) ?? { id: track.albumId, title: track.album.title, artist: track.album.artist ?? track.artist.name, ...(track.album.year ? { year: track.album.year } : {}), artwork: track.artwork, tracks: [] };
    // A track with a real cover gives the album its cover.
    if (!group.artwork.url && track.artwork.url) group.artwork = track.artwork;
    group.tracks.push(track); groups.set(track.albumId, group);
  }
  for (const group of groups.values()) group.tracks.sort(albumOrder);
  return [...groups.values()].sort((a, b) => a.artist.localeCompare(b.artist) || (a.year ?? 0) - (b.year ?? 0) || a.title.localeCompare(b.title));
}
export function artists(tracks: readonly Track[]): ArtistGroup[] {
  const groups = new Map<string, { artist: Artist; tracks: number; albums: Set<string> }>();
  for (const track of tracks) {
    const group = groups.get(track.artist.id) ?? { artist: track.artist, tracks: 0, albums: new Set<string>() };
    group.tracks++; if (track.albumId) group.albums.add(track.albumId); groups.set(track.artist.id, group);
  }
  return [...groups.values()].map(group => ({ artist: group.artist, tracks: group.tracks, albums: group.albums.size })).sort((a, b) => a.artist.name.localeCompare(b.artist.name));
}
export const isLocal = (track: Track) => track.sources.some(source => source.kind === 'local');
