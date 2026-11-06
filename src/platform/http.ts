import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { HttpClient } from '../core/http';
import { HttpFailure } from '../core/http';
import { desktop } from './desktop';
const developmentHosts: Record<string, string> = { 'genius.com': '/public/genius', 'apic-desktop.musixmatch.com': '/public/musixmatch', 'soundcloud.com': '/public/sc', 'api-v2.soundcloud.com': '/public/sc-api', 'a-v2.sndcdn.com': '/public/sc-assets', 'wave.sndcdn.com': '/public/sc-wave', 'open.spotify.com': '/public/spotify', 'api-partner.spotify.com': '/public/spotify-api', 'api.music.yandex.net': '/public/yandex', 'oauth.yandex.ru': '/public/yandex-oauth', 'api.deezer.com': '/public/deezer', 'itunes.apple.com': '/public/apple', 'music.apple.com': '/public/apple-music', 'www.youtube.com': '/public/youtube', 'music.youtube.com': '/public/youtube-music', 'youtubei.googleapis.com': '/public/youtube-api', 'lrclib.net': '/public/lyrics' };
export function createHttp(): HttpClient {
  return { async text(input, signal, options) {
    signal?.throwIfAborted(); const url = new URL(input); if (url.protocol !== 'https:') throw new Error('HTTPS is required');
    let status: number, text: string, retryAfter: string | undefined;
    if (desktop) {
      // Made by the desktop process (desktop/http.mjs): no CORS, no Origin, like CapacitorHttp.
      const id = crypto.randomUUID(), cancel = () => { void desktop!.http.cancel(id); };
      signal?.addEventListener('abort', cancel, { once: true });
      try { ({ status, text, retryAfter } = await desktop.http.request(id, { url: url.href, method: options?.method ?? 'GET', headers: options?.headers, body: options?.body })); }
      finally { signal?.removeEventListener('abort', cancel); }
    } else if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.request({ url: url.href, method: options?.method ?? 'GET', headers: { Accept: '*/*', ...options?.headers }, ...(options?.body !== undefined ? { data: options.body } : {}), responseType: 'text', connectTimeout: 12000, readTimeout: 20000 });
      status = response.status; text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      retryAfter = Object.entries(response.headers ?? {}).find(([key]) => key.toLowerCase() === 'retry-after')?.[1];
    } else {
      const proxy = import.meta.env.DEV ? developmentHosts[url.hostname] : undefined;
      const response = await fetch(proxy ? `${proxy}${url.pathname}${url.search}` : url.href, { signal, ...options }); status = response.status; text = await response.text(); retryAfter = response.headers.get('retry-after') ?? undefined;
    }
    signal?.throwIfAborted();
    if (text.length > 6_000_000) throw new Error('Metadata response is too large');
    if (status < 200 || status >= 300) { const seconds = retryAfter ? Number.isFinite(Number(retryAfter)) ? Number(retryAfter) : (Date.parse(retryAfter) - Date.now()) / 1000 : undefined; throw new HttpFailure(status, text, seconds && Number.isFinite(seconds) ? Math.min(300, Math.max(1, Math.ceil(seconds))) : undefined); }
    return text;
  } };
}
