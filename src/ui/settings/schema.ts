import type { SettingDescriptor } from '../../core/registries';
import type { SettingsValues, SettingValue } from '../../core/types';
import { appearanceSchema, colorIds, motionGroups, motionIds, styleIds } from '../appearance/schema';
import type { AppearanceAxis } from '../appearance/schema';
import { BETA_FEATURES } from '../../core/build';
import { isDesktop } from '../../platform/desktop';
export type SettingSection = 'appearance' | 'home' | 'playback' | 'sound' | 'offline' | 'sync' | 'sources' | 'updates';
export type SettingDefinition = SettingDescriptor;
export const settingsSchema: readonly SettingDefinition[] = [
  ...(['style', 'colors', 'motion'] as const).flatMap(axis => {
    const title = axis[0]!.toUpperCase() + axis.slice(1);
    return [
      { key: `appearance${title}`, section: 'appearance' as const, type: 'appearance' as const, axis, default: axis === 'style' ? 'standard' : 'auto', sync: true, label: `appearance.axis.${axis}` },
      { key: `appearance${title}Custom`, section: 'appearance' as const, type: 'text' as const, default: '', sync: true, label: `appearance.axis.${axis}`, hidden: true },
      { key: `appearance${title}Base`, section: 'appearance' as const, type: 'text' as const, default: axis === 'style' ? 'standard' : axis === 'colors' ? 'mono' : 'smooth', sync: true, label: `appearance.axis.${axis}`, hidden: true },
    ];
  }),
  { key: 'appearanceAutoSuggest', section: 'appearance', type: 'toggle', default: true, sync: true, label: 'appearance.autoSuggest' },
  ...motionGroups.map(group => ({ key: `motion${group[0]!.toUpperCase()}${group.slice(1)}`, section: 'appearance' as const, type: 'text' as const, default: 'auto', sync: true, label: `appearance.group.${group}`, hidden: true })),
  { key: 'motionSpeed', section: 'appearance', type: 'slider', default: appearanceSchema.speed.default, min: appearanceSchema.speed.min, max: appearanceSchema.speed.max, step: appearanceSchema.speed.step, sync: true, label: 'appearance.speed', hidden: true },
  { key: 'language', section: 'appearance', type: 'select', default: 'ru', sync: true, label: 'setting.language', options: [
    { value: 'ru', label: 'language.ru' }, { value: 'en', label: 'language.en' }] },
  // Per device: the phone always keeps the bottom bar.
  { key: 'navPosition', section: 'appearance', type: 'select', default: 'left', sync: false, hidden: !isDesktop(), label: 'setting.navPosition', since: '1.4.0', options: [
    { value: 'left', label: 'setting.navPosition.left' }, { value: 'bottom', label: 'setting.navPosition.bottom' }] },
  { key: 'fontSize', section: 'appearance', type: 'slider', default: 100, min: 85, max: 130, step: 5, sync: true, label: 'setting.fontSize', unit: 'common.percent' },
  { key: 'beatPulse', section: 'appearance', type: 'toggle', default: true, sync: true, beta: true, hidden: !BETA_FEATURES, label: 'setting.beatPulse', hint: 'setting.beatPulseHint', since: '1.1.0' },
  { key: 'beatParticles', section: 'appearance', type: 'toggle', default: true, sync: true, beta: true, hidden: !BETA_FEATURES, label: 'setting.beatParticles', hint: 'setting.beatParticlesHint', since: '1.1.0' },
  { key: 'liveCovers', section: 'appearance', type: 'toggle', default: true, sync: true, beta: true, hidden: !BETA_FEATURES, label: 'setting.liveCovers', hint: 'setting.liveCoversHint', since: '1.1.0' },
  { key: 'recommendations', section: 'home', type: 'toggle', default: true, sync: true, label: 'setting.recommendations', since: '0.6.0' },
  { key: 'charts', section: 'home', type: 'toggle', default: true, sync: true, label: 'setting.charts', since: '0.6.0' },
  { key: 'chartYa', section: 'home', type: 'toggle', default: true, sync: true, label: 'setting.chartYa' },
  { key: 'chartSpotify', section: 'home', type: 'toggle', default: true, sync: true, label: 'setting.chartSpotify' },
  { key: 'chartSc', section: 'home', type: 'toggle', default: true, sync: true, label: 'setting.chartSc' },
  { key: 'chartDefault', section: 'home', type: 'select', default: 'ya', sync: true, label: 'setting.chartDefault', options: [
    { value: 'ya', label: 'source.ya' }, { value: 'spotify', label: 'source.spotify' }, { value: 'sc', label: 'source.sc' }] },
  { key: 'onboardingDone', section: 'home', type: 'toggle', default: false, sync: false, label: 'onboarding.skip', hidden: true },
  { key: 'backgroundPromptSeen', section: 'playback', type: 'toggle', default: false, sync: false, label: 'background.title', hidden: true },
  { key: 'haptics', section: 'playback', type: 'toggle', default: true, sync: false, label: 'setting.haptics' },
  { key: 'waveform', section: 'playback', type: 'toggle', default: true, sync: true, label: 'setting.waveform' },
  { key: 'lyricsSmooth', section: 'playback', type: 'toggle', default: true, sync: true, label: 'setting.lyricsSmooth', since: '1.0.2' },
  { key: 'waveformZoom', section: 'playback', type: 'toggle', default: true, sync: true, label: 'setting.waveformZoom', since: '0.6.0' },
  { key: 'waveCacheLimit', section: 'playback', type: 'slider', default: 32, min: 8, max: 128, step: 8, sync: false, label: 'setting.waveCacheLimit', unit: 'common.mb' },
  { key: 'crossfade', section: 'sound', type: 'slider', default: 3, min: 0, max: 12, step: 1, sync: true, label: 'setting.crossfade', unit: 'common.seconds' },
  { key: 'sameAlbumGapless', section: 'sound', type: 'toggle', default: true, sync: true, label: 'setting.sameAlbumGapless', hidden: true },
  { key: 'autoUpdateCheck', section: 'updates', type: 'toggle', default: true, sync: false, label: 'update.autoCheck' },
  { key: 'normalize', section: 'sound', type: 'toggle', default: true, sync: true, label: 'setting.normalize', since: '1.0.0' },
  { key: 'autoCache', section: 'offline', type: 'toggle', default: true, sync: false, label: 'offline.automatic' },
  { key: 'wifiOnly', section: 'offline', type: 'toggle', default: true, sync: false, label: 'setting.wifiOnly' },
  { key: 'storageLimit', section: 'offline', type: 'slider', default: 4, min: 1, max: 32, step: 1, sync: false, label: 'setting.storageLimit', unit: 'common.gb' },
];
export const defaultSettings: SettingsValues = Object.fromEntries(settingsSchema.map(s => [s.key, s.default]));
export function validateSetting(definition: SettingDefinition, value: SettingValue): boolean {
  if (typeof value !== typeof definition.default) return false;
  if (definition.type === 'appearance' && ![...(definition.axis === 'style' ? styleIds : definition.axis === 'colors' ? colorIds : motionIds), 'custom', ...(definition.axis !== 'style' ? ['auto'] : [])].includes(String(value))) return false;
  if (motionGroups.some(group => `motion${group[0]!.toUpperCase()}${group.slice(1)}` === definition.key) && ![...motionIds, 'auto'].includes(String(value))) return false;
  if (definition.options && !definition.options.some(option => option.value === value)) return false;
  if (typeof value === 'number' && (!Number.isFinite(value) || value < (definition.min ?? -Infinity) || value > (definition.max ?? Infinity))) return false;
  if (typeof value === 'number' && definition.step && Math.abs((value - (definition.min ?? 0)) / definition.step - Math.round((value - (definition.min ?? 0)) / definition.step)) > 0.00001) return false;
  return true;
}
