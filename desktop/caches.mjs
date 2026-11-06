import { lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
/*
 * Chromium keeps its disk caches inside userData, and Electron ignores both app.setPath('cache')
 * and --disk-cache-dir. Those folders are caches (safe to delete), so on Linux they are symbolic
 * links into the cache folder: the data folder then holds only what is worth backing up.
 */
export const CACHE_FOLDERS = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GPUPersistentCache', 'Shared Dictionary'];
/** Call before Chromium starts. Returns the folders that were linked now. */
export function linkCaches(data, cache, folders = CACHE_FOLDERS) {
  const linked = [];
  mkdirSync(data, { recursive: true }); mkdirSync(cache, { recursive: true });
  for (const name of folders) {
    const from = join(data, name), to = join(cache, name);
    mkdirSync(to, { recursive: true });
    let stat; try { stat = lstatSync(from); } catch { /* Not there yet. */ }
    if (stat?.isSymbolicLink()) { if (readlinkSync(from) === to) continue; rmSync(from); }
    else if (stat) rmSync(from, { recursive: true, force: true }); // A real cache folder from an older version: just a cache.
    symlinkSync(to, from, 'dir'); linked.push(name);
  }
  return linked;
}
