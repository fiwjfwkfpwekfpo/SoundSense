import type { HttpClient } from './http';
import type { Track } from './types';
import { cleanArtist, cleanTitle, sameSong } from './lyrics';

/**
 * Live (animated) covers from Apple Music. The track is found in the public iTunes
 * catalogue by title and artist; its album's "editorial video" (the looping square
 * motion artwork the Apple Music app shows) is read from Apple's web catalogue API
 * with the anonymous token the music.apple.com web player itself uses.
 * Nothing goes through our server. Results live in memory for the session.
 */
export interface LiveCoversApi { find(track: Track, signal?: AbortSignal): Promise<string | undefined> }

type SearchItem = { trackName?: string; artistName?: string; collectionId?: number; trackTimeMillis?: number };
type Album = { data?: { attributes?: { editorialVideo?: Record<string, { video?: string } | undefined> } }[] };

export function createLiveCovers(http: HttpClient, options: { storage?: Pick<Storage, 'getItem' | 'setItem'>; country?: string } = {}): LiveCoversApi {
  const found = new Map<string, Promise<string | undefined>>();
  const country = options.country ?? 'us', TOKEN_KEY = 'ss_apple_web_token_v1';
  let token: Promise<string> | undefined;

  function expiry(jwt: string): number { try { return (JSON.parse(atob(jwt.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }).exp ?? 0; } catch { return 0; } }
  async function readToken(signal?: AbortSignal): Promise<string> {
    const saved = options.storage?.getItem(TOKEN_KEY);
    if (saved && expiry(saved) * 1000 > Date.now() + 86_400_000) return saved;
    const page = await http.text('https://music.apple.com/us/new', signal);
    const scripts = [...page.matchAll(/<script[^>]+src="([^"]*\/assets\/index[^"]*\.js)"/g)].map(match => match[1]!);
    for (const path of scripts) {
      const code = await http.text(new URL(path, 'https://music.apple.com').href, signal);
      const jwt = /eyJ[\w-]{10,}\.eyJ[\w-]{20,}\.[\w-]{20,}/.exec(code)?.[0];
      if (jwt) { try { options.storage?.setItem(TOKEN_KEY, jwt); } catch { /* best effort */ } return jwt; }
    }
    throw new Error('Apple Music web token not found');
  }
  const getToken = (signal?: AbortSignal) => { token ??= readToken(signal).catch(error => { token = undefined; throw error; }); return token; };

  async function lookup(track: Track, signal?: AbortSignal): Promise<string | undefined> {
    const term = `${cleanArtist(track.artist.name)} ${cleanTitle(track.title)}`;
    const search = JSON.parse(await http.text(`https://itunes.apple.com/search?${new URLSearchParams({ term, entity: 'song', limit: '15', country })}`, signal)) as { results?: SearchItem[] };
    const match = (search.results ?? []).find(item => item.collectionId && sameSong(track.title, track.artist.name, item.trackName ?? '', item.artistName ?? '') && (!track.duration || !item.trackTimeMillis || Math.abs(item.trackTimeMillis / 1000 - track.duration) <= 10));
    if (!match) return undefined;
    const request = async (jwt: string) => JSON.parse(await http.text(`https://amp-api.music.apple.com/v1/catalog/${country}/albums/${match.collectionId}?extend=editorialVideo`, signal, { headers: { Authorization: `Bearer ${jwt}`, Origin: 'https://music.apple.com', Referer: 'https://music.apple.com/' } })) as Album;
    let album: Album;
    try { album = await request(await getToken(signal)); }
    catch (error) {
      // An expired or rotated token: fetch a fresh one once.
      if ((error as { status?: number }).status !== 401) throw error;
      try { options.storage?.setItem(TOKEN_KEY, ''); } catch { /* best effort */ }
      token = undefined; album = await request(await getToken(signal));
    }
    const video = album.data?.[0]?.attributes?.editorialVideo;
    return video?.motionSquareVideo1x1?.video ?? video?.motionDetailSquare?.video ?? undefined;
  }

  return {
    find(track, signal) {
      if (track.artwork.url && /^blob:|^data:/.test(track.artwork.url)) return Promise.resolve(undefined);
      let pending = found.get(track.id);
      if (!pending) {
        pending = lookup(track, signal).catch(() => undefined);
        found.set(track.id, pending);
        // Failures (network, cancelled) are retried next time; "no live cover" is remembered.
        void pending.then(value => { if (value === undefined && signal?.aborted) found.delete(track.id); });
        if (found.size > 300) found.delete(found.keys().next().value!);
      }
      return pending;
    },
  };
}
