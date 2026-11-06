import { mediaUrl } from './local-media';
const cache = new Map<string, Promise<{ url: string; image: HTMLImageElement }>>();
const decoded = new Map<string, string>();
/**
 * Lists show covers at ~56 px; decoding 500×500 originals for every row made
 * scrolling and track changes slow on phones. Known services get a smaller size.
 */
export function thumbnailUrl(uri: string): string {
  if (/sndcdn\.com\//.test(uri)) return uri.replace(/-t500x500\./, '-t300x300.');
  if (/avatars\.yandex\.net\//.test(uri)) return uri.replace(/\/400x400(?=$|[/?])/, '/200x200');
  return uri;
}
export function peekArtwork(uri: string): string { return decoded.get(uri) ?? ''; }
/** Only a bounded number of decoded images is retained, including queue neighbours. */
export function loadArtwork(uri: string): Promise<{ url: string; image: HTMLImageElement }> {
  let result = cache.get(uri);
  if (!result) {
    result = mediaUrl(uri).then(async url => { const image = new Image(); image.crossOrigin = 'anonymous'; image.src = url; try { await image.decode(); } catch { image.removeAttribute('crossorigin'); image.src = url; await image.decode(); } if (cache.get(uri) === result) decoded.set(uri, url); return { url, image }; });
    cache.set(uri, result); if (cache.size > 48) { const oldest = cache.keys().next().value!; cache.delete(oldest); decoded.delete(oldest); }
    void result.catch(() => { if (cache.get(uri) === result) cache.delete(uri); });
  } else { cache.delete(uri); cache.set(uri, result); }
  return result;
}
