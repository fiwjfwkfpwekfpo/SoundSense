import { appearanceSchema } from './schema';
import type { ColorPack } from './schema';
import { composite, luminance } from './contrast';
import { parseColorPack } from './validate';

/** Read inert palette data only. Qt stores eight-digit colors as AARRGGBB. */
export function fromQuickshellPack(input: unknown): ColorPack {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Quickshell pack: expected an object');
  const palette = (input as Record<string, unknown>).palette;
  if (!palette || typeof palette !== 'object' || Array.isArray(palette)) throw new Error('Quickshell pack.palette: expected an object');
  const converted = Object.fromEntries(Object.entries(palette).map(([role, color]) => [role,
    typeof color === 'string' && /^#[\da-f]{8}$/i.test(color)
      ? `#${color.slice(3)}${color.slice(1, 3)}`
      : color,
  ]));
  const pack = parseColorPack({ version: 1, name: 'Quickshell', palette: converted });
  const background = composite(pack.palette.mainBg, appearanceSchema.colors.defaults.palette.mainBg);
  // Quickshell has no scheme field. Use the visible background, including alpha.
  return { ...pack, scheme: luminance(background) > .179 ? 'light' : 'dark' };
}
