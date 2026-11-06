import { describe, expect, it, vi } from 'vitest';
import { createSoundCloud, soundCloudTrack } from '../../src/core/soundcloud';
import type { HttpClient } from '../../src/core/http';

function recording(id: number, options: { title?: string; artist?: string; duration?: number; protocol?: string; policy?: string } = {}) {
  return { id, title: options.title ?? 'Во Снах', duration: options.duration ?? 120004, full_duration: options.duration ?? 120004, policy: options.policy ?? 'ALLOW', track_authorization: 'public-track-authorization', publisher_metadata: { artist: options.artist ?? 'whyspurky, k1n1ch' }, media: { transcodings: [{ url: `https://api-v2.soundcloud.com/media/${id}`, preset: 'aac_160k', duration: options.duration ?? 120004, format: { protocol: options.protocol ?? 'hls', mime_type: 'audio/mp4' } }] } };
}
function fixture(original = recording(1), alternatives: ReturnType<typeof recording>[] = []) {
  const all = [original, ...alternatives], requests: URL[] = [];
  const http: HttpClient = { text: vi.fn(async (input: string) => {
    const url = new URL(input); requests.push(url);
    if (url.pathname === '/search/tracks') return JSON.stringify({ collection: alternatives });
    const id = Number(url.pathname.split('/').at(-1));
    if (url.pathname.startsWith('/tracks/')) return JSON.stringify(all.find(item => item.id === id));
    if (url.pathname.startsWith('/media/')) return JSON.stringify({ url: `https://audio.test/${id}.m3u8` });
    throw Error('Unexpected metadata request');
  }) };
  return { sc: createSoundCloud(http), requests };
}
describe('full SoundCloud playback', () => {
  it('resolves a full clear AAC stream with fresh track authorization', async () => {
    const original = recording(1), { sc, requests } = fixture(original);
    expect(await sc.stream(soundCloudTrack(original)!)).toBe('https://audio.test/1.m3u8');
    expect(requests.find(url => url.pathname === '/media/1')?.searchParams.get('track_authorization')).toBe('public-track-authorization');
  });
  it('uses a full alternative only when title, artists and duration match', async () => {
    const original = recording(1, { protocol: 'ctr-encrypted-hls' }), { sc } = fixture(original, [recording(2, { artist: 'whyspurky + k1n1ch' })]);
    expect(await sc.stream(soundCloudTrack(original)!)).toBe('https://audio.test/2.m3u8');
  });
  it('does not replace a protected recording with a remix, remaster, other artist or duration', async () => {
    const original = recording(1, { protocol: 'cbc-encrypted-hls' });
    const { sc, requests } = fixture(original, [recording(2, { title: 'Во Снах (Remix)' }), recording(3, { title: 'Во Снах (Remastered 2025)' }), recording(4, { artist: 'Other artist' }), recording(5, { duration: 150000 })]);
    await expect(sc.stream(soundCloudTrack(original)!)).rejects.toMatchObject({ reason: 'protected' });
    expect(requests.filter(url => url.pathname.startsWith('/media/'))).toHaveLength(0);
  });
  it('reports a preview restriction without playing a short excerpt as a full track', async () => {
    const original = recording(1, { policy: 'SNIP' }), { sc, requests } = fixture(original);
    await expect(sc.stream(soundCloudTrack(original)!)).rejects.toMatchObject({ reason: 'preview' });
    expect(requests.some(url => url.pathname.startsWith('/media/'))).toBe(false);
  });
  it('shares waveform requests for the player and queue and reuses completed samples', async () => {
    const text = vi.fn(async (_url: string) => JSON.stringify({ samples: [1, 4, 2] })), sc = createSoundCloud({ text });
    sc.remember({ ...recording(1), waveform_url: 'https://wave.sndcdn.com/one.json' });
    const [one, two] = await Promise.all([sc.waveform('sc-1'), sc.waveform('sc-1')]);
    expect(one).toEqual({ samples: [.25, 1, .5] }); expect(two).toBe(one); expect(await sc.waveform('sc-1')).toBe(one); expect(text).toHaveBeenCalledTimes(1);
  });
});
