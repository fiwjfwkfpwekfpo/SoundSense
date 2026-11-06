import { describe, it, expect, vi } from 'vitest';
import { createLibrary } from '../../src/core/library';
import { createImports } from '../../src/core/import-engine';
import type { ImportServices } from '../../src/core/import-engine';
import { createEnvironment } from '../../src/core/environment-live';
import { localId, localTrack } from '../../src/core/local';
import { createPlayer } from '../../src/core/player';
import { createSettings } from '../../src/core/settings';
import { defaultSettings } from '../../src/ui/settings/schema';
import type { AudioEngine, AudioSlot, AudioEvent } from '../../src/core/audio-engine';
import type { Track, Waveform } from '../../src/core/types';
import type { LibraryApi } from '../../src/core/api';
import { parseSpotifyChart, parseYandexChart } from '../../src/core/charts';
const track = (uri = 'content://test/document/one') => localTrack({ uri, name: 'file.mp3', duration: 10, title: 'Song', artist: 'Artist' }, 'Unknown')!;
const services: ImportServices = { resolveLink: async link => link, getTrack: async () => track(), getCollection: async () => { throw new Error('Not used'); }, find: async () => [] };
const memory = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } }; };
describe('real local library and import', () => {
  it('preserves offline availability when a search refreshes track metadata', () => {
    const storage = memory(), library = createLibrary(storage), original: Track = { ...track(), downloaded: false, sources: [{ kind: 'sc', externalId: '123' }] };
    library.addTracks([original]); library.setDownloaded(original.id, true);
    library.addTracks([{ ...original, title: 'Updated title', downloaded: false }]);
    expect(library.getTrack(original.id)).toMatchObject({ title: 'Updated title', downloaded: true });
    library.flush();
    const restored = createLibrary(storage);
    expect(restored.getTrack(original.id)?.downloaded).toBe(true);
    library.dispose(); restored.dispose();
  });
  it('starts without fabricated tracks or queue and ignores legacy demo snapshots', () => {
    const storage = memory(); storage.setItem('ss_library_v1', JSON.stringify({ tracks: [{ id: 'track-1' }], playlists: [] }));
    const library = createLibrary(storage); expect(library.getSnapshot().tracks).toEqual([]); expect(library.getSnapshot().playlists[0]?.id).toBe('liked'); library.dispose();
  });
  it('identifies the same SAF document selected through a folder and a multiple-file picker', () => {
    expect(localId('content://provider/tree/primary%3AMusic/document/primary%3AMusic%2Fa.mp3')).toBe(localId('content://provider/document/primary%3AMusic%2Fa.mp3'));
    expect(localId('content://provider/document/a.mp3')).not.toBe(localId('content://provider/document/b.mp3'));
  });
  it('rejects unreadable files instead of inserting a fake duration', () => {
    expect(localTrack({ name: 'broken.mp3', uri: 'content://broken' }, 'Unknown')).toBeNull();
    expect(localTrack({ name: 'zero.mp3', uri: 'content://zero', duration: Infinity }, 'Unknown')).toBeNull();
    expect(track().duration).toBe(10);
  });
  it('imports only selected real tracks, restores them and deduplicates a repeated import', async () => {
    const storage = memory(), library = createLibrary(storage), environment = createEnvironment(false), imports = createImports(library, environment, services, storage);
    const item = track();
    const request = { source: 'local', title: 'Files', destination: 'new', collections: [{ id: 'chosen', title: 'Files', tracks: [{ id: item.id, title: item.title, artist: item.artist.name, duration: item.duration, track: item }] }] };
    imports.start(request); await vi.waitFor(() => expect(imports.getSnapshot()?.phase).toBe('done'));
    expect(imports.getSnapshot()?.result?.added).toBe(1); expect(library.getSnapshot().tracks).toHaveLength(1);
    imports.start(request); await vi.waitFor(() => expect(imports.getSnapshot()?.phase).toBe('done'));
    expect(imports.getSnapshot()?.result?.existing).toBe(1); expect(library.getSnapshot().playlists).toHaveLength(2);
    library.flush(); const restored = createLibrary(storage); expect(restored.getTrack(item.id)?.sources[0]?.externalId).toBe(item.sources[0]?.externalId);
    imports.dispose(); library.dispose(); restored.dispose();
  });
  it('preserves likes and original addition dates when tags are refreshed', () => {
    const library = createLibrary(), original = track(); library.addTracks([original]); library.setLiked(original.id, true); library.addTracks([{ ...original, title: 'Updated', addedAt: original.addedAt + 1000 }]);
    expect(library.getTrack(original.id)).toMatchObject({ liked: true, title: 'Updated', addedAt: original.addedAt }); expect(library.getPlaylistTracks('liked')).toHaveLength(1); library.dispose();
  });
  it('keeps the source order of a single import even when file tags were read at different times', async () => {
    const library = createLibrary(), environment = createEnvironment(), imports = createImports(library, environment, services);
    const first = { ...track(), addedAt: 1 }, second = { ...track('content://test/second'), addedAt: 2 };
    imports.start({ source: 'local', title: 'Ordered', destination: 'new', collections: [{ id: 'ordered', title: 'Ordered', tracks: [first, second].map(track => ({ id: track.id, title: track.title, artist: track.artist.name, track })) }] });
    await vi.waitFor(() => expect(imports.getSnapshot()?.phase).toBe('done'));
    expect(library.getPlaylistTracks(imports.getSnapshot()!.result!.playlistId).map(track => track.id)).toEqual([first.id, second.id]); imports.dispose(); library.dispose();
  });
  it('cancels an in-flight source fetch before writing the destination playlist', async () => {
    let finish!: (value: readonly Track[]) => void;
    const library = createLibrary(), environment = createEnvironment(), imports = createImports(library, environment, { ...services, find: () => new Promise(resolve => finish = resolve) });
    imports.start({ source: 'spotify', title: 'Cancelled', destination: 'new', collections: [{ id: 'x', title: 'x', tracks: [{ id: 'x', title: 'Song', artist: 'Artist' }] }] });
    imports.cancel(); finish([track()]); await Promise.resolve(); await Promise.resolve(); expect(imports.getSnapshot()?.phase).toBe('cancelled'); expect(library.getSnapshot().playlists).toHaveLength(1); expect(library.getSnapshot().tracks).toHaveLength(0); imports.dispose(); library.dispose();
  });
});
function engine() {
  const clocks = { a: { position: 0, playing: false, ended: false, buffering: false }, b: { position: 0, playing: false, ended: false, buffering: false } };
  const prepared: { slot: AudioSlot; track: Track; resolve: () => void }[] = [];
  const events = new Set<(event: AudioEvent) => void>();
  const audio: AudioEngine = { prepare: (slot, track) => new Promise(resolve => prepared.push({ slot, track, resolve })), start(slot, position) { clocks[slot] = { position, playing: true, ended: false, buffering: false }; }, pause(slot) { clocks[slot].playing = false; }, stop(slot) { clocks[slot].playing = false; }, seek(slot, position) { clocks[slot].position = position; }, gain() {}, fadeOut() {}, clock: slot => clocks[slot], subscribe(listener) { events.add(listener); return () => events.delete(listener); }, dispose() {} };
  return { audio, clocks, prepared, emit(event: AudioEvent) { for (const listener of events) listener(event); } };
}
describe('real media transport', () => {
  it('keeps a paused system-player seek when playback resumes', async () => {
    vi.useFakeTimers(); const library = createLibrary(), item = track(), e = engine(); library.addTracks([item]);
    const player = createPlayer(library, createSettings(defaultSettings), e.audio);
    try {
      player.play([item.id]); e.prepared[0]!.resolve(); await vi.advanceTimersByTimeAsync(0); const slot = e.prepared[0]!.slot;
      player.toggle(); e.emit({ type: 'seek', slot, position: 7 }); expect(player.getSnapshot()).toMatchObject({ playing: false, position: 7 });
      e.emit({ type: 'seek', slot: slot === 'a' ? 'b' : 'a', position: 1 }); expect(player.getSnapshot().position).toBe(7);
      player.toggle(); expect(e.clocks[slot]).toMatchObject({ playing: true, position: 7 });
    } finally { player.dispose(); library.dispose(); vi.useRealTimers(); }
  });
  it('analyses only the current and next track, cancels obsolete subscriptions and respects the waveform setting', async () => {
    const library = createLibrary() as ReturnType<typeof createLibrary> & LibraryApi, items = [track(), track('content://test/two'), track('content://test/three')];
    library.addTracks(items);
    const targets = vi.fn(), reads = vi.fn(async () => ({ samples: [0, .5, 0], status: 'ready' as const })), active = new Map<string, (wave: Waveform) => void>();
    library.setWaveformTargets = targets; library.getWaveform = reads;
    library.subscribeWaveform = (id, listener) => { active.set(id, listener); return () => { active.delete(id); }; };
    const settings = createSettings(defaultSettings), player = createPlayer(library, settings, engine().audio);
    player.play(items.map(item => item.id));
    expect(targets).toHaveBeenLastCalledWith([items[0]!.id, items[1]!.id]); expect([...active.keys()]).toEqual([items[0]!.id, items[1]!.id]);
    player.next(); expect(targets).toHaveBeenLastCalledWith([items[1]!.id, items[2]!.id]); expect(active.has(items[0]!.id)).toBe(false);
    settings.set('waveform', false); expect(targets).toHaveBeenLastCalledWith([]); expect(active.size).toBe(0);
    const count = reads.mock.calls.length; settings.set('language', 'en'); expect(reads).toHaveBeenCalledTimes(count);
    settings.set('waveform', true); expect([...active.keys()]).toEqual([items[1]!.id, items[2]!.id]);
    player.dispose(); expect(targets).toHaveBeenLastCalledWith([]); expect(active.size).toBe(0); library.dispose();
  });
  it('does not invent an initial queue or run a silent playhead', () => { const library = createLibrary(), { audio } = engine(), player = createPlayer(library, createSettings(defaultSettings), audio); expect(player.getSnapshot()).toMatchObject({ queue: [], trackId: null, playing: false }); player.dispose(); library.dispose(); });
  it('does not advance position while media is preparing or buffering', async () => {
    vi.useFakeTimers(); const library = createLibrary(), item = track(), e = engine(); library.addTracks([item]); const player = createPlayer(library, createSettings(defaultSettings), e.audio);
    try { player.play([item.id]); await vi.advanceTimersByTimeAsync(1000); expect(player.getSnapshot().position).toBe(0); e.prepared[0]!.resolve(); await vi.advanceTimersByTimeAsync(0); const slot = e.prepared[0]!.slot; e.clocks[slot].buffering = true; await vi.advanceTimersByTimeAsync(1500); expect(player.getSnapshot().position).toBe(0); e.clocks[slot] = { position: 2.25, playing: true, buffering: false, ended: false }; await vi.advanceTimersByTimeAsync(100); expect(player.getSnapshot().position).toBe(2.25); }
    finally { player.dispose(); library.dispose(); vi.useRealTimers(); }
  });
  it('ignores stale preparation when a different track is chosen quickly', async () => {
    vi.useFakeTimers(); const library = createLibrary(), first = track(), second = track('content://test/two'), e = engine(); library.addTracks([first, second]); const player = createPlayer(library, createSettings(defaultSettings), e.audio);
    try { player.play([first.id, second.id]); player.next(); e.prepared[0]!.resolve(); await vi.advanceTimersByTimeAsync(100); expect(player.getSnapshot()).toMatchObject({ trackId: second.id, resolving: true }); expect(e.clocks[e.prepared[0]!.slot].playing).toBe(false); e.prepared[1]!.resolve(); await vi.advanceTimersByTimeAsync(400); expect(player.getSnapshot()).toMatchObject({ trackId: second.id, resolving: false, playing: true }); }
    finally { player.dispose(); library.dispose(); vi.useRealTimers(); }
  });
  it('reuses an in-flight next-track preload after a seek or manual next instead of restarting it', async () => {
    vi.useFakeTimers(); const library = createLibrary(), first = track(), second = track('content://test/two'), e = engine(); library.addTracks([first, second]); const player = createPlayer(library, createSettings(defaultSettings), e.audio);
    try {
      player.play([first.id, second.id]); e.prepared[0]!.resolve(); await vi.advanceTimersByTimeAsync(0);
      expect(e.prepared).toHaveLength(2); player.seek(2); expect(e.prepared).toHaveLength(2);
      player.next(); expect(e.prepared).toHaveLength(2); expect(player.getSnapshot()).toMatchObject({ trackId: second.id, resolving: true });
      e.prepared[1]!.resolve(); await vi.advanceTimersByTimeAsync(300);
      expect(e.prepared).toHaveLength(2); expect(player.getSnapshot()).toMatchObject({ trackId: second.id, resolving: false, playing: true });
    } finally { player.dispose(); library.dispose(); vi.useRealTimers(); }
  });
  it('arms the preloaded next track and follows a native hand-off without switching from JavaScript', async () => {
    vi.useFakeTimers(); const library = createLibrary(), items = [track(), track('content://test/two'), track('content://test/three')], e = engine(); library.addTracks(items);
    const arms: { from: AudioSlot; to: AudioSlot; plan: unknown }[] = []; e.audio.arm = (from, to, plan) => { arms.push({ from, to, plan }); };
    const settings = createSettings(defaultSettings); settings.set('crossfade', 0);
    const player = createPlayer(library, settings, e.audio);
    try {
      player.play(items.map(item => item.id)); e.prepared[0]!.resolve(); await vi.advanceTimersByTimeAsync(0); e.prepared[1]!.resolve(); await vi.advanceTimersByTimeAsync(0);
      const from = e.prepared[0]!.slot, to = e.prepared[1]!.slot;
      expect(arms.at(-1)).toMatchObject({ from, to, plan: { track: { id: items[1]!.id }, at: -1 } });
      // The track ends: JavaScript waits for the engine instead of switching itself.
      e.clocks[from] = { position: 10, playing: false, ended: true, buffering: false }; await vi.advanceTimersByTimeAsync(500);
      expect(player.getSnapshot().trackId).toBe(items[0]!.id); expect(e.prepared).toHaveLength(2);
      e.clocks[to] = { position: 0, playing: true, ended: false, buffering: false };
      e.emit({ type: 'advanced', slot: from, to, trackId: items[1]!.id, seconds: 0, position: 0 });
      expect(player.getSnapshot()).toMatchObject({ trackId: items[1]!.id, currentIndex: 1, playing: true }); expect(player.getSnapshot().crossfade).toBeUndefined();
      // The track after it is prepared into the slot that just finished.
      expect(e.prepared).toHaveLength(3); expect(e.prepared[2]).toMatchObject({ slot: from, track: { id: items[2]!.id } });
    } finally { player.dispose(); library.dispose(); vi.useRealTimers(); }
  });
  it('switches from JavaScript when an armed engine does not report the hand-off', async () => {
    vi.useFakeTimers(); const library = createLibrary(), items = [track(), track('content://test/two')], e = engine(); library.addTracks(items);
    const arms: unknown[] = []; e.audio.arm = (_from, _to, plan) => { arms.push(plan); };
    const settings = createSettings(defaultSettings); settings.set('crossfade', 0);
    const player = createPlayer(library, settings, e.audio);
    try {
      player.play(items.map(item => item.id)); e.prepared[0]!.resolve(); await vi.advanceTimersByTimeAsync(0); e.prepared[1]!.resolve(); await vi.advanceTimersByTimeAsync(0);
      e.clocks[e.prepared[0]!.slot] = { position: 10, playing: false, ended: true, buffering: false };
      await vi.advanceTimersByTimeAsync(2600);
      expect(player.getSnapshot().trackId).toBe(items[1]!.id); expect(arms).toContain(null);
    } finally { player.dispose(); library.dispose(); vi.useRealTimers(); }
  });
  it('selects reused native metadata on next and previous while paused', async () => {
    vi.useFakeTimers(); const library = createLibrary(), first = track(), second = track('content://test/two'), e = engine(); library.addTracks([first, second]); e.audio.select = vi.fn(); const player = createPlayer(library, createSettings(defaultSettings), e.audio);
    try {
      player.play([first.id, second.id]); e.prepared[0]!.resolve(); await vi.advanceTimersByTimeAsync(0); e.prepared[1]!.resolve(); await vi.advanceTimersByTimeAsync(0);
      player.toggle(); player.next(); await vi.advanceTimersByTimeAsync(0);
      expect(e.audio.select).toHaveBeenLastCalledWith(e.prepared[1]!.slot, second); expect(player.getSnapshot()).toMatchObject({ trackId: second.id, playing: false, resolving: false });
    } finally { player.dispose(); library.dispose(); vi.useRealTimers(); }
  });
});
describe('public chart parsers', () => {
  it('reads metadata from the Spotify embed and never treats previews as full streams', () => {
    const html = `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { state: { data: { entity: { trackList: [{ uri: 'spotify:track:abc123', title: 'Chart song', subtitle: 'Artist', duration: 210000, audioPreview: { url: 'https://preview.invalid/30s.mp3' } }] } } } } } })}</script>`;
    expect(parseSpotifyChart(html)[0]).toMatchObject({ title: 'Chart song', duration: 210, sources: [{ kind: 'spotify', externalId: 'abc123' }] }); expect(JSON.stringify(parseSpotifyChart(html))).not.toContain('preview.invalid');
  });
  it('reads the real Yandex chart response shape and fails visibly on schema changes', () => { expect(parseYandexChart({ result: { chart: { tracks: [{ track: { id: '1', title: 'Song', durationMs: 100000, artists: [{ id: '2', name: 'Artist' }], coverUri: 'avatars.yandex.net/%%' } }] } } })[0]).toMatchObject({ duration: 100, artist: { name: 'Artist' }, artwork: { url: 'https://avatars.yandex.net/400x400' } }); expect(() => parseYandexChart({})).toThrow('schema'); });
});
