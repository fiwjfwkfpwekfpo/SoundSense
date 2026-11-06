import { describe, expect, it } from 'vitest';
import { registerLyrics } from '../../src/core/lyrics';
import { createExtensions } from '../../src/core/runtime';
import type { Track } from '../../src/core/types';

// Manual: SS_LIVE=1 npx vitest run tests/unit/lyrics-live.test.ts
const live = process.env.SS_LIVE ? describe : describe.skip;
const http = { async text(url: string, signal?: AbortSignal, options?: { headers?: Record<string, string> }) { const response = await fetch(url, { signal, headers: options?.headers}); if (!response.ok) throw Object.assign(new Error(String(response.status)), { status: response.status }); return response.text(); } };
const track = (title: string, artist: string, duration: number): Track => ({ id: `t-${title}`, title, artist: { id: 'a', name: artist, artwork: { seed: 1, variant: 'orbit' } }, duration, sources: [{ kind: 'sc', externalId: '1' }], liked: false, downloaded: false, explicit: false, addedAt: 0, artwork: { seed: 1, variant: 'terrain' } });
live('lyrics chain (live)', () => {
  for (const [title, artist, duration] of [['ЛУЖА КРОВИ (prod. blesskii & pxlskrrt)', 'ТРОЕТОЧИЕ', 150], ['Blinding Lights', 'The Weeknd', 200], ['rizza - succubus', 'kitieru', 87], ['Дедушка Хасан', 'Mr.Credo', 287]] as const) it(`${artist} — ${title}`, async () => {
    const extensions = createExtensions(), item = track(title, artist, duration);
    registerLyrics(extensions, { getTrack: () => item }, http);
    for (const provider of extensions.lyrics.list()) { const started = Date.now(); const result = await provider.find(item.id).catch(error => `error ${error.message}`); console.log(artist, '|', provider.id, typeof result === 'string' ? result : result ? `${result.synced ? 'synced' : 'plain'} ${result.lines.length} lines` : 'none', `${Date.now() - started}ms`); }
    const result = await extensions.lyrics.find(item.id);
    console.log('chosen', artist, result?.creditKey, result?.synced, result?.lines.slice(0, 2).map(line => line.text));
    expect(Array.isArray(result?.lines ?? [])).toBe(true);
  }, 60000);
});
