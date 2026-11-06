import type { ImportChoice, ImportCollection } from './imports';
import type { MusicLink } from './links';
import type { SearchResults, Track, TrackSource } from './types';
import type { AudioStream } from './audio-engine';
import { localId } from './local';

/** Built-ins and future plugins enter through the same registries. Platform
 * adapters inject HTTP and credentials; service code never imports a UI. */
export interface MusicService {
  id: string;
  search?(query: string, signal?: AbortSignal): Promise<SearchResults>;
  getTrack(id: string, signal?: AbortSignal): Promise<Track>;
  inspect(link?: MusicLink, signal?: AbortSignal): Promise<readonly ImportChoice[]>;
  collection(link: MusicLink, signal?: AbortSignal): Promise<ImportCollection>;
  stream?(track: Track, signal?: AbortSignal): Promise<(AudioStream & { source: TrackSource }) | null>;
}

export function catalogueTrack(source: string, value: { id: string; title: string; artist: string; duration: number; artwork?: string; explicit?: boolean; album?: string }): Track {
  const seed = [...`${source}:${value.id}`].reduce((sum, letter) => (sum * 31 + letter.charCodeAt(0)) >>> 0, 0);
  let url: string | undefined;
  try { if (value.artwork && new URL(value.artwork).protocol === 'https:') url = value.artwork; } catch { /* Deterministic artwork remains usable. */ }
  const artwork = { seed, variant: 'orbit' as const, ...(url ? { url } : {}) };
  const id = /^[A-Za-z\d_-]{1,130}$/.test(value.id) ? value.id : localId(`${source}:${value.id}`).replace(/^local-/, 'record-');
  return { id: `${source}-${id}`, title: value.title.slice(0, 500), artist: { id: `${source}-artist-${value.artist}`, name: value.artist.slice(0, 500), artwork }, duration: Math.max(0, value.duration || 0), sources: [{ kind: source, externalId: value.id }], artwork, explicit: !!value.explicit, liked: false, downloaded: false, addedAt: Date.now(), ...(value.album ? { albumId: `${source}-album-${value.album}` } : {}) };
}

export const asImportTrack = (track: Track) => ({ id: track.id, title: track.title, artist: track.artist.name, duration: track.duration || undefined, track });
