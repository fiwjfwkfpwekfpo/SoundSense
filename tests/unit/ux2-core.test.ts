import { describe, expect, it, vi } from 'vitest';
import { audibleRange, equalPower, planCrossfade } from '../../src/core/crossfade';
import { createPlayer } from '../../src/mock/player';
import { createLibrary } from '../../src/mock/library';
import { createSettings } from '../../src/mock/settings';
import { createAudioEngine } from '../../src/mock/audio-engine';
import { defaultSettings } from '../../src/ui/settings/schema';
import { importPalette, readColorLiterals } from '../../src/ui/appearance/palette-import';
import { readFileSync } from 'node:fs';
import { colors } from '../../src/ui/appearance/presets';
import { contrast, composite } from '../../src/ui/appearance/contrast';
describe('crossfade math and policy', () => {
  it('keeps summed power equal to one throughout the overlap', () => { for (let i = 0; i <= 1000; i++) { const gain = equalPower(i / 1000); expect(gain.from ** 2 + gain.to ** 2).toBeCloseTo(1, 12); } });
  it('ignores leading/trailing silence and handles missing/all-silent waves', () => { expect(audibleRange([0, 0, .2, .7, .4, 0], 60)).toEqual({ start: 20, end: 50 }); expect(audibleRange([], 100)).toEqual({ start: 0, end: 100 }); expect(audibleRange([0, 0], 100)).toEqual({ start: 0, end: 100 }); });
  const library = createLibrary(), a = library.getTrack('track-1')!, b = library.getTrack('track-2')!;
  const options = { from: a, to: b, fromWave: [1, 1, 1, 0], toWave: [0, 1, 1, 1], seconds: 3, repeat: 'off' as const, sameAlbumGapless: true };
  it('places the overlap relative to audible sound', () => expect(planCrossfade(options)).toEqual({ fromStart: a.duration * .75 - 3, fromEnd: a.duration * .75, toStart: b.duration * .25, duration: 3 }));
  it('disables overlap for manual switching, album neighbors, repeat-one, and zero seconds', () => { expect(planCrossfade({ ...options, manual: true })).toBeNull(); expect(planCrossfade({ ...options, repeat: 'one' })).toBeNull(); expect(planCrossfade({ ...options, seconds: 0 })).toBeNull(); const album = { ...options, from: { ...a, albumId: 'album' }, to: { ...b, albumId: 'album' } }; expect(planCrossfade(album)).toBeNull(); expect(planCrossfade({ ...album, sameAlbumGapless: false })).not.toBeNull(); });
  it('uses separate engine slots, changes metadata at the start, and advances both clocks', async () => {
    vi.useFakeTimers(); const library = createLibrary(), settings = createSettings(defaultSettings), audio = createAudioEngine();
    library.getWaveform = async () => ({ samples: [1, 1, 1, 1] }); const player = createPlayer(library, undefined, undefined, settings, audio);
    try { await vi.advanceTimersByTimeAsync(0); player.resume(); player.seek(139.8); await vi.advanceTimersByTimeAsync(400);
      expect(player.getSnapshot().trackId).toBe('track-2'); expect(player.getSnapshot().crossfade).toMatchObject({ from: 'track-1', to: 'track-2' }); expect(audio.slots.a.playing).toBe(true); expect(audio.slots.b.playing).toBe(true);
      await vi.advanceTimersByTimeAsync(1400); const state = player.getSnapshot(); expect(state.crossfade!.progress).toBeGreaterThan(.4); expect(state.position).toBeGreaterThan(1); expect(audio.slots.a.gain ** 2 + audio.slots.b.gain ** 2).toBeCloseTo(1, 5);
      await vi.advanceTimersByTimeAsync(2000); expect(player.getSnapshot().crossfade).toBeUndefined(); expect(player.getSnapshot().position).toBeGreaterThan(3); expect(audio.slots.a.playing).toBe(false);
    } finally { player.dispose(); vi.useRealTimers(); }
  });
  it('manual switching fades for 0.3s without starting an overlapping source', async () => { vi.useFakeTimers(); const audio = createAudioEngine(), player = createPlayer(createLibrary(), undefined, undefined, createSettings(defaultSettings), audio); try { await vi.advanceTimersByTimeAsync(0); player.resume(); player.next(); expect(player.getSnapshot().crossfade).toBeUndefined(); expect(player.getSnapshot().transition?.duration).toBe(300); expect(audio.slots.a.fadeSeconds).toBe(.3); expect(audio.slots.b.playing).toBe(false); await vi.advanceTimersByTimeAsync(350); expect(audio.slots.a.playing).toBe(false); expect(audio.slots.b.playing).toBe(true); } finally { player.dispose(); vi.useRealTimers(); } });
  it('sleep timer fades during the final ten seconds and stops both slots', async () => { vi.useFakeTimers(); const player = createPlayer(createLibrary()); try { player.resume(); player.setSleepTimer(.2); await vi.advanceTimersByTimeAsync(3000); expect(player.getSnapshot().sleepTimer!.gain).toBeCloseTo(.9, 1); await vi.advanceTimersByTimeAsync(10000); expect(player.getSnapshot().playing).toBe(false); expect(player.getSnapshot().sleepTimer).toBeUndefined(); } finally { player.dispose(); vi.useRealTimers(); } });
});
describe('static palette extraction', () => {
  it('reads Qt AARRGGBB without evaluating QML and composites mainBg over black', () => { const text = readFileSync(new URL('../fixtures/palettes/colors.qml', import.meta.url), 'utf8'); const result = importPalette({ palette: readColorLiterals(text) }, 'Аметист'); expect(result.pack.palette.mainBg).toBe('#0d0c18'); expect(result.pack.palette.accent).toBe('#6c3bff'); expect(result.corrections.map(item => item.role)).toEqual(['accentMutedText']); });
  it('passes theme.json through the same adapter', () => { const fixture = JSON.parse(readFileSync(new URL('../fixtures/palettes/theme.json', import.meta.url), 'utf8')); const result = importPalette(fixture, 'Серебро'); expect(result.pack.palette.mainBg).toBe('#06080b'); expect(result.pack.palette.accent).toBe('#C9D1DE'); expect(result.corrections).toEqual([]); });
  it.each(['amethyst', 'silver', 'lime', 'gold'])('%s has readable text roles on every surface', id => { const p = colors[id]!.palette; for (const role of ['text', 'textMuted', 'accentMutedText', 'danger', 'warning', 'success'] as const) for (const surface of [p.mainBg, p.cardBg, p.cardHover, composite(p.barBg, p.mainBg)]) expect(contrast(p[role], surface), `${id}.${role}`).toBeGreaterThanOrEqual(4.5); expect(contrast(p.textOnAccent, p.accent)).toBeGreaterThanOrEqual(4.5); });
  it('does not expose upstream theme names in UI or translations', () => { const ru = readFileSync(new URL('../../src/ui/i18n/ru.json', import.meta.url), 'utf8'), en = readFileSync(new URL('../../src/ui/i18n/en.json', import.meta.url), 'utf8'); expect(ru + en + JSON.stringify(colors)).not.toMatch(/PURPLE|stardust|gamesense|urushi|Retro90|Linen/); });
});
