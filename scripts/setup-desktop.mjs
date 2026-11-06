import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
const dist = resolve(pkg, 'dist');
try {
  if ((await readFile(resolve(dist, 'version'), 'utf8')).trim().replace(/^v/, '') === version) { console.log(`Electron ${version} is ready.`); process.exit(0); }
} catch { /* Not installed yet. */ }
const arch = process.arch === 'arm64' ? 'arm64' : 'x64', file = `electron-v${version}-linux-${arch}.zip`;
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
const unzip = spawnSync('python3', ['-m', 'zipfile', '-e', temp, dist], { stdio: 'inherit' });
await rm(temp);
if (unzip.status !== 0) throw new Error('Unpacking Electron failed');
// python's zipfile drops the executable bit.
spawnSync('chmod', ['+x', ...['electron', 'chrome_crashpad_handler', 'chrome-sandbox'].map(name => resolve(dist, name))]);
await writeFile(resolve(pkg, 'path.txt'), 'electron');
console.log(`Electron ${version} is ready in node_modules/electron/dist. No system settings were changed.`);
