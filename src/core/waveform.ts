/** Accepts both 0..140 service values and arbitrary local amplitudes. Invalid input is silence. */
export function normalizeSamples(samples: readonly number[]): number[] {
  let peak = 0;
  for (const sample of samples) if (Number.isFinite(sample)) peak = Math.max(peak, Math.abs(sample));
  return samples.map(sample => !peak || !Number.isFinite(sample) ? 0 : Math.min(1, Math.abs(sample) / peak));
}
/** Weighted area resampling preserves short transients when reducing sample count. */
export function resampleSamples(samples: readonly number[], count: number): number[] {
  const size = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (!size) return [];
  if (!samples.length) return Array<number>(size).fill(0);
  const values = normalizeSamples(samples);
  const step = values.length / size;
  return Array.from({ length: size }, (_, i) => {
    const start = i * step;
    const end = (i + 1) * step;
    let energy = 0;
    for (let j = Math.floor(start); j < Math.ceil(end); j++) {
      const weight = Math.min(j + 1, end) - Math.max(j, start);
      energy += (values[Math.min(j, values.length - 1)] ?? 0) ** 2 * Math.max(0, weight);
    }
    return Math.sqrt(energy / step);
  });
}
