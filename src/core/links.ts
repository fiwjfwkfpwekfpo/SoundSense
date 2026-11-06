import type { SourceKind } from './types';
export type LinkKind = 'track' | 'playlist' | 'album' | 'likes' | 'profile' | 'short';
export interface MusicLink { url: string; source: Exclude<SourceKind, 'local'>; kind: LinkKind; id: string; user?: string }
/** A URL parser, never a redirect fetcher. Hosts are matched exactly. */
export function parseMusicLink(input: string): MusicLink | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  let url: URL;
  try { url = new URL(/^[\w+.-]+:\/\//.test(text) ? text : `https://${text}`); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, '');
  const path = url.pathname.split('/').filter(Boolean);
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:si|feature|ref|from)$/.test(key)) url.searchParams.delete(key);
  url.protocol = 'https:'; url.hash = ''; url.hostname = host;
  const link = (source: MusicLink['source'], kind: LinkKind, id: string, user?: string): MusicLink => ({ url: url.toString(), source, kind, id, ...(user ? { user } : {}) });
  if (host === 'on.soundcloud.com' && path.length === 1) return link('sc', 'short', path[0]!);
  if (host === 'soundcloud.com') {
    if (path.length === 1 && /^[\w-]+$/.test(path[0]!) && !['discover','search','you','stream','upload','popular','charts'].includes(path[0]!)) return link('sc', 'profile', path[0]!, path[0]);
    if (path.length === 2 && path[1] === 'likes') return link('sc', 'likes', path[0]!, path[0]);
    if (path.length === 3 && path[1] === 'sets') return link('sc', 'playlist', `${path[0]}/${path[2]}`, path[0]);
    if (path.length === 2 && !['discover', 'search', 'you'].includes(path[0]!)) return link('sc', 'track', path.join('/'), path[0]);
  }
  if (host === 'youtu.be' && path.length === 1 && /^[\w-]{11}$/.test(path[0]!)) return link('yt', 'track', path[0]!);
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const source = host === 'music.youtube.com' ? 'ytm' : 'yt';
    if (path[0] === 'playlist' && /^[\w-]{2,160}$/.test(url.searchParams.get('list') ?? '')) return link(source, 'playlist', url.searchParams.get('list')!);
    if (path[0] === 'watch' && /^[\w-]{11}$/.test(url.searchParams.get('v') ?? '')) return link(source, 'track', url.searchParams.get('v')!);
    if (path[0] === 'shorts' && /^[\w-]{11}$/.test(path[1] ?? '')) return link(source, 'track', path[1]!);
  }
  if (['music.yandex.ru', 'music.yandex.com', 'music.yandex.by', 'music.yandex.kz', 'music.yandex.uz', 'music.yandex.com.tr'].includes(host)) {
    if (path.length === 2 && path[0] === 'track' && /^\d+$/.test(path[1]!)) return link('ya', 'track', path[1]!);
    if (path.length === 4 && path[0] === 'album' && path[2] === 'track' && /^\d+$/.test(path[3]!)) return link('ya', 'track', path[3]!);
    if (path.length === 2 && path[0] === 'album' && /^\d+$/.test(path[1]!)) return link('ya', 'album', path[1]!);
    if (path.length === 2 && path[0] === 'playlists' && /^lk\.[\da-f-]+$/i.test(path[1]!)) return link('ya', 'likes', path[1]!);
    if (path.length === 2 && path[0] === 'playlists' && /^[\da-f-]{8,}$/i.test(path[1]!)) return link('ya', 'playlist', path[1]!);
    if (path.length === 2 && path[0] === 'users') return link('ya', 'profile', path[1]!, path[1]);
    if (path.length === 4 && path[0] === 'users' && path[2] === 'playlists' && /^\d+$/.test(path[3]!)) return link('ya', path[3] === '3' ? 'likes' : 'playlist', path[3] === '3' ? path[1]! : `${path[1]}/${path[3]}`, path[1]);
  }
  if (host === 'open.spotify.com') {
    const parts = path[0]?.startsWith('intl-') ? path.slice(1) : path;
    if (parts.length === 2 && ['track','playlist','album'].includes(parts[0]!) && /^[a-zA-Z\d]{10,32}$/.test(parts[1]!)) return link('spotify', parts[0] as LinkKind, parts[1]!);
  }
  if (host === 'deezer.com') {
    const parts = /^[a-z]{2}$/i.test(path[0] ?? '') ? path.slice(1) : path;
    if (parts.length === 2 && ['track','playlist','album','profile'].includes(parts[0]!) && /^\d+$/.test(parts[1]!)) return link('deezer', parts[0] as LinkKind, parts[1]!);
  }
  if (host === 'music.apple.com') {
    const parts = /^[a-z]{2}$/i.test(path[0] ?? '') ? path.slice(1) : path;
    const id = parts.at(-1) ?? '', song = url.searchParams.get('i');
    if (parts[0] === 'album' && /^\d+$/.test(id)) return song && /^\d+$/.test(song) ? link('apple','track',song) : link('apple','album',id);
    if (parts[0] === 'song' && /^\d+$/.test(id)) return link('apple','track',id);
    if (parts[0] === 'playlist' && /^pl\.[a-zA-Z\d_-]+$/.test(id)) return link('apple','playlist',id);
  }
  return null;
}
export function extractMusicLink(text: string): MusicLink | null {
  for (const word of text.split(/\s+/)) { const parsed = parseMusicLink(word.replace(/[),.;]+$/, '')); if (parsed) return parsed; }
  return null;
}
