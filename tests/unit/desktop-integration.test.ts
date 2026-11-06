import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { desktopEntry, integrate, locations, quoteExec, unintegrate } from '../../desktop/integration.mjs';

let root = '', env: Record<string, string> = {}, icons = '';
const run = () => {};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ss-integration-'));
  env = { XDG_DATA_HOME: join(root, 'data') };
  icons = join(root, 'icons'); mkdirSync(icons);
  for (const size of [16, 48, 256, 512]) writeFileSync(join(icons, `${size}x${size}.png`), `png-${size}`);
  writeFileSync(join(icons, 'readme.txt'), 'not an icon');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('desktop integration (AppImage)', () => {
  it('quotes Exec as the Desktop Entry spec requires', () => {
    expect(quoteExec('/home/a b/App.AppImage')).toBe('"/home/a b/App.AppImage"');
    expect(quoteExec('/x/$y/`z`/"q"/100%\\')).toBe('"/x/\\$y/\\`z\\`/\\"q\\"/100%%\\\\"');
  });
  it('writes a valid entry and icons into XDG_DATA_HOME only', () => {
    const appImage = join(root, 'Apps', 'SoundSense.AppImage');
    const result = integrate({ appImage, iconsFolder: icons, version: '1.4.6', env, run });
    const place = locations(env), entry = readFileSync(place.entry, 'utf8');
    expect(result.changed).toHaveLength(5);
    expect(entry).toContain(`Exec="${appImage}" %U`);
    expect(entry).toContain('Icon=soundsense');
    expect(entry).toContain('Categories=AudioVideo;Audio;Player;');
    expect(entry).toContain('StartupWMClass=soundsense');
    expect(readFileSync(join(place.icons, '256x256', 'apps', 'soundsense.png'), 'utf8')).toBe('png-256');
    expect(existsSync(join(place.icons, 'readme.txt'))).toBe(false);
  });
  it('is idempotent and follows the file when it is moved', () => {
    const first = join(root, 'a', 'SoundSense.AppImage'), second = join(root, 'b', 'SoundSense.AppImage');
    integrate({ appImage: first, iconsFolder: icons, env, run });
    expect(integrate({ appImage: first, iconsFolder: icons, env, run }).changed).toEqual([]);
    const moved = integrate({ appImage: second, iconsFolder: icons, env, run });
    expect(moved.changed).toEqual([locations(env).entry]);
    expect(readFileSync(locations(env).entry, 'utf8')).toContain(second);
  });
  it('leaves a foreign entry and a launcher-managed app alone', () => {
    const place = locations(env); mkdirSync(place.applications, { recursive: true });
    writeFileSync(place.entry, '[Desktop Entry]\nName=Mine\n');
    expect(integrate({ appImage: '/x/S.AppImage', iconsFolder: icons, env, run }).skipped).toBe('foreign-entry');
    expect(readFileSync(place.entry, 'utf8')).toBe('[Desktop Entry]\nName=Mine\n');
    rmSync(place.entry);
    writeFileSync(join(place.applications, 'appimagekit_abc123-SoundSense.desktop'), '[Desktop Entry]\n');
    expect(integrate({ appImage: '/x/S.AppImage', iconsFolder: icons, env, run }).skipped).toBe('managed-elsewhere');
    expect(existsSync(place.entry)).toBe(false);
  });
  it('refuses a relative or missing AppImage path', () => {
    expect(integrate({ appImage: undefined, iconsFolder: icons, env, run }).skipped).toBe('not-appimage');
    expect(integrate({ appImage: 'S.AppImage', iconsFolder: icons, env, run }).skipped).toBe('not-appimage');
  });
  it('removes only what it wrote', () => {
    integrate({ appImage: join(root, 'S.AppImage'), iconsFolder: icons, env, run });
    const place = locations(env); writeFileSync(join(place.applications, 'other.desktop'), 'x');
    const { removed } = unintegrate({ env, run });
    expect(removed).toHaveLength(5);
    expect(existsSync(place.entry)).toBe(false); expect(existsSync(join(place.applications, 'other.desktop'))).toBe(true);
    expect(unintegrate({ env, run }).removed).toEqual([]);
  });
  it('desktopEntry has the keys launchers need', () => {
    const text = desktopEntry({ appImage: '/x/S.AppImage', version: '1.0.0' });
    for (const key of ['Type=Application', 'Name=SoundSense', 'Terminal=false', 'TryExec=/x/S.AppImage']) expect(text).toContain(key);
    expect(text.endsWith('\n')).toBe(true);
  });
});
