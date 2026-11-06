#!/usr/bin/env node
/** Packs a plugin folder into <id>-<version>.ssplugin: node scripts/pack-plugin.mjs <folder> [output folder] */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { zipSync } from 'fflate';

const [folder, output = 'artifacts/plugins'] = process.argv.slice(2);
if (!folder) { console.error('Usage: node scripts/pack-plugin.mjs <plugin folder> [output folder]'); process.exit(1); }
const root = resolve(folder), files = {};
const walk = directory => { for (const name of readdirSync(directory)) { const path = join(directory, name); if (name.startsWith('.')) continue; if (statSync(path).isDirectory()) walk(path); else files[relative(root, path).split('\\').join('/')] = new Uint8Array(readFileSync(path)); } };
walk(root);
if (!files['manifest.json']) { console.error('manifest.json is missing'); process.exit(1); }
const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
if (!files[manifest.entry ?? 'main.js']) { console.error(`${manifest.entry ?? 'main.js'} is missing`); process.exit(1); }
mkdirSync(output, { recursive: true });
const target = join(output, `${manifest.id}-${manifest.version}.ssplugin`);
writeFileSync(target, zipSync(files, { level: 9 }));
console.log(target);
