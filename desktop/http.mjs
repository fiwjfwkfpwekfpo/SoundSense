import { net } from 'electron';
/*
 * Metadata requests of the core (same role as CapacitorHttp on Android): made by the main
 * process, so there is no CORS and the window's origin is never sent. HTTPS only, no cookies,
 * 6 MB response limit, timeouts like on Android.
 */
const MAX = 6_000_000;
export function createHttp() {
  const active = new Map();
  return {
    async request(id, { url, method = 'GET', headers = {}, body }) {
      const target = new URL(url);
      if (target.protocol !== 'https:' || target.username || target.password) throw new Error('HTTPS is required');
      if (method !== 'GET' && method !== 'POST') throw new Error('Unsupported method');
      const controller = new AbortController(); active.set(id, controller);
      const timer = setTimeout(() => controller.abort(new Error('Request timed out')), 30_000);
      try {
        const sent = new Headers({ Accept: '*/*' });
        for (const [key, value] of Object.entries(headers ?? {})) if (typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(key) && !/^(host|cookie|content-length)$/i.test(key)) sent.set(key, value);
        const response = await net.fetch(target.href, { method, headers: sent, body: method === 'POST' ? String(body ?? '') : undefined, credentials: 'omit', signal: controller.signal });
        const length = Number(response.headers.get('content-length'));
        if (length > MAX) throw new Error('Metadata response is too large');
        const text = await response.text();
        if (text.length > MAX) throw new Error('Metadata response is too large');
        return { status: response.status, text, retryAfter: response.headers.get('retry-after') ?? undefined };
      } finally { clearTimeout(timer); active.delete(id); }
    },
    cancel(id) { active.get(id)?.abort(new Error('Aborted')); },
  };
}
