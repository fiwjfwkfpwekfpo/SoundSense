import type { AudioEngine, AudioSlot } from '../core/audio-engine';
import type { Track } from '../core/types';
export interface MockAudioSlot { trackId: string | null; position: number; playing: boolean; gain: number; fadeSeconds?: number }
export function createAudioEngine(): AudioEngine & { slots: Record<AudioSlot, MockAudioSlot> } {
  const empty = (): MockAudioSlot => ({ trackId: null, position: 0, playing: false, gain: 0 });
  const slots = { a: empty(), b: empty() };
  return {
    slots,
    async prepare(slot: AudioSlot, track: Track) { slots[slot] = { ...empty(), trackId: track.id }; },
    start(slot, position) { slots[slot] = { ...slots[slot], position, playing: true }; },
    pause(slot) { slots[slot].playing = false; },
    stop(slot) { slots[slot] = empty(); },
    seek(slot, position) { slots[slot].position = position; },
    gain(slot, value) { slots[slot].gain = Math.max(0, Math.min(1, value)); },
    fadeOut(slot, seconds) { slots[slot].fadeSeconds = seconds; },
    dispose() { slots.a = empty(); slots.b = empty(); },
  };
}
