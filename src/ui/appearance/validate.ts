import { appearanceSchema, colorIds, motionGroups, motionIds, paletteRoles, styleTokens } from './schema';
import type { AppearanceAxis, AppearancePacks, ColorPack, Easing, MotionGroup, MotionPack, MotionParameters, StylePack } from './schema';

function object(input: unknown, path: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) throw new Error(`${path}: expected a plain object`);
  return input as Record<string, unknown>;
}
function fields(input: Record<string, unknown>, allowed: readonly string[], path: string) {
  for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new Error(`${path}.${key}: unknown key`);
}
function envelope(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  const value = object(input, 'pack'); fields(value, allowed, 'pack');
  if (value.version !== appearanceSchema.version) throw new Error('pack.version: expected 1');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80 || /[\x00-\x1f]/.test(value.name)) throw new Error('pack.name: expected 1–80 characters');
  return value;
}
export function validColor(value: unknown): value is string { return typeof value === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(value); }
export function parseColorPack(input: unknown): ColorPack {
  const value = envelope(input, appearanceSchema.colors.fields);
  if (value.scheme !== undefined && !appearanceSchema.colors.schemes.includes(String(value.scheme))) throw new Error('pack.scheme: expected dark or light');
  const palette = object(value.palette, 'pack.palette'); fields(palette, paletteRoles, 'pack.palette');
  for (const [key, color] of Object.entries(palette)) if (!validColor(color)) throw new Error(`pack.palette.${key}: expected HEX in RRGGBB or RRGGBBAA order`);
  return { version: 1, name: value.name as string, scheme: (value.scheme ?? appearanceSchema.colors.defaults.scheme) as ColorPack['scheme'], palette: { ...appearanceSchema.colors.defaults.palette, ...palette } };
}
export function parseStylePack(input: unknown): StylePack {
  const value = envelope(input, appearanceSchema.style.fields);
  const tokens = object(value.tokens, 'pack.tokens'); fields(tokens, Object.keys(styleTokens), 'pack.tokens');
  for (const [key, token] of Object.entries(tokens)) {
    const definition = styleTokens[key as keyof typeof styleTokens];
    if (definition.type === 'font') {
      if (typeof token !== 'string' || token.length < 1 || token.length > definition.maxLength || !/^[\w\s,'"-]+$/.test(token) || /(?:url|expression)\s*\(/i.test(token)) throw new Error(`pack.tokens.${key}: expected a font family list`);
    } else if (typeof token !== 'number' || !Number.isFinite(token) || token < definition.min || token > definition.max || definition.step && Math.abs(token / definition.step - Math.round(token / definition.step)) > .00001) throw new Error(`pack.tokens.${key}: expected ${definition.min}–${definition.max}`);
  }
  let suggest: StylePack['suggest'];
  if (value.suggest !== undefined) {
    const raw = object(value.suggest, 'pack.suggest'); fields(raw, ['colors', 'motion'], 'pack.suggest');
    if (raw.colors !== undefined && !colorIds.includes(raw.colors as typeof colorIds[number])) throw new Error('pack.suggest.colors: unknown preset');
    if (raw.motion !== undefined && !motionIds.includes(raw.motion as typeof motionIds[number])) throw new Error('pack.suggest.motion: unknown preset');
    suggest = { ...raw } as StylePack['suggest'];
  }
  return { version: 1, name: value.name as string, tokens: { ...appearanceSchema.style.defaults, ...tokens }, ...(suggest ? { suggest } : {}) } as StylePack;
}
export function parseEasing(input: unknown): Easing {
  if (typeof input === 'string' && (appearanceSchema.motion.easing.includes(input) || /^steps\((?:[2-9]|1[0-2])\)$/.test(input))) return input as Easing;
  if (Array.isArray(input) && input.length === 4 && input.every((n, i) => typeof n === 'number' && Number.isFinite(n) && n >= (i % 2 === 0 ? 0 : -2) && n <= (i % 2 === 0 ? 1 : 2))) return [...input] as Easing;
  throw new Error('easing: expected a named curve, steps(2–12), or four valid bezier coordinates');
}
export function parseMotionGroup(input: unknown, group: MotionGroup): MotionParameters {
  const value = object(input, `pack.groups.${group}`);
  fields(value, group === 'waveform' ? ['effect', 'duration', 'easing', 'progress'] : ['effect', 'duration', 'easing'], `pack.groups.${group}`);
  const defaults = appearanceSchema.motion.defaults.groups[group];
  const result = { ...defaults, ...value };
  const definition = appearanceSchema.motion.groups[group];
  if (!definition.effects.includes(result.effect as never)) throw new Error(`pack.groups.${group}.effect: unsupported effect`);
  if (typeof result.duration !== 'number' || !Number.isFinite(result.duration) || result.duration < 0 || result.duration > definition.maxDuration) throw new Error(`pack.groups.${group}.duration: expected 0–${definition.maxDuration}ms`);
  result.easing = parseEasing(result.easing);
  if (group === 'waveform' && !['smooth', 'stepped'].includes(String(result.progress))) throw new Error('pack.groups.waveform.progress: expected smooth or stepped');
  return result as MotionParameters;
}
export function parseMotionPack(input: unknown): MotionPack {
  const value = envelope(input, appearanceSchema.motion.fields);
  const groups = object(value.groups, 'pack.groups'); fields(groups, motionGroups, 'pack.groups');
  return { version: 1, name: value.name as string, groups: Object.fromEntries(motionGroups.map(group => [group, parseMotionGroup(groups[group] ?? {}, group)])) as MotionPack['groups'] };
}
export function parsePack<A extends AppearanceAxis>(axis: A, input: unknown): AppearancePacks[A] {
  return (axis === 'style' ? parseStylePack(input) : axis === 'colors' ? parseColorPack(input) : parseMotionPack(input)) as AppearancePacks[A];
}
/** Failed writes are atomic: no token is applied until the complete pack is valid. */
export function createPackLoader<A extends AppearanceAxis>(axis: A, initial: AppearancePacks[A], warn: (message: string) => void = console.warn) {
  let current = parsePack(axis, initial);
  return {
    get current() { return current; },
    load(input: unknown): { ok: true; pack: AppearancePacks[A] } | { ok: false; pack: AppearancePacks[A]; error: string } {
      try { const next = parsePack(axis, typeof input === 'string' ? JSON.parse(input) : input); current = next; return { ok: true, pack: current }; }
      catch (error) { const message = `Appearance ${axis}: ${error instanceof Error ? error.message : String(error)}; last valid pack retained`; warn(message); return { ok: false, pack: current, error: message }; }
    },
  };
}
