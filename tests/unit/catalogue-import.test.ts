import { it, expect, vi } from 'vitest';
import { createApple, createDeezer, createSpotify, parseApplePlaylist } from '../../src/core/catalogues';
import { parseAppleExport, parseCsv } from '../../src/core/apple-export';
import { catalogueTrack, asImportTrack } from '../../src/core/music-service';
import { createLibrary } from '../../src/core/library';
import { createImports } from '../../src/core/import-engine';
import type { ImportServices } from '../../src/core/import-engine';
import type { ImportChoice } from '../../src/core/imports';
import { parseMusicLink } from '../../src/core/links';
import { createEnvironment } from '../../src/core/environment-live';
import { youtubeAudioRendition, youtubeTrack } from '../../src/core/youtube';
import { ImportFailure } from '../../src/core/imports';

const memory = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } }; };
it('honors rate-limit retry timing and cancels it when the user cancels import', async () => {
  vi.useFakeTimers(); const library = createLibrary(), environment = createEnvironment();
  let attempts = 0;
  const record = catalogueTrack('sc', { id: '1', title: 'Song', artist: 'Artist', duration: 180 });
  const services: ImportServices = { resolveLink: async link => link, getTrack: async () => record, find: async () => [], getCollection: async () => { if (++attempts === 1) throw new ImportFailure('rate_limit', '', 2); return { id: 'likes', title: 'Likes', tracks: [asImportTrack(record)] }; } };
  const imports = createImports(library, environment, services);
  try {
    imports.start({ source: 'sc', title: 'Likes', destination: 'liked', link: parseMusicLink('https://soundcloud.com/user/likes')! }); await vi.advanceTimersByTimeAsync(0);
    expect(imports.getSnapshot()).toMatchObject({ phase: 'error', retryIn: 2 }); await vi.advanceTimersByTimeAsync(1000); expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1000); expect(imports.getSnapshot()?.phase).toBe('done'); expect(attempts).toBe(2);
    attempts = 0; imports.start({ source: 'sc', title: 'Likes', destination: 'liked', link: parseMusicLink('https://soundcloud.com/user/likes')! }); await vi.advanceTimersByTimeAsync(0); imports.cancel(); await vi.advanceTimersByTimeAsync(5000); expect(attempts).toBe(1); expect(imports.getSnapshot()?.phase).toBe('cancelled');
  } finally { imports.dispose(); library.dispose(); vi.useRealTimers(); }
});
it('imports selected likes and playlists together, preserves membership/order and batch inserts a large library', async () => {
  const storage = memory(), library = createLibrary(storage), environment = createEnvironment(false);
  const tracks = Array.from({ length: 2087 }, (_, id) => catalogueTrack('sc', { id: String(id), title: `Song ${id}`, artist: 'Artist', duration: 180 }));
  const choices: ImportChoice[] = [{ id: 'likes', title: 'Likes', liked: true, link: { source: 'sc', kind: 'likes', url: 'https://soundcloud.com/user/likes', id: 'user' } }, { id: 'p1', title: 'Road', link: { source: 'sc', kind: 'playlist', url: 'https://soundcloud.com/user/sets/road', id: 'user/road' } }];
  const find = vi.fn(async () => []), services: ImportServices = { resolveLink: async link => link, getTrack: async () => tracks[0]!, find, getCollection: async link => ({ id: link.id, title: 'Fetched title', tracks: (link.kind === 'likes' ? tracks : [...tracks.slice(0, 10), tracks[0]!]).map(asImportTrack) }) };
  const insert = vi.spyOn(library, 'addTracks'), batch = vi.spyOn(library, 'addToPlaylistBatch');
  const imports = createImports(library, environment, services, storage), request = { source: 'sc', title: 'User', destination: 'separate', selections: choices };
  imports.start(request); await vi.waitFor(() => expect(imports.getSnapshot()?.phase).toBe('done'));
  expect(find).not.toHaveBeenCalled(); expect(insert).toHaveBeenCalledTimes(1); expect(batch).toHaveBeenCalledTimes(2);
  expect(library.getPlaylistTracks('liked')).toHaveLength(2087); const target = library.getSnapshot().playlists.find(value => value.title === 'Road')!;
  expect(target.trackIds).toEqual(tracks.slice(0, 10).map(track => track.id)); expect(imports.getSnapshot()?.result?.imported).toBe(2087);
  imports.start(request); await vi.waitFor(() => expect(imports.getSnapshot()?.phase).toBe('done'));
  expect(library.getSnapshot().playlists).toHaveLength(2); expect(imports.getSnapshot()?.result?.added).toBe(0); expect(imports.getSnapshot()?.result?.existing).toBe(2087);
  imports.dispose(); library.dispose();
});
it('merges exact recording sources, retains download flags and restores metadata without a known duration', async () => {
  const storage = memory(), library = createLibrary(storage), environment = createEnvironment();
  const first = catalogueTrack('sc', { id: '1', title: 'Song', artist: 'Artist', duration: 180 }), second = catalogueTrack('ya', { id: '2', title: 'Song', artist: 'Artist', duration: 180 });
  library.addTracks([{ ...first, downloaded: true }]);
  const services: ImportServices = { resolveLink: async link => link, getTrack: async () => first, getCollection: async () => { throw new Error(); }, find: async () => [] };
  const imports = createImports(library, environment, services);
  imports.start({ source: 'ya', title: 'Likes', destination: 'liked', collections: [{ id: 'likes', title: 'Likes', tracks: [asImportTrack(second)] }] });
  await vi.waitFor(() => expect(imports.getSnapshot()?.phase).toBe('done'));
  expect(library.getTrack(first.id)?.sources.map(source => source.kind)).toEqual(['sc', 'ya']); expect(library.getTrack(first.id)?.downloaded).toBe(true);
  library.addTracks([first]); expect(library.getTrack(first.id)?.sources).toHaveLength(2);
  const unknown = catalogueTrack('spotify', { id: 'unknown', title: 'Unplayed', artist: 'Artist', duration: 0 }); library.addTracks([unknown]); library.addToPlaylist('liked', unknown.id); library.flush();
  const restored = createLibrary(storage); expect(restored.getTrack(unknown.id)?.duration).toBe(0); expect(restored.getTrack(unknown.id)?.liked).toBe(true);
  imports.dispose(); library.dispose(); restored.dispose();
});
it('paginates a public Deezer playlist and refuses untrusted continuation hosts', async () => {
  const item = (id: number) => ({ id, title: `Song ${id}`, duration: 180, artist: { name: 'Artist' } });
  const urls: string[] = [], service = createDeezer({ async text(url) { urls.push(url); return JSON.stringify(url.includes('index=') ? { data: [item(2)] } : { title: 'Mix', nb_tracks: 2, tracks: { data: [item(1)], next: 'https://api.deezer.com/playlist/1/tracks?index=1' } }); } });
  expect((await service.collection(parseMusicLink('https://deezer.com/ru/playlist/1')!)).tracks.map(track => track.id)).toEqual(['deezer-1', 'deezer-2']); expect(urls).toHaveLength(2);
  const unsafe = createDeezer({ async text() { return '{"tracks":{"data":[],"next":"https://evil.test/tracks"}}'; } });
  await expect(unsafe.collection(parseMusicLink('https://deezer.com/playlist/1')!)).rejects.toMatchObject({ kind: 'incomplete' });
});
it('parses Apple Music data islands and export files without dropping multiline quoted titles', () => {
  const html = '<script id="schema:music-playlist" type="application/ld+json">' + JSON.stringify({ '@type': 'MusicPlaylist', name: 'Night', trackCount: 1, track: [{ '@type': 'MusicRecording', identifier: '7', name: 'Song', byArtist: { name: 'Artist' }, duration: 'PT3M4S' }] }) + '</script>';
  expect(parseApplePlaylist(html, 'pl.test')).toMatchObject({ title: 'Night', tracks: [{ title: 'Song', duration: 184 }] });
  expect(() => parseApplePlaylist(html.replace('"trackCount":1', '"trackCount":2'), 'pl.test')).toThrow('incomplete');
  expect(parseCsv('Title,Artist,Playlist Name\r\n"Song\n""live""",Artist,Night')[1]?.[0]).toBe('Song\n"live"');
  const csv = parseAppleExport('Title,Artist,Playlist Name,Duration\nSong,Artist,Night,3:04', 'csv'); expect(csv[0]).toMatchObject({ title: 'Night', liked: false, tracks: [{ duration: 184 }] });
  const json = parseAppleExport(JSON.stringify({ tracks: [{ 'Title': 'Song', 'Artist': 'Artist', 'Track Duration': 184000 }] }), 'json'); expect(json[0]?.tracks[0]?.duration).toBe(184); expect(json[0]?.liked).toBe(true);
});
it('rejects a partial Spotify embed instead of reporting a successful truncated import', async () => {
  const data = { props: { pageProps: { state: { data: { entity: { name: 'Mix', totalCount: 200, trackList: [{ uri: 'spotify:track:abc', title: 'Song', subtitle: 'Artist', duration: 180000 }] } } } } } };
  const service = createSpotify({ async text() { return `<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`; } });
  await expect(service.collection(parseMusicLink('https://open.spotify.com/playlist/1234567890123456789012')!)).rejects.toMatchObject({ kind: 'incomplete' });
  data.props.pageProps.state.data.entity.totalCount = 1;
  expect((await service.collection(parseMusicLink('https://open.spotify.com/playlist/1234567890123456789012')!)).tracks[0]?.track?.sources[0]?.kind).toBe('spotify');
});
it('searches the actual Apple catalogue and uses full audio-only YouTube renditions', async () => {
  const service = createApple({ async text(url) { expect(url).toContain('itunes.apple.com/search?'); return JSON.stringify({ results: [{ trackId: 7, trackName: 'Song', artistName: 'Artist', trackTimeMillis: 180000 }] }); } });
  expect((await service.search!('Song')).tracks[0]?.sources[0]?.kind).toBe('apple');
  const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="1",URI="https://manifest.googlevideo.com/itag/234/audio.m3u8"';
  expect(youtubeAudioRendition(master, 'https://manifest.googlevideo.com/master')).toContain('/itag/234/');
  expect(() => youtubeAudioRendition(master.replace('manifest.googlevideo.com/itag', 'evil.test/itag'), 'https://manifest.googlevideo.com/master')).toThrow('Invalid YouTube');
  expect(youtubeTrack({ id: 'abcdefghijk', title: 'Song', author: { name: 'Artist - Topic' }, duration: { seconds: 180 } }, true)).toMatchObject({ id: 'ytm-abcdefghijk', artist: { name: 'Artist' }, duration: 180 });
});
it('preserves unlinked YouTube Music co-artists from the full credited column', () => {
  expect(youtubeTrack({ id: 'k401ptP1v6U', item_type: 'song', title: 'BALDININI', duration: { seconds: 115 }, artists: [], flex_columns: [{ title: 'BALDININI' }, { title: 'Pepel Nahudi & nkeeei • KM2: BEYOND EMPIRE • 1:55' }] }, true)?.artist.name).toBe('Pepel Nahudi & nkeeei');
  expect(youtubeTrack({ id: 'LjT1_i0BxFs', item_type: 'song', title: 'Земляк', duration: { seconds: 163 }, artists: [{ name: 'Koss' }], flex_columns: [{ title: 'Земляк' }, { title: 'Koss & ПЛУТТО • Земляк • 2:43' }] }, true)?.artist.name).toBe('Koss & ПЛУТТО');
});
