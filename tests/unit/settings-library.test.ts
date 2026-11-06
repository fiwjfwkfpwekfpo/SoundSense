import { describe, expect, it } from 'vitest';
import { createSettings, SETTINGS_STORAGE_KEY } from '../../src/mock/settings';
import { defaultSettings, settingsSchema, validateSetting } from '../../src/ui/settings/schema';
import { createLibrary } from '../../src/mock/library';
describe('settings storage', () => {
  it('saves behind SettingsApi and restores values', () => { const memory = new Map<string, string>(); const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v); } }; const api = createSettings(defaultSettings, storage); api.set('appearanceColors', 'silver'); expect(JSON.parse(memory.get(SETTINGS_STORAGE_KEY)!).appearanceColors).toBe('silver'); expect(createSettings(defaultSettings, storage).getSnapshot().appearanceColors).toBe('silver'); });
  it('survives a storage failure', () => { const api = createSettings(defaultSettings, { getItem() { throw new Error(); }, setItem() { throw new Error(); } }); api.set('appearanceColors', 'silver'); expect(api.getSnapshot().appearanceColors).toBe('silver'); expect(api.isPersistent()).toBe(false); });
  it('rejects values outside schema ranges and options', () => { const theme = settingsSchema.find(s => s.key === 'appearanceColors')!; const size = settingsSchema.find(s => s.key === 'fontSize')!; expect(validateSetting(theme, 'invalid')).toBe(false); expect(validateSetting(size, 400)).toBe(false); expect(validateSetting(size, 101)).toBe(false); expect(validateSetting(size, 110)).toBe(true); });
  it('resets a section without losing other settings', () => { const api = createSettings(defaultSettings); api.set('language', 'en'); api.set('appearanceColors', 'silver'); api.reset(['appearanceColors']); expect(api.getSnapshot().appearanceColors).toBe('auto'); expect(api.getSnapshot().language).toBe('en'); });
});
describe('mock library', () => {
  it('starts with 42 curated songs and 2048 liked songs', () => { const library = createLibrary(); expect(library.getSnapshot().tracks.filter(t => t.id.startsWith('track-'))).toHaveLength(42); expect(library.getPlaylistTracks('liked')).toHaveLength(2048); });
  it('updates liked songs through the same API', () => { const library = createLibrary(); library.setLiked('track-1', false); expect(library.getPlaylistTracks('liked')).toHaveLength(2047); expect(library.getTrack('track-1')?.liked).toBe(false); library.setLiked('track-1', true); expect(library.getPlaylistTracks('liked')).toHaveLength(2048); });
  it('filters and sorts the large library', () => { const library = createLibrary(); const tracks = library.getPlaylistTracks('liked', 'ночная', 'duration'); expect(tracks.length).toBeGreaterThan(100); expect(tracks.every((t, i) => i === 0 || t.duration >= tracks[i - 1]!.duration)).toBe(true); });
  it('combines text and source filters', async () => { const library = createLibrary(); const result = await library.search('lunar', { source: 'sc', type: 'tracks' }); expect(result.tracks.length).toBeGreaterThan(0); expect(result.tracks.every(t => t.sources.some(s => s.kind === 'sc') && t.artist.name === 'lunar field')).toBe(true); });
});
