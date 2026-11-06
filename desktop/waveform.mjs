import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { net } from 'electron';
import { fileURLToPath } from 'node:url';
/*
 * Waveform, loudness and bass rhythm computed on the computer (SPEC §6), the same numbers as
 * android/…/AudioWaveform.java: ffmpeg decodes to float PCM on stdout, every block goes
 * straight into 1000 bins (RMS·0.65 + peak·0.35) and 50 ms bass frames, then is dropped.
 * Memory stays constant for any track length; no resampling; first channel only.
 * Cache file format and key are the Android ones (WaveformCache.java), in data/waveforms.
 */
const POINTS = 1000, VERSION = 2, RHYTHM_FPS = 20, MAX_RHYTHM = 20 * 7200, TIMEOUT = 240_000;
// The AppImage carries its own static ffmpeg (scripts/build-ffmpeg.mjs); development uses the one in .toolchain.
const here = dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.SS_FFMPEG ?? [process.resourcesPath && join(process.resourcesPath, 'ffmpeg', 'ffmpeg'), join(here, '..', '.toolchain', 'ffmpeg', 'ffmpeg')].find(path => path && existsSync(path)) ?? 'ffmpeg';

/** Bytes of a stream: a progressive file, or the init + media segments of an HLS playlist (unencrypted only). */
async function* streamBytes(input, headers, signal) {
  const get = async url => { const response = await net.fetch(url, { headers: headers ?? {}, credentials: 'omit', signal }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response; };
  if (!/\.m3u8(?:\?|$)/i.test(new URL(input).pathname + new URL(input).search)) { const response = await get(input); for await (const chunk of response.body) yield Buffer.from(chunk); return; }
  let url = input, text = await (await get(url)).text();
  if (/#EXT-X-STREAM-INF|#EXT-X-MEDIA:.*TYPE=AUDIO/.test(text)) {
    // Master playlist: the audio rendition, else the lowest-bandwidth variant.
    const audio = /#EXT-X-MEDIA:[^\n]*TYPE=AUDIO[^\n]*URI="([^"]+)"/.exec(text)?.[1];
    const variants = [...text.matchAll(/#EXT-X-STREAM-INF:[^\n]*BANDWIDTH=(\d+)[^\n]*\n([^#\n][^\n]*)/g)].sort((a, b) => Number(a[1]) - Number(b[1]));
    const next = audio ?? variants[0]?.[2]?.trim(); if (!next) throw new Error('No HLS rendition');
    url = new URL(next, url).href; text = await (await get(url)).text();
  }
  if (/#EXT-X-KEY:(?![^\n]*METHOD=NONE)/.test(text)) throw new Error('Encrypted HLS');
  const init = /#EXT-X-MAP:[^\n]*URI="([^"]+)"/.exec(text)?.[1];
  const segments = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  for (const part of [...(init ? [init] : []), ...segments]) { const response = await get(new URL(part, url).href); for await (const chunk of response.body) yield Buffer.from(chunk); }
}
export function createWaveforms(paths, emit) {
  const directory = join(paths.data, 'waveforms'), limitFile = join(directory, 'limit.json');
  const jobs = new Map(), streams = new Map();
  let available, limit = 32 * 1024 * 1024, running = 0; const waiting = [];
  void readFile(limitFile, 'utf8').then(text => { const value = JSON.parse(text).bytes; if (Number.isFinite(value)) limit = value; }).catch(() => {});
  const hasFfmpeg = () => available ??= spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' }).status === 0;
  const file = key => join(directory, `${createHash('sha256').update(`local:${key}:${VERSION}`).digest('hex')}.wfm`);
  async function readCache(key) {
    try {
      const path = file(key), bytes = await readFile(path), length = bytes.length;
      if (length !== POINTS && length < POINTS + 4 || length > POINTS + 4 + MAX_RHYTHM) return null;
      const now = new Date(); void utimes(path, now, now).catch(() => {});
      const result = { samples: [...bytes.subarray(0, POINTS)].map(value => value / 255), progress: 1, status: 'ready', cached: true };
      if (length >= POINTS + 4) result.loudness = bytes.readFloatBE(POINTS);
      if (length > POINTS + 4) result.rhythm = bytes.subarray(POINTS + 4).toString('base64');
      return result;
    } catch { return null; }
  }
  async function writeCache(key, values, loudness, rhythm) {
    await mkdir(directory, { recursive: true });
    const bytes = Buffer.alloc(POINTS + 4 + rhythm.length);
    for (let index = 0; index < POINTS; index++) bytes[index] = Math.max(0, Math.min(255, Math.round(values[index] * 255)));
    bytes.writeFloatBE(loudness, POINTS); rhythm.copy(bytes, POINTS + 4);
    const target = file(key), temp = `${target}.tmp`;
    await writeFile(temp, bytes); await rename(temp, target); await trim();
  }
  async function entries() { try { return await Promise.all((await readdir(directory)).filter(name => name.endsWith('.wfm')).map(async name => { const info = await stat(join(directory, name)); return { path: join(directory, name), size: info.size, at: info.mtimeMs }; })); } catch { return []; } }
  async function trim() { const list = await entries(); let bytes = list.reduce((sum, item) => sum + item.size, 0); if (bytes <= limit) return; for (const item of list.sort((a, b) => a.at - b.at)) { await rm(item.path, { force: true }); bytes -= item.size; if (bytes <= limit) break; } }
  const values = (squares, peaks, measured) => { const out = new Float64Array(POINTS); let maximum = .001; for (let index = 0; index < POINTS; index++) { out[index] = Math.sqrt(squares[index] / Math.max(1, measured[index])) * .65 + peaks[index] * .35; maximum = Math.max(maximum, out[index]); } return Array.from(out, value => value / maximum); };
  function rhythmBytes(bass, counts) {
    const level = Array.from(bass, (value, index) => Math.sqrt(value / Math.max(1, counts[index])));
    const sorted = [...level].sort((a, b) => a - b), top = Math.max(1e-4, sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .98))]);
    return Buffer.from(level.map(value => Math.max(0, Math.min(255, Math.round(value / top * 255)))));
  }
  /** One decode. `input` is a file path or an https URL with optional request headers. */
  function decode(key, input, headers, duration, cancelled) {
    return new Promise((resolve, reject) => {
      // Streams are fetched here and piped in: the bundled ffmpeg has no network code at all.
      const remote = /^https:/.test(input);
      const args = ['-hide_banner', '-nostdin', '-loglevel', 'info', '-i', remote ? 'pipe:0' : input, '-map', '0:a:0', '-vn', '-sn', '-dn', '-af', 'pan=mono|c0=c0', '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'];
      const child = spawn(FFMPEG, args, { stdio: [remote ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
      const feed = new AbortController();
      if (remote) {
        child.stdin.on('error', () => {}); // ffmpeg may stop reading early (cancel, broken file).
        void (async () => {
          try { for await (const chunk of streamBytes(input, headers, feed.signal)) { if (!child.stdin.write(chunk)) await new Promise(done => child.stdin.once('drain', done)); } }
          catch { /* ffmpeg ends with what it got, or fails below. */ }
          finally { child.stdin.end(); }
        })();
        child.on('close', () => feed.abort());
      }
      const squares = new Float64Array(POINTS), peaks = new Float64Array(POINTS), measured = new Float64Array(POINTS);
      const frames = Math.max(1, Math.min(MAX_RHYTHM, Math.ceil(duration * RHYTHM_FPS))), bass = new Float64Array(frames), bassCount = new Float64Array(frames);
      let rate = 0, alpha = 0, low1 = 0, low2 = 0, sample = 0, completed = 0, log = '', rest = Buffer.alloc(0), pending = [], lastProgress = Date.now();
      const timer = setTimeout(() => { child.kill('SIGKILL'); }, TIMEOUT);
      cancelled.kill = () => { feed.abort(); child.kill('SIGKILL'); };
      const consume = chunk => {
        const data = rest.length ? Buffer.concat([rest, chunk]) : chunk, usable = data.length - data.length % 4;
        rest = data.subarray(usable);
        const binsPerSample = POINTS / (duration * rate), framesPerSample = RHYTHM_FPS / rate;
        for (let offset = 0; offset < usable; offset += 4, sample++) {
          const value = data.readFloatLE(offset); if (!Number.isFinite(value)) continue;
          const bin = Math.max(0, Math.min(POINTS - 1, Math.floor(sample * binsPerSample)));
          squares[bin] += value * value; if (Math.abs(value) > peaks[bin]) peaks[bin] = Math.abs(value); measured[bin]++; if (bin > completed) completed = bin;
          low1 += alpha * (value - low1); low2 += alpha * (low1 - low2);
          const frame = Math.max(0, Math.min(frames - 1, Math.floor(sample * framesPerSample))); bass[frame] += low2 * low2; bassCount[frame]++;
        }
        const now = Date.now();
        if (now - lastProgress >= 250 && completed > 0) { lastProgress = now; emit({ uri: key, samples: values(squares, peaks, measured), progress: completed / POINTS, status: 'building' }); }
      };
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', text => {
        if (log.length < 64_000) log += text;
        // The output stream line names the decoded sample rate: "Audio: pcm_f32le, 44100 Hz, mono".
        if (!rate) { const match = /Output #0[\s\S]*?Audio: pcm_f32le[^,]*, (\d+) Hz/.exec(log); if (match) { rate = Number(match[1]); alpha = 1 - Math.exp(-2 * Math.PI * 140 / rate); for (const chunk of pending) consume(chunk); pending = []; } }
      });
      child.stdout.on('data', chunk => { if (rate) consume(chunk); else pending.push(chunk); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => {
        clearTimeout(timer);
        if (cancelled.value) { reject(Object.assign(new Error('Waveform superseded'), { code: 'CANCELLED' })); return; }
        if (code !== 0 || !rate || !sample) { reject(new Error(`ffmpeg failed (${code}): ${log.split('\n').filter(Boolean).slice(-2).join(' ')}`)); return; }
        let energy = 0, total = 0; for (let index = 0; index < POINTS; index++) { energy += squares[index]; total += measured[index]; }
        const loudness = total > 0 && energy > 0 ? 10 * Math.log10(energy / total) : -60;
        resolve({ values: values(squares, peaks, measured), loudness, rhythm: rhythmBytes(bass, bassCount) });
      });
    });
  }
  async function slot() { if (running < 2) { running++; return; } await new Promise(resolve => waiting.push(resolve)); running++; }
  function release() { running--; waiting.shift()?.(); }
  async function analyse(key, input, headers, options) {
    const duration = Number(options.duration); if (!(duration > 0)) throw new Error('Unknown duration');
    const previous = jobs.get(key); if (previous) { previous.value = true; previous.kill?.(); }
    const cancelled = { value: false }; jobs.set(key, cancelled);
    try {
      const cached = await readCache(key);
      if (cached && (!options.loudness || 'loudness' in cached) && (!options.rhythm || 'rhythm' in cached)) return cached;
      if (!hasFfmpeg()) return { error: 'UNAVAILABLE' };
      await slot();
      try {
        if (cancelled.value) return { error: 'CANCELLED' };
        const started = Date.now(), result = await decode(key, input, headers, duration, cancelled);
        await writeCache(key, result.values, result.loudness, result.rhythm);
        const value = { uri: key, samples: result.values, progress: 1, status: 'ready', loudness: result.loudness, rhythm: result.rhythm.toString('base64'), computeMs: Date.now() - started };
        emit(value); return value;
      } finally { release(); }
    } catch (error) { if (error?.code === 'CANCELLED') return { error: 'CANCELLED' }; throw error; }
    finally { if (jobs.get(key) === cancelled) jobs.delete(key); }
  }
  return {
    readWaveform(options) {
      let path; try { path = fileURLToPath(String(options.uri)); } catch { throw new Error('Audio file is required'); }
      return analyse(String(options.uri), path, undefined, options);
    },
    readStreamWaveform(options) {
      const id = String(options.id), stream = streams.get(id);
      if (!stream) return readCache(`stream:${id}`).then(cached => cached && (!options.loudness || 'loudness' in cached) && (!options.rhythm || 'rhythm' in cached) ? cached : { error: 'NOT_READY' });
      return analyse(`stream:${id}`, stream.uri, stream.headers, options);
    },
    /** The player registers the stream address when it prepares a track (as MusicCache.streamUri on Android). */
    registerStream(id, uri, headers) { if (typeof id !== 'string' || !/^https:/.test(String(uri))) return; streams.set(id, { uri: String(uri), headers }); if (streams.size > 32) streams.delete(streams.keys().next().value); },
    cancel(key) { const job = jobs.get(String(key)); if (job) { job.value = true; job.kill?.(); } },
    async stats() { const list = await entries(); return { bytes: list.reduce((sum, item) => sum + item.size, 0), count: list.length, limit }; },
    async clear() { for (const item of await entries()) await rm(item.path, { force: true }); },
    async setLimit(bytes) { limit = Math.max(1024 * 1024, Math.min(256 * 1024 * 1024, Number(bytes) || limit)); await mkdir(directory, { recursive: true }); await writeFile(limitFile, JSON.stringify({ bytes: limit })); await trim(); },
  };
}
