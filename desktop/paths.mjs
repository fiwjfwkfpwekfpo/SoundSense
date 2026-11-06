import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
/*
 * Three folders, as in docs/SPEC.md §15:
 *   config — settings and themes (small, fine for dotfiles)
 *   data   — library, waves, downloads, logs, Chromium storage. Back up this one folder.
 *   cache  — listened tracks, covers, HTTP cache. Safe to delete at any time.
 * XDG variables are respected; a relative XDG value is ignored, as the spec requires.
 */
const xdg = (name, fallback) => { const value = process.env[name]; return value && isAbsolute(value) ? value : join(homedir(), fallback); };
const NAME = 'soundsense';
export function appPaths() {
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    return { config: join(roaming, 'SoundSense'), data: join(local, 'SoundSense', 'Data'), cache: join(local, 'SoundSense', 'Cache') };
  }
  return { config: join(xdg('XDG_CONFIG_HOME', '.config'), NAME), data: join(xdg('XDG_DATA_HOME', '.local/share'), NAME), cache: join(xdg('XDG_CACHE_HOME', '.cache'), NAME) };
}
