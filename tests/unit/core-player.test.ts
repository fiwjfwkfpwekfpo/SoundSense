import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlayer } from '../../src/core/player';
import { createAudioSettings } from '../../src/core/audio-settings';
import type { AudioEngine, AudioEvent, AudioSlot } from '../../src/core/audio-engine';
import type { LibraryApi, SettingsApi } from '../../src/core/api';
import type { Track } from '../../src/core/types';

const track = (id: string): Track => ({ id, title: id, artist: { id: 'x', name: 'x' }, duration: 100, artwork: {}, liked: false, sources: [{ kind: 'sc', externalId: id }] }) as unknown as Track;
function setup(options: { fail?: Set<string> } = {}) {
  const tracks = new Map(['a', 'b', 'c', 'd'].map(id => [id, track(id)])), levels = new Map<string, (level: number) => void>();
  const library = { getTrack: (id: string) => tracks.get(id), recordPlay() {}, setLiked() {}, getWaveform: async () => null, getLoudness: (id: string) => new Promise<number>(resolve => levels.set(id, resolve)) } as unknown as LibraryApi;
  const settings = { getSnapshot: () => ({ crossfade: 0, normalize: true, waveform: false }), subscribe: () => () => {} } as unknown as SettingsApi;
  const calls: string[] = [], volume: Record<AudioSlot, number> = { a: 1, b: 1 }, clocks: Record<AudioSlot, { position: number; playing: boolean; ended: boolean; buffering: boolean }> = { a: { position: 0, playing: false, ended: false, buffering: false }, b: { position: 0, playing: false, ended: false, buffering: false } };
  let emit: (event: AudioEvent) => void = () => {};
  const audio: AudioEngine = {
    async prepare(slot, item) { calls.push(`prepare:${slot}:${item.id}`); if (options.fail?.has(item.id)) throw Object.assign(new Error('gone'), { status: 404 }); },
    start(slot, position) { calls.push(`start:${slot}`); clocks[slot] = { position, playing: true, ended: false, buffering: false }; }, pause(slot) { clocks[slot].playing = false; }, stop(slot) { calls.push(`stop:${slot}`); clocks[slot] = { position: 0, playing: false, ended: false, buffering: false }; },
    seek(slot, position) { clocks[slot].position = position; }, gain() {}, fadeOut() {}, processing(slot, values) { volume[slot] = values.volume; calls.push(`volume:${slot}:${values.volume.toFixed(2)}`); },
    clock: slot => clocks[slot], subscribe(listener) { emit = listener; return () => {}; }, dispose() {},
  };
  const player = createPlayer(library, settings, audio, undefined, undefined, createAudioSettings());
  return { player, calls, volume, clocks, levels, emit: (event: AudioEvent) => emit(event) };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
describe('core player', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('never changes the normalization gain in the middle of a playing track', async () => {
    const { player, volume, levels } = setup();
    player.play(['a', 'b']); await flush(); expect(player.getSnapshot().resolving).toBe(false);
    // The level of the next, preloaded track is applied to its slot before it starts.
    levels.get('b')!(-8); await flush(); expect(volume.a).toBeCloseTo(10 ** (-6 / 20), 3); expect(volume.b).toBe(1);
    // The playing track was measured after it had been heard for a while: it keeps its volume…
    vi.advanceTimersByTime(5000); levels.get('a')!(-6); await flush(); expect(volume.b).toBe(1);
    // …and gets the measured one the next time it starts.
    player.next(); await vi.advanceTimersByTimeAsync(400); player.previous(false); await vi.advanceTimersByTimeAsync(400);
    expect(player.getSnapshot().trackId).toBe('a'); expect(Math.min(volume.a, volume.b)).toBeCloseTo(10 ** (-8 / 20), 3);
    player.dispose();
  });
  it('applies a level that arrives right at the start', async () => {
    const { player, volume, levels } = setup();
    player.play(['a']); await flush(); levels.get('a')!(-8); await flush(); expect(volume.b).toBeCloseTo(10 ** (-6 / 20), 3); player.dispose();
  });
  it('moves on by the engine\'s "ended" event without waiting for a timer', async () => {
    const { player, emit, clocks } = setup();
    player.play(['a', 'b']); await flush(); clocks.b.ended = true; emit({ type: 'ended', slot: 'b' }); await flush();
    expect(player.getSnapshot().trackId).toBe('b'); expect(player.getSnapshot().playing).toBe(true); player.dispose();
  });
  it('forgets a preloaded track whose slot failed and prepares it again', async () => {
    const { player, emit, calls } = setup();
    player.play(['a', 'b']); await flush(); expect(calls.filter(call => call === 'prepare:a:b')).toHaveLength(1);
    emit({ type: 'error', slot: 'a', reason: 'network' }); await flush(); expect(player.getSnapshot().playing).toBe(true); expect(player.getSnapshot().trackId).toBe('a');
    await vi.advanceTimersByTimeAsync(9000); expect(calls.filter(call => call === 'prepare:a:b')).toHaveLength(2); player.dispose();
  });
  it('skips a track that cannot be played when the queue advances by itself', async () => {
    const { player, emit } = setup({ fail: new Set(['b']) });
    player.play(['a', 'b', 'c']); await flush(); emit({ type: 'ended', slot: 'b' }); await vi.advanceTimersByTimeAsync(20_000);
    expect(player.getSnapshot().trackId).toBe('c'); expect(player.getSnapshot().playing).toBe(true); player.dispose();
  });
  it('checks the next track while the current one plays and prepares the one after it instead', async () => {
    const { player, emit, calls } = setup({ fail: new Set(['b']) });
    player.play(['a', 'b', 'c']); await flush();
    // b is gone: c is already prepared in the free slot while a still plays.
    expect(calls).toContain('prepare:a:b'); expect(calls).toContain('prepare:a:c'); expect(player.getSnapshot().trackId).toBe('a');
    const before = calls.length; emit({ type: 'ended', slot: 'b' }); await flush();
    expect(player.getSnapshot().trackId).toBe('c'); expect(calls.slice(before).filter(call => call.startsWith('prepare'))).toEqual([]); player.dispose();
  });
});
