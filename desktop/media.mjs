import { net } from 'electron';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { extname, isAbsolute, normalize, relative } from 'node:path';
/*
 * ss-media:// — how the window reads audio and covers it cannot fetch by itself:
 *   ss-media://file/?p=/abs/path.flac      a local audio file (with Range, so seeking works)
 *   ss-media://stream/?u=https://…&h=json   a remote stream that needs request headers
 *                                           (User-Agent etc.), which <audio> cannot send;
 *                                           with &id=<track> it is also kept on disk (music-cache.mjs)
 *   ss-media://cache/?id=<track>            a complete track from the cache
 *   ss-media://hls/<name>/index.m3u8        a cached HLS track (playlist and segments)
 * Local reads are limited to audio and image types; images only from the app's own folders.
 */
const AUDIO = /^\.(flac|mp3|ogg|oga|opus|m4a|mp4|aac|wav|aif|aiff|alac|wma)$/i, IMAGE = /^\.(jpe?g|png|webp)$/i;
const TYPES = { '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const inside = (root, path) => { const rel = relative(root, path); return !!rel && !rel.startsWith('..') && !isAbsolute(rel); };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range' };
const FORWARD = ['range', 'accept', 'if-range'];
export function mediaHandler(paths, cache) {
  async function file(request, path) {
    path = normalize(path);
    const extension = extname(path);
    if (!isAbsolute(path) || !(AUDIO.test(extension) || IMAGE.test(extension) && [paths.data, paths.cache].some(root => inside(root, path)))) return new Response('Forbidden', { status: 403 });
    let info; try { info = await stat(path); } catch { return new Response('Not found', { status: 404 }); }
    if (!info.isFile()) return new Response('Not found', { status: 404 });
    const headers = { 'Content-Type': TYPES[extension.toLowerCase()] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', ...CORS };
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
      let end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (start >= info.size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}`, ...CORS } });
      return new Response(Readable.toWeb(createReadStream(path, { start, end })), { status: 206, headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${info.size}` } });
    }
    return new Response(Readable.toWeb(createReadStream(path)), { status: 200, headers: { ...headers, 'Content-Length': String(info.size) } });
  }
  async function stream(request, target, extra) {
    let url; try { url = new URL(target); } catch { return new Response('Bad request', { status: 400 }); }
    if (url.protocol !== 'https:' || url.username || url.password) return new Response('Forbidden', { status: 403 });
    let headers = {}; try { headers = extra ? JSON.parse(extra) : {}; } catch { return new Response('Bad request', { status: 400 }); }
    const sent = new Headers();
    for (const [key, value] of Object.entries(headers)) if (typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(key) && !/^(host|cookie|content-length)$/i.test(key)) sent.set(key, value);
    for (const key of FORWARD) { const value = request.headers.get(key); if (value) sent.set(key, value); }
    const response = await net.fetch(url.href, { headers: sent, credentials: 'omit', signal: request.signal });
    const out = new Headers(CORS);
    for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) { const value = response.headers.get(key); if (value) out.set(key, value); }
    return new Response(response.body, { status: response.status, headers: out });
  }
  return async request => {
    const url = new URL(request.url);
    if (url.hostname === 'file') return file(request, url.searchParams.get('p') ?? '');
    if (url.hostname === 'stream') {
      const target = url.searchParams.get('u') ?? '', extra = url.searchParams.get('h'), id = url.searchParams.get('id');
      if (!id || !cache || !/^https:\/\//.test(target)) return stream(request, target, extra);
      let headers = {}; try { headers = extra ? JSON.parse(extra) : {}; } catch { return new Response('Bad request', { status: 400 }); }
      return cache.stream(request, id, target, headers, () => stream(request, target, extra));
    }
    if (url.hostname === 'cache' && cache) return cache.serve(request, url.searchParams.get('id') ?? '');
    if (url.hostname === 'hls' && cache) return cache.serveHls(request, url.pathname);
    return new Response('Not found', { status: 404 });
  };
}
