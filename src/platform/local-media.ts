import { Capacitor } from '@capacitor/core';
import { desktop, desktopMediaUrl } from './desktop';

let database: Promise<IDBDatabase> | undefined;
const urls = new Map<string, string>();
function open(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('soundsense-local-media', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('files'); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function storeLocalBlob(key: string, blob: Blob): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => { const transaction = db.transaction('files', 'readwrite'); transaction.objectStore('files').put(blob, key); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
}
export async function loadLocalBlob(key: string): Promise<Blob | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => { const request = db.transaction('files', 'readonly').objectStore('files').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
export async function mediaUrl(uri: string): Promise<string> {
  if (uri.startsWith('local-blob:')) {
    let url = urls.get(uri);
    if (!url) { const file = await loadLocalBlob(uri); if (!file) throw new Error('Local file is no longer available'); url = URL.createObjectURL(file); urls.set(uri, url); }
    return url;
  }
  if (desktop) return desktopMediaUrl(uri);
  return Capacitor.isNativePlatform() && /^(content|file):/.test(uri) ? Capacitor.convertFileSrc(uri) : uri;
}
export async function thumbnail(bytes: Uint8Array, mime: string): Promise<Blob> {
  const original = new Blob([new Uint8Array(bytes)], { type: mime });
  const image = await createImageBitmap(original);
  try {
    const scale = Math.min(1, 512 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise(resolve => canvas.toBlob(blob => resolve(blob ?? original), 'image/jpeg', .85));
  } finally { image.close(); }
}
