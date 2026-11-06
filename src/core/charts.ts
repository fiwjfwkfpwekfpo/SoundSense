import type { HttpClient } from './http';
import { getJson } from './http';
import type { Track } from './types';
import type { createSoundCloud } from './soundcloud';
import type { LibraryApi } from './api';
export type ChartSource = 'ya' | 'spotify' | 'sc';
export interface Chart { source: ChartSource; title: string; url: string; updatedAt: number; tracks: readonly Track[]; stale?: boolean }
export interface ChartsApi { get(source: ChartSource, signal?: AbortSignal, force?: boolean): Promise<Chart> }
export function parseSpotifyChart(html: string): readonly Track[] {
  const raw = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!raw) throw new Error('Spotify embed data is missing');
  const entity = JSON.parse(raw).props?.pageProps?.state?.data?.entity;
  if (!Array.isArray(entity?.trackList)) throw new Error('Spotify chart schema changed');
  const artwork = entity.coverArt?.sources?.[0]?.url;
  return entity.trackList.flatMap((item: { uri?: string; title?: string; subtitle?: string; duration?: number; isExplicit?: boolean }, index: number) => {
    const id = /^spotify:track:([\w]+)$/.exec(item.uri ?? '')?.[1]; if (!id || !item.title || !item.duration || !Number.isFinite(item.duration)) return [];
    const seed = index + 6000;
    return [{ id: `spotify-${id}`, title: item.title, artist: { id: `spotify-artist-${item.subtitle}`, name: item.subtitle ?? '', artwork: { seed, variant: 'orbit' as const } }, duration: item.duration / 1000,
      sources: [{ kind: 'spotify', externalId: id }], liked: false, downloaded: false, explicit: !!item.isExplicit, addedAt: Date.now(), artwork: { seed, variant: 'terrain' as const, ...(artwork ? { url: artwork } : {}) } }];
  });
}
export function parseYandexChart(data: unknown): readonly Track[] {
  const entries = (data as { result?: { chart?: { tracks?: { track?: { id: string; title: string; durationMs?: number; coverUri?: string; explicit?: boolean; contentWarning?: string; artists?: { id: string; name: string }[]; albums?: { id: string }[] } }[] } } }).result?.chart?.tracks;
  if (!Array.isArray(entries)) throw new Error('Yandex chart schema changed');
  return entries.flatMap(({ track }, index) => {
    if (!track?.id || !track.title || !track.durationMs) return [];
    const seed = index + 7000, artist = track.artists?.map(artist => artist.name).join(', ') ?? '', artwork = track.coverUri ? `https://${track.coverUri.replace('%%', '400x400')}` : undefined;
    return [{ id: `ya-${track.id}`, title: track.title, artist: { id: `ya-artist-${track.artists?.[0]?.id}`, name: artist, artwork: { seed, variant: 'orbit' as const } }, duration: track.durationMs / 1000,
      sources: [{ kind: 'ya', externalId: String(track.id) }], albumId: track.albums?.[0] ? `ya-album-${track.albums[0].id}` : undefined, liked: false, downloaded: false, explicit: !!track.explicit || track.contentWarning === 'explicit', addedAt: Date.now(), artwork: { seed, variant: 'terrain' as const, ...(artwork ? { url: artwork } : {}) } }];
  });
}
export function createCharts(http: HttpClient, sc: ReturnType<typeof createSoundCloud>, library: LibraryApi, storage?: Pick<Storage, 'getItem' | 'setItem'>): ChartsApi {
  const cache = new Map<ChartSource, Chart>();
  for (const source of ['sc', 'spotify', 'ya'] as const) { try { const saved = JSON.parse(storage?.getItem(`ss_chart_${source}`) ?? 'null'); if (saved?.source === source && Array.isArray(saved.tracks) && saved.tracks.every((track: Track) => track && typeof track.id === 'string' && typeof track.title === 'string' && track.artist && track.artwork && Array.isArray(track.sources) && Number.isFinite(track.duration)) && Number.isFinite(saved.updatedAt)) cache.set(source, saved); } catch {} }
  return { async get(source, signal, force = false) {
    const cached = cache.get(source);
    if (cached && !force && Date.now() - cached.updatedAt < 5 * 60_000) { library.addTracks(cached.tracks); return cached; }
    try {
      let tracks: readonly Track[], url: string;
      if (source === 'sc') { url = 'https://soundcloud.com/music-charts-us/sets/all-music-genres'; const set = await sc.collection({ source: 'sc', kind: 'playlist', id: 'music-charts-us/all-music-genres', url }, signal); tracks = set.tracks.flatMap(item => item.track ? [item.track] : []); }
      else if (source === 'spotify') { url = 'https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2tF'; tracks = parseSpotifyChart(await http.text('https://open.spotify.com/embed/playlist/37i9dQZEVXbMDoHDwVN2tF', signal)); }
      else { url = 'https://music.yandex.ru/chart'; tracks = parseYandexChart(await getJson(http, 'https://api.music.yandex.net/landing3/chart', signal)); }
      signal?.throwIfAborted(); if (!tracks.length) throw new Error('Chart is empty');
      const chart: Chart = { source, title: source === 'sc' ? 'US · Top 50' : source === 'spotify' ? 'Global · Top 50' : 'Топ 100', url, tracks, updatedAt: Date.now() };
      cache.set(source, chart); library.addTracks(tracks);
      try { storage?.setItem(`ss_chart_${source}`, JSON.stringify(chart)); } catch { /* In-memory cache remains available. */ }
      return chart;
    } catch (error) { signal?.throwIfAborted(); if (cached) { library.addTracks(cached.tracks); return { ...cached, stale: true }; } throw error; }
  } };
}
