import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/*
 * A tiny static ffmpeg for the desktop build: only audio decoding to raw float PCM, for waveforms,
 * loudness and rhythm (desktop/waveform.mjs). No network code (the desktop process fetches streams
 * and pipes them in), no external libraries, statically linked: it runs on any x86_64 Linux and the
 * AppImage needs nothing from the system. Result: .toolchain/ffmpeg/ffmpeg (~3 MB).
 * The source tarball is pinned by SHA-256 (verified once against the FFmpeg release signing key
 * FCF986EA15E6E293A5644F10B4322F04D67658D8). Building needs gcc and make on the build machine only.
 */
const VERSION = '9.0.2', SHA256 = '8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e';
const root = fileURLToPath(new URL('../', import.meta.url));
const base = resolve(root, '.toolchain/ffmpeg-src'), out = resolve(root, '.toolchain/ffmpeg'), binary = resolve(out, 'ffmpeg');
const stamp = resolve(out, 'version');
try { if ((await readFile(stamp, 'utf8')).trim() === VERSION && existsSync(binary)) { console.log(`ffmpeg ${VERSION} is ready.`); process.exit(0); } } catch { /* Build it. */ }
await mkdir(base, { recursive: true });
const tarball = resolve(base, `ffmpeg-${VERSION}.tar.xz`);
const sha = async file => createHash('sha256').update(await readFile(file)).digest('hex');
if (!existsSync(tarball) || await sha(tarball) !== SHA256) {
  console.log(`Downloading ffmpeg ${VERSION} source…`);
  const response = await fetch(`https://ffmpeg.org/releases/ffmpeg-${VERSION}.tar.xz`);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  await writeFile(tarball, Buffer.from(await response.arrayBuffer()));
}
if (await sha(tarball) !== SHA256) throw new Error('ffmpeg source: SHA-256 mismatch');
const source = resolve(base, `ffmpeg-${VERSION}`);
function run(command, args, cwd = base) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args[0] ?? ''} failed`);
}
await rm(source, { recursive: true, force: true });
run('tar', ['-xJf', tarball]);
const decoders = ['aac', 'aac_latm', 'mp3', 'mp3float', 'mp2', 'mp2float', 'flac', 'alac', 'opus', 'vorbis', 'wavpack', 'ape', 'wmav1', 'wmav2', 'wmapro', 'ac3', 'eac3',
  'pcm_s16le', 'pcm_s16be', 'pcm_s24le', 'pcm_s24be', 'pcm_s32le', 'pcm_s32be', 'pcm_f32le', 'pcm_f32be', 'pcm_f64le', 'pcm_u8', 'pcm_alaw', 'pcm_mulaw'];
const demuxers = ['mov', 'mp3', 'flac', 'ogg', 'matroska', 'wav', 'aiff', 'aac', 'mpegts', 'asf', 'wv', 'ape', 'ac3', 'eac3'];
const parsers = ['aac', 'aac_latm', 'mpegaudio', 'flac', 'opus', 'vorbis', 'ac3'];
run('./configure', [
  '--prefix=' + resolve(source, 'install'), '--disable-everything', '--disable-autodetect', '--disable-doc', '--disable-debug', '--disable-network',
  '--disable-ffplay', '--disable-ffprobe', '--disable-avdevice', '--disable-swscale', '--disable-x86asm',
  '--enable-static', '--disable-shared', '--enable-small', '--pkg-config-flags=--static', '--extra-ldflags=-static', '--extra-cflags=-O2',
  ...decoders.map(name => `--enable-decoder=${name}`), ...demuxers.map(name => `--enable-demuxer=${name}`), ...parsers.map(name => `--enable-parser=${name}`),
  '--enable-protocol=file', '--enable-protocol=pipe', '--enable-filter=pan', '--enable-filter=aformat', '--enable-filter=aresample', '--enable-filter=anull',
  '--enable-encoder=pcm_f32le', '--enable-muxer=pcm_f32le', '--enable-swresample',
], source);
run('make', [`-j${Math.max(1, cpus().length)}`, 'ffmpeg'], source);
await mkdir(out, { recursive: true });
await copyFile(resolve(source, 'ffmpeg'), binary);
run('strip', [binary]);
await copyFile(resolve(source, 'LICENSE.md'), resolve(out, 'LICENSE.md'));
await copyFile(resolve(source, 'COPYING.LGPLv2.1'), resolve(out, 'COPYING.LGPLv2.1'));
await writeFile(stamp, VERSION + '\n');
await rm(source, { recursive: true, force: true });
console.log(`ffmpeg ${VERSION} built: ${binary}`);
