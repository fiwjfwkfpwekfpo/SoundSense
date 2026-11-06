import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMusicLink, extractMusicLink } from '../../src/core/links';
import { classifyImportError, ImportFailure } from '../../src/core/imports';
import { matchTrack } from '../../src/core/matching';
import { parseSpotifyArchive, parseSpotifyFiles } from '../../src/core/spotify';
import { NavigationStack } from '../../src/core/navigation';
import { createHaptics } from '../../src/core/haptics';
import { createEnvironment } from '../../src/mock/environment';
import { createImports } from '../../src/mock/imports';
import { createLibrary } from '../../src/mock/library';
import { readFileSync } from 'node:fs';
import { strToU8 } from 'fflate';
afterEach(() => vi.useRealTimers());
describe('supported shared links', () => {
  it.each([
    ['soundcloud.com/ecutegirl/likes', 'sc', 'likes'], ['https://m.soundcloud.com/user/sets/night?utm_source=share', 'sc', 'playlist'],
    ['https://soundcloud.com/user/song', 'sc', 'track'], ['https://on.soundcloud.com/AbcD', 'sc', 'short'],
    ['music.youtube.com/playlist?list=PLabc', 'ytm', 'playlist'], ['https://www.youtube.com/watch?v=aB123456789&list=PLfoo&utm_medium=share', 'yt', 'track'],
    ['https://youtu.be/aB123456789?si=abc', 'yt', 'track'], ['https://m.youtube.com/watch?v=Abc12345678', 'yt', 'track'],
    ['music.yandex.ru/playlists/lk.01234567-abcd-1234-8888-123456789abc', 'ya', 'likes'],
    ['music.yandex.ru/users/user/playlists/123', 'ya', 'playlist'], ['https://music.yandex.ru/album/123', 'ya', 'album'], ['https://music.yandex.ru/album/123/track/456?utm_source=share', 'ya', 'track'],
  ])('%s → %s %s', (url, source, kind) => { expect(parseMusicLink(url)).toMatchObject({ source, kind }); expect(parseMusicLink(url)?.url).not.toContain('utm_'); });
  it.each(['https://soundcloud.com.evil.test/u/song', 'https://user:secret@soundcloud.com/u/likes', 'javascript:alert(1)', 'https://example.com', '', 'https://youtube.com/watch', 'https://music.yandex.ru/users/u/playlists/nope'])('rejects %s', url => expect(parseMusicLink(url)).toBeNull());
  it('extracts a link from Android EXTRA_TEXT', () => expect(extractMusicLink('Listen here: https://youtu.be/abc12345678.')).toMatchObject({ source: 'yt', id: 'abc12345678' }));
});
describe('actionable import failures', () => {
  it.each([[404, '', 'not_found'], [403, 'private playlist', 'private'], [451, '', 'region'], [401, '', 'auth'], [403, '', 'auth'], [429, '', 'rate_limit'], [0, 'session expired', 'expired'], [0, 'Network offline', 'offline'], [0, 'timeout', 'timeout']])('%s %s', (status, message, kind) => expect(classifyImportError({ status, message }).kind).toBe(kind));
  it('preserves typed failures and retry intervals', () => { const error = new ImportFailure('rate_limit', '', 20); expect(classifyImportError(error)).toBe(error); });
});
describe('metadata matching', () => {
  const candidates = [{ id: '1', title: 'Polutona (Official Audio)', artist: 'Lunar Field feat. Nika', duration: 143 }];
  it('normalizes Cyrillic, brackets and feat, allowing three seconds', () => expect(matchTrack({ id: 'a', title: 'Полутона', artist: 'Lunar Field ft Nika', duration: 146 }, candidates)).toMatchObject({ kind: 'confident' }));
  it('asks for review when duration disagrees', () => expect(matchTrack({ id: 'a', title: 'Polutona', artist: 'Lunar Field Nika', duration: 155 }, candidates).kind).toBe('uncertain'));
  it('does not replace unrelated songs', () => expect(matchTrack({ id: 'a', title: 'Other song', artist: 'Someone else' }, candidates).kind).toBe('missing'));
});
describe('Spotify Account data', () => {
  it('reads an actual ZIP fixture with liked tracks and nested playlist items', async () => { const collections = await parseSpotifyArchive(readFileSync(new URL('../fixtures/spotify-account.zip', import.meta.url))); expect(collections).toHaveLength(2); expect(collections[0]?.tracks[0]).toMatchObject({ title: 'Полутона', artist: 'lunar field' }); expect(collections[1]?.title).toBe('Night'); expect(collections[1]?.tracks).toHaveLength(2); });
  it('rejects history exports and malformed ZIPs', async () => { expect(() => parseSpotifyFiles({ 'StreamingHistory0.json': strToU8('[]') })).toThrowError(ImportFailure); await expect(parseSpotifyArchive(strToU8('not zip'))).rejects.toMatchObject({ kind: 'invalid_archive' }); });
});
describe('back hierarchy and retained tabs', () => {
  it('closes sheet → lyrics → player → child page → tab root → home → exit', () => {
    const nav = new NavigationStack<string>(); nav.switchTab('library'); nav.go({ name: 'playlist', id: 'night' }); nav.saveScroll(420); nav.open('player'); nav.open('lyrics'); nav.sheet('track');
    nav.back(); expect(nav.state.sheet).toBeNull(); expect(nav.state.overlays.at(-1)).toBe('lyrics'); nav.back(); expect(nav.state.overlays.at(-1)).toBe('player'); nav.back(); expect(nav.entry.route.name).toBe('playlist'); nav.back(); expect(nav.entry.route.name).toBe('library'); nav.back(); expect(nav.state.activeTab).toBe('home'); expect(nav.back()).toBe(false);
  });
  it('returns nested selectors to their parent sheet and replaces track action sheets', () => { const nav = new NavigationStack<string>(); nav.sheet('appearance'); nav.sheet('select'); nav.back(); expect(nav.state.sheet).toBe('appearance'); nav.back(); nav.sheet('track'); nav.replaceSheet('addPlaylist'); nav.back(); expect(nav.state.sheet).toBeNull(); });
  it('retains the stack and scroll for each tab', () => { const nav = new NavigationStack(); nav.go({ name: 'library' }); nav.saveScroll(350); nav.switchTab('search'); nav.go({ name: 'artist', id: '1' }); nav.saveScroll(210); nav.switchTab('home'); expect(nav.entry.route.name).toBe('library'); expect(nav.entry.scroll).toBe(350); nav.switchTab('search'); expect(nav.entry.scroll).toBe(210); });
});
describe('haptics', () => {
  it('is a browser no-op and honors the toggle dynamically', () => { let enabled = true; const impact = vi.fn(async () => {}); const driver = { impact, selectionStart: impact, selectionEnd: impact, selectionChanged: impact }; const web = createHaptics(driver, () => enabled, false); web.pulse(); expect(impact).not.toHaveBeenCalled(); const native = createHaptics(driver, () => enabled, true); native.pulse(); expect(impact).toHaveBeenCalledOnce(); enabled = false; native.pulse(); native.start(); native.wave(0, 1); native.end(); expect(impact).toHaveBeenCalledOnce(); });
  it('ticks once per new waveform bar with a tiny burst floor', () => { let time = 0; const tick = vi.fn(async () => {}), selectionChanged = vi.fn(async () => {}); const api = createHaptics({ impact: async () => {}, selectionChanged, tick, selectionStart: async () => {}, selectionEnd: async () => {} }, () => true, true, () => time); api.start(); api.wave(1, .1); api.wave(1, .1); time = 4; api.wave(2, 1); time = 20; api.wave(3, 1); time = 40; api.wave(4, 0); expect(tick).toHaveBeenCalledTimes(3); expect(selectionChanged).not.toHaveBeenCalled(); });
});
describe('background imports', () => {
  it('deduplicates repeat imports and resolves partial results without leaving the job', () => {
    vi.useFakeTimers(); const environment = createEnvironment(), library = createLibrary(), api = createImports(library, environment);
    const request = { source: 'sc' as const, link: parseMusicLink('soundcloud.com/user/likes')!, title: 'Import', destination: 'new' };
    api.start(request); vi.advanceTimersByTime(2000); expect(api.getSnapshot()?.phase).toBe('done'); const result = api.getSnapshot()!.result!;
    expect(result.missing).toHaveLength(2); expect(result.uncertain).toHaveLength(2); expect(result.unavailable).toHaveLength(2); expect(result.added).toBe(6);
    api.resolve(0, result.uncertain[0]!.candidateId!); expect(api.getSnapshot()?.result?.imported).toBe(7);
    api.start(request); vi.advanceTimersByTime(2000); expect(api.getSnapshot()?.result).toMatchObject({ added: 0, existing: 6, playlistId: result.playlistId }); api.dispose(); environment.dispose();
  });
  it('resumes automatically after a rate limit or reconnection', () => { vi.useFakeTimers(); const environment = createEnvironment('import-rate_limit'), api = createImports(createLibrary(), environment); api.start({ source: 'sc', title: 'x', destination: 'liked' }); vi.advanceTimersByTime(150); expect(api.getSnapshot()?.error?.kind).toBe('rate_limit'); vi.advanceTimersByTime(7000); expect(api.getSnapshot()?.phase).toBe('done'); environment.setScenario('offline'); api.start({ source: 'sc', title: 'x', destination: 'liked' }); vi.advanceTimersByTime(150); expect(api.getSnapshot()?.error?.kind).toBe('offline'); environment.setScenario('normal'); vi.advanceTimersByTime(2000); expect(api.getSnapshot()?.phase).toBe('done'); api.dispose(); environment.dispose(); });
});
