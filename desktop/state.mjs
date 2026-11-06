import { mkdir, readdir, readFile, rename, rm, open } from 'node:fs/promises';
import { join } from 'node:path';
/*
 * Persistent app state, one file per key. Same contract as the Android StateStore plugin:
 * read() returns everything, write() replaces one key atomically (temp file + fsync + rename).
 * Settings (themes included) go to the config folder, everything else to data/state.
 */
const SETTINGS = 'ss_settings_v1';
const KEY = /^ss_[A-Za-z0-9_.-]{1,120}$/;
const MAX_VALUE = 64 * 1024 * 1024;
export function createStateStore(paths) {
  const state = join(paths.data, 'state');
  const file = key => key === SETTINGS ? join(paths.config, 'settings.json') : join(state, `${key}.json`);
  const check = key => { if (typeof key !== 'string' || !KEY.test(key)) throw new Error('Invalid state key'); return key; };
  // Writes of one key are serialized: an older value can never land after a newer one.
  const queues = new Map();
  const queue = (key, task) => { const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(task); queues.set(key, next); void next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {}); return next; };
  async function atomic(target, text) {
    const temp = `${target}.${process.pid}.tmp`;
    const handle = await open(temp, 'w');
    try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, target);
  }
  return {
    async read() {
      await mkdir(state, { recursive: true }); await mkdir(paths.config, { recursive: true });
      const values = {};
      for (const name of await readdir(state)) {
        const key = name.replace(/\.json$/, '');
        if (name.endsWith('.json') && KEY.test(key)) try { values[key] = await readFile(join(state, name), 'utf8'); } catch { /* Unreadable file: skipped, the rest still loads. */ }
      }
      try { values[SETTINGS] = await readFile(file(SETTINGS), 'utf8'); } catch { /* No settings yet. */ }
      return values;
    },
    write(key, value) {
      check(key); if (typeof value !== 'string' || value.length > MAX_VALUE) throw new Error('Invalid state value');
      return queue(key, async () => { await mkdir(key === SETTINGS ? paths.config : state, { recursive: true }); await atomic(file(key), value); });
    },
    remove(key) { check(key); return queue(key, () => rm(file(key), { force: true })); },
    /** Leftover temp files of a crashed write are removed on start; the previous value stays. */
    async cleanup() { for (const directory of [state, paths.config]) try { for (const name of await readdir(directory)) if (name.endsWith('.tmp')) await rm(join(directory, name), { force: true }); } catch { /* Missing folder. */ } },
    flush: () => Promise.all([...queues.values()].map(value => value.catch(() => {}))),
  };
}
