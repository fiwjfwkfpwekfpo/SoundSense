#!/usr/bin/env node
/**
 * Builds the plugin catalog: packs every folder of plugins/src into plugins/packages and writes plugins/catalog.json.
 *   node scripts/build-catalog.mjs
 * The app downloads catalog.json and the base64 package (plain text, works over any HTTP client),
 * checks size and SHA-256, then installs it like a file: new plugins start disabled.
 */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

const base = resolve(new URL('../plugins/', import.meta.url).pathname), src = join(base, 'src'), out = join(base, 'packages');
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const entries = [];
for (const name of readdirSync(src).sort()) {
  const root = join(src, name);
  if (!statSync(root).isDirectory()) continue;
  const files = {};
  const walk = dir => { for (const item of readdirSync(dir)) { if (item.startsWith('.')) continue; const path = join(dir, item); if (statSync(path).isDirectory()) walk(path); else files[relative(root, path).split('\\').join('/')] = new Uint8Array(readFileSync(path)); } };
  walk(root);
  if (!files['manifest.json']) throw new Error(`${name}: manifest.json is missing`);
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  if (!manifest.name || !manifest.description) throw new Error(`${name}: name and description are required for the catalog`);
  if (!files[manifest.entry ?? 'main.js']) throw new Error(`${name}: entry file is missing`);
  const bytes = Buffer.from(zipSync(files, { level: 9 })), file = `${manifest.id}-${manifest.version}.ssplugin`;
  writeFileSync(join(out, file), bytes); writeFileSync(join(out, `${file}.b64`), bytes.toString('base64'));
  entries.push({ id: manifest.id, name: manifest.name, description: manifest.description, version: manifest.version, author: manifest.author ?? '', apiVersion: manifest.apiVersion, permissions: manifest.permissions,
    package: `packages/${file}.b64`, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...(files['icon.svg'] ? { icon: `src/${name}/icon.svg` } : {}) });
}
writeFileSync(join(base, 'catalog.json'), JSON.stringify({ schema: 1, plugins: entries }, null, 2) + '\n');
console.log(`Catalog: ${entries.length} plugins → plugins/catalog.json`);
