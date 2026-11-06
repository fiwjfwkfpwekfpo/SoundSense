import type { HttpClient } from './http';
import type { LibraryApi } from './api';
import type { Extensions } from './runtime';
import type { Lyrics, LyricsLine, Track } from './types';

/**
 * Lyrics chain modelled on Riff (MIT): lyrics do not depend on the service that
 * streams the track. Every provider is asked by artist + title (+ duration);
 * the first synced result wins, otherwise the first plain text is shown.
 * Order: Yandex (when signed in) → LRCLIB → Musixmatch → Genius (plain only).
 */
export interface RawLyrics { synced?: string; plain?: string }

export function cleanTitle(value: string): string {
  return value.replace(/\s*[([][^)\]]*(?:official|audio|video|lyrics?|visualizer|prod\.?|feat\.?|ft\.?|remaster(?:ed)?|clip|клип|hd|4k)[^)\]]*[)\]]/gi, '')
    .replace(/\s+(?:feat\.?|ft\.?)\s+.*$/i, '').replace(/\s+/g, ' ').trim();
}
export function cleanArtist(value: string): string { return value.replace(/\s*-\s*topic$/i, '').replace(/\bvevo\b/gi, '').split(/,|&| feat\.? | ft\.? | x /i)[0]!.trim(); }
const norm = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Same song: normalized titles equal (or one contains the other) and the main artist appears. */
export function sameSong(title: string, artist: string, candidateTitle: string, candidateArtist: string): boolean {
  const a = norm(cleanTitle(title)), b = norm(cleanTitle(candidateTitle)), x = norm(cleanArtist(artist)), y = norm(candidateArtist);
  return !!a && !!b && (a === b || a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a))) && !!x && !!y && (y.includes(x) || x.includes(norm(cleanArtist(candidateArtist))));
}

/** LRC (`[mm:ss.xx]`, several stamps per line) or Musixmatch JSON subtitles → lines. */
export function parseSynced(text: string): LyricsLine[] {
  const trimmed = text.trim();
  if (trimmed.startsWith('[{')) {
    try { return (JSON.parse(trimmed) as { text?: string; time?: { total?: number } }[]).flatMap(item => Number.isFinite(item.time?.total) ? [{ time: item.time!.total!, text: (item.text ?? '').trim() }] : []).sort((a, b) => a.time - b.time); } catch { return []; }
  }
  const lines: LyricsLine[] = [];
  for (const raw of trimmed.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)]; if (!stamps.length) continue;
    const content = raw.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
    for (const stamp of stamps) lines.push({ time: Number(stamp[1]) * 60 + Number(stamp[2]!.replace(':', '.')), text: content });
  }
  return lines.sort((a, b) => a.time - b.time);
}
export function parsePlain(text: string): LyricsLine[] {
  return text.replace(/\r/g, '').split('\n').map(line => line.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').trim())
    .filter((line, index, all) => line || (index > 0 && all[index - 1])).map(text => ({ time: 0, text }));
}
export function toLyrics(trackId: string, raw: RawLyrics | null, creditKey: string): Lyrics | null {
  if (!raw) return null;
  const synced = raw.synced ? parseSynced(raw.synced).filter((line, index, all) => line.text || index < all.length - 1) : [];
  if (synced.some(line => line.text)) return { trackId, language: /[а-яё]/i.test(raw.synced!) ? 'ru' : 'en', lines: synced, creditKey, synced: true };
  const text = raw.plain || raw.synced || '';
  const plain = parsePlain(text); if (!plain.some(line => line.text)) return null;
  return { trackId, language: /[а-яё]/i.test(text) ? 'ru' : 'en', lines: plain, creditKey, synced: false };
}

export function extractGenius(html: string): string {
  let collected = '', position = 0;
  const marker = 'data-lyrics-container="true"';
  while (true) {
    const at = html.indexOf(marker, position); if (at < 0) break;
    const start = html.indexOf('>', at) + 1; let depth = 1, cursor = start;
    while (depth > 0 && cursor < html.length) {
      const open = html.indexOf('<div', cursor), close = html.indexOf('</div>', cursor); if (close < 0) { depth = -1; break; }
      if (open >= 0 && open < close) { depth++; cursor = open + 4; } else { depth--; if (!depth) { collected += (collected ? '\n' : '') + html.slice(start, close); position = close + 6; } cursor = close + 6; }
    }
    if (depth !== 0) break;
  }
  const decoded = collected.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCharCode(parseInt(code, 16)));
  return decoded.replace(/\[[^\]]*\]/g, '').replace(/\n{3,}/g, '\n\n').split('\n').map(line => line.trim())
    .filter(line => !/^\d*\s*Contributors/i.test(line) && !(/Lyrics$/i.test(line) && line.length < 60 && !/\s{1}\S+\s{1}\S+\s/.test(line))).join('\n').trim();
}

/**
 * Searches to try for a track. SoundCloud uploads are often titled "Artist - Title"
 * with the uploader as the artist, so that split is tried first.
 */
export function queries(track: Pick<Track, 'title' | 'artist'> & { sources?: Track['sources'] }): { title: string; artist: string }[] {
  const result: { title: string; artist: string }[] = [];
  // Only uploads (SoundCloud, YouTube) put the artist into the title; tagged files and catalogues do not.
  const uploaded = !track.sources || track.sources.some(source => ['sc', 'yt', 'ytm'].includes(source.kind));
  const split = uploaded && /^\s*(.+?)\s+[-–—]\s+(.+)$/.exec(track.title);
  if (split && split[1]!.length < 80) result.push({ artist: split[1]!.trim(), title: split[2]!.trim() });
  result.push({ artist: track.artist.name, title: track.title });
  return result.filter((item, index) => result.findIndex(other => norm(other.title) === norm(item.title) && norm(other.artist) === norm(item.artist)) === index);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

export function registerLyrics(extensions: Extensions, library: Pick<LibraryApi, 'getTrack'>, http: HttpClient, yandex?: {
  lyrics(id: string, signal?: AbortSignal): Promise<RawLyrics | null>;
  search(query: string, signal?: AbortSignal): Promise<{ tracks: readonly Track[] }>;
  signedIn(): Promise<boolean>;
}, diagnostics?: { record(scope: string, event: string, data?: Record<string, unknown>, level?: 'info' | 'warn' | 'error'): void }, storage?: Pick<Storage, 'getItem' | 'setItem'>): () => void {
  const json = async <T,>(url: string, signal?: AbortSignal, headers?: Record<string, string>) => JSON.parse(await http.text(url, signal, headers ? { headers } : undefined)) as T;
  const cache = new Map<string, Lyrics | null>();
  /*
   * Answers are also kept across restarts: a found text for 30 days, "nothing found" for
   * 3 days. Replaying a track shows its lyrics at once instead of after 0.3–3 s of lookups.
   */
  const STORE_KEY = 'ss_lyrics_cache_v1', STORE_LIMIT = 160, FOUND_MS = 30 * 86_400_000, NONE_MS = 3 * 86_400_000;
  let stored: Record<string, { v: Lyrics | null; at: number }> = {};
  try { const saved = JSON.parse(storage?.getItem(STORE_KEY) ?? '{}'); if (saved && typeof saved === 'object') stored = saved; } catch { /* Start empty. */ }
  const fromStore = (key: string): Lyrics | null | undefined => { const entry = stored[key]; if (!entry || Date.now() - entry.at > (entry.v ? FOUND_MS : NONE_MS)) return undefined; return entry.v; };
  const toStore = (key: string, value: Lyrics | null) => {
    if (!storage) return;
    delete stored[key]; stored[key] = { v: value, at: Date.now() };
    const keys = Object.keys(stored); for (const old of keys.slice(0, Math.max(0, keys.length - STORE_LIMIT))) delete stored[old];
    try { storage.setItem(STORE_KEY, JSON.stringify(stored)); } catch { /* Memory only. */ }
  };
  const wrap = (id: string, titleKey: string, find: (track: Track, signal?: AbortSignal) => Promise<RawLyrics | null>) => extensions.lyrics.register({ id, titleKey, async find(trackId, signal) {
    const track = library.getTrack(trackId); if (!track) return null;
    const key = `${id}:${trackId}`; if (cache.has(key)) return cache.get(key)!;
    const remembered = fromStore(key); if (remembered !== undefined) { cache.set(key, remembered); return remembered; }
    // A slow service must not hold up the next one in the chain.
    const started = performance.now();
    const timeout = AbortSignal.timeout(9000), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const attempt = async () => { for (const query of queries(track)) { const raw = await find({ ...track, title: query.title, artist: { ...track.artist, name: query.artist } }, combined); if (raw) return raw; } return null; };
      const value = toLyrics(trackId, await Promise.race([attempt(), new Promise<never>((_, reject) => combined.addEventListener('abort', () => reject(new DOMException('Timed out', 'TimeoutError')), { once: true }))]), titleKey);
      diagnostics?.record('lyrics', 'provider', { trackId, provider: id, outcome: value ? (value.synced ? 'synced' : 'plain') : 'none', lines: value?.lines.length ?? 0, ms: Math.round(performance.now() - started) });
      cache.set(key, value); if (cache.size > 200) cache.delete(cache.keys().next().value!);
      // "Nothing" from Yandex (signed out) or Musixmatch (temporarily blocked) may change soon: only keep real answers there.
      if (value || id === 'lrclib' || id === 'genius') toStore(key, value);
      return value;
    } catch (error) { signal?.throwIfAborted(); diagnostics?.record('lyrics', 'provider', { trackId, provider: id, outcome: 'failed', status: (error as { status?: number }).status ?? null, message: String((error as Error)?.message ?? error).slice(0, 120), ms: Math.round(performance.now() - started) }, 'warn'); if ((error as { status?: number }).status === 404) { cache.set(key, null); return null; } throw error; }
  } });
  const dispose: (() => void)[] = [];
  if (yandex) dispose.push(wrap('ya', 'provider.yandex', async (track, signal) => {
    if (!await yandex.signedIn()) return null;
    let id = track.sources.find(source => source.kind === 'ya')?.externalId;
    if (!id) { const found = (await yandex.search(`${cleanArtist(track.artist.name)} ${cleanTitle(track.title)}`, signal)).tracks.find(item => sameSong(track.title, track.artist.name, item.title, item.artist.name) && (!track.duration || !item.duration || Math.abs(item.duration - track.duration) <= 6)); id = found?.sources.find(source => source.kind === 'ya')?.externalId; }
    return id ? yandex.lyrics(id, signal) : null;
  }));
  dispose.push(wrap('lrclib', 'provider.lrclib', async (track, signal) => {
    const title = cleanTitle(track.title), artist = cleanArtist(track.artist.name), headers = { 'User-Agent': 'SoundSense (https://github.com/fiwjfwkfpwekfpo/SoundSense)' };
    type Item = { trackName?: string; artistName?: string; duration?: number; instrumental?: boolean; syncedLyrics?: string | null; plainLyrics?: string | null };
    const pick = (item: Item | undefined): RawLyrics | null => item && !item.instrumental && (item.syncedLyrics || item.plainLyrics) ? { synced: item.syncedLyrics ?? undefined, plain: item.plainLyrics ?? undefined } : null;
    const get = async (withDuration: boolean) => { const url = new URL('https://lrclib.net/api/get'); url.searchParams.set('artist_name', artist); url.searchParams.set('track_name', title); if (withDuration && track.duration) url.searchParams.set('duration', String(Math.round(track.duration))); try { return pick(await json<Item>(url.href, signal, headers)); } catch (error) { signal?.throwIfAborted(); if ((error as { status?: number }).status === 404) return null; throw error; } };
    // The exact lookup and the search run together; the search covers uploads whose duration differs.
    const searching = json<Item[]>(`https://lrclib.net/api/search?${new URLSearchParams({ q: `${artist} ${title}` })}`, signal, headers).catch(() => [] as Item[]);
    const exact = await get(true); if (exact?.synced) return exact;
    const list = await searching;
    const matching = list.filter(item => sameSong(track.title, track.artist.name, item.trackName ?? '', item.artistName ?? '') && (!track.duration || !item.duration || Math.abs(item.duration - track.duration) <= 8));
    return pick(matching.find(item => item.syncedLyrics)) ?? exact ?? pick(matching[0]);
  }));
  // An empty token means Musixmatch refuses anonymous clients for now: do not ask again for a while.
  let mxmToken: { value: string; until: number } | undefined, mxmBlockedUntil = 0;
  dispose.push(wrap('musixmatch', 'provider.musixmatch', async (track, signal) => {
    const base = 'https://apic-desktop.musixmatch.com/ws/1.1/', headers = { 'User-Agent': UA, Cookie: 'x-mxm-token-guid=' };
    if (Date.now() < mxmBlockedUntil) return null;
    if (!mxmToken || mxmToken.until < Date.now()) {
      const data = await json<{ message?: { body?: { user_token?: string } } }>(`${base}token.get?app_id=web-desktop-app-v1.0`, signal, headers);
      const value = data.message?.body?.user_token; if (!value || /^0+$/.test(value) || /^UpgradeOnly/.test(value)) { mxmBlockedUntil = Date.now() + 30 * 60_000; return null; }
      mxmToken = { value, until: Date.now() + 6 * 60 * 60_000 };
    }
    const query = new URLSearchParams({ app_id: 'web-desktop-app-v1.0', usertoken: mxmToken.value, q_track: cleanTitle(track.title), q_artist: cleanArtist(track.artist.name), subtitle_format: 'lrc', format: 'json', namespace: 'lyrics_richsynched', ...(track.duration ? { q_duration: String(Math.round(track.duration)), f_subtitle_length: String(Math.round(track.duration)), f_subtitle_length_max_deviation: '6' } : {}) });
    type Body<T> = { message?: { body?: T } };
    const data = await json<Body<{ macro_calls?: Record<string, Body<{ track?: { track_name?: string; artist_name?: string; instrumental?: number }; subtitle_list?: { subtitle?: { subtitle_body?: string } }[]; lyrics?: { lyrics_body?: string } }>> }>>(`${base}macro.subtitles.get?${query}`, signal, headers);
    const calls = data.message?.body?.macro_calls; if (!calls) return null;
    const info = calls['matcher.track.get']?.message?.body?.track;
    if (!info || info.instrumental || !sameSong(track.title, track.artist.name, info.track_name ?? '', info.artist_name ?? '')) return null;
    const synced = calls['track.subtitles.get']?.message?.body?.subtitle_list?.[0]?.subtitle?.subtitle_body;
    const plain = calls['track.lyrics.get']?.message?.body?.lyrics?.lyrics_body?.replace(/\n*\*{3,}[\s\S]*$/, '');
    return synced || plain ? { synced: synced || undefined, plain: plain || undefined } : null;
  }));
  dispose.push(wrap('genius', 'provider.genius', async (track, signal) => {
    const query = `${cleanArtist(track.artist.name)} ${cleanTitle(track.title)}`;
    const data = await json<{ response?: { sections?: { hits?: { result?: { url?: string; title?: string; artist_names?: string } }[] }[] } }>(`https://genius.com/api/search/song?${new URLSearchParams({ q: query })}`, signal, { 'User-Agent': UA });
    const hit = (data.response?.sections?.[0]?.hits ?? []).map(item => item.result).find(result => result?.url && /^https:\/\/genius\.com\//.test(result.url) && sameSong(track.title, track.artist.name, result.title ?? '', result.artist_names ?? ''));
    if (!hit?.url) return null;
    const text = extractGenius(await http.text(hit.url, signal, { headers: { 'User-Agent': UA } }));
    return text ? { plain: text } : null;
  }));
  return () => { dispose.reverse().forEach(fn => fn()); cache.clear(); };
}
