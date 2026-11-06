import type { Palette } from './schema';
export type Channels = [number, number, number, number];
export function channels(hex: string): Channels { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1]; }
export function toHex([r, g, b, a = 1]: Channels): string { return '#' + [r, g, b, ...(a < 1 ? [a * 255] : [])].map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join(''); }
export function composite(foreground: string, background: string): string {
  const a = channels(foreground), b = channels(background); return toHex([a[0] * a[3] + b[0] * (1 - a[3]), a[1] * a[3] + b[1] * (1 - a[3]), a[2] * a[3] + b[2] * (1 - a[3]), 1]);
}
export function mix(first: string, second: string, amount: number): string {
  const a = channels(first), b = channels(second), p = Math.max(0, Math.min(1, amount)); return toHex(a.map((n, i) => n * (1 - p) + b[i]! * p) as Channels);
}
export function luminance(hex: string): number { const c = channels(hex).slice(0, 3).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4); return c[0]! * .2126 + c[1]! * .7152 + c[2]! * .0722; }
export function contrast(first: string, second: string): number { const a = luminance(composite(first, second)), b = luminance(second); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }
export function ensureTextContrast(palette: Palette): Palette {
  const next = { ...palette }; const surfaces = [next.mainBg, next.cardBg, next.cardHover, composite(next.barBg, next.mainBg)];
  for (const role of ['text', 'textMuted'] as const) {
    for (let i = 0; i < 30 && surfaces.some(surface => contrast(next[role], surface) < 4.5); i++) next[role] = mix(next[role], next.accent, .14);
  }
  if (contrast(next.textOnAccent, next.accent) < 4.5) next.textOnAccent = contrast(next.mainBg, next.accent) >= 4.5 ? next.mainBg : next.text;
  return next;
}
