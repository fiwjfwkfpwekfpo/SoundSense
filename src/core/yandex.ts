import { md5 } from '@noble/hashes/legacy';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import type { HttpClient, HttpOptions } from './http';
import { HttpFailure } from './http';
import type { Artwork, Track, SearchResults } from './types';
import type { ImportChoice, ImportCollection, ImportTrack } from './imports';
import { ImportFailure } from './imports';
import type { MusicLink } from './links';
import { PlaybackFailure, playbackFailureReason } from './audio-engine';
import { sameRecording } from './matching';
import type { DiagnosticsApi } from './diagnostics';
import { errorDetails } from './diagnostics';

interface YaTrack { id?: string | number; title?: string; version?: string; durationMs?: number; available?: boolean; coverUri?: string; artists?: readonly { id: string | number; name: string }[]; albums?: readonly { id: string | number }[]; explicit?: boolean; contentWarning?: string }
interface Ref { id?: string | number; albumId?: string | number; track?: YaTrack; richData?: YaTrack; title?: string; durationMs?: number }
interface YaPlaylist { uid?: string | number; kind?: string | number; playlistUuid?: string; title?: string; trackCount?: number; tracks?: readonly Ref[]; owner?: { uid?: string | number; login?: string }; volumes?: readonly (readonly YaTrack[])[] }
const headers = { Accept: 'application/json', 'X-Yandex-Music-Client': 'YandexMusicAndroid/24023231' };
const root = 'https://api.music.yandex.net';
const idOf = (value: string | number | undefined) => String(value ?? '');
const fullCodecs = new Set(['mp3', 'aac', 'he-aac', 'aac-mp4', 'he-aac-mp4', 'flac', 'flac-mp4']);
function mediaUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new PlaybackFailure('unavailable', 'Invalid Yandex media URL', undefined, 'YA_MEDIA_URL'); }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || !/(^|\.)yandex(?:music)?\.net$/.test(url.hostname) || url.username || url.password || url.port && url.port !== '443') throw new PlaybackFailure('unavailable', 'Invalid Yandex media host', undefined, 'YA_MEDIA_HOST');
  if (/\/encraw(?:\/|$)/i.test(url.pathname)) throw new PlaybackFailure('protected', 'Yandex returned an encrypted transport', undefined, 'YA_ENCRYPTED_TRANSPORT');
  return url;
}
/** Some storage hosts ignore format=json and still return the documented XML
 * ticket. Read only its four scalar fields; never interpret external entities. */
function downloadTicket(text: string): { host?: string; path?: string; ts?: string; s?: string } {
  if (text.trimStart().startsWith('{')) return JSON.parse(text);
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || !/<download-info(?:\s|>)/.test(text)) throw new PlaybackFailure('unavailable', 'Invalid Yandex download ticket', undefined, 'YA_TICKET_FORMAT');
  return Object.fromEntries(['host', 'path', 'ts', 's'].map(key => [key, new RegExp(`<${key}>([^<]*)</${key}>`).exec(text)?.[1]?.replace(/&(?:amp|quot|apos|lt|gt);/g, entity => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' })[entity]!)]));
}
function cover(uri: string | undefined): string | undefined {
  if (!uri) return;
  try { const url = new URL((uri.startsWith('https:') ? uri : `https://${uri}`).replace('%%', '400x400')); return url.protocol === 'https:' && /(^|\.)yandex(?:music)?\.(net|ru)$/.test(url.hostname) ? url.href : undefined; } catch { return; }
}
export function yandexTrack(data: YaTrack): Track | null {
  const id = idOf(data.id), duration = Number(data.durationMs) / 1000;
  if (!id || !data.title || !Number.isFinite(duration) || duration <= 0) return null;
  const name = (data.artists ?? []).map(artist => artist.name).filter(Boolean).join(', '), seed = [...id].reduce((sum, letter) => (sum * 31 + letter.charCodeAt(0)) >>> 0, 0);
  const title = data.version && !data.title.toLowerCase().includes(data.version.toLowerCase()) ? `${data.title} (${data.version})` : data.title;
  const url = cover(data.coverUri), artwork: Artwork = { seed, variant: 'terrain', ...(url ? { url } : {}) };
  return { id: `ya-${id}`, title, artist: { id: `ya-artist-${data.artists?.[0]?.id ?? id}`, name, artwork }, artwork, duration, sources: [{ kind: 'ya', externalId: id }], albumId: data.albums?.[0] ? `ya-album-${data.albums[0].id}` : undefined, liked: false, downloaded: false, explicit: !!data.explicit || data.contentWarning === 'explicit', addedAt: Date.now(), ...(data.available === false ? { playbackHint: 'unavailable' as const } : {}) };
}
async function pooled<T, R>(items: readonly T[], count: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length); let index = 0;
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => { while (index < items.length) { const current = index++; results[current] = await run(items[current]!, current); } }));
  return results;
}
export function createYandex(http: HttpClient, token: () => Promise<string | undefined>, diagnostics?: DiagnosticsApi) {
  const likes = new Map<string, readonly Ref[]>();
  async function api<T>(path: string, signal?: AbortSignal, options?: HttpOptions, authorization: 'public' | 'optional' | 'required' = 'optional'): Promise<T> {
    async function request(credential?: string): Promise<T> {
      signal?.throwIfAborted();
      const data = JSON.parse(await http.text(root + path, signal, { ...options, headers: { ...headers, ...(credential ? { Authorization: `OAuth ${credential}` } : {}), ...options?.headers } })) as { result?: T; error?: { name?: string; message?: string } };
      if (data.error) throw new ImportFailure(/unauthor|auth|not.logged/i.test(data.error.name ?? '') ? 'auth' : 'not_found', `${data.error.name ?? ''}: ${data.error.message ?? ''}`);
      if (data.result === undefined || data.result === null) throw new ImportFailure('not_found'); return data.result;
    }
    // Public links and catalogue metadata work independently of account state,
    // including an expired login. Credentials are needed only for private data.
    if (authorization === 'public') return request();
    if (authorization === 'optional') {
      try { return await request(); }
      catch (error) {
        signal?.throwIfAborted();
        if (!(error instanceof HttpFailure && [401, 403, 451].includes(error.status)) && !(error instanceof ImportFailure && error.kind === 'auth')) throw error;
        let credential: string | undefined; try { credential = await token(); } catch { signal?.throwIfAborted(); throw error; }
        if (!credential) throw error instanceof HttpFailure && error.status !== 451 ? new ImportFailure('auth') : error;
        try { return await request(credential); } catch (failed) { if (failed instanceof HttpFailure && [401, 403].includes(failed.status)) throw new ImportFailure('auth'); throw failed; }
      }
    }
    const credential = await token(); signal?.throwIfAborted(); if (!credential) throw new ImportFailure('auth');
    try { return await request(credential); } catch (error) { if (error instanceof HttpFailure && [401, 403].includes(error.status)) throw new ImportFailure('auth'); throw error; }
  }
  async function getTrack(id: string, signal?: AbortSignal): Promise<Track> {
    const data = await api<readonly YaTrack[]>(`/tracks/${encodeURIComponent(id.replace(/^ya-/, ''))}`, signal), track = yandexTrack(data[0] ?? {});
    if (!track) throw new ImportFailure('not_found'); return track;
  }
  async function account(signal?: AbortSignal) { const status = await api<{ account?: { uid?: string | number; login?: string; displayName?: string } }>('/account/status', signal, undefined, 'required'); const uid = idOf(status.account?.uid); if (!uid) throw new ImportFailure('auth'); return { uid, name: status.account?.displayName || status.account?.login || uid }; }
  async function search(query: string, signal?: AbortSignal): Promise<SearchResults> {
    const data = await api<{ tracks?: { results?: readonly YaTrack[] } }>(`/search?${new URLSearchParams({ text: query, type: 'all', page: '0', nocorrect: 'true' })}`, signal);
    const tracks = (data.tracks?.results ?? []).flatMap(item => { const track = yandexTrack(item); return track ? [track] : []; });
    return { tracks, artists: [...new Map(tracks.map(track => [track.artist.id, track.artist])).values()], playlists: [] };
  }
  async function playlist(link: MusicLink, signal?: AbortSignal): Promise<YaPlaylist> {
    if (link.kind === 'album') return api(`/albums/${encodeURIComponent(link.id)}/with-tracks`, signal);
    if (link.id.includes('/') && link.user) return api(`/users/${encodeURIComponent(link.user)}/playlists/${encodeURIComponent(link.id.split('/').at(-1)!)}`, signal);
    const paths = [`/playlist/${encodeURIComponent(link.id)}?richTracks=true`, `/playlist/${encodeURIComponent(link.id)}`];
    if (link.id.startsWith('lk.')) paths.push(`/playlist/${encodeURIComponent(link.id.slice(3))}?richTracks=true`);
    let failure: unknown;
    for (const path of paths) { try { const data = await api<YaPlaylist>(path, signal); if (Array.isArray(data.tracks)) return data; } catch (error) { signal?.throwIfAborted(); failure = error; if (!(error instanceof ImportFailure && ['not_found', 'auth'].includes(error.kind)) && !(error instanceof HttpFailure && error.status === 404)) throw error; } }
    throw failure ?? new ImportFailure('not_found');
  }
  async function likeRefs(owner: string, signal?: AbortSignal, authorization: 'optional' | 'required' = 'optional'): Promise<readonly Ref[]> {
    const path = `/users/${encodeURIComponent(owner)}`;
    const read = async (mode: 'public' | 'required'): Promise<readonly Ref[]> => {
      try { const data = await api<{ library?: { tracks?: readonly Ref[] } }>(`${path}/likes/tracks`, signal, undefined, mode); if (Array.isArray(data.library?.tracks)) return data.library.tracks; throw new ImportFailure('not_found'); }
      catch (error) {
        signal?.throwIfAborted();
        if (!(error instanceof HttpFailure && [401, 403, 404].includes(error.status)) && !(error instanceof ImportFailure && ['auth', 'not_found'].includes(error.kind))) throw error;
        const playlist = await api<YaPlaylist>(`${path}/playlists/3`, signal, undefined, mode); if (!Array.isArray(playlist.tracks)) throw new ImportFailure('not_found'); return playlist.tracks;
      }
    };
    let refs: readonly Ref[];
    if (authorization === 'required') refs = await read('required');
    else {
      try { refs = await read('public'); }
      catch (error) {
        signal?.throwIfAborted();
        if (!(error instanceof HttpFailure && [401, 403].includes(error.status)) && !(error instanceof ImportFailure && error.kind === 'auth')) throw error;
        refs = await read('required');
      }
    }
    likes.set(owner, refs); if (likes.size > 3) likes.delete(likes.keys().next().value!); return refs;
  }
  async function inspect(link?: MusicLink, signal?: AbortSignal): Promise<readonly ImportChoice[]> {
    if (link?.kind === 'likes' && !link.id.startsWith('lk.')) { const refs = await likeRefs(link.user ?? link.id, signal); return [{ id: `ya-likes-${link.user ?? link.id}`, title: 'Мне нравится', count: refs.length, liked: true, link }]; }
    if (link && link.kind !== 'profile') { const data = await playlist(link, signal); return [{ id: `ya-${link.id}`, title: data.title || 'Яндекс Музыка', count: data.trackCount ?? data.tracks?.length, liked: link.kind === 'likes', link }]; }
    const owner = link?.user ?? (await account(signal)).uid;
    const [lists, liked] = await Promise.all([api<readonly YaPlaylist[]>(`/users/${encodeURIComponent(owner)}/playlists/list`, signal, undefined, link ? 'optional' : 'required'), likeRefs(owner, signal, link ? 'optional' : 'required')]);
    const result: ImportChoice[] = [{ id: `ya-likes-${owner}`, title: 'Мне нравится', count: liked.length, liked: true, link: { source: 'ya', kind: 'likes', id: owner, user: owner, url: `https://music.yandex.ru/users/${encodeURIComponent(owner)}/playlists/3` } }];
    for (const item of lists) {
      const kind = idOf(item.kind), uid = idOf(item.owner?.uid ?? item.uid ?? owner); if (!kind || kind === '3') continue;
      result.push({ id: `ya-list-${uid}-${kind}`, title: item.title || kind, count: item.trackCount, link: { source: 'ya', kind: 'playlist', id: `${uid}/${kind}`, user: uid, url: `https://music.yandex.ru/users/${encodeURIComponent(uid)}/playlists/${encodeURIComponent(kind)}` } });
    }
    return result;
  }
  async function collection(link: MusicLink, signal?: AbortSignal, progress?: (completed: number, total: number) => void): Promise<ImportCollection> {
    let refs: readonly Ref[], title: string;
    if (link.kind === 'likes' && !link.id.startsWith('lk.')) { const owner = link.user ?? link.id; refs = likes.get(owner) ?? await likeRefs(owner, signal); likes.delete(owner); title = 'Мне нравится'; }
    else { const data = await playlist(link, signal); title = data.title || 'Яндекс Музыка'; refs = link.kind === 'album' ? (data.volumes ?? []).flat() : data.tracks ?? []; }
    if (!refs.length) return { id: `ya-${link.id}`, title, liked: link.kind === 'likes', tracks: [] };
    const records = new Map<string, YaTrack>(), missing = new Map<string, string>();
    for (const ref of refs) { const raw = ref.track ?? ref.richData ?? ref as YaTrack, id = idOf(raw.id ?? ref.id); if (raw.title && raw.durationMs) records.set(id, raw); else if (id) missing.set(id, ref.albumId ? `${id}:${ref.albumId}` : id); }
    const ids = [...missing.values()], batches: string[][] = []; for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
    let completed = refs.length - missing.size; progress?.(completed, refs.length);
    await pooled(batches, 3, async batch => {
      signal?.throwIfAborted(); const data = await api<readonly YaTrack[]>('/tracks', signal, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ 'track-ids': batch.join(',') }).toString() });
      for (const track of data) records.set(idOf(track.id), track); completed += batch.length; progress?.(Math.min(completed, refs.length), refs.length);
    });
    const tracks: ImportTrack[] = refs.map(ref => { const id = idOf(ref.track?.id ?? ref.richData?.id ?? ref.id), data = records.get(id), track = data && yandexTrack(data); return track ? { id: track.id, title: track.title, artist: track.artist.name, duration: track.duration, track } : { id: `ya-${id}`, title: data?.title || id, artist: '', unavailable: 'deleted' }; });
    return { id: `ya-${link.id}`, title, liked: link.kind === 'likes', tracks };
  }
  let legacyBrokenAt = 0; const LEGACY_RETRY_MS = 6 * 60 * 60_000;
  async function stream(track: Track, signal?: AbortSignal): Promise<{ uri: string; source: Track['sources'][number] } | null> {
    let source = track.sources.find(item => item.kind === 'ya');
    const credential = await token(); if (!credential) { if (!source) return null; throw new ImportFailure('auth'); }
    if (!source) { const result = await search(`${track.artist.name} ${track.title}`, signal); const match = result.tracks.find(candidate => sameRecording({ title: track.title, artist: track.artist.name, duration: track.duration }, { title: candidate.title, artist: candidate.artist.name, duration: candidate.duration })); source = match?.sources[0]; }
    if (!source) return null;
    let legacyFailure: unknown;
    // The legacy ticket flow has been failing for every track; after one failure the
    // working raw flow is used directly for a while (two requests fewer per track).
    if (Date.now() - legacyBrokenAt > LEGACY_RETRY_MS) try {
      const options = await api<readonly { codec?: string; bitrateInKbps?: number; downloadInfoUrl?: string; preview?: boolean }[]>(`/tracks/${encodeURIComponent(source.externalId)}/download-info`, signal, undefined, 'required');
      if (!Array.isArray(options)) throw new PlaybackFailure('unavailable', 'Invalid Yandex download variants', undefined, 'YA_VARIANTS_FORMAT');
      const full = options.filter(item => !item.preview && fullCodecs.has(item.codec ?? '') && item.downloadInfoUrl).sort((a, b) => (b.bitrateInKbps ?? 0) - (a.bitrateInKbps ?? 0));
      diagnostics?.record('yandex', 'stream.variants', { trackId: track.id, count: options.length, full: full.length, variants: options.map(item => `${item.codec}:${item.bitrateInKbps}:${item.preview ? 'preview' : 'full'}`).join(', ') });
      if (!full.length) throw new PlaybackFailure(options.some(item => item.preview) ? 'preview' : 'unavailable', 'Yandex returned no full legacy audio variant', undefined, options.length ? 'YA_NO_FULL_VARIANT' : 'YA_EMPTY_VARIANTS');
      for (const variant of full.slice(0, 3)) {
        try {
          const ticket = mediaUrl(variant.downloadInfoUrl!); ticket.searchParams.set('format', 'json');
          // Tickets and media hosts never receive the account Authorization header.
          const details = downloadTicket(await http.text(ticket.href, signal));
          if (!details.host || !/^[a-z\d.-]+\.yandex(?:music)?\.net$/i.test(details.host) || !details.path?.startsWith('/') || /[?#]/.test(details.path) || !/^\d+$/.test(details.ts ?? '') || !details.s) throw new PlaybackFailure('unavailable', 'Invalid Yandex download ticket fields', undefined, 'YA_TICKET_FIELDS');
          const signature = [...md5(new TextEncoder().encode(`XGRlBW9FXlekgbPrRHuSiA${details.path.slice(1)}${details.s}`))].map(value => value.toString(16).padStart(2, '0')).join('');
          return { uri: mediaUrl(`https://${details.host}/get-mp3/${signature}/${details.ts}${details.path}`).href, source };
        } catch (error) { signal?.throwIfAborted(); legacyFailure = error; }
      }
      throw legacyFailure;
    } catch (error) {
      signal?.throwIfAborted(); legacyFailure = error;
      const reason = playbackFailureReason(error);
      if (['network', 'timeout', 'region'].includes(reason)) throw error;
      if (['YA_TICKET_FIELDS', 'YA_TICKET_FORMAT', 'YA_VARIANTS_FORMAT'].includes(String((error as { code?: unknown }).code))) legacyBrokenAt = Date.now();
      diagnostics?.record('yandex', 'stream.legacy.unavailable', { trackId: track.id, reason, ...errorDetails(error) });
    }
    // Current API also supports ordinary raw files for an authorized account.
    // Request signing is independent of media encryption; encrypted transports
    // are never requested or passed to the audio engine.
    const ts = String(Math.floor(Date.now() / 1000)), quality = 'hq', codecs = ['mp3', 'aac', 'he-aac', 'aac-mp4', 'he-aac-mp4'], transport = 'raw';
    const bytes = hmac(sha256, 'kzqU4XhfCaY6B6JTHODeq5', `${ts}${source.externalId}${quality}${codecs.join('')}${transport}`);
    const sign = btoa(String.fromCharCode(...bytes)).slice(0, -1);
    const query = new URLSearchParams({ ts, trackId: source.externalId, quality, codecs: codecs.join(','), transports: transport, sign });
    const info = await api<{ downloadInfo?: { codec?: string; transport?: string; url?: string; urls?: readonly string[]; preview?: boolean; key?: string } }>(`/get-file-info?${query}`, signal, { headers: { 'X-Yandex-Music-Client': 'YandexMusicDesktopAppWindows/5.95.0' } }, 'required');
    const file = info.downloadInfo;
    if (file?.transport !== 'raw' || file.key) throw new PlaybackFailure(file?.transport === 'encraw' || file?.key ? 'protected' : 'unavailable', 'Yandex did not return a raw audio transport', undefined, 'YA_FILE_TRANSPORT');
    if (file.preview || !fullCodecs.has(file.codec ?? '')) throw new PlaybackFailure(file.preview ? 'preview' : 'unsupported', 'Yandex did not return a supported full audio file', undefined, 'YA_FILE_CODEC');
    const uri = file.url ?? file.urls?.[0];
    if (!uri) throw legacyFailure ?? new PlaybackFailure('unavailable', 'Yandex returned no full audio URL', undefined, 'YA_FILE_URL');
    diagnostics?.record('yandex', 'stream.raw.selected', { trackId: track.id, codec: file.codec, transport: file.transport });
    return { uri: mediaUrl(uri).href, source };
  }
  /**
   * Lyrics of a Yandex track (synced LRC first, then plain text). Requests are
   * signed like the official clients: base64(HMAC-SHA256(key, trackId + timestamp)).
   */
  async function lyrics(id: string, signal?: AbortSignal): Promise<{ synced?: string; plain?: string } | null> {
    const plain = id.replace(/^ya-/, ''); if (!/^\d+$/.test(plain)) return null;
    const result: { synced?: string; plain?: string } = {};
    for (const format of ['LRC', 'TEXT'] as const) {
      try {
        const timestamp = String(Math.floor(Date.now() / 1000));
        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('p93jhgh689SBReK6ghtw62'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(plain + timestamp)))));
        const data = await api<{ downloadUrl?: string }>(`/tracks/${plain}/lyrics?${new URLSearchParams({ format, timeStamp: timestamp, sign: signature })}`, signal, undefined, 'required');
        if (!data.downloadUrl || !/^https:\/\//.test(data.downloadUrl)) continue;
        const text = (await http.text(data.downloadUrl, signal)).trim(); if (!text) continue;
        if (format === 'LRC') { result.synced = text; break; } else result.plain = text;
      } catch (error) { signal?.throwIfAborted(); if (error instanceof ImportFailure && error.kind === 'auth') return null; }
    }
    return result.synced || result.plain ? result : null;
  }
  return { account, inspect, collection, search, getTrack, stream, lyrics };
}
