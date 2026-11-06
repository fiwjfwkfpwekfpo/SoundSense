import { PLUGIN_CATALOG_URL } from '../repository';
import type { HttpClient } from '../http';
import { PluginError } from './types';

/** One reviewed plugin in the repository's `plugins/` folder. */
export interface CatalogEntry {
  id: string; name: string; description: string; version: string; author: string; apiVersion: string;
  permissions: readonly string[]; package: string; size: number; sha256: string;
}
export interface PluginCatalogApi {
  list(signal?: AbortSignal): Promise<readonly CatalogEntry[]>;
  /** Downloads a package and checks its size and SHA-256 against the catalog. */
  download(entry: CatalogEntry, signal?: AbortSignal): Promise<Uint8Array>;
}
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const hex = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map(b => b.toString(16).padStart(2, '0')).join('');

export function parseCatalog(source: string): readonly CatalogEntry[] {
  let raw: { schema?: number; plugins?: unknown };
  try { raw = JSON.parse(source); } catch { throw new PluginError('catalog', 'Catalog is not valid JSON'); }
  if (raw.schema !== 1 || !Array.isArray(raw.plugins) || raw.plugins.length > 200) throw new PluginError('catalog', 'Unsupported catalog');
  return raw.plugins.flatMap((item): CatalogEntry[] => {
    const e = item as Record<string, unknown>;
    if (!e || !text(e.id, 80) || !text(e.name, 60) || !text(e.description, 400) || !/^\d+\.\d+\.\d+/.test(String(e.version)) || !/^packages\/[\w.-]+\.ssplugin\.b64$/.test(String(e.package))
      || !Number.isSafeInteger(e.size) || (e.size as number) > 2 * 1024 * 1024 || !/^[a-f\d]{64}$/.test(String(e.sha256)) || !Array.isArray(e.permissions)) return [];
    return [{ id: e.id, name: e.name, description: e.description, version: String(e.version), author: typeof e.author === 'string' ? e.author : '', apiVersion: String(e.apiVersion ?? ''), permissions: e.permissions.map(String), package: String(e.package), size: e.size as number, sha256: String(e.sha256) }];
  });
}
export function createPluginCatalog(http: HttpClient, base = PLUGIN_CATALOG_URL): PluginCatalogApi {
  return {
    async list(signal) { return parseCatalog(await http.text(`${base}/catalog.json`, signal)); },
    async download(entry, signal) {
      const b64 = (await http.text(`${base}/${entry.package}`, signal)).trim();
      if (!/^[A-Za-z\d+/]+={0,2}$/.test(b64)) throw new PluginError('catalog', 'Unreadable package');
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      if (bytes.length !== entry.size || await hex(bytes) !== entry.sha256) throw new PluginError('catalog', 'Package does not match the catalog (size or SHA-256)');
      return bytes;
    },
  };
}
