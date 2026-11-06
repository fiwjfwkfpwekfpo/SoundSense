import type { HttpClient } from './http';
import type { MusicService } from './music-service';
import { asImportTrack, catalogueTrack } from './music-service';
import { ImportFailure } from './imports';
import type { ImportCollection } from './imports';
import type { MusicLink } from './links';
import type { Track } from './types';
import { PlaybackFailure } from './audio-engine';
import { sameRecording } from './matching';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
type Data = Record<string, unknown>;
const obj = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
const arr = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const str = (value: unknown): string => typeof value === 'string' ? value : value && typeof value === 'object' && 'text' in value ? String(value.text ?? '') : value && typeof value === 'object' && 'toString' in value && String(value) !== '[object Object]' ? String(value) : '';
const seconds = (value: unknown): number => typeof value === 'number' ? value : str(value).split(':').reduce((sum, part) => sum * 60 + (Number(part) || 0), 0);
const mediaUrl = (input: string) => { const url = new URL(input); if (url.protocol !== 'https:' || !/(^|\.)googlevideo\.com$/.test(url.hostname) || url.username || url.password) throw new PlaybackFailure('unavailable', 'Invalid YouTube media URL'); return url.href; };

export function youtubeTrack(value: unknown, music = false): Track | null {
  const data = obj(value), lockup = data.type === 'LockupView', metadata = obj(data.metadata), author = obj(data.author), image = obj(data.content_image), imageRows = arr(obj(metadata.metadata).metadata_rows);
  const id = str(lockup ? data.content_id : data.id ?? data.videoId), title = str(lockup ? metadata.title : data.title ?? data.name);
  if (!/^[\w-]{11}$/.test(id) || !title || lockup && data.content_type && data.content_type !== 'VIDEO') return null;
  // Music search also prints artists without a channel/browse link. The SDK's
  // artists[] omits them, so read the complete credited prefix before the album
  // separator. Otherwise a valid recording can lose one or all of its artists.
  const musicCredits = music && data.item_type === 'song' ? str(obj(arr(data.flex_columns)[1]).title).split(/\s*[•·]\s*/)[0]?.trim() : '';
  const artists = musicCredits || arr(data.artists ?? data.authors).map(value => str(obj(value).name)).filter(Boolean).join(', ');
  const rowArtist = str(obj(arr(obj(imageRows[0]).metadata_parts)[0]).text), name = (artists || str(author.name ?? data.author) || rowArtist).replace(/\s*-\s*Topic$/i, '');
  const badges = arr(image.overlays).flatMap(value => arr(obj(value).badges));
  const duration = seconds(obj(data.duration).seconds ?? (lockup ? obj(badges[0]).text : data.duration));
  const thumbs = arr(lockup ? image.image : data.thumbnails ?? obj(data.thumbnail).contents), cover = thumbs.map(obj).sort((a, b) => Math.abs(Number(a.width) - 400) - Math.abs(Number(b.width) - 400))[0];
  return catalogueTrack(music ? 'ytm' : 'yt', { id, title, artist: name, duration, artwork: cover ? str(cover.url) : `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
}

/** Select a complete audio rendition. Previews and DRM cipher material are
 * never interpreted as ordinary audio files. */
export function youtubeAudioRendition(master: string, origin: string): string {
  for (const line of master.split(/\r?\n/)) if (/^#EXT-X-MEDIA:.*TYPE=AUDIO/.test(line)) { const uri = /\bURI="([^"]+)"/.exec(line)?.[1]; if (uri && /\/itag\/(?:234|233)\//.test(uri)) return mediaUrl(new URL(uri, origin).href); }
  for (const line of master.split(/\r?\n/)) if (/^#EXT-X-MEDIA:.*TYPE=AUDIO/.test(line)) { const uri = /\bURI="([^"]+)"/.exec(line)?.[1]; if (uri) return mediaUrl(new URL(uri, origin).href); }
  throw new PlaybackFailure('unavailable', 'No full YouTube audio rendition');
}

export function createYouTube(http: HttpClient) {
  let session: Promise<import('youtubei.js/web').Innertube> | undefined;
  let visitor: { value: string; at: number } | undefined;
  const ready = () => session ??= import('youtubei.js/web').then(({ Innertube }) => Innertube.create({
    generate_session_locally: true, retrieve_player: false, enable_session_cache: false,
    fetch: async (input, init) => {
      const request = new Request(input, init), url = new URL(request.url);
      if (url.protocol !== 'https:' || !['www.youtube.com', 'music.youtube.com', 'youtubei.googleapis.com'].includes(url.hostname)) throw new Error('Unexpected YouTube metadata host');
      if (!['GET', 'POST'].includes(request.method)) throw new Error('Unsupported metadata method');
      const headers: Record<string, string> = {}; for (const [key, value] of request.headers) if (!/^(?:cookie|authorization|host|content-length)$/i.test(key)) headers[key] = value;
      const body = request.method === 'POST' ? await request.text() : undefined;
      return new Response(await http.text(url.href, request.signal, { method: request.method as 'GET' | 'POST', headers, body }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  })).catch(error => { session = undefined; throw error; });

  async function getTrack(id: string, signal?: AbortSignal, music = false): Promise<Track> {
    const plain = id.replace(/^ytm?-/, ''); if (!/^[\w-]{11}$/.test(plain)) throw new ImportFailure('invalid_link');
    const tube = await ready(); signal?.throwIfAborted(); const info = await tube.getBasicInfo(plain); signal?.throwIfAborted();
    const basic = info.basic_info, track = youtubeTrack({ id: plain, title: basic.title, author: basic.author, duration: basic.duration, thumbnails: basic.thumbnail }, music);
    if (!track) throw new ImportFailure('not_found'); return track;
  }
  async function search(query: string, signal?: AbortSignal, music = false) {
    const tube = await ready(); signal?.throwIfAborted();
    const page = music ? await tube.music.search(query, { type: 'song' }) : await tube.search(query, { type: 'video' }); signal?.throwIfAborted();
    const values = music ? arr(obj(page).contents).flatMap(value => arr(obj(value).contents)) : arr(obj(page).videos);
    const tracks = values.slice(0, 50).flatMap(value => youtubeTrack(value, music) ?? []);
    return { tracks, artists: [...new Map(tracks.map(track => [track.artist.id, track.artist])).values()], playlists: [] };
  }
  async function collection(link: MusicLink, signal?: AbortSignal, music = false): Promise<ImportCollection> {
    if (link.kind === 'track') { const track = await getTrack(link.id, signal, music); return { id: track.id, title: track.title, tracks: [asImportTrack(track)] }; }
    if (link.kind !== 'playlist' || !/^[\w-]{2,160}$/.test(link.id)) throw new ImportFailure('invalid_link');
    const tube = await ready(); signal?.throwIfAborted(); let page = await tube.getPlaylist(link.id); signal?.throwIfAborted();
    const title = page.info.title ?? (music ? 'YouTube Music' : 'YouTube'), tracks: ImportCollection['tracks'][number][] = [];
    let pages = 0;
    while (true) {
      for (const value of page.items) {
        const track = youtubeTrack(value, music);
        if (track) tracks.push(asImportTrack(track));
        else { const data = obj(value), id = str(data.id ?? data.content_id); if (id) tracks.push({ id: `yt-${id}`, title: str(data.title) || id, artist: '', unavailable: 'deleted' }); }
      }
      if (!page.has_continuation) break;
      if (++pages > 150) throw new ImportFailure('incomplete');
      signal?.throwIfAborted(); page = await page.getContinuation(); signal?.throwIfAborted();
    }
    return { id: `yt-playlist-${link.id}`, title, tracks };
  }
  async function stream(track: Track, signal?: AbortSignal) {
    let source = track.sources.find(item => item.kind === 'yt' || item.kind === 'ytm');
    if (!source) {
      const candidates = (await search(`${track.artist.name} ${track.title}`, signal, true)).tracks;
      source = candidates.find(candidate => sameRecording({ title: track.title, artist: track.artist.name, duration: track.duration }, { title: candidate.title, artist: candidate.artist.name, duration: candidate.duration }))?.sources[0];
    }
    if (!source) return null;
    if (!visitor || Date.now() - visitor.at > 10 * 60_000) {
      const page = await http.text('https://www.youtube.com/', signal, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US' } });
      visitor = { value: /"VISITOR_DATA"\s*:\s*"([^"\\]+)"/.exec(page)?.[1] ?? '', at: Date.now() };
    }
    const response = JSON.parse(await http.text('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', signal, {
      method: 'POST', headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json', 'X-Youtube-Client-Name': '101', 'X-Youtube-Client-Version': '1.02', Origin: 'https://www.youtube.com', ...(visitor.value ? { 'X-Goog-Visitor-Id': visitor.value } : {}) },
      body: JSON.stringify({ context: { client: { clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1', userAgent: USER_AGENT, osName: 'visionOS', osVersion: '26.5.23O471', hl: 'en', timeZone: 'UTC', utcOffsetMinutes: 0, visitorData: visitor.value || undefined } }, videoId: source.externalId, contentCheckOk: true, racyCheckOk: true }),
    })) as { streamingData?: { hlsManifestUrl?: string; adaptiveFormats?: readonly { url?: string; mimeType?: string; drmFamilies?: unknown; signatureCipher?: string; cipher?: string }[] }; playabilityStatus?: { status?: string } };
    const master = response.streamingData?.hlsManifestUrl;
    if (master) { const origin = mediaUrl(master), manifest = await http.text(origin, signal, { headers: { 'User-Agent': USER_AGENT } }); return { uri: youtubeAudioRendition(manifest, origin), headers: { 'User-Agent': USER_AGENT }, source }; }
    const direct = response.streamingData?.adaptiveFormats?.find(format => format.url && /^audio\//.test(format.mimeType ?? '') && !format.drmFamilies && !format.cipher && !format.signatureCipher);
    if (direct?.url) return { uri: mediaUrl(direct.url), headers: { 'User-Agent': USER_AGENT }, source };
    throw new PlaybackFailure(response.playabilityStatus?.status === 'LOGIN_REQUIRED' ? 'auth' : 'unavailable', 'YouTube did not provide a full public audio stream');
  }
  const service = (music = false): MusicService => ({ id: music ? 'ytm' : 'yt', getTrack: (id, signal) => getTrack(id, signal, music), search: (query, signal) => search(query, signal, music), collection: (link, signal) => collection(link, signal, music), stream,
    async inspect(link, signal) { if (!link) throw new ImportFailure('invalid_link'); const data = await collection(link, signal, music); return [{ id: data.id, title: data.title, count: data.tracks.length, link }]; },
  });
  return { youtube: service(), music: service(true) };
}
