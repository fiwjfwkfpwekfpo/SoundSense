import { describe, expect, it } from 'vitest';
import { normalizeSamples, resampleSamples } from '../../src/core/waveform';
import { generateWaveform } from '../../src/mock/data';
describe('normalization', () => {
  it('normalizes service samples', () => expect(normalizeSamples([0, 70, 140])).toEqual([0, .5, 1]));
  it('handles local samples and negative amplitudes', () => expect(normalizeSamples([-.2, .4, .8])).toEqual([.25, .5, 1]));
  it('treats nonfinite values as silence', () => expect(normalizeSamples([NaN, Infinity, -Infinity, 2])).toEqual([0, 0, 0, 1]));
  it('handles silence and empty input', () => { expect(normalizeSamples([0, 0])).toEqual([0, 0]); expect(normalizeSamples([])).toEqual([]); });
});
describe('resampling', () => {
  it('preserves RMS energy when downsampling', () => expect(resampleSamples([0, 1, 0, 1], 2)).toEqual([Math.SQRT1_2, Math.SQRT1_2]));
  it('upsamples a single value', () => { const values = resampleSamples([140], 5); expect(values).toHaveLength(5); values.forEach(value => expect(value).toBeCloseTo(1, 12)); });
  it('does not invent peaks in silence', () => expect(resampleSamples([], 3)).toEqual([0, 0, 0]));
  it('accepts invalid target widths', () => { expect(resampleSamples([1], 0)).toEqual([]); expect(resampleSamples([1], NaN)).toEqual([]); });
  it('supports noninteger sample ratios without invalid output', () => { const values = resampleSamples([0, 1, .1], 77); expect(values).toHaveLength(77); expect(values.every(v => Number.isFinite(v) && v >= 0 && v <= 1.000001)).toBe(true); });
  it('creates deterministic musical envelopes', () => {
    const wave = generateWaveform(42); expect(wave).toEqual(generateWaveform(42)); expect(wave).toHaveLength(1000);
    const average = (start: number, end: number) => wave.slice(start, end).reduce((a, b) => a + b, 0) / (end - start);
    expect(average(280, 450)).toBeGreaterThan(average(0, 70));
  });
});
