import type { HttpClient } from './http';
import { getJson } from './http';
import type { ImportCollection, ImportChoice } from './imports';
import { ImportFailure } from './imports';
import type { MusicLink } from './links';
import type { Track, SearchResults } from './types';
import { asImportTrack, catalogueTrack } from './music-service';
import type { MusicService } from './music-service';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const results = (tracks: Track[]): SearchResults => ({ tracks, artists: [...new Map(tracks.map(track => [track.artist.id, track.artist])).values()], playlists: [] });
const singleChoice = (link: MusicLink, collection: ImportCollection): ImportChoice[] => [{ id: collection.id, title: collection.title, count: collection.tracks.length, liked: collection.liked, link }];
const requireLink = (link?: MusicLink): MusicLink => { if (!link) throw new ImportFailure('invalid_link'); return link; };

interface DeezerTrack { id?: number; title?: string; duration?: number; artist?: { name?: string }; album?: { id?: number; cover_big?: string; cover_xl?: string }; explicit_lyrics?: boolean; readable?: boolean }
const deezerTrack = (value: DeezerTrack): Track | null => value.id && value.title && value.artist?.name ? catalogueTrack('deezer', { id: String(value.id), title: value.title, artist: value.artist.name, duration: value.duration ?? 0, artwork: value.album?.cover_big ?? value.album?.cover_xl, explicit: value.explicit_lyrics, album: value.album?.id ? String(value.album.id) : undefined }) : null;
export function createDeezer(http: HttpClient): MusicService {
  const api = async <T>(path: string, signal?: AbortSignal): Promise<T> => { const data = await getJson<T & { error?: { code?: number } }>(http, `https://api.deezer.com${path}`, signal); if (data.error) throw new ImportFailure(data.error.code === 200 ? 'auth' : 'not_found'); return data; };
  async function getTrack(id: string, signal?: AbortSignal): Promise<Track> { const track = deezerTrack(await api<DeezerTrack>(`/track/${encodeURIComponent(id.replace(/^deezer-/, ''))}`, signal)); if (!track) throw new ImportFailure('not_found'); return track; }
  async function collection(link: MusicLink, signal?: AbortSignal): Promise<ImportCollection> {
    if (link.kind === 'track') { const track = await getTrack(link.id, signal); return { id: track.id, title: track.title, tracks: [asImportTrack(track)] }; }
    if (!['playlist', 'album'].includes(link.kind)) throw new ImportFailure('invalid_link');
    const data = await api<{ title?: string; nb_tracks?: number; tracks?: { data?: readonly DeezerTrack[]; next?: string; total?: number } }>(`/${link.kind}/${encodeURIComponent(link.id)}`, signal);
    const items = [...data.tracks?.data ?? []]; let next = data.tracks?.next, pages = 0; const seen = new Set<string>();
    while (next) {
      signal?.throwIfAborted(); const url = new URL(next);
      if (url.protocol !== 'https:' || url.hostname !== 'api.deezer.com' || seen.has(next) || ++pages > 150) throw new ImportFailure('incomplete');
      seen.add(next); const page = await api<{ data?: readonly DeezerTrack[]; next?: string }>(url.pathname + url.search, signal);
      if (!page.data?.length) throw new ImportFailure('incomplete'); items.push(...page.data); next = page.next;
    }
    if (items.length < (data.nb_tracks ?? data.tracks?.total ?? items.length)) throw new ImportFailure('incomplete');
    return { id: `deezer-${link.kind}-${link.id}`, title: data.title ?? 'Deezer', tracks: items.map(item => { const track = deezerTrack(item); return track ? asImportTrack(track) : { id: `deezer-${item.id}`, title: item.title ?? '', artist: item.artist?.name ?? '', unavailable: 'deleted' as const }; }) };
  }
  return { id: 'deezer', getTrack, collection, async inspect(link, signal) { const value = requireLink(link); return singleChoice(value, await collection(value, signal)); }, async search(query, signal) { const data = await api<{ data?: readonly DeezerTrack[] }>(`/search?${new URLSearchParams({ q: query, limit: '40' })}`, signal); return results((data.data ?? []).flatMap(item => { const track = deezerTrack(item); return track ? [track] : []; })); } };
}

interface AppleTrack { trackId?: number; trackName?: string; artistName?: string; trackTimeMillis?: number; artworkUrl100?: string; collectionId?: number; collectionName?: string; trackCount?: number; trackExplicitness?: string }
const appleTrack = (value: AppleTrack): Track | null => value.trackId && value.trackName && value.artistName ? catalogueTrack('apple', { id: String(value.trackId), title: value.trackName, artist: value.artistName, duration: (value.trackTimeMillis ?? 0) / 1000, artwork: value.artworkUrl100?.replace(/100x100/, '400x400'), explicit: value.trackExplicitness === 'explicit', album: value.collectionId ? String(value.collectionId) : undefined }) : null;
const duration = (value: unknown): number => { if (typeof value === 'number') return value > 1000 ? value / 1000 : value; const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(text(value)); return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0; };

/** Parse bounded JSON data islands only. No scripts from a music page run. */
export function parseApplePlaylist(html: string, id: string): ImportCollection {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(match => /\bid=["'](?:serialized-server-data|schema:music-playlist)["']/i.test(match[1]!));
  const records = new Map<string, Track>(); let title = '', total = 0, visited = 0;
  for (const script of scripts) {
    let value: unknown; try { value = JSON.parse(script[2]!); } catch { continue; }
    const stack = [value];
    while (stack.length) {
      if (++visited > 150000) throw new ImportFailure('incomplete');
      const raw = stack.pop(); if (Array.isArray(raw)) { stack.push(...raw); continue; }
      const node = object(raw), attrs = object(node.attributes), descriptor = object(node.contentDescriptor), artist = text(node.artistName ?? attrs.artistName ?? node.artist ?? object(node.byArtist).name);
      const name = text(node.title ?? node.name ?? attrs.name), kind = text(node.type ?? node['@type'] ?? descriptor.kind);
      if (['playlist', 'playlists', 'MusicPlaylist'].includes(kind)) { title ||= name; total = Math.max(total, number(node.trackCount ?? attrs.trackCount)); }
      if (name && artist && (['songs', 'song', 'library-songs', 'MusicRecording'].includes(kind) || descriptor.kind === 'song')) {
        const rawId = text(node.id ?? node.identifier) || String(number(node.id)) || `${artist}-${name}`;
        const track = catalogueTrack('apple', { id: rawId === '0' ? `${artist}-${name}` : rawId, title: name, artist, duration: duration(node.durationInMillis ?? attrs.durationInMillis ?? node.duration), artwork: text(object(node.artwork ?? attrs.artwork).url).replace('{w}', '400').replace('{h}', '400').replace('{f}', 'jpg') });
        records.set(track.id, track); continue;
      }
      stack.push(...Object.values(node).filter(item => item && typeof item === 'object'));
    }
  }
  if (!records.size) throw new ImportFailure('private');
  if (total && total > records.size) throw new ImportFailure('incomplete');
  return { id: `apple-playlist-${id}`, title: title || 'Apple Music', tracks: [...records.values()].map(asImportTrack) };
}

export function createApple(http: HttpClient): MusicService {
  const lookup = (id: string, signal?: AbortSignal) => getJson<{ results?: readonly AppleTrack[] }>(http, `https://itunes.apple.com/lookup?${new URLSearchParams({ id, entity: 'song', limit: '200' })}`, signal);
  async function getTrack(id: string, signal?: AbortSignal): Promise<Track> { const data = await lookup(id.replace(/^apple-/, ''), signal), track = data.results?.flatMap(item => appleTrack(item) ?? [])[0]; if (!track) throw new ImportFailure('not_found'); return track; }
  async function collection(link: MusicLink, signal?: AbortSignal): Promise<ImportCollection> {
    if (link.kind === 'track') { const track = await getTrack(link.id, signal); return { id: track.id, title: track.title, tracks: [asImportTrack(track)] }; }
    if (link.kind === 'album') { const data = await lookup(link.id, signal), tracks = (data.results ?? []).flatMap(item => { const track = appleTrack(item); return track ? [asImportTrack(track)] : []; }); if (tracks.length < (data.results?.[0]?.trackCount ?? tracks.length)) throw new ImportFailure('incomplete'); return { id: `apple-album-${link.id}`, title: data.results?.[0]?.collectionName ?? 'Apple Music', tracks }; }
    if (link.kind !== 'playlist' || new URL(link.url).hostname !== 'music.apple.com') throw new ImportFailure('invalid_link');
    return parseApplePlaylist(await http.text(link.url, signal), link.id);
  }
  return { id: 'apple', collection, getTrack, async inspect(link, signal) { const value = requireLink(link); return singleChoice(value, await collection(value, signal)); }, async search(query, signal) { const data = await getJson<{ results?: readonly AppleTrack[] }>(http, `https://itunes.apple.com/search?${new URLSearchParams({ term: query, entity: 'song', limit: '40' })}`, signal); return results((data.results ?? []).flatMap(item => { const track = appleTrack(item); return track ? [track] : []; })); } };
}

const spotifyItem = (input: unknown): Track | null => {
  const item = object(input), artist = text(item.subtitle ?? item.artist) || list(item.artists).map(value => text(object(value).name ?? object(object(value).profile).name)).filter(Boolean).join(', ') || list(object(object(item.albumOfTrack).artists).items).map(value => text(object(object(value).profile).name)).filter(Boolean).join(', ');
  const title = text(item.title ?? item.name), uri = text(item.uri), id = uri.startsWith('spotify:track:') ? uri.split(':').at(-1)! : text(item.id) || `${artist}-${title}`;
  if (!title || !artist) return null;
  return catalogueTrack('spotify', { id, title, artist, duration: (number(item.duration_ms ?? object(item.trackDuration).totalMilliseconds ?? object(item.duration).totalMilliseconds) || number(item.duration)) / 1000, artwork: text(object(list(object(item.coverArt).sources)[0]).url) });
};
export function parseSpotifyEmbed(html: string): { title: string; tracks: Track[]; total?: number; token?: string } {
  const script = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/i.exec(html);
  if (!script) throw new ImportFailure('private');
  let data: ObjectValue; try { data = object(JSON.parse(script[1]!)); } catch { throw new ImportFailure('not_found'); }
  const props = object(object(data.props).pageProps), state = object(props.state), entity = object(object(state.data).entity);
  if (props.status === 404) throw new ImportFailure('not_found');
  const entries = Array.isArray(entity.trackList) ? entity.trackList : [entity];
  return { title: text(entity.name ?? props.title) || 'Spotify', tracks: entries.flatMap(item => spotifyItem(item) ?? []), total: typeof entity.totalCount === 'number' ? entity.totalCount : entity.type === 'track' || entity.entityType === 'track' ? 1 : undefined, token: text(object(object(state.settings).session).accessToken) || undefined };
}
export function createSpotify(http: HttpClient): MusicService {
  async function collection(link: MusicLink, signal?: AbortSignal): Promise<ImportCollection> {
    if (!['playlist', 'album', 'track'].includes(link.kind)) throw new ImportFailure('invalid_link');
    const embedded = parseSpotifyEmbed(await http.text(`https://open.spotify.com/embed/${link.kind}/${encodeURIComponent(link.id)}`, signal));
    let tracks = embedded.tracks, total = embedded.total;
    if (link.kind === 'playlist' && embedded.token) {
      try {
        const items: unknown[] = []; let offset = 0;
        do {
          const page = await getSpotifyPage(link.id, offset, embedded.token, signal), content = object(object(object(page.data).playlistV2).content), values = list(content.items);
          if (!values.length && number(content.totalCount) > offset) throw new ImportFailure('incomplete');
          if (offset === 0) total = typeof content.totalCount === 'number' ? content.totalCount : undefined;
          if (total === undefined || total > 15000) throw new ImportFailure('incomplete');
          items.push(...values); offset += values.length;
        } while (offset < total);
        tracks = items.flatMap(value => { const entry = object(value); return spotifyItem(object(entry.itemV2 ?? entry.item).data) ?? []; });
        // Deleted entries remain explicit instead of silently losing rows.
        if (tracks.length !== items.length) throw new ImportFailure('incomplete');
      } catch (error) { signal?.throwIfAborted(); if (embedded.total === undefined || embedded.tracks.length !== embedded.total) throw error instanceof ImportFailure ? error : new ImportFailure('incomplete'); total = embedded.total; tracks = embedded.tracks; }
    }
    if (link.kind === 'track' && tracks.length === 1) total = 1;
    if (total === undefined || tracks.length < total) throw new ImportFailure('incomplete');
    return { id: `spotify-${link.kind}-${link.id}`, title: embedded.title, tracks: tracks.map(asImportTrack) };
  }
  async function getSpotifyPage(id: string, offset: number, token: string, signal?: AbortSignal): Promise<ObjectValue> {
    return JSON.parse(await http.text('https://api-partner.spotify.com/pathfinder/v1/query', signal, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Referer: 'https://open.spotify.com/' }, body: JSON.stringify({ operationName: 'fetchPlaylist', variables: { uri: `spotify:playlist:${id}`, offset, limit: 100, enableWatchFeedEntrypoint: true }, extensions: { persistedQuery: { version: 1, sha256Hash: '8964e8eafb21aa992a7d951d256d83285c04be2105d209262901de70cb97584a' } } }) }));
  }
  return { id: 'spotify', collection, async inspect(link, signal) { const value = requireLink(link); return singleChoice(value, await collection(value, signal)); }, async getTrack(id, signal) { const link: MusicLink = { source: 'spotify', kind: 'track', id: id.replace(/^spotify-/, ''), url: `https://open.spotify.com/track/${id.replace(/^spotify-/, '')}` }; const data = await collection(link, signal), track = data.tracks[0]?.track; if (!track) throw new ImportFailure('not_found'); return track; } };
}
