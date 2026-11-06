import { dialog, nativeImage } from 'electron';
import { createHash } from 'node:crypto';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
/*
 * Local files for the window: the system file dialog, a recursive folder scan and tag reading
 * (music-metadata in Node, so the file is never copied into the window). Covers are reduced to
 * 512 px JPEG in data/artwork. Files themselves are never changed (SPEC §2).
 */
const AUDIO = /\.(flac|mp3|ogg|oga|opus|m4a|mp4|aac|wav|aif|aiff|alac|wma)$/i;
const LIMIT = 10000;
const MIME = { '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.wav': 'audio/wav' };
export function createFiles(paths, window) {
  const artwork = join(paths.data, 'artwork');
  async function describe(path, root) {
    const info = await stat(path);
    return { uri: pathToFileURL(path).href, name: basename(path), path: root ? relative(root, path) : basename(path), size: info.size, modifiedAt: Math.round(info.mtimeMs), mime: MIME[extname(path).toLowerCase()] ?? '' };
  }
  async function walk(root) {
    const found = []; let limited = false;
    const stack = [root];
    while (stack.length) {
      const directory = stack.pop();
      let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.')) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) stack.push(path);
        else if (entry.isFile() && AUDIO.test(entry.name)) { if (found.length >= LIMIT) { limited = true; break; } found.push(path); }
      }
      if (limited) break;
    }
    return { found, limited };
  }
  return {
    async pickAudio(kind) {
      const result = await dialog.showOpenDialog(window(), kind === 'folder'
        ? { properties: ['openDirectory'] }
        : { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: ['flac', 'mp3', 'ogg', 'oga', 'opus', 'm4a', 'mp4', 'aac', 'wav', 'aif', 'aiff', 'alac', 'wma'] }] });
      if (result.canceled || !result.filePaths.length) return { files: null };
      if (kind === 'folder') {
        const root = result.filePaths[0], { found, limited } = await walk(root);
        return { files: await Promise.all(found.map(path => describe(path, root))), name: basename(root), limited };
      }
      const files = result.filePaths.filter(path => AUDIO.test(path)).slice(0, LIMIT);
      return { files: await Promise.all(files.map(path => describe(path))), limited: result.filePaths.length > LIMIT };
    },
    async readAudioMetadata(file) {
      let path; try { path = fileURLToPath(file.uri); } catch { return { ...file, error: 'unreadable' }; }
      if (!AUDIO.test(path)) return { ...file, error: 'unreadable' };
      try {
        const { parseFile } = await import('music-metadata');
        const { common, format } = await parseFile(path, { duration: true, skipCovers: false });
        if (!format.duration) return { ...file, error: 'unreadable' };
        let artworkUri;
        const picture = common.picture?.[0];
        if (picture?.data?.length) try {
          const image = nativeImage.createFromBuffer(Buffer.from(picture.data));
          if (!image.isEmpty()) {
            const { width, height } = image.getSize(), scale = Math.min(1, 512 / Math.max(width, height));
            const jpeg = (scale < 1 ? image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' }) : image).toJPEG(85);
            const target = join(artwork, `${createHash('sha256').update(jpeg).digest('hex').slice(0, 32)}.jpg`);
            await mkdir(artwork, { recursive: true }); await writeFile(target, jpeg);
            artworkUri = pathToFileURL(target).href;
          }
        } catch { /* A broken picture must not discard playable audio. */ }
        return { ...file, title: common.title, artist: common.artist, album: common.album, albumArtist: common.albumartist, year: common.year, trackNo: common.track?.no ?? undefined, discNo: common.disk?.no ?? undefined, duration: format.duration, ...(artworkUri ? { artworkUri } : {}) };
      } catch { return { ...file, error: 'unreadable' }; }
    },
    async saveJson(filename, text) {
      const result = await dialog.showSaveDialog(window(), { defaultPath: filename, filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (result.canceled || !result.filePath) return { status: 'cancelled' };
      await writeFile(result.filePath, text, 'utf8');
      return { status: 'saved' };
    },
  };
}
