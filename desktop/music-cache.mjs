import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
/*
 * Listened and downloaded tracks on the computer (SPEC §8), the desktop counterpart of
 * android/…/MusicCache.java. A track is downloaded once, while it plays:
 *   - a plain file: the window's <audio> reads ss-media://stream/…&id=<track>; the bytes come
 *     from one download that is written to disk and served from there as it grows;
 *   - HLS: the window plays it from the network (hls.js), the playlist and its segments are
 *     copied here in the background and played from ss-media://hls/… next time.
 * The waveform decoder reads the same download (bytes()), so nothing is fetched twice for it.
 * Only complete entries are playable; the oldest unused ones go first when the limit is reached,
 * liked tracks last. Everything lives in <cache>/tracks and may be deleted at any time.
 */
const MAX_BYTES = 512 * 1024 * 1024, NEAR = 512 * 1024, MAX_PARTS = 4000, KEEP_IDLE = 2, EXPLICIT = 2;
const HLS = /\.m3u8(?:\?|$)/i, CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range' };
const clean = headers => { const sent = {}; for (const [key, value] of Object.entries(headers ?? {})) if (typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(key) && !/^(host|cookie|content-length|range)$/i.test(key)) sent[key] = value; return sent; };

export function createMusicCache({ directory, fetch, onChange = _snapshot => {} }) {
  const entries = new Map(), names = new Map(), jobs = new Map(), queue = [];
  let limit = 4 * 1024 * 1024 * 1024, automatic = true, preferred = new Set(), loaded, timer, explicit = 0;
  const name = id => createHash('sha256').update(String(id)).digest('hex').slice(0, 40);
  const location = entry => join(directory, `${entry.name}.${entry.kind === 'hls' ? 'hls' : 'bin'}`);
  const total = () => { let bytes = 0; for (const entry of entries.values()) bytes += entry.size; return bytes; };
  const snapshot = () => ({
    entries: [...[...entries.values()].map(entry => ({ id: entry.id, state: 'complete', progress: 1, bytes: entry.size })),
      ...[...jobs.values()].filter(job => !entries.has(job.id)).map(job => ({ id: job.id, state: 'downloading', progress: job.progress(), bytes: job.received })),
      ...queue.filter(item => !entries.has(item.id) && !jobs.has(item.id)).map(item => ({ id: item.id, state: 'queued', progress: 0, bytes: 0 }))],
    bytes: total(), limit,
  });
  const changed = () => { if (timer) return; timer = setTimeout(() => { timer = undefined; onChange(snapshot()); }, 250); timer.unref?.(); };
  const load = () => loaded ??= (async () => {
    await mkdir(directory, { recursive: true });
    const files = await readdir(directory);
    for (const file of files) if (file.endsWith('.json')) {
      try { const meta = JSON.parse(await readFile(join(directory, file), 'utf8')); if (typeof meta.id === 'string' && meta.name === file.slice(0, -5) && meta.name === name(meta.id) && meta.size > 0 && ['file', 'hls'].includes(meta.kind)) { entries.set(meta.id, meta); names.set(meta.name, meta); } } catch { /* A damaged record is dropped below. */ }
    }
    // Unfinished downloads and files without a record are leftovers of a killed process.
    for (const file of files) { const base = file.replace(/\.[^.]+$/, ''); if (!names.has(base) || file.endsWith('.part')) await rm(join(directory, file), { recursive: true, force: true }).catch(() => {}); }
  })().catch(() => {});
  async function drop(entry) { entries.delete(entry.id); names.delete(entry.name); await rm(location(entry), { recursive: true, force: true }).catch(() => {}); await rm(join(directory, `${entry.name}.json`), { force: true }).catch(() => {}); }
  async function trim() {
    let bytes = total(); if (bytes <= limit) return;
    const now = Date.now();
    const order = [...entries.values()].filter(entry => now - entry.at > 10 * 60_000).sort((a, b) => Number(preferred.has(a.id)) - Number(preferred.has(b.id)) || a.at - b.at);
    for (const entry of order) { await drop(entry); bytes -= entry.size; if (bytes <= limit) break; }
  }
  async function commit(entry) { entries.set(entry.id, entry); names.set(entry.name, entry); await writeFile(join(directory, `${entry.name}.json`), JSON.stringify(entry)); await trim(); }
  function touch(entry) { const now = Date.now(); if (now - entry.at > 10 * 60_000) { entry.at = now; void writeFile(join(directory, `${entry.name}.json`), JSON.stringify(entry)).catch(() => {}); } }
  /** A complete entry whose files are still on disk (the cache folder may be cleaned by hand). */
  async function ready(id) {
    await load(); const entry = entries.get(id); if (!entry) return null;
    try { const info = await stat(entry.kind === 'hls' ? join(location(entry), 'index.m3u8') : location(entry)); if (entry.kind === 'file' && info.size !== entry.size) throw new Error('Size'); return entry; }
    catch { await drop(entry); changed(); return null; }
  }

  function begin(id, url, headers, wanted, provider) {
    const base = join(directory, name(id)), controller = new AbortController(), waiters = new Set();
    const job = { id, provider, kind: HLS.test(url) ? 'hls' : 'file', received: 0, total: 0, type: '', state: 'loading', readers: 0, explicit: wanted, controller, started: Date.now(), parts: [], count: 0, path: `${base}.part`,
      progress: () => job.kind === 'hls' ? (job.count ? job.parts.length / job.count : 0) : job.total ? job.received / job.total : 0,
      wait: () => new Promise(resolve => waiters.add(resolve)) };
    const wake = () => { for (const resolve of waiters) resolve(); waiters.clear(); };
    const get = async target => fetch(target, { headers: clean(headers), credentials: 'omit', signal: controller.signal });
    const settle = state => { job.state = state; if (jobs.get(id) === job) jobs.delete(id); wake(); changed(); pump(); };
    jobs.set(id, job); changed();
    // Tracks the listener skipped away from stop downloading; explicit downloads always finish.
    const idle = [...jobs.values()].filter(other => other !== job && !other.explicit && other.readers === 0).sort((a, b) => b.started - a.started);
    for (const other of idle.slice(KEEP_IDLE - 1)) other.controller.abort();
    job.head = (async () => {
      await load(); await rm(job.path, { recursive: true, force: true });
      if (job.kind === 'file') {
        const response = await get(url), size = Number(response.headers.get('content-length'));
        if (response.status !== 200 || !response.body || !(size > 0) || size > MAX_BYTES || response.headers.get('content-encoding')) { controller.abort(); throw new Error(`Not cacheable (${response.status})`); }
        job.total = size; job.type = response.headers.get('content-type') ?? 'application/octet-stream';
        const handle = await open(job.path, 'w');
        job.done = (async () => {
          try { for await (const chunk of response.body) { await handle.write(chunk); job.received += chunk.length; wake(); } }
          finally { await handle.close(); }
          if (job.received !== size) throw new Error('Incomplete download');
          await rename(job.path, `${base}.bin`); job.path = `${base}.bin`;
          await commit({ id, provider: job.provider, name: name(id), kind: 'file', type: job.type, size, at: Date.now() });
        })();
      } else {
        const reply = await get(url); if (!reply.ok) throw new Error(`HTTP ${reply.status}`);
        const text = await reply.text();
        // Only a finished, unencrypted media playlist with whole-file segments can be replayed from disk.
        if (/#EXT-X-STREAM-INF/.test(text) || /#EXT-X-KEY:(?![^\n]*METHOD=NONE)/.test(text) || /BYTERANGE/.test(text) || !/#EXT-X-ENDLIST/.test(text)) throw new Error('Playlist is not cacheable');
        const out = [], files = [];
        for (const line of text.split(/\r?\n/)) {
          const value = line.trim();
          if (value.startsWith('#EXT-X-MAP:')) { const uri = /URI="([^"]+)"/.exec(value)?.[1]; if (!uri) throw new Error('Bad playlist'); files.push(new URL(uri, url).href); out.push(value.replace(/URI="[^"]+"/, `URI="p${files.length - 1}"`)); }
          else if (value && !value.startsWith('#')) { files.push(new URL(value, url).href); out.push(`p${files.length - 1}`); }
          else out.push(value);
        }
        if (!files.length || files.length > MAX_PARTS || files.some(file => !file.startsWith('https:'))) throw new Error('Bad playlist');
        await mkdir(job.path, { recursive: true }); job.count = files.length;
        job.done = (async () => {
          for (const [index, file] of files.entries()) {
            const part = await get(file); if (!part.ok) throw new Error(`HTTP ${part.status}`);
            const data = Buffer.from(await part.arrayBuffer());
            if (job.received + data.length > MAX_BYTES) throw new Error('Too large');
            await writeFile(join(job.path, `p${index}`), data); job.received += data.length; job.parts.push(`p${index}`); wake();
          }
          await writeFile(join(job.path, 'index.m3u8'), out.join('\n'));
          await rm(`${base}.hls`, { recursive: true, force: true }); await rename(job.path, `${base}.hls`); job.path = `${base}.hls`;
          await commit({ id, provider: job.provider, name: name(id), kind: 'hls', type: 'application/vnd.apple.mpegurl', size: job.received, parts: files.length, at: Date.now() });
        })();
      }
      job.done.then(() => settle('complete'), async () => { await rm(`${base}.part`, { recursive: true, force: true }).catch(() => {}); settle('failed'); });
    })();
    job.head.catch(async () => { await rm(`${base}.part`, { recursive: true, force: true }).catch(() => {}); settle('failed'); });
    return job;
  }
  /** Explicit downloads run two at a time. */
  function pump() {
    while (explicit < EXPLICIT && queue.length) {
      const item = queue.shift(); if (entries.has(item.id)) continue;
      const running = jobs.get(item.id); if (running) { running.explicit = true; continue; }
      explicit++; const job = begin(item.id, item.uri, item.headers, true, item.provider);
      const done = () => { explicit--; pump(); };
      job.head.then(() => job.done.then(done, done), done);
    }
  }
  const moved = job => `${join(directory, name(job.id))}.${job.kind === 'hls' ? 'hls' : 'bin'}`;
  /** Bytes [start, end] of a file download, as far as it has got; waits for the rest. */
  function tail(job, start, end) {
    let position = start, handle, closed = false; job.readers++;
    const finish = async () => { if (closed) return; closed = true; job.readers--; try { await handle?.close(); } catch { /* Already closed. */ } };
    return new ReadableStream({
      async pull(controller) {
        try {
          for (;;) {
            if (position > end) { await finish(); controller.close(); return; }
            const available = Math.min(job.received, end + 1) - position;
            if (available > 0) {
              handle ??= await open(job.path, 'r').catch(() => open(moved(job), 'r'));
              const buffer = new Uint8Array(Math.min(available, 256 * 1024)), { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
              if (!bytesRead) throw new Error('Cache file is shorter than expected');
              position += bytesRead; controller.enqueue(bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead)); return;
            }
            if (job.state !== 'loading') throw new Error('Download failed');
            await job.wait();
          }
        } catch (error) { await finish(); controller.error(error); }
      },
      cancel() { return finish(); },
    });
  }
  function fileResponse(request, path, size, type) {
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', ...CORS };
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2])), end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, ...CORS } });
      return new Response(Readable.toWeb(createReadStream(path, { start, end })), { status: 206, headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` } });
    }
    return new Response(Readable.toWeb(createReadStream(path)), { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
  }
  async function* partBytes(folder, count, signal, job) {
    for (let index = 0; index < count; index++) {
      while (job && job.parts.length <= index) { if (job.state !== 'loading' && job.parts.length <= index) throw new Error('Download failed'); await Promise.race([job.wait(), new Promise(resolve => signal?.addEventListener('abort', resolve, { once: true }))]); signal?.throwIfAborted(); }
      signal?.throwIfAborted();
      yield await readFile(join(folder(), `p${index}`)).catch(error => { if (!job) throw error; return readFile(join(moved(job), `p${index}`)); });
    }
  }
  async function* streamBytes(stream, signal) {
    const reader = stream.getReader(), aborted = new Promise(resolve => signal?.addEventListener('abort', () => resolve({ done: true }), { once: true }));
    try { for (;;) { const { done, value } = await Promise.race([reader.read(), aborted]); if (done || signal?.aborted) return; yield Buffer.from(value.buffer, value.byteOffset, value.byteLength); } }
    finally { await reader.cancel().catch(() => {}); }
  }

  return {
    snapshot: async () => { await load(); return snapshot(); },
    async configure(options) { await load(); automatic = options?.automatic !== false; limit = Math.max(128 * 1024 * 1024, (Number(options?.limitMb) || 4096) * 1024 * 1024); await trim(); changed(); },
    setPreferred(ids) { preferred = new Set(Array.isArray(ids) ? ids.map(String) : []); },
    /** Where a complete track plays from, for the window.
     * @returns {Promise<{available: boolean, uri?: string, provider?: string}>} */
    async source(id) { const entry = await ready(String(id)); if (!entry) return { available: false }; touch(entry); return { available: true, ...(entry.provider ? { provider: entry.provider } : {}), uri: entry.kind === 'hls' ? `ss-media://hls/${entry.name}/index.m3u8` : `ss-media://cache/?id=${encodeURIComponent(entry.id)}` }; },
    /** The player is about to play or preload this address: copy it in the background. */
    async note(id, uri, headers, provider) {
      await load(); id = String(id);
      const job = jobs.get(id);
      if (job) { job.provider ??= provider; return; }
      if (automatic && /^https:/.test(String(uri)) && !entries.has(id)) begin(id, String(uri), headers, false, provider);
    },
    async download({ id, uri, headers, provider = undefined }) { await load(); id = String(id); if (!/^https:/.test(String(uri))) throw new Error('HTTPS is required'); if (entries.has(id)) return; const job = jobs.get(id); if (job) job.explicit = true; else if (!queue.some(item => item.id === id)) queue.push({ id, uri: String(uri), headers, provider }); changed(); pump(); },
    async remove({ id }) { await load(); id = String(id); const at = queue.findIndex(item => item.id === id); if (at >= 0) queue.splice(at, 1); jobs.get(id)?.controller.abort(); const entry = entries.get(id); if (entry) await drop(entry); changed(); },
    async clear() { await load(); queue.length = 0; for (const job of jobs.values()) job.controller.abort(); for (const entry of [...entries.values()]) await drop(entry); changed(); },
    /** ss-media://stream with a track id: from disk when complete, else through the shared download. */
    async stream(request, id, url, headers, proxy) {
      const entry = await ready(id);
      if (entry?.kind === 'file') { touch(entry); return fileResponse(request, location(entry), entry.size, entry.type); }
      let job = jobs.get(id);
      if (HLS.test(url) || job && job.kind !== 'file' || !job && !automatic) return proxy();
      job ??= begin(id, url, headers, false);
      try { await job.head; } catch { return proxy(); }
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? ''), ranged = !!range && !!(range[1] || range[2]);
      let start = 0, end = job.total - 1;
      if (ranged) { start = range[1] ? Number(range[1]) : Math.max(0, job.total - Number(range[2])); if (range[1] && range[2]) end = Math.min(Number(range[2]), job.total - 1); }
      if (start >= job.total || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${job.total}`, ...CORS } });
      // A jump far ahead of the download is answered from the network; the copy keeps going.
      if (job.state === 'failed' || start > job.received + NEAR) return proxy();
      return new Response(tail(job, start, end), { status: ranged ? 206 : 200, headers: { 'Content-Type': job.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Content-Length': String(end - start + 1), ...(ranged ? { 'Content-Range': `bytes ${start}-${end}/${job.total}` } : {}), ...CORS } });
    },
    /** ss-media://cache/?id=… — a complete file. */
    async serve(request, id) { const entry = await ready(String(id)); if (entry?.kind !== 'file') return new Response('Not found', { status: 404, headers: CORS }); touch(entry); return fileResponse(request, location(entry), entry.size, entry.type); },
    /** ss-media://hls/<name>/index.m3u8 and its parts. */
    async serveHls(request, path) {
      await load(); const match = /^\/([a-f0-9]{40})\/(index\.m3u8|p\d{1,4})$/.exec(path), entry = match ? names.get(match[1]) : undefined;
      if (!entry || entry.kind !== 'hls') return new Response('Not found', { status: 404, headers: CORS });
      const file = join(location(entry), match[2]); let info; try { info = await stat(file); } catch { await drop(entry); changed(); return new Response('Not found', { status: 404, headers: CORS }); }
      touch(entry); return fileResponse(request, file, info.size, match[2] === 'index.m3u8' ? 'application/vnd.apple.mpegurl' : 'application/octet-stream');
    },
    /** The audio bytes of a track in file order (HLS: init + segments), for the waveform decoder; null when not here. */
    async bytes(id, signal) {
      id = String(id); const entry = await ready(id);
      if (entry?.kind === 'file') return Readable.from(createReadStream(location(entry), { signal }));
      if (entry?.kind === 'hls') return partBytes(() => location(entry), entry.parts, signal);
      const job = jobs.get(id); if (!job) return null;
      try { await job.head; } catch { return null; }
      return job.kind === 'hls' ? partBytes(() => job.path, job.count, signal, job) : streamBytes(tail(job, 0, job.total - 1), signal);
    },
    /** For tests and shutdown: resolves when nothing is downloading. */
    async idle() { for (;;) { const running = [...jobs.values()]; if (!running.length && !queue.length) return; await Promise.all(running.map(job => job.head.then(() => job.done, () => {}).catch(() => {}))); await new Promise(resolve => setTimeout(resolve, 0)); } },
  };
}
