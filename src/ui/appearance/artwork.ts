import type { Artwork } from '../../core/types';
import { colors } from './presets';
import type { ColorPack, Palette } from './schema';
import { channels, ensureTextContrast, mix, toHex } from './contrast';

/** Immutable input stops: changing the current palette can never feed back into extraction. */
export function artworkStops(palette: Palette = colors.mono!.palette) {
  return { base: mix(palette.cardBg, palette.mainBg, .1), mid: mix(palette.cardHover, palette.textMuted, .34), light: mix(palette.textMuted, palette.text, .6), shine: mix(palette.textMuted, palette.text, .9) };
}
/** Deterministic fallback samples from the generated gradient, before the SVG is mounted. */
export function sampleArtwork(artwork: Artwork): string {
  const stops = artworkStops(); const offset = ((artwork.seed % 35) + 35) % 35 / 35;
  const center = artwork.variant === 'ribbon' ? mix(stops.mid, stops.shine, .18 + offset * .22) : artwork.variant === 'orbit' ? mix(stops.mid, stops.light, .24 + offset * .16) : artwork.variant === 'haze' ? mix(stops.base, stops.mid, .48 + offset * .22) : mix(stops.base, stops.light, .16 + offset * .18);
  return mix(stops.base, center, .64);
}
/** Samples the actual generated SVG at 32² pixels using immutable monochrome stops. */
export async function extractArtwork(svg: SVGSVGElement | HTMLImageElement, artwork: Artwork): Promise<string> {
  if (svg instanceof HTMLImageElement) { const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32; const context = canvas.getContext('2d'); if (!context) return sampleArtwork(artwork); context.drawImage(svg, 0, 0, 32, 32); const pixels = context.getImageData(0, 0, 32, 32).data, mean: [number, number, number, number] = [0, 0, 0, 1]; for (let index = 0; index < pixels.length; index += 4) for (let channel = 0; channel < 3; channel++) mean[channel]! += pixels[index + channel]! / 1024; return toHex(mean); }
  const clone = svg.cloneNode(true) as SVGSVGElement; const stops = artworkStops();
  clone.removeAttribute('style'); clone.removeAttribute('aria-hidden');
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', '64'); clone.setAttribute('height', '64');
  clone.querySelectorAll('stop').forEach(stop => { const role = ['base', 'mid', 'light', 'shine'].find(name => stop.classList.contains(name)) as keyof typeof stops | undefined; if (role) stop.setAttribute('stop-color', stops[role]); });
  const styles: Record<string, Record<string, string>> = {
    'ribbon-line': { fill: 'none', stroke: stops.shine, 'stroke-width': '1', opacity: '.5' },
    'ribbon-haze': { fill: 'none', stroke: stops.light, 'stroke-width': '20', opacity: '.24' },
    orbit: { fill: stops.light }, 'orbit-ring': { fill: 'none', stroke: stops.light, 'stroke-width': '1', opacity: '.5' },
    horizon: { fill: stops.base }, haze: { fill: stops.base }, 'haze-line': { fill: 'none', stroke: stops.mid, opacity: '.65' },
    terrain: { fill: stops.base, stroke: stops.light, 'stroke-width': '1' }, grain: { opacity: '.16', style: 'mix-blend-mode:screen' },
  };
  for (const [name, properties] of Object.entries(styles)) clone.querySelectorAll(`.${name}`).forEach(node => { for (const [key, value] of Object.entries(properties)) node.setAttribute(key, value); });
  clone.querySelectorAll('.terrain').forEach((node, index) => node.setAttribute('opacity', String(.5 + index * .05)));
  clone.querySelectorAll('[style]').forEach(node => { if (node.classList.contains('terrain')) node.removeAttribute('style'); });
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext('2d'); if (!context) return sampleArtwork(artwork);
    context.drawImage(image, 0, 0, 32, 32); const pixels = context.getImageData(0, 0, 32, 32).data;
    const mean: [number, number, number, number] = [0, 0, 0, 1];
    for (let i = 0; i < pixels.length; i += 4) for (let channel = 0; channel < 3; channel++) mean[channel]! += pixels[i + channel]! / 1024;
    return toHex(mean);
  } finally { URL.revokeObjectURL(url); }
}
export function fromArtwork(artwork: Artwork, average = sampleArtwork(artwork)): ColorPack {
  const base = colors.mono!; const palette = base.palette;
  const accent = mix(average, palette.text, .78);
  return { ...base, name: 'Обложка', palette: ensureTextContrast({ ...palette, accent, mainBg: mix(average, palette.mainBg, .86), cardBg: mix(average, palette.cardBg, .74), cardHover: mix(average, palette.cardHover, .78), textOnAccent: palette.mainBg }) };
}
