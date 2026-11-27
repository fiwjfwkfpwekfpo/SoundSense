import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { releaseChannel } from './lib/channels.mjs';
/*
 * Desktop (Electron) builds. Everything stays inside the project folder:
 *   npm run desktop               Vite dev server + Electron window (beta)
 *   npm run desktop:app           build web + desktop process, run it unpacked (artifacts/desktop/<channel>/app)
 *   npm run desktop:appimage      the same, packed as AppImage in artifacts/desktop/<channel>/
 * Electron and electron-builder caches live in .toolchain/, not in ~/.cache.
 */
const root = fileURLToPath(new URL('../', import.meta.url));
const [command = 'dev', requested = command === 'dev' ? 'beta' : 'stable'] = process.argv.slice(2);
if (!['dev', 'app', 'appimage', 'win'].includes(command)) throw new Error('Usage: node scripts/desktop.mjs dev|app|appimage|win [stable|beta]');
const channel = releaseChannel(requested);
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const toolchain = resolve(root, '.toolchain');
const target = command === 'win' ? 'win32' : command === 'appimage' ? 'linux' : process.platform;
const windows = target === 'win32';
const electronDist = target === process.platform && (!windows || process.arch === 'x64') ? resolve(root, 'node_modules/electron/dist') : resolve(toolchain, `electron-${target}-x64`);
const electron = resolve(electronDist, windows ? 'electron.exe' : 'electron');
const ffmpeg = resolve(toolchain, windows ? 'ffmpeg-win32-x64/ffmpeg.exe' : 'ffmpeg/ffmpeg');
const env = { ...process.env, SS_CHANNEL: channel.name, SS_FFMPEG: ffmpeg, ELECTRON_CACHE: resolve(toolchain, 'electron-cache'), ELECTRON_BUILDER_CACHE: resolve(toolchain, 'electron-builder-cache') };
function run(file, args, options = {}) {
  const result = spawnSync(file, args, { cwd: root, env, stdio: 'inherit', ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!existsSync(electron)) run(process.execPath, ['scripts/setup-desktop.mjs', target]);
// Waveforms need the bundled static ffmpeg (built once into .toolchain/ffmpeg).
run(process.execPath, ['scripts/build-ffmpeg.mjs', target]);

if (command === 'dev') {
  const url = 'http://127.0.0.1:5173/';
  const vite = spawn(process.execPath, ['scripts/web.mjs', 'dev', channel.name], { cwd: root, env, stdio: 'inherit' });
  // Wait for the dev server, then open the window on it.
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(url)).ok) break; } catch { /* Not up yet. */ }
    if (attempt > 120 || vite.exitCode !== null) { vite.kill(); throw new Error('Vite dev server did not start'); }
    await new Promise(done => setTimeout(done, 500));
  }
  const app = spawn(electron, [resolve(root, 'desktop/main.mjs')], { cwd: root, env: { ...env, SS_DEV_URL: url }, stdio: 'inherit' });
  const stop = () => { app.kill(); vite.kill(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  app.on('exit', code => { vite.kill(); process.exit(code ?? 0); });
} else {
  const out = resolve(root, 'artifacts/desktop', channel.name), app = resolve(out, command === 'win' ? 'windows-x64/app' : 'app');
  run(process.execPath, ['scripts/web.mjs', 'build', channel.name]);
  await rm(app, { recursive: true, force: true }); await mkdir(app, { recursive: true });
  run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'config/vite.desktop.config.ts', '--logLevel', 'warn'], { env: { ...env, SS_DESKTOP_OUT: app } });
  await cp(resolve(root, 'desktop/preload.cjs'), resolve(app, 'preload.cjs'));
  await cp(resolve(root, 'assets/branding/icons/512x512.png'), resolve(app, 'icon.png'));
  await cp(resolve(root, 'assets/branding/icons'), resolve(app, 'icons'), { recursive: true }); // copied to ~/.local/share/icons on first start
  await cp(resolve(root, 'dist', channel.name), resolve(app, 'web'), { recursive: true });
  await writeFile(resolve(app, 'package.json'), JSON.stringify({ name: 'soundsense', productName: 'SoundSense', version: manifest.version, description: manifest.description, main: 'main.mjs', desktopName: 'soundsense.desktop', author: 'SoundSense', license: 'UNLICENSED' }, null, 2) + '\n');
  if (command === 'app') { if (!process.env.SS_NO_LAUNCH) run(electron, [app]); }
  else {
    const output = command === 'win' ? resolve(out, 'windows-x64') : out;
    // Builder downloads CommonJS helpers inside this ES-module project.
    await mkdir(env.ELECTRON_BUILDER_CACHE, { recursive: true });
    await writeFile(resolve(env.ELECTRON_BUILDER_CACHE, 'package.json'), '{"type":"commonjs"}\n');
    const format = command === 'win' ? ['--win', 'nsis', 'portable'] : ['--linux', 'AppImage'];
    run(process.execPath, ['node_modules/electron-builder/cli.js', ...format, '--x64', '--publish', 'never', '--config', 'config/electron-builder.json',
      `-c.directories.app=${app}`, `-c.directories.output=${output}`, `-c.electronDist=${electronDist}`,
      `-c.electronVersion=${JSON.parse(await readFile(resolve(root, 'node_modules/electron/package.json'), 'utf8')).version}`,
      ...(command === 'win' ? [`-c.nsis.artifactName=SoundSense-\${version}-${channel.name}-windows-x64-setup.exe`,
        `-c.portable.artifactName=SoundSense-\${version}-${channel.name}-windows-x64-portable.exe`]
        : [`-c.artifactName=SoundSense-\${version}-${channel.name}-\${arch}.\${ext}`])]);
    await rm(resolve(output, 'builder-debug.yml'), { force: true });
    console.log(`Desktop packages are in ${output}`);
  }
}
