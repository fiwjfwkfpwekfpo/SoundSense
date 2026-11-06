#!/usr/bin/env node
/** Signs a test update manifest for the current package version: node scripts/release/make-fixture.mjs */
import { sign, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const { version, versionCode: base } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const key = readFileSync(join(homedir(), '.local/share/SoundSense/signing/update-ed25519.pem'));
const filename = `SoundSense-${version}-stable.apk`;
const payload = { schema: 1, channel: 'stable', version, versionCode: Number(base) * 10 + 5, publishedAt: '2026-01-01T00:00:00.000Z', notes: { ru: ['Тест'], en: ['Test'] },
  artifacts: { android: { filename, size: 1024, sha256: createHash('sha256').update('fixture').digest('hex'), urls: [`https://raw.githubusercontent.com/fiwjfwkfpwekfpo/SoundSense/releases/${filename}`] } } };
const bytes = Buffer.from(JSON.stringify(payload));
const signature = sign(null, Buffer.concat([Buffer.from('SoundSense/update-manifest/v1\n'), bytes]), key).toString('hex');
mkdirSync(new URL('../../tests/fixtures/updates/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../../tests/fixtures/updates/stable-${version}.json`, import.meta.url), JSON.stringify({ schema: 1, payload: bytes.toString('base64'), signature }, null, 2) + '\n');
console.log(`tests/fixtures/updates/stable-${version}.json`);
