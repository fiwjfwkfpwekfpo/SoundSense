import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { execFile } from 'node:child_process';
/*
 * Desktop integration for the AppImage (freedesktop.org Desktop Entry and Icon Theme specs).
 * An AppImage is a single file; the menu entry and the icon are put where launchers look:
 *   $XDG_DATA_HOME/applications/soundsense.desktop            (default ~/.local/share/applications)
 *   $XDG_DATA_HOME/icons/hicolor/<N>x<N>/apps/soundsense.png
 * It runs on start, only for an AppImage, and only writes what is missing or changed (for example,
 * when the file was moved). A launcher that manages AppImages itself (AppImageLauncher, appimaged,
 * Gear Lever) is left alone. Nothing is touched outside XDG_DATA_HOME.
 */
export const APP_ID = 'soundsense';
const MARKER = 'X-SoundSense-Managed=true';
/** @param {Record<string, string | undefined>} [env] */
const dataHome = (env = process.env) => env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(homedir(), '.local', 'share');
/** @param {Record<string, string | undefined>} [env] */
export const locations = (env = process.env) => {
  const base = dataHome(env);
  return { applications: join(base, 'applications'), entry: join(base, 'applications', `${APP_ID}.desktop`), icons: join(base, 'icons', 'hicolor') };
};
/** Exec values are quoted and escaped as the Desktop Entry spec requires (`"`, `` ` ``, `$`, `\` and `%`). */
export const quoteExec = path => `"${path.replace(/[\\"`$]/g, match => `\\${match}`).replace(/%/g, '%%')}"`;
export function desktopEntry({ appImage, version }) {
  return [
    '[Desktop Entry]', 'Type=Application', 'Version=1.5',
    'Name=SoundSense', 'GenericName=Music Player', 'GenericName[ru]=Музыкальный плеер',
    'Comment=Personal music player', 'Comment[ru]=Личный музыкальный плеер',
    `Exec=${quoteExec(appImage)} %U`, `TryExec=${appImage}`, `Icon=${APP_ID}`, 'Terminal=false',
    'Categories=AudioVideo;Audio;Player;', 'Keywords=music;player;audio;плеер;музыка;', `StartupWMClass=${APP_ID}`,
    MARKER, ...(version ? [`X-SoundSense-Version=${version}`] : []), '',
  ].join('\n');
}
const iconSizes = folder => existsSync(folder) ? readdirSync(folder).map(name => /^(\d+)x\1\.png$/.exec(name)).filter(Boolean).map(match => ({ size: match[1], file: match[0] })) : [];
/** A launcher that integrates AppImages on its own already shows this app; a second entry would duplicate it. */
const managedElsewhere = applications => existsSync(applications) && readdirSync(applications).some(name => /^appimagekit_.*soundsense.*\.desktop$/i.test(name) || /^(appimagelauncher|gearlever)[^/]*soundsense[^/]*\.desktop$/i.test(name));
/** @param {string} file @param {string[]} args */
const spawn = (file, args) => { try { execFile(file, args, { timeout: 10_000 }, () => {}).on('error', () => {}); } catch { /* Not installed. */ } };
const refresh = (place, run) => {
  // Launchers that cache icons pick the new ones up after this; a missing tool is not an error.
  if (existsSync(join(place.icons, 'icon-theme.cache'))) run('gtk-update-icon-cache', ['-q', '-t', '-f', place.icons]);
  run('update-desktop-database', ['-q', place.applications]);
};

/**
 * Writes the menu entry and the icons. Returns what changed.
 * @param {{ appImage?: string, iconsFolder: string, version?: string, env?: Record<string, string | undefined>, run?: (file: string, args: string[]) => void, force?: boolean }} options
 * @returns {{ changed: string[], skipped?: string }}
 */
export function integrate({ appImage, iconsFolder, version, env = process.env, run = spawn, force = false }) {
  const place = locations(env), changed = [];
  if (!appImage || !isAbsolute(appImage) || /[\n\r]/.test(appImage)) return { changed, skipped: 'not-appimage' };
  if (!force && managedElsewhere(place.applications)) return { changed, skipped: 'managed-elsewhere' };
  if (existsSync(place.entry) && !readFileSync(place.entry, 'utf8').includes(MARKER)) return { changed, skipped: 'foreign-entry' };
  const entry = desktopEntry({ appImage, version });
  mkdirSync(place.applications, { recursive: true });
  if (!existsSync(place.entry) || readFileSync(place.entry, 'utf8') !== entry) { writeFileSync(place.entry, entry, { mode: 0o644 }); changed.push(place.entry); }
  for (const { size, file } of iconSizes(iconsFolder)) {
    const target = join(place.icons, `${size}x${size}`, 'apps', `${APP_ID}.png`), source = join(iconsFolder, file);
    if (existsSync(target) && readFileSync(target).equals(readFileSync(source))) continue;
    mkdirSync(join(place.icons, `${size}x${size}`, 'apps'), { recursive: true }); copyFileSync(source, target); changed.push(target);
  }
  if (changed.length) refresh(place, run);
  return { changed };
}
/**
 * Removes only what integrate() wrote.
 * @param {{ env?: Record<string, string | undefined>, run?: (file: string, args: string[]) => void }} [options]
 */
export function unintegrate({ env = process.env, run = spawn } = {}) {
  const place = locations(env), removed = [];
  if (existsSync(place.entry) && readFileSync(place.entry, 'utf8').includes(MARKER)) { rmSync(place.entry); removed.push(place.entry); }
  for (const folder of existsSync(place.icons) ? readdirSync(place.icons) : []) {
    const target = join(place.icons, folder, 'apps', `${APP_ID}.png`);
    if (/^\d+x\d+$/.test(folder) && existsSync(target)) { rmSync(target); removed.push(target); }
  }
  if (removed.length) refresh(place, run);
  return { removed };
}
