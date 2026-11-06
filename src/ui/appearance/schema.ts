import mono from './colors/mono.json';
import smooth from './motion/smooth.json';

export const paletteRoles = ['bgOverlay', 'mainBg', 'barBg', 'cardBg', 'cardHover', 'border', 'borderLight', 'accent', 'text', 'textMuted', 'textOnAccent', 'accentMutedText', 'danger', 'warning', 'success'] as const;
export type PaletteRole = typeof paletteRoles[number];
export type Palette = Record<PaletteRole, string>;
export type Scheme = 'dark' | 'light';
export interface ColorPack { version: 1; name: string; scheme: Scheme; palette: Palette }
const numeric = (value: number, min: number, max: number, css: string, unit = 'px', step?: number) => ({ type: 'number' as const, default: value, min, max, css, unit, step });
const font = (value: string, css: string) => ({ type: 'font' as const, default: value, css, maxLength: 160 });
export const styleTokens = {
  space1: numeric(4, 2, 12, '--space-1'), space2: numeric(8, 4, 20, '--space-2'), space3: numeric(12, 6, 26, '--space-3'), space4: numeric(16, 8, 32, '--space-4'),
  space5: numeric(20, 10, 38, '--space-5'), space6: numeric(24, 12, 44, '--space-6'), space7: numeric(28, 14, 48, '--space-7'), space8: numeric(32, 16, 56, '--space-8'),
  radiusS: numeric(8, 0, 24, '--radius-s'), radiusM: numeric(14, 0, 32, '--radius-m'), radiusL: numeric(22, 0, 48, '--radius-l'), radiusXl: numeric(32, 0, 64, '--radius-xl'), radiusFull: numeric(999, 0, 999, '--radius-full'),
  fontBody: font("'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", '--font-family'),
  fontDisplay: font("'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", '--font-display'),
  fontMono: font("'JetBrains Mono', 'SFMono-Regular', Consolas, monospace", '--font-mono'),
  fontXs: numeric(11, 10, 20, '--font-size-xs'), fontS: numeric(12, 10, 22, '--font-size-s'), fontSm: numeric(13, 11, 24, '--font-size-sm'), fontM: numeric(14, 12, 26, '--font-size-m'),
  fontBodySize: numeric(15, 12, 28, '--font-size-body'), fontL: numeric(17, 14, 30, '--font-size-l'), fontXl: numeric(20, 16, 34, '--font-size-xl'), font2xl: numeric(24, 18, 40, '--font-size-2xl'),
  font3xl: numeric(30, 22, 46, '--font-size-3xl'), fontHero: numeric(32, 24, 48, '--font-size-hero'), fontLyrics: numeric(26, 18, 42, '--font-size-lyrics'),
  weightNormal: numeric(400, 100, 900, '--font-weight-normal', '', 100), weightMedium: numeric(500, 100, 900, '--font-weight-medium', '', 100),
  weightSemibold: numeric(600, 100, 900, '--font-weight-semibold', '', 100), weightBold: numeric(700, 100, 900, '--font-weight-bold', '', 100),
  borderWidth: numeric(1, 0, 3, '--border-width'), chromeBorders: numeric(0, 0, 1, '--chrome-borders', '', 1), focusWidth: numeric(2, 1, 4, '--focus-width'),
  blurNav: numeric(24, 0, 40, '--blur-nav'), blurArt: numeric(1, 0, 8, '--blur-art'),
  opacityDisabled: numeric(.38, .2, .8, '--opacity-disabled', ''), opacityHover: numeric(.12, 0, .4, '--opacity-hover', ''), opacityPressed: numeric(.22, 0, .5, '--opacity-pressed', ''),
  opacityMuted: numeric(.65, .3, 1, '--opacity-muted', ''), opacityArt: numeric(.9, .2, 1, '--opacity-art', ''), opacityNoise: numeric(.16, 0, .4, '--opacity-noise', ''),
  opacityRing: numeric(.24, 0, .6, '--opacity-ring', ''), opacityLine: numeric(.5, .1, 1, '--opacity-line', ''),
  shadowStrength: numeric(.28, 0, .6, '--shadow-strength', ''), listDensity: numeric(1, .85, 1.3, '--list-density', ''),
} as const;
export type StyleToken = keyof typeof styleTokens;
export type StyleValues = { [K in StyleToken]: (typeof styleTokens)[K]['type'] extends 'font' ? string : number };
export const styleIds = ['standard', 'soft', 'compact', 'flat', 'retro'] as const;
export const colorIds = Object.keys({ cover: true, amethyst: true, silver: true, lime: true, gold: true, mono: true, amoled: true, 'high-contrast': true });
export const motionIds = ['smooth', 'snappy', 'spring', 'retro', 'minimal', 'off'] as const;
export interface StylePack { version: 1; name: string; tokens: StyleValues; suggest?: { colors?: string; motion?: string } }
export const motionGroups = ['general', 'player', 'title', 'cover', 'lyrics', 'waveform'] as const;
export type MotionGroup = typeof motionGroups[number];
export type Easing = 'standard' | 'emphasized' | 'spring' | 'linear' | `steps(${number})` | [number, number, number, number];
export interface MotionParameters { effect: string; duration: number; easing: Easing; progress?: 'smooth' | 'stepped' }
export type MotionValues = Record<MotionGroup, MotionParameters>;
export interface MotionPack { version: 1; name: string; groups: MotionValues }
export const motionRegistry = {
  general: { effects: ['fluid', 'color-spread', 'listen-flight', 'liquid-tabs', 'tab-circle', 'depth', 'cascade', 'crt', 'play-morph', 'like-sparks', 'fade', 'slide', 'scale', 'none'], maxDuration: 1200 },
  player: { effects: ['shared', 'drop', 'slide-up', 'expand', 'fade'], maxDuration: 1500 },
  title: { effects: ['fade', 'slide-up', 'blur', 'typewriter', 'split-flap', 'decipher', 'none'], maxDuration: 1500 },
  cover: { effects: ['stack', 'goo', 'crossfade', 'slide', 'zoom', 'none'], maxDuration: 1500 },
  lyrics: { effects: ['fade', 'scale', 'blur', 'fill', 'none'], maxDuration: 1500 },
  waveform: { effects: ['morph', 'grow', 'sweep', 'none'], maxDuration: 1200 },
} as const;
export const appearanceSchema = {
  version: 1 as const,
  colors: { fields: ['version', 'name', 'scheme', 'palette'], roles: paletteRoles, schemes: ['dark', 'light'], defaults: mono as ColorPack },
  style: { fields: ['version', 'name', 'tokens', 'suggest'], tokens: styleTokens, defaults: Object.fromEntries(Object.entries(styleTokens).map(([key, definition]) => [key, definition.default])) as StyleValues },
  motion: { fields: ['version', 'name', 'groups'], groups: motionRegistry, easing: ['standard', 'emphasized', 'spring', 'linear'], steps: { min: 2, max: 12 }, defaults: smooth as MotionPack },
  speed: { min: .5, max: 2, step: .1, default: 1 },
};
export type AppearanceAxis = 'style' | 'colors' | 'motion';
export interface AppearancePacks { style: StylePack; colors: ColorPack; motion: MotionPack }
