import { Clipboard } from '@capacitor/clipboard';
import { Capacitor } from '@capacitor/core';
import type { FilesApi } from '../core/api';
import { SystemUi } from './system-ui';
import { AUDIO_EXTENSIONS, localId } from '../core/local';
import type { LocalAudioFile, LocalAudioMetadata, LocalFileSelection } from '../core/local';
import { storeLocalBlob, thumbnail } from './local-media';
import { desktop } from './desktop';

export const JSON_EXPORT_MAX_BYTES = 100_000;
export const DIAGNOSTICS_EXPORT_MAX_BYTES = 8 * 1024 * 1024;

export function safeJsonFilename(filename: string): string {
  const base = filename.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .trim().replace(/\.json$/i, '').replace(/^[. ]+|[. ]+$/g, '');
  let safe = '';
  for (const character of base || 'appearance') {
    if (new TextEncoder().encode(safe + character).byteLength > 120) break;
    safe += character;
  }
  return `${safe}.json`;
}

export function validateJsonExport(text: string, purpose?: 'diagnostics'): void {
  const limit = purpose === 'diagnostics' ? DIAGNOSTICS_EXPORT_MAX_BYTES : JSON_EXPORT_MAX_BYTES;
  if (new TextEncoder().encode(text).byteLength > limit) throw new Error('files.tooLarge');
  try { JSON.parse(text); } catch { throw new Error('files.invalidJson'); }
}

/** Platform choice lives at composition time; UI calls the neutral FilesApi. */
export function createFiles(native = Capacitor.isNativePlatform(), bridge: Pick<typeof SystemUi, 'saveJson'> = SystemUi): FilesApi {
  const selectedFiles = new Map<string, File>();
  async function pickAudio(kind: 'files' | 'folder'): Promise<LocalFileSelection | null> {
    // Desktop: system dialog and folder scan in the desktop process; files are read in place.
    if (desktop) { const result = await desktop.files.pickAudio(kind); return result.files === null ? null : result as LocalFileSelection; }
    if (native) { const result = await SystemUi.pickAudio({ kind }); return result.files === null ? null : result as LocalFileSelection; }
    return new Promise(resolve => {
      const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.accept = 'audio/*,.flac,.mp3,.ogg,.opus,.m4a,.wav,.aac,.aif,.aiff';
      if (kind === 'folder') input.setAttribute('webkitdirectory', '');
      input.hidden = true; document.body.append(input);
      const finish = (result: LocalFileSelection | null) => { input.remove(); resolve(result); };
      input.addEventListener('change', () => {
        const files = [...(input.files ?? [])].filter(file => AUDIO_EXTENSIONS.test(file.name)).slice(0, 10000).map(file => {
          const uri = `local-blob:${localId(`${file.webkitRelativePath || file.name}:${file.size}:${file.lastModified}`)}`;
          selectedFiles.set(uri, file);
          return { uri, name: file.name, path: file.webkitRelativePath || file.name, size: file.size, modifiedAt: file.lastModified, mime: file.type };
        });
        finish({ files, name: kind === 'folder' ? files[0]?.path?.split('/')[0] : undefined, limited: (input.files?.length ?? 0) > 10000 });
      }, { once: true });
      input.addEventListener('cancel', () => finish(null), { once: true }); input.click();
    });
  }
  async function readBrowserMetadata(file: LocalAudioFile, signal?: AbortSignal): Promise<LocalAudioMetadata> {
    const blob = selectedFiles.get(file.uri); if (!blob) return { ...file, error: 'unreadable' };
    const worker = new Worker(new URL('./metadata-worker.ts', import.meta.url), { type: 'module' });
    try {
      const result = await new Promise<Partial<LocalAudioMetadata> & { picture?: { data: Uint8Array; format: string } }>((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error('Metadata timeout')); }, 20000);
        const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
        function cleanup() { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
        signal?.addEventListener('abort', abort, { once: true });
        worker.onmessage = event => { cleanup(); resolve(event.data); }; worker.onerror = () => { cleanup(); reject(new Error('Metadata unavailable')); };
        worker.postMessage({ id: 1, file: blob });
      });
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (result.error || !result.duration) return { ...file, error: 'unreadable' };
      // Files live in IndexedDB, never in synchronous localStorage or base64 strings.
      await storeLocalBlob(file.uri, blob);
      let artworkUri: string | undefined;
      if (result.picture) {
        try { artworkUri = `${file.uri}-art`; await storeLocalBlob(artworkUri, await thumbnail(result.picture.data, result.picture.format)); }
        catch { artworkUri = undefined; /* A broken picture must not discard playable audio. */ }
      }
      return { ...file, title: result.title, artist: result.artist, album: result.album, albumArtist: result.albumArtist, year: result.year, trackNo: result.trackNo, discNo: result.discNo, duration: result.duration, artworkUri };
    } finally { worker.terminate(); }
  }
  return {
    async readClipboard() { return desktop ? await desktop.clipboard.read() : native ? (await Clipboard.read()).value : await navigator.clipboard.readText(); },
    pickAudio,
    async pickFolder() { return (await pickAudio('folder'))?.files ?? null; },
    async readAudioMetadata(files, progress, signal) {
      let next = 0, completed = 0;
      const result: LocalAudioMetadata[] = Array(files.length);
      async function read() {
        while (next < files.length) {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          const index = next++, file = files[index]!;
          try { result[index] = desktop ? await desktop.files.readAudioMetadata(file) : native ? await SystemUi.readAudioMetadata({ file }) : await readBrowserMetadata(file, signal); }
          catch (error) { if (signal?.aborted) throw error; result[index] = { ...file, error: 'unreadable' }; }
          progress({ completed: ++completed, total: files.length, name: file.name });
        }
      }
      await Promise.all([read(), read()]); return result;
    },
    async saveJson(filename, text, purpose) {
      validateJsonExport(text, purpose);
      const safeName = safeJsonFilename(filename);
      if (desktop) return (await desktop.files.saveJson(safeName, text)).status;
      if (native) {
        const result = await bridge.saveJson({ filename: safeName, text, ...(purpose ? { purpose } : {}) });
        if (result.status !== 'saved' && result.status !== 'cancelled') throw new Error('files.saveFailed');
        return result.status;
      }
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = safeName; link.hidden = true;
      try { document.body.append(link); link.click(); }
      finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
      return 'saved';
    },
  };
}
