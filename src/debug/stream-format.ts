import { parseBuffer } from 'music-metadata';

const PREFIX = 256 * 1024;
export async function formatFromBytes(bytes: Uint8Array, mimeType?: string, size?: number, seconds?: number) {
  const { format } = await parseBuffer(bytes, { mimeType, size }, { skipCovers: true, skipPostHeaders: true });
  return {
    codec: format.codec ?? null, sampleRate: format.sampleRate ?? null, channels: format.numberOfChannels ?? null,
    bitrate: format.bitrate ? Math.round(format.bitrate) : size && seconds ? Math.round(size * 8 / seconds) : null,
  };
}

/** Inspect the header of the exact URL handed to the decoder, including a cache hit. */
export async function probeStream(url: string, seconds: number, signal: AbortSignal) {
  const response = await fetch(url, { headers: { Range: `bytes=0-${PREFIX - 1}` }, credentials: 'omit', signal });
  if (!response.ok || !response.body) throw new Error('Stream header unavailable');
  const reader = response.body.getReader(), prefix = new Uint8Array(PREFIX);
  let used = 0;
  try {
    while (used < PREFIX) {
      const { value, done } = await reader.read(); if (done) break;
      const part = value.subarray(0, PREFIX - used); prefix.set(part, used); used += part.length;
    }
  } finally { void reader.cancel().catch(() => {}); }
  const size = response.status === 206 ? Number(response.headers.get('content-range')?.split('/')[1]) : Number(response.headers.get('content-length'));
  return formatFromBytes(prefix.subarray(0, used), response.headers.get('content-type') ?? undefined, size || undefined, seconds);
}
