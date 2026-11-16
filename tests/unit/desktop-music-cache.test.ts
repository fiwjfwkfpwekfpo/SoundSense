import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMusicCache } from '../../desktop/music-cache.mjs';

const bytes = (size: number, seed = 1) => { const data = Buffer.alloc(size); for (let i = 0; i < size; i++) data[i] = (i * 31 + seed) & 255; return data; };
/** A slow server: the body arrives in chunks with a pause, so readers overtake the download. */
function server(files: Record<string, Buffer | string>, log: string[] = []) {
  return async (url: string, options?: { signal?: AbortSignal }) => {
    log.push(url); const body = files[url];
    if (body === undefined) return new Response('missing', { status: 404 });
    if (typeof body === 'string') return new Response(body, { status: 200 });
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({ async pull(controller) { if (options?.signal?.aborted) { controller.error(new Error('aborted')); return; } await new Promise(resolve => setTimeout(resolve, 2)); if (offset >= body.length) { controller.close(); return; } controller.enqueue(new Uint8Array(body.subarray(offset, offset + 4096))); offset += 4096; } });
    return new Response(stream, { status: 200, headers: { 'content-length': String(body.length), 'content-type': 'audio/mpeg' } });
  };
}
const request = (range?: string) => new Request('ss-media://stream/', range ? { headers: { range } } : undefined);
const read = async (response: Response) => Buffer.from(await response.arrayBuffer());
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'ss-music-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

describe('desktop music cache', () => {
  it('serves a playing file from one download and replays it from disk', async () => {
    const data = bytes(50_000), log: string[] = [], cache = createMusicCache({ directory, fetch: server({ 'https://cdn/a.mp3': data }, log) });
    const proxy = () => { throw new Error('proxy must not be used'); };
    const [whole, part] = await Promise.all([cache.stream(request('bytes=0-'), 'a', 'https://cdn/a.mp3', {}, proxy), cache.stream(request('bytes=1000-1999'), 'a', 'https://cdn/a.mp3', {}, proxy)]);
    expect(whole.status).toBe(206); expect(whole.headers.get('content-range')).toBe('bytes 0-49999/50000');
    expect((await read(whole)).equals(data)).toBe(true); expect((await read(part)).equals(data.subarray(1000, 2000))).toBe(true);
    await cache.idle(); expect(log).toEqual(['https://cdn/a.mp3']);
    expect(await cache.source('a')).toEqual({ available: true, uri: 'ss-media://cache/?id=a' });
    expect((await cache.snapshot()).entries).toEqual([{ id: 'a', state: 'complete', progress: 1, bytes: 50_000 }]);
    // A new process finds the entry; a link that changed meanwhile is not requested again.
    const again = createMusicCache({ directory, fetch: async () => { throw new Error('offline'); } });
    const replay = await again.stream(request('bytes=49990-'), 'a', 'https://cdn/other.mp3', {}, proxy);
    expect(replay.status).toBe(206); expect((await read(replay)).equals(data.subarray(49990))).toBe(true);
    const chunks: Buffer[] = []; for await (const chunk of (await again.bytes('a'))!) chunks.push(Buffer.from(chunk)); expect(Buffer.concat(chunks).equals(data)).toBe(true);
  });
  it('answers a jump far ahead and an uncacheable stream through the proxy', async () => {
    const data = bytes(2_000_000), cache = createMusicCache({ directory, fetch: server({ 'https://cdn/big.mp3': data }) });
    let proxied = 0; const proxy = () => { proxied++; return new Response('proxied'); };
    await cache.stream(request('bytes=1900000-'), 'big', 'https://cdn/big.mp3', {}, proxy); expect(proxied).toBe(1);
    await cache.stream(request(), 'gone', 'https://cdn/missing.mp3', {}, proxy); expect(proxied).toBe(2);
    await cache.idle(); expect((await cache.source('big')).available).toBe(true); expect((await cache.source('gone')).available).toBe(false);
    expect(readdirSync(directory).filter(file => file.endsWith('.part'))).toEqual([]);
  });
  it('copies an HLS playlist with its segments and feeds them in order', async () => {
    const init = bytes(300, 3), one = bytes(5000, 5), two = bytes(7000, 7);
    const playlist = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-MAP:URI="init.mp4?sig=1"', '#EXTINF:10,', 'seg1.m4s?sig=2', '#EXTINF:8,', 'https://other/seg2.m4s', '#EXT-X-ENDLIST'].join('\n');
    const cache = createMusicCache({ directory, fetch: server({ 'https://cdn/t/list.m3u8?x=1': playlist, 'https://cdn/t/init.mp4?sig=1': init, 'https://cdn/t/seg1.m4s?sig=2': one, 'https://other/seg2.m4s': two }) });
    await cache.note('h', 'https://cdn/t/list.m3u8?x=1', {});
    const chunks: Buffer[] = []; for await (const chunk of (await cache.bytes('h'))!) chunks.push(Buffer.from(chunk)); expect(Buffer.concat(chunks).equals(Buffer.concat([init, one, two]))).toBe(true);
    await cache.idle(); const source = await cache.source('h'); expect(source.uri).toMatch(/^ss-media:\/\/hls\/[a-f0-9]{40}\/index\.m3u8$/);
    const path = new URL(source.uri!).pathname, text = (await read(await cache.serveHls(request(), path))).toString();
    expect(text).toContain('#EXT-X-MAP:URI="p0"'); expect(text.split('\n').filter(line => /^p\d$/.test(line))).toEqual(['p1', 'p2']);
    expect((await read(await cache.serveHls(request(), path.replace('index.m3u8', 'p2')))).equals(two)).toBe(true);
    expect((await cache.serveHls(request(), path.replace('index.m3u8', '../x'))).status).toBe(404);
  });
  it('with automatic caching off keeps only requested downloads, and removes entries', async () => {
    const changes: unknown[] = [], cache = createMusicCache({ directory, fetch: server({ 'https://cdn/s.mp3': bytes(9000) }), onChange: (value: unknown) => { changes.push(value); } });
    await cache.configure({ automatic: false, limitMb: 128 });
    await cache.note('s', 'https://cdn/s.mp3', {}); await cache.idle(); expect((await cache.source('s')).available).toBe(false);
    await cache.download({ id: 's', uri: 'https://cdn/s.mp3', headers: undefined }); await cache.idle(); expect((await cache.source('s')).available).toBe(true);
    await cache.remove({ id: 's' }); expect((await cache.snapshot()).entries).toEqual([]); expect(readdirSync(directory)).toEqual([]);
    await new Promise(resolve => setTimeout(resolve, 300)); expect(changes.length).toBeGreaterThan(0);
  });
});
