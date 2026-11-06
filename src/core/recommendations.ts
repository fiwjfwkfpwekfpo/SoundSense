import type { HttpClient } from './http';
import { getJson } from './http';
import type { LibraryApi } from './api';
import type { Track, Unsubscribe } from './types';

/**
 * Recommendations in the spirit of Riff (MIT, rootscripts/riff): a taste profile
 * from likes and history, candidates from Deezer (related artists, artist radio)
 * and YouTube Music ("artist title mix"), then hand-made scoring. Everything runs
 * on the device against public APIs; no SoundSense server is involved.
 */
export interface Seed { trackId: string; artist: string; title: string; weight: number }
export interface Candidate { artist: string; title: string; duration?: number; match: number; source: 'deezer' | 'ytmix'; seedWeight: number; track?: Track }
export interface Profile { seeds: readonly Seed[]; topArtists: ReadonlySet<string>; cyrillic: boolean; heard: ReadonlySet<string> }
export type RecommendationPhase = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
export interface RecommendationState { phase: RecommendationPhase; updatedAt: number }
export interface RecommendationsApi {
  getSnapshot(): RecommendationState; subscribe(listener: (state: RecommendationState) => void): Unsubscribe;
  /** Refreshes when the list is older than `maxAge` (or always with `force`). */
  refresh(options?: { force?: boolean; maxAge?: number }): Promise<void>;
}

export function normalizeArtist(name: string): string {
  return String(name || '').replace(/\b(official|vevo|records|topic)\b/gi, '').replace(/\s*-\s*topic$/i, '').replace(/[^\p{L}\p{N}\s&-]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
export function trackKey(artist: string, title: string): string {
  let a = String(artist || '').toLowerCase(), t = String(title || '').toLowerCase();
  t = t.replace(/\s*\([^)]*official[^)]*\)/gi, '').replace(/\s*\[[^\]]*\]/gi, '').replace(/\s*\([^)]*(video|audio|remaster(ed)?|lyrics?|visualizer)[^)]*\)/gi, '');
  t = t.replace(/\s*(feat\.?|ft\.?)\s+[^(\[-]+/gi, '').replace(/\s*\((feat\.?|ft\.?)[^)]*\)/gi, '');
  a = a.replace(/\s*(feat\.?|ft\.?)\s+.*$/gi, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return `${a}::${t}`;
}
const firstArtist = (name: string) => name.split(/,|&| feat\.? | ft\.? | x /i)[0]!.trim();

/** Likes weigh 3; history weighs by recency (0.97^position) plus up to +2 for repeated plays. */
export function buildProfile(library: Pick<LibraryApi, 'getSnapshot' | 'getTrack' | 'getPlayCounts'>): Profile {
  const snapshot = library.getSnapshot(), plays = library.getPlayCounts?.() ?? {};
  const entries = new Map<string, Seed>(), heard = new Set<string>();
  const entry = (track: Track | undefined) => {
    if (!track?.artist.name || !track.title) return undefined;
    const key = trackKey(track.artist.name, track.title); heard.add(key);
    let value = entries.get(key); if (!value) entries.set(key, value = { trackId: track.id, artist: track.artist.name, title: track.title, weight: 0 });
    return value;
  };
  for (const track of snapshot.tracks) if (track.liked) entry(track)!.weight += 3;
  snapshot.history.forEach((id, index) => { const value = entry(library.getTrack(id)); if (value) value.weight += .97 ** index + Math.min(2, Math.max(0, (plays[id] ?? 1) - 1) * .5); });
  const artists = new Map<string, number>(); let cyrillic = 0, total = 0;
  for (const seed of entries.values()) { const name = normalizeArtist(firstArtist(seed.artist)); artists.set(name, (artists.get(name) ?? 0) + seed.weight); total++; if (/[Ѐ-ӿ]/.test(seed.title)) cyrillic++; }
  const topArtists = new Set([...artists].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name));
  return { seeds: [...entries.values()].filter(seed => seed.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, 30), topArtists, cyrillic: total > 0 && cyrillic / total > .4, heard };
}

/** Weighted random draw without replacement. */
export function pickSeeds(seeds: readonly Seed[], count = 4, random = Math.random): Seed[] {
  const pool = [...seeds], picked: Seed[] = [];
  while (picked.length < count && pool.length) {
    let r = random() * pool.reduce((sum, seed) => sum + seed.weight, 0);
    let index = pool.findIndex(seed => (r -= seed.weight) <= 0); if (index < 0) index = pool.length - 1;
    picked.push(pool.splice(index, 1)[0]!);
  }
  return picked;
}

/** Sum of match × seed weight per track, +0.6 for new artists (−0.4 for top ones), Cyrillic bonus, a little noise. */
export function rankCandidates(candidates: readonly Candidate[], profile: Pick<Profile, 'topArtists' | 'cyrillic' | 'heard'>, avoid: ReadonlySet<string>, limit = 25, random = Math.random): Candidate[] {
  const grouped = new Map<string, { best: Candidate; score: number; artist: string }>();
  for (const candidate of candidates) {
    const key = trackKey(candidate.artist, candidate.title); if (key.startsWith('::') || key.endsWith('::') || profile.heard.has(key) || avoid.has(key)) continue;
    const score = candidate.match * candidate.seedWeight, current = grouped.get(key);
    if (!current) grouped.set(key, { best: candidate, score, artist: normalizeArtist(firstArtist(candidate.artist)) });
    else { current.score += score; if (candidate.track && !current.best.track) current.best = candidate; }
  }
  const top = [...profile.topArtists];
  const scored = [...grouped.values()].map(entry => {
    const isTop = top.some(name => name && (entry.artist === name || entry.artist.includes(name) || name.includes(entry.artist)));
    const score = entry.score + (isTop ? -.4 : .6) + (profile.cyrillic && /[Ѐ-ӿ]/.test(entry.best.title) ? .3 : 0) + random() * .15;
    return { ...entry, isTop, rank: score };
  }).sort((a, b) => b.rank - a.rank);
  const maxTop = Math.max(1, Math.floor(limit * .3)), perArtist = new Map<string, number>(), result: Candidate[] = []; let tops = 0;
  for (const item of scored) {
    const count = perArtist.get(item.artist) ?? 0; if (count >= 2 || item.isTop && tops >= maxTop) continue;
    perArtist.set(item.artist, count + 1); if (item.isTop) tops++; result.push(item.best);
    if (result.length >= limit) break;
  }
  return result;
}

const shuffle = <T,>(values: readonly T[], random = Math.random) => values.map(value => [random(), value] as const).sort((a, b) => a[0] - b[0]).map(([, value]) => value);
async function pool<T, R>(items: readonly T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []; let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (next < items.length) { const index = next++; results[index] = await run(items[index]!); } }));
  return results;
}

export function createRecommendations(options: {
  http: HttpClient; library: LibraryApi; searchMusic(query: string, signal?: AbortSignal): Promise<readonly Track[]>;
  storage?: Pick<Storage, 'getItem' | 'setItem'>; limit?: number;
}): RecommendationsApi {
  const KEY = 'ss_recommendations_v1', listeners = new Set<(state: RecommendationState) => void>();
  let state: RecommendationState = { phase: 'idle', updatedAt: 0 }, running: Promise<void> | undefined, recent: string[] = [];
  try { const saved = JSON.parse(options.storage?.getItem(KEY) ?? 'null'); if (saved && Number.isFinite(saved.updatedAt)) { state = { phase: options.library.getSnapshot().recommendations.length ? 'ready' : 'idle', updatedAt: saved.updatedAt }; if (Array.isArray(saved.recent)) recent = saved.recent.filter((key: unknown) => typeof key === 'string').slice(0, 300); } } catch {}
  const publish = (next: RecommendationState) => { state = next; for (const listener of listeners) listener(state); };
  const artistIds = new Map<string, Promise<string | null>>();
  const deezer = <T,>(path: string, signal: AbortSignal) => getJson(options.http, `https://api.deezer.com/${path}`, signal) as Promise<T>;
  type DeezerTracks = { data?: { title?: string; duration?: number; artist?: { name?: string } }[] };
  function artistId(name: string, signal: AbortSignal) {
    const key = normalizeArtist(name); let value = artistIds.get(key);
    if (!value) { value = deezer<{ data?: { id?: number }[] }>(`search/artist?q=${encodeURIComponent(name)}&limit=1`, signal).then(data => data.data?.[0]?.id ? String(data.data[0].id) : null).catch(() => null); artistIds.set(key, value); }
    return value;
  }
  async function deezerCandidates(seed: Seed, signal: AbortSignal): Promise<Candidate[]> {
    const id = await artistId(firstArtist(seed.artist), signal); if (!id) return [];
    const [related, radio] = await Promise.all([
      deezer<{ data?: { id?: number; name?: string }[] }>(`artist/${id}/related?limit=25`, signal).catch(() => ({ data: [] })),
      deezer<DeezerTracks>(`artist/${id}/radio?limit=40`, signal).catch(() => ({ data: [] })),
    ]);
    const relatedTracks = await pool(shuffle(related.data ?? []).slice(0, 6), 3, async (artist, ) => {
      if (!artist.id) return [];
      const top = await deezer<DeezerTracks>(`artist/${artist.id}/top?limit=15`, signal).catch(() => ({ data: [] }));
      const index = (related.data ?? []).indexOf(artist);
      return shuffle(top.data ?? []).slice(0, 4).map(item => ({ artist: item.artist?.name || artist.name || '', title: item.title || '', duration: item.duration, match: 1 - Math.min(1, index / 12) * .6, source: 'deezer' as const, seedWeight: seed.weight }));
    });
    return [...relatedTracks.flat(), ...shuffle(radio.data ?? []).slice(0, 25).map(item => ({ artist: item.artist?.name || '', title: item.title || '', duration: item.duration, match: .7, source: 'deezer' as const, seedWeight: seed.weight }))];
  }
  async function mixCandidates(seed: Seed, signal: AbortSignal): Promise<Candidate[]> {
    const tracks = await options.searchMusic(`${firstArtist(seed.artist)} ${seed.title} mix`, signal).catch(() => []);
    return tracks.slice(0, 14).filter(track => track.id !== seed.trackId && track.duration >= 90 && track.duration <= 480).map((track, index) => ({ artist: track.artist.name, title: track.title, match: (1 - index / 20 * .5) * 1.3, source: 'ytmix' as const, seedWeight: seed.weight, track }));
  }
  /** Deezer gives names only: find the same recording on YouTube Music to make it playable. */
  async function playable(candidate: Candidate, signal: AbortSignal): Promise<Track | undefined> {
    if (candidate.track) return candidate.track;
    const found = await options.searchMusic(`${candidate.artist} ${candidate.title}`, signal).catch(() => []);
    const wanted = trackKey(firstArtist(candidate.artist), candidate.title);
    return found.slice(0, 6).find(track => trackKey(firstArtist(track.artist.name), track.title) === wanted && (!candidate.duration || !track.duration || Math.abs(candidate.duration - track.duration) <= 5));
  }
  async function run(): Promise<void> {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 60_000), signal = controller.signal;
    publish({ ...state, phase: 'loading' });
    try {
      const profile = buildProfile(options.library);
      if (!profile.seeds.length) { options.library.setRecommendations?.([]); publish({ phase: 'empty', updatedAt: Date.now() }); return; }
      const seeds = pickSeeds(profile.seeds, 4);
      const candidates = (await pool(seeds, 2, async seed => (await Promise.all([mixCandidates(seed, signal), deezerCandidates(seed, signal).catch(() => [])])).flat())).flat();
      const ranked = rankCandidates(candidates, profile, new Set(recent), Math.round((options.limit ?? 25) * 1.4));
      const resolved = (await pool(ranked, 3, candidate => playable(candidate, signal))).filter((track): track is Track => !!track);
      const unique = [...new Map(resolved.map(track => [track.id, track])).values()].filter(track => !profile.heard.has(trackKey(track.artist.name, track.title))).slice(0, options.limit ?? 25);
      if (!unique.length) throw new Error('No playable recommendations');
      options.library.addTracks(unique.map(track => options.library.getTrack(track.id) ?? track)); options.library.setRecommendations?.(unique.map(track => track.id));
      recent = [...unique.map(track => trackKey(track.artist.name, track.title)), ...recent].slice(0, 300);
      const updatedAt = Date.now(); try { options.storage?.setItem(KEY, JSON.stringify({ updatedAt, recent })); } catch {}
      publish({ phase: 'ready', updatedAt });
    } catch { publish({ ...state, phase: options.library.getSnapshot().recommendations.length ? 'ready' : 'error' }); }
    finally { clearTimeout(timeout); }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    refresh({ force = false, maxAge = 6 * 60 * 60_000 } = {}) {
      if (running) return running;
      if (!force && state.updatedAt && Date.now() - state.updatedAt < maxAge && options.library.getSnapshot().recommendations.length) return Promise.resolve();
      return running = run().finally(() => { running = undefined; });
    },
  };
}
