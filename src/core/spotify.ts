import { unzip, strFromU8 } from 'fflate';
import { ImportFailure } from './imports';
import type { ImportCollection, ImportTrack } from './imports';
import { catalogueTrack } from './music-service';
const MAX_ARCHIVE = 30 * 1024 * 1024, MAX_JSON = 12 * 1024 * 1024;
function tracks(input: unknown): ImportTrack[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const object = entry as Record<string, unknown>;
    const track = (object.track && typeof object.track === 'object' ? object.track : object) as Record<string, unknown>;
    const title = track.track ?? track.trackName ?? track.name;
    const artist = track.artist ?? track.artistName;
    if (typeof title !== 'string' || typeof artist !== 'string') return [];
    return [{ id: typeof track.uri === 'string' ? track.uri : `spotify-${index}-${artist}-${title}`, title: title.slice(0, 500), artist: artist.slice(0, 500), ...(typeof track.duration_ms === 'number' ? { duration: track.duration_ms / 1000 } : {}) }];
  });
}
/** Files remain in memory; only two documented Account data JSON shapes are read. */
export function parseSpotifyFiles(files: Record<string, Uint8Array>): ImportCollection[] {
  const libraryKey = Object.keys(files).find(key => /(?:^|\/)YourLibrary\.json$/i.test(key));
  if (!libraryKey) throw new ImportFailure('invalid_archive');
  try {
    const read = (key: string): Record<string, unknown> => {
      if (files[key]!.length > MAX_JSON) throw new Error('JSON too large');
      return JSON.parse(strFromU8(files[key]!)) as Record<string, unknown>;
    };
    const library = read(libraryKey);
    if (!Array.isArray(library.tracks)) throw new Error('Missing tracks');
    const result: ImportCollection[] = [{ id: 'spotify-library', title: 'YourLibrary', tracks: tracks(library.tracks), liked: true }];
    for (const key of Object.keys(files).filter(key => /(?:^|\/)Playlist[^/]*\.json$/i.test(key))) {
      const data = read(key);
      if (!Array.isArray(data.playlists)) throw new Error('Missing playlists');
      data.playlists.forEach((value: unknown, index) => {
        const playlist = value as Record<string, unknown>;
        if (typeof playlist.name === 'string' && Array.isArray(playlist.items)) result.push({ id: `${key}-${index}`, title: playlist.name, tracks: tracks(playlist.items) });
      });
    }
    return result;
  } catch { throw new ImportFailure('invalid_archive'); }
}
export async function parseSpotifyArchive(bytes: Uint8Array, catalogue = false): Promise<ImportCollection[]> {
  if (bytes.length > MAX_ARCHIVE) throw new ImportFailure('invalid_archive', 'Compressed archive exceeds 30 MiB');
  try {
    let total = 0;
    const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => unzip(bytes, { filter(file) {
      const accepted = /(?:^|\/)(?:YourLibrary|Playlist[^/]*)\.json$/i.test(file.name);
      if (accepted) { total += file.originalSize; if (total > MAX_ARCHIVE || file.originalSize > MAX_JSON) return false; }
      return accepted;
    } }, (error, data) => error ? reject(error) : resolve(data)));
    if (total > MAX_ARCHIVE) throw new Error('Expanded archive too large');
    const collections = parseSpotifyFiles(files);
    return catalogue ? collections.map(collection => ({ ...collection, tracks: collection.tracks.map(original => ({ ...original, track: catalogueTrack('spotify', { id: original.id.replace(/^spotify:track:/, ''), title: original.title, artist: original.artist, duration: original.duration ?? 0 }) })) })) : collections;
  } catch (error) { throw error instanceof ImportFailure ? error : new ImportFailure('invalid_archive'); }
}
