import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
/*
 * Electron's own postinstall needs Node 22, the project builds with Node 20. So the Electron
 * binary is fetched here: the exact version from node_modules/electron, checked against the
 * checksums.json shipped in that package, unpacked into node_modules/electron/dist.
 * Nothing outside the project folder is touched.
 */
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = resolve(root, 'node_modules/electron');
const { version } = JSON.parse(await readFile(resolve(pkg, 'package.json'), 'utf8'));
const target = process.argv[2] ?? process.platform;
if (!['linux', 'win32'].includes(target)) throw new Error('Expected linux or win32');
const arch = target === 'win32' ? 'x64' : process.arch;
const native = target === process.platform && arch === process.arch;
const dist = native ? resolve(pkg, 'dist') : resolve(root, '.toolchain', `electron-${target}-${arch}`);
const executable = target === 'win32' ? 'electron.exe' : 'electron';
try {
  await access(resolve(dist, executable));
  if ((await readFile(resolve(dist, 'version'), 'utf8')).trim().replace(/^v/, '') === version) { console.log(`Electron ${version} is ready.`); process.exit(0); }
} catch { /* Not installed yet. */ }
const file = `electron-v${version}-${target}-${arch}.zip`;
const expected = JSON.parse(await readFile(resolve(pkg, 'checksums.json'), 'utf8'))[file];
if (!expected) throw new Error(`${file} is not listed in checksums.json`);
const url = `https://github.com/electron/electron/releases/download/v${version}/${file}`;
console.log(`Downloading ${file}…`);
const response = await fetch(url);
if (!response.ok) throw new Error(`Download failed: ${url} → ${response.status}`);
const data = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(data).digest('hex') !== expected) throw new Error('SHA-256 mismatch');
const temp = resolve(root, '.toolchain', file);
await mkdir(resolve(root, '.toolchain'), { recursive: true });
await writeFile(temp, data);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
const unzip = process.platform === 'win32' ? spawnSync('tar.exe', ['-xf', temp, '-C', dist], { stdio: 'inherit' })
  : spawnSync('python3', ['-m', 'zipfile', '-e', temp, dist], { stdio: 'inherit' });
await rm(temp);
if (unzip.status !== 0) throw new Error('Unpacking Electron failed');
// python's zipfile drops the executable bit.
if (target === 'linux') spawnSync('chmod', ['+x', ...['electron', 'chrome_crashpad_handler', 'chrome-sandbox'].map(name => resolve(dist, name))]);
if (native) await writeFile(resolve(pkg, 'path.txt'), executable);
console.log(`Electron ${version} is ready in ${dist}.`);
