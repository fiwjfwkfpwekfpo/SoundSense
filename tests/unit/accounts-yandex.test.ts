import { it, expect, vi } from 'vitest';
import { createYandexAccount } from '../../src/core/accounts';
import { HttpFailure } from '../../src/core/http';
import { createYandex } from '../../src/core/yandex';
import type { HttpClient } from '../../src/core/http';
import { parseMusicLink } from '../../src/core/links';
import { catalogueTrack } from '../../src/core/music-service';
import { createHmac } from 'node:crypto';
import { createDiagnostics } from '../../src/debug/diagnostics';

const secrets = (initial: string | null = null) => { let value = initial; return { read: vi.fn(async () => value), write: vi.fn(async (next: string) => { value = next; }), remove: vi.fn(async () => { value = null; }) }; };
it('imports public Yandex collections without reading account credentials, even if a login has expired', async () => {
  const token = vi.fn(async (): Promise<string | undefined> => { throw new Error('Expired login must not block a public link'); });
  const ya = createYandex({ async text(_url, _signal, options) { expect(options?.headers?.Authorization).toBeUndefined(); return JSON.stringify({ result: { title: 'Public', tracks: [{ id: 7, track: { id: 7, title: 'Song', durationMs: 180000, artists: [{ id: 1, name: 'Artist' }] } }] } }); } }, token);
  const result = await ya.collection(parseMusicLink('https://music.yandex.ru/playlists/lk.12345678-aaaa')!);
  expect(result.tracks).toHaveLength(1); expect(token).not.toHaveBeenCalled();
});
it('tries the public legacy likes playlist before asking for credentials', async () => {
  const token = vi.fn(async () => undefined), calls: string[] = [];
  const ya = createYandex({ async text(url, _signal, options) { calls.push(url); expect(options?.headers?.Authorization).toBeUndefined(); if (url.endsWith('/likes/tracks')) throw new HttpFailure(401, '{}'); return JSON.stringify({ result: { title: 'Likes', tracks: [{ id: 7, track: { id: 7, title: 'Song', durationMs: 180000, artists: [{ id: 1, name: 'Artist' }] } }] } }); } }, token);
  const choices = await ya.inspect(parseMusicLink('https://music.yandex.ru/users/public/playlists/3')!);
  expect(choices[0]?.count).toBe(1); expect(token).not.toHaveBeenCalled(); expect(calls.at(-1)).toContain('/playlists/3');
});
it('uses a device code, respects pending/slow_down and keeps user credentials in the injected secret store', async () => {
  let polls = 0; const fields: URLSearchParams[] = [], vault = secrets(), open = vi.fn(async () => {}), delay = vi.fn(async (_ms: number, _signal: AbortSignal) => {});
  const account = createYandexAccount({ async text(url, _signal, options) {
    fields.push(new URLSearchParams(options?.body));
    if (url.endsWith('/device/code')) return JSON.stringify({ device_code: 'private-device-code', user_code: 'USER-CODE', verification_url: 'https://ya.ru/device', expires_in: 600, interval: 2 });
    if (++polls === 1) throw new HttpFailure(400, '{"error":"authorization_pending"}');
    if (polls === 2) throw new HttpFailure(400, '{"error":"slow_down"}');
    return '{"access_token":"private_test_token","refresh_token":"private_refresh_token","expires_in":3600}';
  } }, vault, open, delay);
  const seen: string[] = []; account.api.subscribe(value => { seen.push(value.phase); if (value.phase === 'waiting') void account.api.openAuthorization(); });
  await account.api.login(); await account.identify('123', 'User');
  expect(seen).toEqual(['requesting', 'waiting', 'connected', 'connected']);
  expect(delay.mock.calls.map(call => call[0])).toEqual([2000, 2000, 7000]);
  expect(fields[1]!.get('code')).toBe('private-device-code'); expect(fields[1]!.get('grant_type')).toBe('device_code');
  expect(open).toHaveBeenCalledWith('https://ya.ru/device');
  expect(await account.getToken()).toBe('private_test_token');
  expect(JSON.stringify(account.api.getSnapshot())).not.toMatch(/private_test_token|private_refresh_token|private-device-code/);
  expect(JSON.parse((await vault.read())!)).toMatchObject({ uid: '123', name: 'User' });
});
it('cancels pending authorization and never opens an untrusted verification host', async () => {
  const vault = secrets(), open = vi.fn(async () => {}), account = createYandexAccount({ async text() { return '{"device_code":"secret","user_code":"CODE","verification_url":"https://oauth.yandex.ru.evil.test/","expires_in":600}'; } }, vault, open);
  await expect(account.api.login()).rejects.toMatchObject({ kind: 'auth' }); expect(open).not.toHaveBeenCalled(); expect(vault.write).not.toHaveBeenCalled();
});
it('logout during a token refresh cannot restore credentials later', async () => {
  let finish!: (value: string) => void;
  const vault = secrets(JSON.stringify({ accessToken: 'old_token', refreshToken: 'refresh_token', expiresAt: 0 }));
  const account = createYandexAccount({ text: () => new Promise(resolve => finish = resolve) }, vault, async () => {});
  const pending = account.getToken(); const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function')); await account.api.logout(); finish('{"access_token":"new_token","expires_in":3600}'); await rejected;
  expect(await vault.read()).toBeNull(); expect(account.api.getSnapshot().phase).toBe('disconnected');
});
it('loads Yandex likes in ordered batches instead of searching for every track', async () => {
  const refs = Array.from({ length: 2087 }, (_, index) => ({ id: String(index + 1), albumId: '9' }));
  let batches = 0, active = 0, peak = 0;
  const http: HttpClient = { async text(url, _signal, options) {
    expect(options?.headers?.Authorization).toBeUndefined();
    if (url.includes('/likes/tracks')) return JSON.stringify({ result: { library: { tracks: refs } } });
    if (url.endsWith('/tracks')) { batches++; active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 0)); active--; const ids = new URLSearchParams(options!.body).get('track-ids')!.split(','); return JSON.stringify({ result: ids.reverse().map(id => ({ id: id.split(':')[0], title: `Song ${id.split(':')[0]}`, artists: [{ id: 1, name: 'Artist' }], durationMs: 180000 })) }); }
    throw new Error('Unexpected endpoint');
  } };
  const ya = createYandex(http, async () => 'private_token'), link = parseMusicLink('https://music.yandex.ru/users/user/playlists/3')!;
  expect(link.kind).toBe('likes'); const choices = await ya.inspect(link); expect(choices[0]?.count).toBe(2087);
  const result = await ya.collection(choices[0]!.link);
  expect(result.tracks).toHaveLength(2087); expect(result.tracks[0]?.id).toBe('ya-1'); expect(result.tracks.at(-1)?.id).toBe('ya-2087'); expect(batches).toBe(21); expect(peak).toBe(3);
});
it('loads shared lk UUID richData, hydrates missing IDs and preserves explicit version', async () => {
  const calls: string[] = [], ya = createYandex({ async text(url) { calls.push(url); if (url.includes('richTracks=true')) throw new HttpFailure(404, '{}'); return JSON.stringify({ result: { title: 'Shared', tracks: [{ id: 7, richData: { id: 7, title: 'Song', version: 'Live', durationMs: 100000, artists: [{ id: 1, name: 'Artist' }], coverUri: 'avatars.yandex.net/x/%%' } }] } }); } }, async () => undefined);
  const result = await ya.collection(parseMusicLink('https://music.yandex.ru/playlists/lk.12345678-aaaa')!);
  expect(result.tracks[0]?.track?.title).toBe('Song (Live)'); expect(result.tracks[0]?.track?.artwork.url).toBe('https://avatars.yandex.net/x/400x400'); expect(calls).toHaveLength(2);
});
it('resolves a signed authorized Yandex full stream without leaking OAuth to storage hosts', async () => {
  const ya = createYandex({ async text(url, _signal, options) {
    if (url.includes('/download-info')) { expect(options?.headers?.Authorization).toBe('OAuth token'); return JSON.stringify({ result: [{ codec: 'mp3', bitrateInKbps: 320, downloadInfoUrl: 'https://storage.yandex.net/ticket', preview: false }] }); }
    expect(options?.headers?.Authorization).toBeUndefined(); return '{"host":"storage.yandex.net","path":"/path/file.mp3","ts":"123","s":"salt"}';
  } }, async () => 'token');
  const track = catalogueTrack('ya', { id: '7', title: 'Song', artist: 'Artist', duration: 180 });
  expect((await ya.stream(track))?.uri).toMatch(/^https:\/\/storage\.yandex\.net\/get-mp3\/[a-f\d]{32}\/123\/path\/file\.mp3$/);
});
it('accepts a full HE-AAC stream when the storage host returns XML despite format=json', async () => {
  const calls: string[] = [];
  const ya = createYandex({ async text(url, _signal, options) {
    calls.push(url);
    if (url.includes('/download-info')) return JSON.stringify({ result: [{ codec: 'he-aac', bitrateInKbps: 192, downloadInfoUrl: 'http://storage.mds.yandex.net/ticket', preview: false }] });
    expect(url).toBe('https://storage.mds.yandex.net/ticket?format=json'); expect(options?.headers?.Authorization).toBeUndefined();
    return '<?xml version="1.0"?><download-info><host>strm.yandex.net</host><path>/audio/full.aac</path><ts>123</ts><s>salt</s></download-info>';
  } }, async () => 'token');
  expect((await ya.stream(catalogueTrack('ya', { id: '7', title: 'Song', artist: 'Artist', duration: 180 })))?.uri).toMatch(/^https:\/\/strm\.yandex\.net\/get-mp3\/[a-f\d]{32}\/123\/audio\/full.aac$/);
  expect(calls).toHaveLength(2);
});
it('uses the authorized raw file endpoint when the old API returns no full variants', async () => {
  const diagnostics = createDiagnostics({ version: '0.5.1', platform: 'test' });
  const ya = createYandex({ async text(input, _signal, options) {
    expect(options?.headers?.Authorization).toBe('OAuth token'); const url = new URL(input);
    if (url.pathname.endsWith('/download-info')) return '{"result":[]}';
    expect(url.pathname).toBe('/get-file-info');
    expect(options?.headers?.['X-Yandex-Music-Client']).toBe('YandexMusicDesktopAppWindows/5.95.0');
    const q = url.searchParams;
    expect(q.get('transports')).toBe('raw'); expect(q.get('trackId')).toBe('7'); expect(q.get('quality')).toBe('hq');
    const expected = createHmac('sha256', 'kzqU4XhfCaY6B6JTHODeq5').update(`${q.get('ts')}7hq${q.get('codecs')!.replaceAll(',', '')}raw`).digest('base64').slice(0, -1);
    expect(q.get('sign')).toBe(expected);
    return JSON.stringify({ result: { downloadInfo: { codec: 'aac-mp4', transport: 'raw', urls: ['https://strm.yandex.net/audio/full.m4a?signature=private'] } } });
  } }, async () => 'token', diagnostics);
  const result = await ya.stream(catalogueTrack('ya', { id: '7', title: 'Song', artist: 'Artist', duration: 180 }));
  expect(result?.uri).toContain('/audio/full.m4a'); expect(result).not.toHaveProperty('headers');
  expect(diagnostics.getSnapshot().find(e => e.event === 'stream.legacy.unavailable')?.data.code).toBe('YA_EMPTY_VARIANTS');
  expect(await diagnostics.export()).not.toContain('private'); diagnostics.clear();
});
it('rejects encrypted transports and previews returned by the file endpoint', async () => {
  for (const file of [{ codec: 'aac', transport: 'encraw', key: 'private' }, { codec: 'aac', transport: 'raw', preview: true }]) {
    const ya = createYandex({ async text(url) { return url.includes('/download-info') ? '{"result":[]}' : JSON.stringify({ result: { downloadInfo: { ...file, url: 'https://strm.yandex.net/full' } } }); } }, async () => 'token');
    await expect(ya.stream(catalogueTrack('ya', { id: '7', title: 'Song', artist: 'Artist', duration: 180 }))).rejects.toMatchObject({ reason: file.transport === 'encraw' ? 'protected' : 'preview' });
  }
});
it('never sends a token to a storage ticket or follows a ticket onto an untrusted host', async () => {
  const calls: string[] = [];
  const ya = createYandex({ async text(url) {
    calls.push(url);
    if (url.includes('/download-info')) return JSON.stringify({ result: [{ codec: 'mp3', downloadInfoUrl: 'https://yandex.net.evil.test/ticket', preview: false }] });
    return JSON.stringify({ result: { downloadInfo: { codec: 'aac', transport: 'raw', urls: ['https://yandex.net.evil.test/audio'] } } });
  } }, async () => 'token');
  await expect(ya.stream(catalogueTrack('ya', { id: '7', title: 'Song', artist: 'Artist', duration: 180 }))).rejects.toMatchObject({ code: 'YA_MEDIA_HOST' });
  expect(calls.every(url => new URL(url).hostname === 'api.music.yandex.net')).toBe(true);
});
