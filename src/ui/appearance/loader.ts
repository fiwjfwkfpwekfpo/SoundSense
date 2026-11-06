import type { Artwork, SettingsValues } from '../../core/types';
import { colors, motions, styles } from './presets';
import { createPackLoader } from './validate';
import { motionGroups, styleTokens } from './schema';
import type { AppearanceAxis, AppearancePacks, ColorPack, MotionGroup, MotionValues, StylePack } from './schema';
import { resolveColors, resolveMotion } from './resolver';
import { fromArtwork } from './artwork';
import { easingToCss, effectiveMotion } from './motion/runtime';
export const customKey = (axis: AppearanceAxis) => `appearance${axis[0]!.toUpperCase()}${axis.slice(1)}Custom`;
export const choiceKey = (axis: AppearanceAxis) => `appearance${axis[0]!.toUpperCase()}${axis.slice(1)}`;
export const baseKey = (axis: AppearanceAxis) => `${choiceKey(axis)}Base`;
export const groupKey = (group: MotionGroup) => `motion${group[0]!.toUpperCase()}${group.slice(1)}`;
export interface AppearanceState {
  style: StylePack; colors: ColorPack; motion: AppearancePacks['motion']; groups: MotionValues;
  selection: { style: string; colors: ReturnType<typeof resolveColors>; motion: ReturnType<typeof resolveMotion> }; errors: string[];
}
export function createAppearanceLoader() {
  const loaders = { style: createPackLoader('style', styles.standard!), colors: createPackLoader('colors', colors.mono!), motion: createPackLoader('motion', motions.smooth!) };
  return {
    resolve(values: SettingsValues, reducedMotion = false, artwork?: Artwork, average?: string): AppearanceState {
      const errors: string[] = [];
      function load<A extends AppearanceAxis>(axis: A, id: string, registry: Record<string, AppearancePacks[A]>, fallback: string): AppearancePacks[A] {
        const input = id === 'custom' ? values[customKey(axis)] || registry[String(values[baseKey(axis)] ?? fallback)] || registry[fallback] : registry[id] ?? registry[fallback];
        const result = loaders[axis].load(input); if (!result.ok) errors.push(result.error); return result.pack as AppearancePacks[A];
      }
      const styleId = String(values.appearanceStyle ?? 'standard'); const style = load('style', styleId, styles, 'standard');
      const colorSelection = resolveColors(String(values.appearanceColors ?? 'auto'), style, values.appearanceAutoSuggest !== false);
      let colorPack = load('colors', colorSelection.id, colors, 'mono');
      if (colorSelection.id === 'cover' && artwork) colorPack = fromArtwork(artwork, average);
      const groupChoices = Object.fromEntries(motionGroups.map(group => [group, String(values[groupKey(group)] ?? 'auto')]));
      const motionSelection = resolveMotion(String(values.appearanceMotion ?? 'auto'), groupChoices, style, values.appearanceAutoSuggest !== false, reducedMotion);
      const motion = load('motion', motionSelection.common.id, motions, 'smooth');
      const groups = Object.fromEntries(motionGroups.map(group => {
        const choice = motionSelection.groups[group].id;
        const parameters = choice === motionSelection.common.id ? motion.groups[group] : choice === 'custom' ? load('motion', choice, motions, 'smooth').groups[group] : (motions[choice] ?? motions.smooth!).groups[group];
        return [group, effectiveMotion(group, parameters, { speed: Math.max(.5, Math.min(2, Number(values.motionSpeed ?? 1))), lowPower: typeof navigator !== 'undefined' && navigator.hardwareConcurrency <= 4, off: choice === 'off' })];
      })) as MotionValues;
      return { style, colors: colorPack, motion, groups, selection: { style: styleId, colors: colorSelection, motion: motionSelection }, errors };
    },
  };
}
export function styleVariables(style: StylePack): Record<string, string> {
  return Object.fromEntries(Object.entries(styleTokens).map(([key, definition]) => [definition.css, String(style.tokens[key as keyof typeof styleTokens]) + ('unit' in definition ? definition.unit : '')]));
}
export function colorVariables(pack: ColorPack): Record<string, string> { return Object.fromEntries(Object.entries(pack.palette).map(([role, color]) => [`--palette-${role}`, color])); }
const registered = new Set<string>();
const applied = new WeakMap<HTMLElement, string>();
export function registerPaletteProperties(pack: ColorPack) {
  if (typeof CSS === 'undefined' || !('registerProperty' in CSS)) return;
  for (const [name, initialValue] of Object.entries(colorVariables(pack))) {
    if (registered.has(name)) continue;
    try { CSS.registerProperty({ name, syntax: '<color>', inherits: true, initialValue }); } catch { /* HMR / an earlier root has already registered it. */ }
    registered.add(name);
  }
  for (const [key, definition] of Object.entries(styleTokens)) {
    if (!key.startsWith('radius') && !key.startsWith('opacity') || definition.type !== 'number' || registered.has(definition.css)) continue;
    try { CSS.registerProperty({ name: definition.css, syntax: definition.unit === 'px' ? '<length>' : '<number>', inherits: true, initialValue: String(definition.default) + definition.unit }); } catch { /* HMR registration. */ }
    registered.add(definition.css);
  }
}
export function applyAppearance(state: AppearanceState, fontScale = 1, target: HTMLElement = document.documentElement) {
  const fingerprint = JSON.stringify({ style: state.style, colors: state.colors, groups: state.groups, selection: state.selection, fontScale });
  if (applied.get(target) === fingerprint) return false;
  applied.set(target, fingerprint);
  registerPaletteProperties(colors.mono!);
  // Interpolating inherited palette properties invalidates every descendant on
  // every frame. Backgrounds crossfade as two static compositor layers instead.
  target.style.transition = Object.values(styleTokens).filter(definition => definition.css.startsWith('--radius-') || definition.css.startsWith('--opacity-')).map(definition => `${definition.css} ${state.groups.general.duration}ms ${easingToCss(state.groups.general.easing)}`).join(', ');
  for (const [key, value] of Object.entries({ ...styleVariables(state.style), ...colorVariables(state.colors) })) if (target.style.getPropertyValue(key) !== value) target.style.setProperty(key, value);
  for (const group of motionGroups) {
    const parameters = state.groups[group];
    target.style.setProperty(`--motion-${group}-duration`, `${parameters.duration}ms`);
    target.style.setProperty(`--motion-${group}-easing`, easingToCss(parameters.easing));
    target.setAttribute(`data-motion-${group}`, parameters.effect);
  }
  target.setAttribute('data-motion-waveform-progress', state.groups.waveform.progress ?? 'smooth');
  target.setAttribute('data-color-scheme', state.colors.scheme); target.style.colorScheme = state.colors.scheme;
  target.setAttribute('data-style', state.selection.style); target.setAttribute('data-colors', state.selection.colors.id);
  target.setAttribute('data-motion', state.selection.motion.common.id);
  target.style.setProperty('--font-scale', String(fontScale));
  // VirtualList reads this variable numerically: keep the resolved value in px.
  const tokens = state.style.tokens;
  const textHeight = (tokens.fontM * 1.25 + tokens.fontSm * 1.5) * fontScale + tokens.space1 + tokens.space2;
  target.style.setProperty('--track-height', `${Math.ceil(Math.max(44, tokens.space4 * 3 + tokens.space2, textHeight, 68 * tokens.listDensity * fontScale))}px`);
  if (target === document.documentElement) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', state.colors.palette.mainBg);
    window.dispatchEvent(new CustomEvent('app:appearance', { detail: { scheme: state.colors.scheme } })); window.dispatchEvent(new Event('app:theme'));
  }
  return true;
}
