import type { DiagnosticEntry, DiagnosticsApi } from '../core/diagnostics';
import { errorDetails } from '../core/diagnostics';

const MAX_ENTRIES = 350, STORAGE_KEY = 'ss_diagnostics_v1';
/** Logs stay on the device. Tokens and signed query strings never enter an export. */
export function redactDiagnostic(value: unknown): string {
  return String(value ?? '').replace(/\b(?:https?|content|file):\/\/[^\s"'<>]+/g, raw => {
    try { const url = new URL(raw); return url.protocol === 'https:' || url.protocol === 'http:' ? `${url.origin}${url.pathname}` : `${url.protocol}//${url.hostname}/[document]`; } catch { return '[url]'; }
  }).replace(/\b(?:Bearer|OAuth)\s+\S+/gi, '[credentials]')
    .replace(/\beyJ[A-Za-z\d_-]+\.[A-Za-z\d_-]+\.[A-Za-z\d_-]+\b/g, '[token]')
    .replace(/((?:token|password|secret|authorization|signature|policy|client_id)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]').slice(0, 1200);
}
export function createDiagnostics(options: { storage?: Pick<Storage, 'getItem' | 'setItem'>; version: string; platform: string; native?: () => Promise<unknown> }): DiagnosticsApi {
  let entries: readonly DiagnosticEntry[] = [], sequence = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<(entries: readonly DiagnosticEntry[]) => void>();
  const save = () => { clearTimeout(timer); timer = undefined; try { options.storage?.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* Diagnostics cannot interrupt playback. */ } };
  try { const saved = JSON.parse(options.storage?.getItem(STORAGE_KEY) ?? '[]'); if (Array.isArray(saved)) entries = saved.filter(item => item && Number.isFinite(item.id) && typeof item.scope === 'string' && typeof item.event === 'string' && typeof item.at === 'string' && item.data && typeof item.data === 'object').slice(-MAX_ENTRIES); sequence = Math.max(0, ...entries.map(entry => entry.id)); } catch {}
  const api: DiagnosticsApi = {
    getSnapshot: () => entries,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    record(scope, event, data = {}, level = 'info') {
      const safe = Object.fromEntries(Object.entries(data).slice(0, 25).map(([key, value]) => [key, /token|password|secret|authorization|signature|policy|client.?id/i.test(key) ? '[redacted]' : typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean' || value === null ? value : redactDiagnostic(value)]));
      entries = [...entries.slice(-(MAX_ENTRIES - 1)), { id: ++sequence, at: new Date().toISOString(), level, scope, event, data: safe }];
      if (level === 'error') save(); else if (!timer) timer = setTimeout(() => { const request = (globalThis as { requestIdleCallback?: (fn: () => void, options: { timeout: number }) => number }).requestIdleCallback; if (request) request(save, { timeout: 3000 }); else save(); }, 2000);
      for (const listener of listeners) listener(entries);
    },
    async export() {
      let native: unknown, timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        if (options.native) native = await Promise.race([
          options.native(),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Native diagnostics timed out')), 3000); }),
        ]);
      } catch (error) { native = errorDetails(error); }
      finally { clearTimeout(timeout); }
      save();
      return JSON.stringify({ schema: 1, app: 'SoundSense', version: options.version, platform: options.platform, exportedAt: new Date().toISOString(), entries, native }, (_key, value) => typeof value === 'string' ? redactDiagnostic(value) : value, 2);
    },
    clear() { entries = []; save(); for (const listener of listeners) listener(entries); },
  };
  return api;
}
