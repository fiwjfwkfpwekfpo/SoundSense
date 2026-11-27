import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

function limiter() {
  const source = readFileSync(new URL('../../src/platform/output-limiter.worklet.js', import.meta.url), 'utf8');
  const context = { AudioWorkletProcessor: class { port = {}; }, sampleRate: 48000,
    registerProcessor: (_name: string, constructor: new () => unknown) => new constructor() };
  const node = runInNewContext(source, context);
  return (left: Float32Array, right: Float32Array) => {
    const out = [new Float32Array(left.length), new Float32Array(right.length)];
    node.process([[left, right]], [out]); return out;
  };
}
it('passes neutral stereo samples bit-for-bit after one render quantum', () => {
  const render = limiter();
  const left = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i * .083) * .96);
  const right = Float32Array.from(left, x => -x * .35);
  render(left, right);
  expect(render(right, left)).toEqual([left, right]);
});
it('catches isolated peaks and a boosted overlap and preserves the stereo ratio', () => {
  const render = limiter();
  for (let block = 0; block < 80; block++) {
    const left = Float32Array.from({ length: 128 }, (_, i) => i === 0 || i === 127 ? (block % 4 + 1) * 1.41 : .4);
    const [a, b] = render(left, Float32Array.from(left, x => -.5 * x));
    expect(Math.max(...a!.map(Math.abs))).toBeLessThanOrEqual(1);
    expect([...b!].every((sample, index) => sample === -.5 * a![index]!)).toBe(true);
  }
});
