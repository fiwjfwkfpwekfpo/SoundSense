// Adapted from rootscripts/riff track-audio.js (MIT), via cloverscripts/riff-muriel.
// Copyright (c) 2026 rootscripts. License: public/licenses/riff.txt.
export interface AudioProcessing { speed: number; speedPitch: number; pitch: number; volume: number }
export interface AudioPreset { id: string; name?: string; label?: string; values: Omit<AudioProcessing, 'volume'> }
export interface AudioSettingsState { global: AudioProcessing; tracks: Readonly<Record<string, AudioProcessing>>; presets: readonly AudioPreset[] }
export interface AudioSettingsApi {
  getSnapshot(): AudioSettingsState;
  subscribe(listener: (state: AudioSettingsState) => void): () => void;
  get(id: string): AudioProcessing;
  set(key: keyof AudioProcessing, value: number, id?: string): void;
  trackOnly(id: string, enabled: boolean): void;
  preset(preset: AudioPreset, id?: string): void;
  savePreset(name: string, id?: string): void;
  removePreset(id: string): void;
  reset(id?: string): void;
  flush(): void;
  dispose(): void;
}
export const normalAudio: Readonly<AudioProcessing> = { speed: 1, speedPitch: 1, pitch: 0, volume: 1 };
export const audioPresets: readonly AudioPreset[] = [
  { id: 'normal', label: 'audio.normal', values: { speed: 1, speedPitch: 1, pitch: 0 } },
  { id: 'slowed', label: 'audio.slowed', values: { speed: 1, speedPitch: .8, pitch: 0 } },
  { id: 'daycore', label: 'audio.daycore', values: { speed: 1, speedPitch: .85, pitch: -1 } },
  { id: 'sped', label: 'audio.sped', values: { speed: 1.25, speedPitch: 1, pitch: 0 } },
  { id: 'nightcore', label: 'audio.nightcore', values: { speed: 1, speedPitch: 1.25, pitch: 0 } },
  { id: 'practice', label: 'audio.practice', values: { speed: .75, speedPitch: 1, pitch: 0 } },
];
const key = 'ss_audio_settings_v1';
export function normalizeAudio(input?: Partial<AudioProcessing>): AudioProcessing {
  const range = { speed: [.5, 2], speedPitch: [.5, 2], pitch: [-12, 12], volume: [0, 2] } as const;
  return Object.fromEntries(Object.entries(normalAudio).map(([key, fallback]) => { const name = key as keyof AudioProcessing, value = Number(input?.[name]); return [name, Number.isFinite(value) ? Math.round(Math.max(range[name][0], Math.min(range[name][1], value)) * (name === 'pitch' ? 1 : 100)) / (name === 'pitch' ? 1 : 100) : fallback]; })) as unknown as AudioProcessing;
}
export function processingRate(values: AudioProcessing): number { return values.speed * values.speedPitch; }
export function processingPitch(values: AudioProcessing): number { return values.speedPitch * 2 ** (values.pitch / 12); }
export function createAudioSettings(storage?: Pick<Storage, 'getItem' | 'setItem'>): AudioSettingsApi {
  let state: AudioSettingsState = { global: { ...normalAudio }, tracks: {}, presets: [] }, timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<(state: AudioSettingsState) => void>();
  try { const saved = JSON.parse(storage?.getItem(key) ?? 'null'); if (saved && typeof saved === 'object') state = { global: normalizeAudio(saved.global), tracks: Object.fromEntries(Object.entries(saved.tracks ?? {}).filter(([id, value]) => id.length <= 160 && value && typeof value === 'object').slice(-5000).map(([id, value]) => [id, normalizeAudio(value as Partial<AudioProcessing>)])), presets: Array.isArray(saved.presets) ? saved.presets.filter((preset: AudioPreset) => typeof preset?.id === 'string' && typeof preset.name === 'string' && preset.name.trim()).slice(-40).map((preset: AudioPreset) => ({ id: preset.id, name: preset.name!.slice(0, 40), values: normalizeAudio(preset.values) })) : [] }; } catch { /* Damaged audio settings do not prevent playback. */ }
  const flush = () => { clearTimeout(timer); timer = undefined; try { storage?.setItem(key, JSON.stringify(state)); } catch {} };
  const publish = () => { clearTimeout(timer); timer = setTimeout(flush, 200); for (const listener of listeners) listener(state); };
  const apply = (values: AudioProcessing, id?: string) => { state = id ? { ...state, tracks: { ...state.tracks, [id]: normalizeAudio(values) } } : { ...state, global: normalizeAudio(values) }; publish(); };
  const api: AudioSettingsApi = {
    getSnapshot: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get(id) { return Object.hasOwn(state.tracks, id) ? state.tracks[id]! : state.global; },
    set(key, value, id) { apply({ ...(id ? api.get(id) : state.global), [key]: value }, id); },
    trackOnly(id, enabled) { if (enabled) apply({ ...api.get(id) }, id); else { const tracks = { ...state.tracks }; delete tracks[id]; state = { ...state, tracks }; publish(); } },
    preset(preset, id) { apply({ ...(id ? api.get(id) : state.global), ...preset.values }, id); },
    savePreset(name, id) { const clean = name.replace(/\s+/g, ' ').trim().slice(0, 40); if (!clean) return; const { speed, speedPitch, pitch } = id ? api.get(id) : state.global; state = { ...state, presets: [...state.presets.slice(-39), { id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: clean, values: { speed, speedPitch, pitch } }] }; publish(); },
    removePreset(id) { state = { ...state, presets: state.presets.filter(preset => preset.id !== id) }; publish(); },
    reset(id) { if (id) api.trackOnly(id, false); else apply({ ...normalAudio }); },
    flush, dispose() { flush(); listeners.clear(); },
  };
  return api;
}
