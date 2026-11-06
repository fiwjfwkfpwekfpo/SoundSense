import lightFixture from '../fixtures/light-colors.json';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../fixtures/quickshell-theme.json';
import { appearanceSchema, motionGroups, paletteRoles, styleTokens } from '../../src/ui/appearance/schema';
import type { AppearanceAxis, AppearancePacks, Palette, PaletteRole } from '../../src/ui/appearance/schema';
import { colors, motions, styles } from '../../src/ui/appearance/presets';
import { createPackLoader, parseColorPack, parseEasing, parseMotionPack, parsePack, parseStylePack } from '../../src/ui/appearance/validate';
import { fromQuickshellPack } from '../../src/ui/appearance/quickshell';
import { resolveColors, resolveMotion } from '../../src/ui/appearance/resolver';
import { fromArtwork, sampleArtwork } from '../../src/ui/appearance/artwork';
import type { Artwork } from '../../src/core/types';
import { applyAppearance, colorVariables, createAppearanceLoader, registerPaletteProperties, styleVariables } from '../../src/ui/appearance/loader';
import { effectiveMotion } from '../../src/ui/appearance/motion/runtime';

describe('appearance package envelopes and independence', () => {
  const valid: AppearancePacks = { style: styles.standard!, colors: colors.mono!, motion: motions.smooth! };

  it.each(['style', 'colors', 'motion'] as const)('%s accepts partial data over defaults', axis => {
    const field = axis === 'style' ? 'tokens' : axis === 'colors' ? 'palette' : 'groups';
    const parsed = parsePack(axis, { version: 1, name: 'Partial', [field]: {} });
    expect(parsed.version).toBe(1);
    expect(parsed.name).toBe('Partial');
    if (axis === 'style') expect((parsed as AppearancePacks['style']).tokens).toEqual(appearanceSchema.style.defaults);
    if (axis === 'colors') expect((parsed as AppearancePacks['colors']).palette).toEqual(appearanceSchema.colors.defaults.palette);
    if (axis === 'motion') expect((parsed as AppearancePacks['motion']).groups).toEqual(appearanceSchema.motion.defaults.groups);
  });

  it.each(['style', 'colors', 'motion'] as const)('%s rejects unknown keys, types, versions, and missing payload', axis => {
    const pack = valid[axis];
    for (const input of [null, [], 'bad', {}, { ...pack, version: 2 }, { ...pack, name: 1 }, { ...pack, name: '' }, { ...pack, name: 'x'.repeat(81) }, { ...pack, name: 'bad\nname' }, { ...pack, extra: true }]) {
      expect(() => parsePack(axis, input)).toThrow();
    }
    expect(() => parsePack(axis, { version: 1, name: 'Missing body' })).toThrow();
  });

  it('rejects packages and keys belonging to another axis', () => {
    const axes = Object.keys(valid) as AppearanceAxis[];
    for (const target of axes) for (const source of axes) {
      if (target !== source) expect(() => parsePack(target, valid[source])).toThrow('unknown key');
    }
    expect(() => parseStylePack({ version: 1, name: 'Mixed', tokens: { mainBg: colors.mono!.palette.mainBg } })).toThrow('unknown key');
    expect(() => parseColorPack({ version: 1, name: 'Mixed', palette: { radiusS: 4 } })).toThrow('unknown key');
    expect(() => parseMotionPack({ version: 1, name: 'Mixed', groups: { radiusS: 4 } })).toThrow('unknown key');
  });

  it.each(['style', 'colors', 'motion'] as const)('%s loader retains the complete last valid package after a broken write', axis => {
    const warning = vi.fn();
    const loader = createPackLoader(axis, valid[axis], warning);
    const next = { ...valid[axis], name: 'New valid' };
    expect(loader.load(JSON.stringify(next))).toEqual({ ok: true, pack: next });
    for (const input of ['{', { ...next, invalid: true }, { ...next, version: 99 }]) {
      const result = loader.load(input);
      expect(result.ok).toBe(false);
      expect(result.pack).toEqual(next);
      expect(loader.current).toEqual(next);
    }
    expect(warning).toHaveBeenCalledTimes(3);
    expect(warning.mock.calls.every(([message]) => String(message).includes(axis) && String(message).includes('last valid pack retained'))).toBe(true);
    expect(warning.mock.calls[1]?.[0]).toContain('pack.invalid');
  });
});

describe('palette validator', () => {
  it('accepts exactly six/eight HEX digits and inherits missing roles/scheme', () => {
    const result = parseColorPack({ version: 1, name: 'Partial', palette: { mainBg: '#10203080', accent: '#AABBCC' } });
    expect(result.palette.mainBg).toBe('#10203080');
    expect(result.palette.accent).toBe('#AABBCC');
    expect(result.palette.cardBg).toBe(colors.mono!.palette.cardBg);
    expect(result.scheme).toBe('dark');
    expect(Object.keys(result.palette).sort()).toEqual([...paletteRoles].sort());
  });
  it.each(['#fff', '#ffff', '#12345', '#123456789', 'red', 'rgb(0 0 0)', 'url(https://example.invalid)', 42, null, {}])('rejects non-palette value %j', mainBg => {
    expect(() => parseColorPack({ version: 1, name: 'Bad', palette: { mainBg } })).toThrow('mainBg');
  });
  it('rejects an unknown role or invalid scheme', () => {
    expect(() => parseColorPack({ version: 1, name: 'Bad', palette: { unknown: '#abcdef' } })).toThrow('unknown key');
    expect(() => parseColorPack({ version: 1, name: 'Bad', scheme: 'auto', palette: {} })).toThrow('scheme');
  });
});

describe('style validator and registry', () => {
  it('accepts a partial numeric/font package and a partial recommendation', () => {
    const pack = parseStylePack({ version: 1, name: 'Partial', tokens: { radiusS: 0, fontBody: 'monospace' }, suggest: { colors: 'silver' } });
    expect(pack.tokens.radiusS).toBe(0);
    expect(pack.tokens.fontBody).toBe('monospace');
    expect(pack.tokens.space8).toBe(appearanceSchema.style.defaults.space8);
    expect(pack.suggest).toEqual({ colors: 'silver' });
  });
  for (const [key, definition] of Object.entries(styleTokens)) {
    if (definition.type !== 'number') continue;
    it(`${key} rejects wrong types and values outside its registered range`, () => {
      for (const token of ['1', null, NaN, Infinity, definition.min - 1, definition.max + 1]) expect(() => parseStylePack({ version: 1, name: 'Bad', tokens: { [key]: token } })).toThrow(key);
    });
  }
  it('rejects unsafe fonts, invalid weight increments, and invalid recommendations', () => {
    for (const fontBody of [24, '', 'x'.repeat(161), 'url(https://example.invalid/font)', 'monospace; color:red', '<script>']) expect(() => parseStylePack({ version: 1, name: 'Bad', tokens: { fontBody } })).toThrow('fontBody');
    expect(() => parseStylePack({ version: 1, name: 'Bad', tokens: { weightBold: 650 } })).toThrow('weightBold');
    expect(() => parseStylePack({ version: 1, name: 'Bad', tokens: {}, suggest: { colors: 'unknown' } })).toThrow('suggest.colors');
    expect(() => parseStylePack({ version: 1, name: 'Bad', tokens: {}, suggest: { motion: 'unknown' } })).toThrow('suggest.motion');
    expect(() => parseStylePack({ version: 1, name: 'Bad', tokens: {}, suggest: { style: 'retro' } })).toThrow('unknown key');
  });
});

describe('motion validator and registry', () => {
  it('merges individual group parameters over the defaults', () => {
    const pack = parseMotionPack({ version: 1, name: 'Partial', groups: { title: { effect: 'typewriter' } } });
    expect(pack.groups.title.effect).toBe('typewriter');
    expect(pack.groups.title.duration).toBe(motions.smooth!.groups.title.duration);
    expect(pack.groups.player).toEqual(motions.smooth!.groups.player);
  });
  it.each(motionGroups)('%s rejects unsupported effects, unknown fields, and invalid durations', group => {
    for (const data of [{ effect: 'arbitrary-effect' }, { effect: 2 }, { duration: '200' }, { duration: -1 }, { duration: Infinity }, { duration: appearanceSchema.motion.groups[group].maxDuration + 1 }, { color: 'accent' }]) {
      expect(() => parseMotionPack({ version: 1, name: 'Bad', groups: { [group]: data } })).toThrow();
    }
  });
  it('restricts waveform progress to waveform and its fixed list', () => {
    expect(parseMotionPack({ version: 1, name: 'Good', groups: { waveform: { progress: 'stepped' } } }).groups.waveform.progress).toBe('stepped');
    expect(() => parseMotionPack({ version: 1, name: 'Bad', groups: { waveform: { progress: 'continuous' } } })).toThrow('progress');
    expect(() => parseMotionPack({ version: 1, name: 'Bad', groups: { title: { progress: 'smooth' } } })).toThrow('unknown key');
  });
  it.each(['standard', 'emphasized', 'spring', 'linear', 'steps(2)', 'steps(12)', [0, -2, 1, 2]])('accepts enumerated easing %j', easing => expect(parseEasing(easing)).toEqual(easing));
  it.each(['ease', 'steps(1)', 'steps(13)', 'steps(2.5)', 'steps(02)', 'cubic-bezier(0,0,1,1)', 'url(x)', [0, 0, 1], [-.1, 0, 1, 1], [0, -2.01, 1, 1], [0, 0, 1.1, 1], [0, 0, 1, Infinity]])('rejects arbitrary/out-of-range easing %j', easing => expect(() => parseEasing(easing)).toThrow());
});

describe('built-in presets and combinations', () => {
  it('validates every source preset', () => {
    for (const pack of Object.values(styles)) expect(parseStylePack(pack)).toEqual(pack);
    for (const pack of Object.values(colors)) expect(parseColorPack(pack)).toEqual(pack);
    for (const pack of Object.values(motions)) expect(parseMotionPack(pack)).toEqual(pack);
    expect(Object.keys(styles)).toHaveLength(5);
    expect(Object.keys(colors)).toHaveLength(8);
    expect(Object.keys(motions)).toHaveLength(6);
  });
  for (const [styleId, style] of Object.entries(styles)) for (const [colorId, color] of Object.entries(colors)) {
    it(`resolves ${styleId} + ${colorId} and generates independent CSS variables`, () => {
      const combined = createAppearanceLoader().resolve({ appearanceStyle: styleId, appearanceColors: colorId, appearanceMotion: 'smooth' });
      expect(combined.errors).toEqual([]);
      expect(combined.style.tokens).toEqual(style.tokens);
      expect(combined.colors.palette).toEqual(color.palette);
      expect(combined.motion.groups).toEqual(motions.smooth!.groups);
      expect('palette' in combined.style).toBe(false);
      expect('tokens' in combined.colors).toBe(false);
      const form = styleVariables(combined.style);
      const palette = colorVariables(combined.colors);
      expect(Object.keys(form)).toHaveLength(Object.keys(styleTokens).length);
      expect(Object.keys(palette)).toHaveLength(paletteRoles.length);
      expect(Object.keys(form).some(key => key.startsWith('--palette-'))).toBe(false);
      expect(Object.keys(palette).every(key => key.startsWith('--palette-'))).toBe(true);
      expect(form['--radius-s']).toBe(`${style.tokens.radiusS}px`);
      expect(palette['--palette-mainBg']).toBe(color.palette.mainBg);
    });
  }
});

describe('Quickshell palette adapter', () => {
  it('converts the exact fixture Qt alpha order and fills omitted roles', () => {
    const pack = fromQuickshellPack(fixture);
    expect(pack.palette.mainBg).toBe('#0f0e1cd8');
    expect(pack.palette.bgOverlay).toBe('#0a0913b0');
    expect(pack.palette.cardBg).toBe(fixture.palette.cardBg);
    expect(pack.palette.barBg).toBe(colors.mono!.palette.barBg);
    expect(pack.version).toBe(1);
    expect('skin' in pack).toBe(false);
    expect('tokens' in pack).toBe(false);
  });
  it('ignores all outer metadata and never transfers Qt shape or tokens', () => {
    const palette = { mainBg: '#80AABBCC', accent: '#123456' };
    const result = fromQuickshellPack({ version: 999, skin: 'anything', layout: null, tokens: { radiusS: 'invalid' }, arbitrary: true, palette });
    expect(result).toEqual(fromQuickshellPack({ palette }));
    expect(result.palette.mainBg).toBe('#AABBCC80');
    expect(palette.mainBg).toBe('#80AABBCC');
  });
  it('infers a light or dark scheme from the visible background instead of outer metadata', () => {
    expect(fromQuickshellPack({ palette: { mainBg: '#f6f2ea' }, scheme: 'dark' }).scheme).toBe('light');
    expect(fromQuickshellPack({ palette: { mainBg: '#080b08' }, scheme: 'light' }).scheme).toBe('dark');
    expect(fromQuickshellPack({ palette: { mainBg: '#f0f6f2ea' } }).scheme).toBe('light');
    expect(fromQuickshellPack({ palette: { mainBg: '#00ffffff' } }).scheme).toBe('dark');
    expect(fromQuickshellPack(fixture).scheme).toBe('dark');
  });
  it.each([null, [], {}, { palette: null }, { palette: [] }, { palette: { invalidRole: '#123456' } }, { palette: { accent: '#abc' } }, { palette: { accent: 4 } }])('rejects invalid palette %j', input => expect(() => fromQuickshellPack(input)).toThrow());
});

type Rgba = readonly [number, number, number, number];
function rgba(value: string): Rgba {
  return [parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255, value.length === 9 ? parseInt(value.slice(7, 9), 16) / 255 : 1];
}
function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  return [0, 1, 2].map(channel => (foreground[channel]! * foreground[3] + background[channel]! * background[3] * (1 - foreground[3])) / (alpha || 1)).concat(alpha) as unknown as Rgba;
}
function luminance(value: Rgba): number {
  const linear = value.slice(0, 3).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return linear[0]! * .2126 + linear[1]! * .7152 + linear[2]! * .0722;
}
function contrast(foreground: string, background: string, mainBg: string): number {
  const backdrop = composite(rgba(background), rgba(mainBg));
  const text = composite(rgba(foreground), backdrop);
  const [light, dark] = [luminance(text), luminance(backdrop)].sort((a, b) => b - a);
  return (light! + .05) / (dark! + .05);
}
function expectReadable(palette: Palette, name: string) {
  const backgrounds: PaletteRole[] = ['mainBg', 'cardBg', 'cardHover', 'barBg'];
  for (const textRole of ['text', 'textMuted'] as const) for (const backgroundRole of backgrounds) {
    expect(contrast(palette[textRole], palette[backgroundRole], palette.mainBg), `${name}: ${textRole} on ${backgroundRole}`).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrast(palette.textOnAccent, palette.accent, palette.mainBg), `${name}: textOnAccent on accent`).toBeGreaterThanOrEqual(4.5);
}
describe('palette contrast with alpha compositing', () => {
  it('handles alpha as CSS RRGGBBAA, including foreground and surface alpha', () => {
    expect(contrast('#ffffff', '#000000', '#000000')).toBeCloseTo(21);
    expect(contrast('#ffffff80', '#000000', '#000000')).toBeCloseTo(5.32, 1);
    expect(contrast('#ffffff', '#ffffff80', '#000000')).toBeLessThan(4.5);
  });
  it.each(Object.entries(colors))('%s has readable body/muted/action text', (name, pack) => expectReadable(pack.palette, name));
});

describe('independent selection priorities', () => {
  const noSuggestion = parseStylePack({ version: 1, name: 'No suggestion', tokens: {} });
  it('keeps a manual palette above each style recommendation and the auto-suggestion switch', () => {
    for (const style of Object.values(styles)) for (const enabled of [true, false]) expect(resolveColors('silver', style, enabled)).toEqual({ id: 'silver', source: 'manual' });
  });
  it('uses a palette suggestion, or monochrome when absent/disabled', () => {
    expect(resolveColors('auto', styles.retro!)).toEqual({ id: 'lime', source: 'style' });
    expect(resolveColors(undefined, styles.retro!)).toEqual({ id: 'lime', source: 'style' });
    expect(resolveColors('auto', noSuggestion)).toEqual({ id: 'cover', source: 'default' });
    expect(resolveColors('auto', styles.retro!, false)).toEqual({ id: 'cover', source: 'default' });
  });
  it('uses manual group before manual common before style suggestion', () => {
    const result = resolveMotion('spring', { title: 'retro', cover: 'auto' }, styles.retro!);
    expect(result.common).toEqual({ id: 'spring', source: 'manual' });
    expect(result.groups.title).toEqual({ id: 'retro', source: 'manual' });
    for (const group of motionGroups.filter(group => group !== 'title')) expect(result.groups[group]).toEqual({ id: 'spring', source: 'manual' });
  });
  it('uses the style motion suggestion before the smooth default and respects disabled suggestions', () => {
    const suggested = resolveMotion('auto', {}, styles.retro!);
    expect(suggested.common).toEqual({ id: 'retro', source: 'style' });
    for (const group of motionGroups) expect(suggested.groups[group]).toEqual(suggested.common);
    expect(resolveMotion('auto', {}, noSuggestion).common).toEqual({ id: 'smooth', source: 'default' });
    expect(resolveMotion('auto', {}, styles.retro!, false).common).toEqual({ id: 'smooth', source: 'default' });
  });
  it('applies reduced motion only to groups without a manual common/group selection', () => {
    const system = resolveMotion('auto', { title: 'retro' }, styles.retro!, true, true);
    expect(system.common).toEqual({ id: 'minimal', source: 'system' });
    expect(system.groups.title).toEqual({ id: 'retro', source: 'manual' });
    expect(system.groups.player).toEqual({ id: 'minimal', source: 'system' });
    const manual = resolveMotion('spring', { title: 'retro' }, styles.retro!, true, true);
    expect(manual.common).toEqual({ id: 'spring', source: 'manual' });
    expect(manual.groups.title.id).toBe('retro');
    expect(manual.groups.player.id).toBe('spring');
    expect(resolveMotion('off', {}, styles.standard!, true, true).common).toEqual({ id: 'off', source: 'manual' });
  });
  it('releasing manual choices restores each style source without changing another group', () => {
    const result = resolveMotion('auto', { title: 'auto', lyrics: 'spring' }, styles.retro!);
    expect(result.common.source).toBe('style');
    expect(result.groups.title).toEqual({ id: 'retro', source: 'style' });
    expect(result.groups.lyrics).toEqual({ id: 'spring', source: 'manual' });
    expect(resolveColors('auto', styles.retro!).source).toBe('style');
  });
});

describe('resolved CSS and motion runtime contract', () => {
  it('keeps smooth waveform progress when only the appearance effect is disabled', () => {
    const parameters = motions.minimal!.groups.waveform;
    expect(effectiveMotion('waveform', parameters, { speed: 1, lowPower: false }).duration).toBe(parameters.duration);
    expect(effectiveMotion('waveform', parameters, { speed: 1, lowPower: false, off: true }).duration).toBe(0);
  });
  it('registers each palette variable as an inheritable color once for smooth switching', () => {
    const registerProperty = vi.fn();
    vi.stubGlobal('CSS', { registerProperty });
    try {
      registerPaletteProperties(colors.mono!);
      registerPaletteProperties(colors.silver!);
      expect(registerProperty.mock.calls.filter(([property]) => String(property.name).startsWith('--palette-'))).toHaveLength(paletteRoles.length);
      expect(new Set(registerProperty.mock.calls.map(([property]) => property.name)).size).toBe(registerProperty.mock.calls.length);
      for (const role of paletteRoles) expect(registerProperty).toHaveBeenCalledWith({ name: `--palette-${role}`, syntax: '<color>', inherits: true, initialValue: colors.mono!.palette[role] });
    } finally { vi.unstubAllGlobals(); }
  });
  it('retains native insets/dock metrics while applying colors, shape, and group variables', () => {
    const properties = new Map<string, string>([['--inset-top', '48px'], ['--inset-bottom', '24px'], ['--dock-height', '178px']]);
    const attributes = new Map<string, string>();
    const target = { style: { getPropertyValue(key: string) { return properties.get(key) ?? ''; }, setProperty(key: string, value: string) { properties.set(key, value); }, colorScheme: '' }, setAttribute(key: string, value: string) { attributes.set(key, value); } } as unknown as HTMLElement;
    vi.stubGlobal('document', { documentElement: {} });
    try {
      const state = createAppearanceLoader().resolve({ appearanceStyle: 'retro', appearanceColors: 'custom', appearanceColorsCustom: JSON.stringify(lightFixture), appearanceMotion: 'spring', motionTitle: 'retro', motionSpeed: 2 });
      applyAppearance(state, 1.1, target);
      expect(properties.get('--inset-top')).toBe('48px');
      expect(properties.get('--inset-bottom')).toBe('24px');
      expect(properties.get('--dock-height')).toBe('178px');
      expect(properties.get('--radius-s')).toBe('0px');
      expect(properties.get('--palette-mainBg')).toBe(lightFixture.palette.mainBg);
      expect(properties.get('--motion-title-duration')).toBe(`${motions.retro!.groups.title.duration / 2}ms`);
      expect(properties.get('--motion-title-easing')).toMatch(/^steps\(/);
      expect(properties.get('--font-scale')).toBe('1.1');
      expect(attributes.get('data-motion-title')).toBe('split-flap');
      expect(attributes.get('data-color-scheme')).toBe('light');
      expect(target.style.colorScheme).toBe('light');
    } finally { vi.unstubAllGlobals(); }
  });
  it('applies speed to every duration and only replaces blur on low-power devices', () => {
    const parameters = { effect: 'blur', duration: 300, easing: 'standard' as const };
    expect(effectiveMotion('title', parameters, { speed: 2, lowPower: true })).toMatchObject({ effect: 'fade', duration: 150 });
    expect(effectiveMotion('title', parameters, { speed: .5, lowPower: false })).toMatchObject({ effect: 'blur', duration: 600 });
    expect(effectiveMotion('title', { ...parameters, effect: 'slide-up' }, { speed: 1, lowPower: true }).effect).toBe('slide-up');
    expect(effectiveMotion('title', parameters, { speed: 1, lowPower: false, off: true }).duration).toBe(0);
    expect(effectiveMotion('title', { ...parameters, effect: 'none' }, { speed: 1, lowPower: false }).duration).toBe(0);
  });
  it('does not apply a partially valid custom package or lose its previous resolved palette', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const loader = createAppearanceLoader();
      const values = { appearanceStyle: 'standard', appearanceColors: 'custom', appearanceMotion: 'smooth', appearanceColorsCustom: JSON.stringify({ version: 1, name: 'Custom', scheme: 'light', palette: { mainBg: '#eeeedd' } }) };
      const valid = loader.resolve(values);
      const broken = loader.resolve({ ...values, appearanceColorsCustom: JSON.stringify({ version: 1, name: 'Broken', palette: { mainBg: '#112233', unknown: '#445566' } }) });
      expect(broken.colors).toEqual(valid.colors);
      expect(broken.errors).toHaveLength(1);
      expect(broken.errors[0]).toContain('unknown key');
    } finally { warning.mockRestore(); }
  });
});

describe('cover palette contrast and determinism', () => {
  const variants: Artwork['variant'][] = ['ribbon', 'orbit', 'haze', 'terrain'];
  const seeds = [-23, 0, 1, 8, 17, 34, 35, 1009];
  for (const variant of variants) for (const seed of seeds) {
    it(`${variant}/${seed} produces readable text without modifying monochrome`, () => {
      const artwork = { seed, variant };
      const baseline = JSON.stringify(colors.mono);
      const first = fromArtwork(artwork);
      expect(parseColorPack(first)).toEqual(first);
      expectReadable(first.palette, `${variant}/${seed}`);
      expect(fromArtwork(artwork)).toEqual(first);
      expect(fromArtwork(artwork, sampleArtwork(artwork))).toEqual(first);
      expect(JSON.stringify(colors.mono)).toBe(baseline);
    });
  }
  it('varies extracted colors across generated variants and remains stable after other tracks', () => {
    const first = fromArtwork({ seed: 17, variant: 'ribbon' });
    const second = fromArtwork({ seed: 17, variant: 'haze' });
    expect(first.palette.accent).not.toBe(second.palette.accent);
    expect(fromArtwork({ seed: 17, variant: 'ribbon' })).toEqual(first);
  });
  it.each(['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#a17d42'])('keeps readable text when the actual sampler supplies %s', average => {
    for (const variant of variants) {
      const artwork = { seed: 19, variant };
      const pack = fromArtwork(artwork, average);
      expectReadable(pack.palette, `${variant}/${average}`);
      expect(fromArtwork(artwork, average)).toEqual(pack);
    }
  });
});
