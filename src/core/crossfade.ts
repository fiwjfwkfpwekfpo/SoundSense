import type { RepeatMode, Track } from './types';
export function equalPower(progress: number): { from: number; to: number } {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return { from: Math.cos(p * Math.PI / 2), to: Math.sin(p * Math.PI / 2) };
}
/** End is exclusive. All-silence waves use the full track rather than a zero span. */
export function audibleRange(samples: readonly number[], duration: number, threshold = .035): { start: number; end: number } {
  if (!samples.length || duration <= 0) return { start: 0, end: Math.max(0, duration) };
  const first = samples.findIndex(value => Number.isFinite(value) && value > threshold);
  if (first < 0) return { start: 0, end: duration };
  let last = samples.length - 1; while (last > first && !(samples[last]! > threshold)) last--;
  return { start: first / samples.length * duration, end: (last + 1) / samples.length * duration };
}
export interface CrossfadePlan { fromStart: number; fromEnd: number; toStart: number; duration: number }
export function planCrossfade(options: { from: Track; to: Track; fromWave: readonly number[]; toWave: readonly number[]; seconds: number; manual?: boolean; repeat: RepeatMode; sameAlbumGapless: boolean }): CrossfadePlan | null {
  const { from, to } = options;
  if (options.manual || options.repeat === 'one' || from.id === to.id || options.seconds <= 0 || options.sameAlbumGapless && from.albumId && from.albumId === to.albumId) return null;
  const a = audibleRange(options.fromWave, from.duration), b = audibleRange(options.toWave, to.duration);
  const duration = Math.min(12, options.seconds, a.end - a.start, b.end - b.start);
  return duration > 0 ? { fromStart: a.end - duration, fromEnd: a.end, toStart: b.start, duration } : null;
}
