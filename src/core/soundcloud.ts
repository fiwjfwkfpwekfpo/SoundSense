import type { HttpClient } from './http';
import { getJson } from './http';
import type { Track } from './types';
import type { MusicLink } from './links';
import { parseMusicLink } from './links';
import type { ImportChoice, ImportCollection, ImportTrack } from './imports';
import { ImportFailure } from './imports';
import publicClient from './sc-public-client.json';
import { PlaybackFailure } from './audio-engine';
import type { DiagnosticsApi } from './diagnostics';
import { errorDetails } from './diagnostics';
import { samePlaybackRecording } from './matching';

interface Transcoding { url: string; preset: string; snipped?: boolean; duration?: number; format?: { protocol?: string; mime_type?: string } }
interface SoundCloudTrack { id: number; kind?: string; title?: string; duration?: number; full_duration?: number; permalink_url?: string; artwork_url?: string; waveform_url?: string;
  user?: { id?: number; username?: string; avatar_url?: string }; publisher_metadata?: { artist?: string; explicit?: boolean }; policy?: string; track_authorization?: string; media?: { transcodings?: readonly Transcoding[] } }
interface SoundCloudSet { id: number; kind: string; title?: string; username?: string; likes_count?: number; public_favorites_count?: number; track_count?: number; permalink_url?: string; tracks?: readonly SoundCloudTrack[] }
interface Page { collection: readonly (SoundCloudTrack | { track?: SoundCloudTrack })[]; next_href?: string }
export function soundCloudTrack(data: SoundCloudTrack): Track | null {
  const duration = (data.full_duration || data.duration || 0) / 1000;
  if (!data.id || !data.title || !Number.isFinite(duration) || duration <= 0) return null;
  const name = data.publisher_metadata?.artist?.trim() || data.user?.username || 'SoundCloud';
  const artwork = data.artwork_url || data.user?.avatar_url;
  return { id: `sc-${data.id}`, title: data.title, duration, artist: { id: `sc-user-${data.user?.id ?? data.id}`, name, artwork: { seed: data.user?.id ?? data.id, variant: 'orbit' } },
    artwork: { seed: data.id, variant: 'terrain', ...(artwork ? { url: artwork.replace(/-large\./, '-t500x500.') } : {}) }, sources: [{ kind: 'sc', externalId: String(data.id) }], explicit: !!data.publisher_metadata?.explicit, liked: false, downloaded: false, addedAt: Date.now(),
    ...(data.policy === 'SNIP' ? { playbackHint: 'preview' as const } : data.policy === 'BLOCK' ? { playbackHint: 'unavailable' as const } : data.media?.transcodings?.length && data.media.transcodings.every(item => /encrypted/.test(item.format?.protocol ?? '')) ? { playbackHint: 'protected' as const } : {}) };
}
export function createSoundCloud(http: HttpClient, storage?: Pick<Storage, 'getItem' | 'setItem'>, diagnostics?: DiagnosticsApi) {
  const records = new Map<string, SoundCloudTrack>();
  const waveformCache = new Map<string, { samples: readonly number[] }>(), waveformRequests = new Map<string, Promise<{ samples: readonly number[] } | null>>();
  let client: Promise<string> | undefined;
  async function discover(): Promise<string> {
    const html = await http.text('https://soundcloud.com/');
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]!).filter(url => /^https:\/\/a-v2\.sndcdn\.com\//.test(url));
    for (const script of scripts.reverse().slice(0, 12)) {
      const source = await http.text(script), key = /client_id\s*:\s*"([a-zA-Z0-9]{32})"/.exec(source)?.[1];
      if (key) { try { storage?.setItem('ss_sc_public_client', key); } catch { /* Public client discovery also works without storage. */ } return key; }
    }
    throw new Error('SoundCloud public client is unavailable');
  }
  function clientId(): Promise<string> { if (!client) { let cached = publicClient.clientId; try { cached = storage?.getItem('ss_sc_public_client') || cached; } catch {} client = /^[a-zA-Z0-9]{32}$/.test(cached) ? Promise.resolve(cached) : discover(); client.catch(() => client = undefined); } return client; }
  async function api<T>(path: string, parameters: Record<string, string> = {}, signal?: AbortSignal, retry = true): Promise<T> {
    const url = new URL(path.startsWith('https:') ? path : `https://api-v2.soundcloud.com/${path}`);
    if (url.hostname !== 'api-v2.soundcloud.com') throw new ImportFailure('invalid_link');
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    url.searchParams.set('client_id', await clientId()); signal?.throwIfAborted();
    try { return await getJson<T>(http, url.href, signal); }
    catch (error) { if (retry && [401, 403].includes(Number((error as { status?: number }).status))) { client = discover(); return api<T>(path, parameters, signal, false); } throw error; }
  }
  function remember(data: SoundCloudTrack): Track | null { const track = soundCloudTrack(data); if (track) { records.set(track.id, data); if (records.size > 200) records.delete(records.keys().next().value!); } return track; }
  async function getTrack(id: string, signal?: AbortSignal): Promise<Track> { const data = await api<SoundCloudTrack>(`tracks/${encodeURIComponent(id.replace(/^sc-/, ''))}`, {}, signal); const track = remember(data); if (!track) throw new ImportFailure('not_found'); return track; }
  async function resolve(url: string, signal?: AbortSignal): Promise<SoundCloudTrack & SoundCloudSet> { return api('resolve', { url }, signal); }
  async function search(query: string, signal?: AbortSignal): Promise<readonly Track[]> { const data = await api<{ collection: readonly SoundCloudTrack[] }>('search/tracks', { q: query, limit: '30', linked_partitioning: '1' }, signal); return data.collection.flatMap(data => { const track = remember(data); return track ? [track] : []; }); }
  async function directStream(track: Track, signal?: AbortSignal): Promise<string | null> {
    const source = track.sources.find(source => source.kind === 'sc'); if (!source) return null;
    // Search transcodings expire. Fetch fresh full metadata before resolving a stream.
    await getTrack(source.externalId, signal); const data = records.get(`sc-${source.externalId}`);
    if (!data) throw new PlaybackFailure('unavailable', 'SoundCloud metadata is unavailable');
    if (data.policy === 'SNIP') throw new PlaybackFailure('preview', 'SoundCloud only offers a preview');
    if (data.policy === 'BLOCK') throw new PlaybackFailure('region', 'SoundCloud playback is restricted');
    const transcodings = data.media?.transcodings ?? [];
    const formats = transcodings.filter(format => !format.snipped && !format.preset.startsWith('abr') && ['hls', 'progressive'].includes(format.format?.protocol ?? '') && (!format.duration || Math.abs(format.duration / 1000 - track.duration) < 4))
      .sort((a,b) => Number(b.preset.includes('aac_160')) - Number(a.preset.includes('aac_160')));
    diagnostics?.record('soundcloud', 'stream.variants', { trackId: track.id, title: track.title, variants: transcodings.map(item => `${item.preset}:${item.format?.protocol}:${item.snipped ? 'preview' : 'full'}`).join(', '), usable: formats.length });
    if (!formats.length && transcodings.some(format => /encrypted/.test(format.format?.protocol ?? ''))) throw new PlaybackFailure('protected', 'SoundCloud provides only licensed DRM streams');
    let last: unknown;
    for (const format of formats) {
      try {
        const result = await api<{ url?: string }>(format.url, data.track_authorization ? { track_authorization: data.track_authorization } : {}, signal);
        if (result.url && /^https:\/\//.test(result.url)) { diagnostics?.record('soundcloud', 'stream.selected', { trackId: track.id, preset: format.preset, protocol: format.format?.protocol }); return result.url; }
      } catch (error) { signal?.throwIfAborted(); last = error; diagnostics?.record('soundcloud', 'stream.variant.failed', { trackId: track.id, preset: format.preset, ...errorDetails(error) }, 'warn'); }
    }
    if (last) throw last;
    throw new PlaybackFailure('unavailable', 'No full SoundCloud stream is available');
  }
  async function stream(track: Track, signal?: AbortSignal): Promise<string | null> {
    try { return await directStream(track, signal); }
    catch (error) {
      signal?.throwIfAborted();
      if (!(error instanceof PlaybackFailure) || !['protected', 'region', 'preview', 'unavailable'].includes(error.reason)) throw error;
      // Never replace a recording based only on a similar title. Both artists, version and full duration must agree.
      const candidates = await search(`${track.artist.name} ${track.title}`, signal).catch(() => []);
      const exact = candidates.filter(candidate => candidate.id !== track.id && !candidate.playbackHint && samePlaybackRecording({ title: track.title, artist: track.artist.name, duration: track.duration }, { title: candidate.title, artist: candidate.artist.name, duration: candidate.duration }));
      for (const candidate of exact.slice(0, 2)) {
        try { const uri = await directStream(candidate, signal); if (uri) { diagnostics?.record('soundcloud', 'stream.alternative', { trackId: track.id, candidateId: candidate.id, title: candidate.title, artist: candidate.artist.name, duration: candidate.duration }); return uri; } }
        catch { signal?.throwIfAborted(); }
      }
      throw error;
    }
  }
  const imported = (data: SoundCloudTrack): ImportTrack => {
    const track = remember(data); return { id: `sc-${data.id}`, title: data.title || '', artist: track?.artist.name || data.user?.username || '', duration: track?.duration,
      ...(track ? { track } : {}), ...(!track ? { unavailable: 'deleted' as const } : data.policy === 'SNIP' ? { unavailable: 'preview' as const } : data.policy === 'BLOCK' ? { unavailable: 'private' as const } : {}) };
  };
  async function collection(link: MusicLink, signal?: AbortSignal): Promise<ImportCollection> {
    if (link.kind === 'likes') {
      const user = await resolve(`https://soundcloud.com/${encodeURIComponent(link.user ?? link.id)}`, signal);
      let page: string | undefined = `users/${user.id}/likes?limit=200&linked_partitioning=1`; const tracks: ImportTrack[] = [];
      while (page && tracks.length < 10000) { const data: Page = await api(page, {}, signal); for (const item of data.collection) if ('track' in item && item.track) tracks.push(imported(item.track)); page = data.next_href; }
      if (page) throw new ImportFailure('incomplete');
      return { id: `sc-likes-${user.id}`, title: user.username || link.user || 'SoundCloud', liked: true, tracks };
    }
    const set = await resolve(link.url, signal);
    if (set.kind !== 'playlist' || !Array.isArray(set.tracks)) throw new ImportFailure('not_found');
    if (set.tracks.length > 10000) throw new ImportFailure('incomplete');
    const tracks: ImportTrack[] = [], entries = set.tracks.slice(0, 10000);
    for (let index = 0; index < entries.length; index += 50) {
      const batch = entries.slice(index, index + 50), missing = batch.filter(track => !track.title);
      const fetched = missing.length ? await api<SoundCloudTrack[]>('tracks', { ids: missing.map(track => track.id).join(',') }, signal) : [];
      const byId = new Map(fetched.map(track => [track.id, track])); tracks.push(...batch.map(track => imported(track.title ? track : byId.get(track.id) ?? track)));
    }
    return { id: `sc-set-${set.id}`, title: set.title || 'SoundCloud', tracks };
  }
  async function inspect(link?: MusicLink, signal?: AbortSignal): Promise<readonly ImportChoice[]> {
    if (!link) throw new ImportFailure('invalid_link');
    if (link.kind === 'short') { const item = await resolve(link.url, signal); const parsed = item.permalink_url && parseMusicLink(item.permalink_url); if (!parsed) throw new ImportFailure('invalid_link'); return inspect(parsed, signal); }
    if (link.kind !== 'profile') { const data = await resolve(link.kind === 'likes' ? `https://soundcloud.com/${encodeURIComponent(link.user ?? link.id)}` : link.url, signal); return [{ id: `sc-${link.kind}-${data.id}`, title: data.title || data.username || 'SoundCloud', count: link.kind === 'likes' ? data.likes_count ?? data.public_favorites_count : data.track_count ?? data.tracks?.length, liked: link.kind === 'likes', link }]; }
    const user = await resolve(link.url, signal); if (user.kind !== 'user') throw new ImportFailure('invalid_link');
    const result: ImportChoice[] = [{ id: `sc-likes-${user.id}`, title: 'Мне нравится', count: user.likes_count ?? user.public_favorites_count, liked: true, link: { ...link, kind: 'likes', url: link.url.replace(/\/+$/, '') + '/likes' } }];
    let page: string | undefined = `users/${user.id}/playlists_without_albums?limit=200&linked_partitioning=1`;
    while (page) { signal?.throwIfAborted(); const data: { collection: readonly SoundCloudSet[]; next_href?: string } = await api(page, {}, signal); for (const set of data.collection) { if (!set.permalink_url) continue; const parsed = parseMusicLink(set.permalink_url); if (parsed) result.push({ id: `sc-set-${set.id}`, title: set.title || 'SoundCloud', count: set.track_count ?? set.tracks?.length, link: parsed }); } page = data.next_href; }
    return result;
  }
  return { search, getTrack, stream, resolve, collection, inspect, remember,
    async fromLink(link: MusicLink, signal?: AbortSignal) { const track = remember(await resolve(link.url, signal)); if (!track) throw new ImportFailure('not_found'); return track; },
    async waveform(id: string, signal?: AbortSignal) {
      signal?.throwIfAborted();
      if (waveformCache.has(id)) return waveformCache.get(id)!;
      if (!waveformRequests.has(id)) waveformRequests.set(id, (async () => {
        let data = records.get(id); if (!data) { await getTrack(id); data = records.get(id); }
        if (!data?.waveform_url || !/^https:\/\/wave\.sndcdn\.com\//.test(data.waveform_url)) return null;
        const wave = await getJson<{ samples: number[] }>(http, data.waveform_url), max = Math.max(1, ...wave.samples), result = { samples: wave.samples.map(sample => sample / max) };
        waveformCache.set(id, result); if (waveformCache.size > 32) waveformCache.delete(waveformCache.keys().next().value!); return result;
      })().finally(() => waveformRequests.delete(id)));
      const result = await waveformRequests.get(id)!; signal?.throwIfAborted(); return result;
    },
  };
}
