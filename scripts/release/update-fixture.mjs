#!/usr/bin/env node
/**
 * Signed stable manifest of the current version for tests/ui/updates.spec.ts ("installed version is current").
 * Run after raising the version: node scripts/release/update-fixture.mjs. Needs the local update key.
 */
import { createHash, sign } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url)), folder = join(root, 'tests/fixtures/updates');
const { version, versionCode } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const key = readFileSync(join(homedir(), '.local/share/SoundSense/signing/update-ed25519.pem'));
const filename = `SoundSense-${version}-stable.apk`;
const payload = { schema: 1, channel: 'stable', version, versionCode: versionCode * 10 + 5, publishedAt: '2026-01-01T00:00:00.000Z', notes: { ru: ['Тест'], en: ['Test'] },
  artifacts: { android: { filename, size: 1024, sha256: createHash('sha256').update(Buffer.alloc(1024)).digest('hex'), urls: [`https://raw.githubusercontent.com/fiwjfwkfpwekfpo/SoundSense/releases/${filename}`] } } };
const bytes = Buffer.from(JSON.stringify(payload));
const signature = sign(null, Buffer.concat([Buffer.from('SoundSense/update-manifest/v1\n'), bytes]), key).toString('hex');
for (const name of readdirSync(folder)) if (/^stable-.*\.json$/.test(name)) rmSync(join(folder, name));
writeFileSync(join(folder, `stable-${version}.json`), JSON.stringify({ schema: 1, payload: bytes.toString('base64'), signature }, null, 2) + '\n');
console.log(`tests/fixtures/updates/stable-${version}.json`);
