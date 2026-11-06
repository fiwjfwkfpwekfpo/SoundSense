import { fromQuickshellPack } from './quickshell';
import { channels, composite, contrast, mix, toHex } from './contrast';
import { paletteRoles } from './schema';
import type { ColorPack, PaletteRole } from './schema';
export interface PaletteCorrection { role: PaletteRole; before: string; after: string }
/** Extract literal color properties only; no QML is evaluated. */
export function readColorLiterals(qml: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of qml.matchAll(/(?:readonly\s+)?property\s+color\s+(\w+)\s*:\s*["'](#[\da-f]{6}(?:[\da-f]{2})?)["']/gi)) {
    if (paletteRoles.includes(match[1] as PaletteRole)) result[match[1]!] = match[2]!;
  }
  if (!result.mainBg || !result.accent) throw new Error('Missing mainBg/accent color literals');
  // The shell derives absent roles from its main background and border.
  result.barBg ??= result.mainBg;
  result.borderLight ??= result.border!;
  result.bgOverlay ??= result.mainBg;
  return result;
}
export function importPalette(input: unknown, name: string): { pack: ColorPack; corrections: PaletteCorrection[]; compositedMainBg: string } {
  const pack = { ...fromQuickshellPack(input), name };
  const main = channels(pack.palette.mainBg);
  // Black is represented as channels, keeping literals confined to preset JSON.
  pack.palette = { ...pack.palette, mainBg: composite(pack.palette.mainBg, toHex([0, 0, 0, 1])) };
  const surfaces = [pack.palette.mainBg, pack.palette.cardBg, pack.palette.cardHover, composite(pack.palette.barBg, pack.palette.mainBg)];
  const corrections: PaletteCorrection[] = [];
  for (const role of ['text', 'textMuted', 'accentMutedText', 'danger', 'warning', 'success', 'textOnAccent'] as const) {
    const backgrounds = role === 'textOnAccent' ? [pack.palette.accent] : surfaces;
    const before = pack.palette[role];
    if (backgrounds.every(background => contrast(before, background) >= 4.5)) continue;
    const endpoint = contrast(toHex([255, 255, 255, 1]), backgrounds[0]!) >= contrast(toHex([0, 0, 0, 1]), backgrounds[0]!) ? toHex([255, 255, 255, 1]) : toHex([0, 0, 0, 1]);
    let lo = 0, hi = 1;
    for (let i = 0; i < 20; i++) { const amount = (lo + hi) / 2; if (backgrounds.every(background => contrast(mix(before, endpoint, amount), background) >= 4.5)) hi = amount; else lo = amount; }
    pack.palette[role] = mix(before, endpoint, hi); corrections.push({ role, before, after: pack.palette[role] });
  }
  return { pack, corrections, compositedMainBg: main[3] < 1 ? pack.palette.mainBg : '' };
}
