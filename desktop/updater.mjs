import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
/*
 * Self-update of the AppImage. The window has already verified the signed manifest (Ed25519);
 * this process downloads the file named in it, checks size and SHA-256, and replaces the running
 * AppImage:
 *   1. download to <cache>/updates/<name>.part, hash while writing, rename to <name> when it matches
 *   2. copy next to the installed AppImage, mark executable, rename over it (atomic; the running
 *      instance keeps working from the old inode)
 *   3. start the new file once this process has exited, then quit
 * Nothing is installed unless the size and the hash match the manifest.
 */
const MAX_SIZE = 512 * 1024 * 1024, NAME = /^[a-z\d][a-z\d._-]{0,180}\.AppImage$/i, HEX = /^[a-f\d]{64}$/i;
const PROGRESS_EVERY = 250;

export function validateArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object') throw new Error('Invalid update');
  const { filename, size, sha256, urls } = artifact;
  if (typeof filename !== 'string' || !NAME.test(filename)) throw new Error('Invalid update file name');
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_SIZE) throw new Error('Invalid update size');
  if (typeof sha256 !== 'string' || !HEX.test(sha256)) throw new Error('Invalid update hash');
  if (!Array.isArray(urls) || !urls.length || urls.length > 12) throw new Error('Invalid update addresses');
  const safe = urls.filter(value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } });
  if (!safe.length) throw new Error('Invalid update addresses');
  return { filename, size, sha256: sha256.toLowerCase(), urls: safe };
}
/** The file must be an ELF AppImage of type 2 ("AI\x02" at offset 8): a wrong file never replaces the app. */
export async function looksLikeAppImage(path) {
  const handle = await open(path, 'r');
  try { const { buffer } = await handle.read(Buffer.alloc(11), 0, 11, 0); return buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && buffer[8] === 0x41 && buffer[9] === 0x49 && buffer[10] === 0x02; }
  finally { await handle.close(); }
}
/** Environment for the new instance: the old AppImage mount must not leak into it. */
export function cleanEnv(env) {
  const out = { ...env }, mount = env.APPDIR;
  for (const key of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD', 'SS_DEV_URL']) delete out[key];
  if (mount) for (const key of ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'GSETTINGS_SCHEMA_DIR']) if (out[key]) {
    const kept = out[key].split(':').filter(part => part && !part.startsWith(mount));
    if (kept.length) out[key] = kept.join(':'); else delete out[key];
  }
  return out;
}

/**
 * @param {{ cache: string, appImage?: string, fetch: typeof fetch, onProgress?: (value: { id: string, bytes: number }) => void,
 *           quit?: () => void, spawnFile?: typeof spawn, pid?: number, env?: Record<string, string | undefined> }} options
 */
export function createUpdater({ cache, appImage, fetch: doFetch, onProgress = () => {}, quit = () => {}, spawnFile = spawn, pid = process.pid, env = process.env }) {
  const folder = join(cache, 'updates'), jobs = new Map(), ready = new Map();
  const available = () => !!appImage;
  async function cleanup(keep) {
    let names = []; try { names = await readdir(folder); } catch { return; }
    for (const name of names) if (name !== keep) await rm(join(folder, name), { force: true }).catch(() => {});
  }
  async function fetchTo(url, part, artifact, id, signal) {
    const response = await doFetch(url, { signal, credentials: 'omit', redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const hash = createHash('sha256'), handle = await open(part, 'w', 0o600);
    let bytes = 0, last = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.length; if (bytes > artifact.size) throw new Error('Update is larger than announced');
        hash.update(value); await handle.write(value);
        if (Date.now() - last >= PROGRESS_EVERY) { last = Date.now(); onProgress({ id, bytes }); }
      }
    } finally { await handle.close(); }
    onProgress({ id, bytes });
    if (bytes !== artifact.size) throw new Error('Update size does not match');
    if (hash.digest('hex') !== artifact.sha256) throw new Error('Update hash does not match');
  }
  return {
    available,
    /** Resolves with the token for install(). */
    async download(id, artifactInput) {
      const artifact = validateArtifact(artifactInput);
      if (!available()) throw new Error('Not running from an AppImage');
      jobs.get(id)?.abort(); const controller = new AbortController(); jobs.set(id, controller);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      await cleanup(); const part = join(folder, `${artifact.filename}.part`), file = join(folder, artifact.filename);
      try {
        let failure = new Error('No address worked');
        for (const url of artifact.urls) {
          if (controller.signal.aborted) throw new Error('Aborted');
          try { await fetchTo(url, part, artifact, id, controller.signal); failure = undefined; break; } catch (error) { failure = error; await rm(part, { force: true }); }
        }
        if (failure) throw failure;
        await rename(part, file); ready.set(id, { file, artifact });
        return id;
      } finally { jobs.delete(id); await rm(part, { force: true }).catch(() => {}); }
    },
    cancel(id) { jobs.get(id)?.abort(new Error('Aborted')); },
    /** Replaces the AppImage and starts the new one when this process is gone. */
    async install(token) {
      const entry = ready.get(token); if (!entry) throw new Error('Nothing downloaded');
      if (!available()) throw new Error('Not running from an AppImage');
      const info = await stat(entry.file); if (info.size !== entry.artifact.size || !await looksLikeAppImage(entry.file)) throw new Error('Downloaded file is not an AppImage');
      const next = `${appImage}.update`;
      try { await copyFile(entry.file, next); await chmod(next, 0o755); await rename(next, appImage); }
      catch (error) { await rm(next, { force: true }).catch(() => {}); throw error; }
      await rm(entry.file, { force: true }).catch(() => {}); ready.delete(token);
      // Wait for this process (and its single-instance lock) to end, then start the new file.
      const child = spawnFile('/bin/sh', ['-c', 'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; exec "$2"', 'sh', String(pid), appImage], { detached: true, stdio: 'ignore', env: cleanEnv(env) });
      child.unref?.(); quit();
      return 'opened';
    },
  };
}
