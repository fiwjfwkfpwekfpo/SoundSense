import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CACHE_FOLDERS, linkCaches } from '../../desktop/caches.mjs';

let root = '', data = '', cache = '';
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ss-caches-')); data = join(root, 'data', 'chromium'); cache = join(root, 'cache', 'chromium'); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('desktop cache folders', () => {
  it('links every cache folder into the cache directory and keeps writes there', () => {
    expect(linkCaches(data, cache)).toEqual(CACHE_FOLDERS);
    for (const name of CACHE_FOLDERS) { expect(lstatSync(join(data, name)).isSymbolicLink()).toBe(true); expect(readlinkSync(join(data, name))).toBe(join(cache, name)); }
    writeFileSync(join(data, 'Cache', 'entry'), 'x');
    expect(existsSync(join(cache, 'Cache', 'entry'))).toBe(true);
  });
  it('is idempotent', () => {
    linkCaches(data, cache);
    expect(linkCaches(data, cache)).toEqual([]);
  });
  it('replaces a real cache folder left by an older version, and a wrong link, without touching other data', () => {
    mkdirSync(join(data, 'Cache'), { recursive: true }); writeFileSync(join(data, 'Cache', 'old'), 'x');
    mkdirSync(join(data, 'Local Storage'), { recursive: true }); writeFileSync(join(data, 'Local Storage', 'keep'), 'x');
    expect(linkCaches(data, cache)).toContain('Cache');
    expect(existsSync(join(data, 'Cache', 'old'))).toBe(false);
    expect(existsSync(join(data, 'Local Storage', 'keep'))).toBe(true);
    rmSync(join(data, 'GPUCache')); mkdirSync(join(root, 'elsewhere')); symlinkSync(join(root, 'elsewhere'), join(data, 'GPUCache'));
    expect(linkCaches(data, cache)).toEqual(['GPUCache']);
  });
});
