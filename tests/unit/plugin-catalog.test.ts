import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPluginCatalog, parseCatalog } from '../../src/core/plugins/catalog';
import { readPackage } from '../../src/core/plugins/manifest';

const root = new URL('../../plugins/', import.meta.url);
const http = { text: async (url: string) => readFileSync(new URL(url.replace('https://example.test/', ''), root), 'utf8') };

describe('plugin catalog', () => {
  it('lists every reviewed plugin with a name and description', async () => {
    const list = await createPluginCatalog(http, 'https://example.test').list();
    expect(list.length).toBeGreaterThanOrEqual(5);
    for (const entry of list) { expect(entry.name).not.toBe(''); expect(entry.description.length).toBeGreaterThan(10); }
  });
  it('downloads packages that pass the checksum and are valid plugins', async () => {
    const api = createPluginCatalog(http, 'https://example.test');
    for (const entry of await api.list()) { const pack = readPackage(await api.download(entry)); expect(pack.manifest.id).toBe(entry.id); expect(pack.manifest.version).toBe(entry.version); }
  });
  it('rejects a package whose checksum differs and malformed catalogs', async () => {
    const api = createPluginCatalog(http, 'https://example.test'), [entry] = await api.list();
    await expect(api.download({ ...entry, sha256: '0'.repeat(64) })).rejects.toThrow(/does not match/);
    expect(() => parseCatalog('{"schema":2,"plugins":[]}')).toThrow();
    expect(parseCatalog(JSON.stringify({ schema: 1, plugins: [{ id: 'x', name: 'n' }] }))).toEqual([]);
  });
});
