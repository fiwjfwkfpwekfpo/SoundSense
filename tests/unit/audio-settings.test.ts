import { describe, expect, it } from 'vitest';
import { audioPresets, createAudioSettings, normalizeAudio, normalAudio, processingPitch, processingRate } from '../../src/core/audio-settings';
const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; };
describe('global and per-track audio', () => {
  it('keeps a track override when another track or global settings change, including after restart', () => {
    const storage = memory(), audio = createAudioSettings(storage);
    audio.set('speed', 1.25); audio.trackOnly('one', true); audio.set('pitch', -3, 'one'); audio.set('speed', .75);
    expect(audio.get('one')).toMatchObject({ speed: 1.25, pitch: -3 }); expect(audio.get('two')).toMatchObject({ speed: .75, pitch: 0 });
    audio.flush(); const restored = createAudioSettings(storage); expect(restored.get('one')).toEqual(audio.get('one'));
    restored.trackOnly('one', false); expect(restored.get('one')).toEqual(restored.get('two')); audio.dispose(); restored.dispose();
  });
  it('combines independent tempo, tape speed and semitones without changing preset volume', () => {
    const audio = createAudioSettings(); audio.set('volume', 1.5); audio.preset(audioPresets.find(item => item.id === 'nightcore')!);
    expect(audio.get('one').volume).toBe(1.5); expect(processingRate(audio.get('one'))).toBe(1.25); expect(processingPitch(audio.get('one'))).toBe(1.25);
    audio.set('speed', .8); audio.set('pitch', 12); expect(processingRate(audio.get('one'))).toBe(1); expect(processingPitch(audio.get('one'))).toBe(2.5); audio.dispose();
  });
  it('saves a named preset and restores it without modifying another track override', () => {
    const storage = memory(), audio = createAudioSettings(storage); audio.trackOnly('one', true); audio.set('speed', 1.4, 'one'); audio.savePreset('  My   preset  ', 'one'); audio.flush();
    const restored = createAudioSettings(storage), preset = restored.getSnapshot().presets[0]!; expect(preset.name).toBe('My preset'); restored.preset(preset); restored.reset('one');
    expect(restored.get('one').speed).toBe(1.4); restored.reset(); expect(restored.get('one')).toEqual(normalAudio); restored.removePreset(preset.id); expect(restored.getSnapshot().presets).toEqual([]); audio.dispose(); restored.dispose();
  });
  it('validates corrupted values before passing them to the native audio engine', () => {
    expect(normalizeAudio({ speed: Infinity, speedPitch: 99, pitch: -900, volume: NaN })).toEqual({ speed: 1, speedPitch: 2, pitch: -12, volume: 1 });
    const storage = memory(); storage.setItem('ss_audio_settings_v1', '{broken'); const audio = createAudioSettings(storage); expect(audio.get('one')).toEqual(normalAudio); audio.dispose();
  });
});
