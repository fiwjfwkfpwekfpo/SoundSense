import type { Track } from './types';

export interface LocalAudioFile {
  uri: string; name: string; path?: string; size?: number; modifiedAt?: number; mime?: string;
}
export interface LocalAudioMetadata extends LocalAudioFile {
  title?: string; artist?: string; album?: string; albumArtist?: string; year?: number; trackNo?: number; discNo?: number; duration?: number; artworkUri?: string; error?: string;
}
export interface LocalFileSelection { files: readonly LocalAudioFile[]; name?: string; limited?: boolean }
export interface LocalScanProgress { completed: number; total: number; name: string }
export const AUDIO_EXTENSIONS = /\.(flac|mp3|ogg|oga|opus|m4a|mp4|aac|wav|aif|aiff|alac|wma)$/i;

/** Stable across rescans and app restarts. No title-based merging of different recordings. */
export function localId(uri: string): string {
  // SAF returns a tree URI for folders and a document URI for individual selection.
  uri = uri.replace(/\/tree\/[^/]+\/document\//, '/document/');
  let a = 2166136261, b = 5381;
  for (let index = 0; index < uri.length; index++) { a = Math.imul(a ^ uri.charCodeAt(index), 16777619); b = Math.imul(b, 33) ^ uri.charCodeAt(index); }
  return `local-${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`;
}
const positive = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0 && (value as number) < 1000;
const validYear = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 1800 && (value as number) < 2200;
export function localTrack(file: LocalAudioMetadata, unknownArtist: string): Track | null {
  if (file.error || !file.duration || !Number.isFinite(file.duration) || file.duration <= 0) return null;
  const id = localId(file.uri), seed = parseInt(id.split('-')[1]!, 36) % 10000;
  const title = file.title?.trim() || file.name.replace(/\.[^.]+$/, '');
  const artist = file.artist?.trim() || unknownArtist;
  return { id, title, artist: { id: `local-artist-${localId(artist)}`, name: artist, artwork: { seed, variant: 'terrain' } },
    duration: file.duration, sources: [{ kind: 'local', externalId: file.uri }], explicit: false, liked: false, downloaded: true,
    addedAt: Date.now(), artwork: { seed, variant: 'terrain', ...(file.artworkUri ? { url: file.artworkUri } : {}) },
    // Albums are grouped by album artist (falls back to the track artist), as music players do.
    ...(file.album?.trim() ? { albumId: `local-album-${localId(`${file.albumArtist?.trim() || artist}/${file.album.trim()}`)}`, album: { title: file.album.trim(), artist: file.albumArtist?.trim() || artist, ...(validYear(file.year) ? { year: file.year } : {}) } } : {}),
    ...(positive(file.trackNo) ? { trackNo: file.trackNo } : {}), ...(positive(file.discNo) ? { discNo: file.discNo } : {}) };
}
