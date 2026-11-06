/// <reference lib="webworker" />
import { parseBlob } from 'music-metadata';
self.onmessage = async (event: MessageEvent<{ id: number; file: File }>) => {
  const { id, file } = event.data;
  try {
    const metadata = await parseBlob(file, { duration: true });
    const picture = metadata.common.picture?.[0];
    self.postMessage({ id, title: metadata.common.title, artist: metadata.common.artist, album: metadata.common.album, albumArtist: metadata.common.albumartist, year: metadata.common.year, trackNo: metadata.common.track?.no ?? undefined, discNo: metadata.common.disk?.no ?? undefined, duration: metadata.format.duration,
      ...(picture ? { picture: { data: picture.data, format: picture.format } } : {}) });
  } catch { self.postMessage({ id, error: 'unreadable' }); }
};
