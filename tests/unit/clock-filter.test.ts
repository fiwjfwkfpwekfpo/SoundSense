import { describe, expect, it } from 'vitest';
import { filterClock, type FilteredClock } from '../../src/core/clock-filter';

const playing = (position: number) => ({ position, playing: true, ended: false, buffering: false, rate: 1.25 });

describe('media clock filter', () => {
  it('runs smoothly through the stalls and jumps of a Yandex stream report (beta trace "Фобия")', () => {
    // [report time ms, reported position s], copied from the trace: the position stalls, then jumps ahead.
    const reports: [number, number][] = [[39919, 13.931], [40191, 13.931], [40592, 13.931], [40993, 14.18], [41394, 14.18], [41795, 15.43], [42196, 15.93], [42597, 16.43]];
    let clock: FilteredClock | undefined, shown: number[] = [];
    for (const [at, position] of reports) { clock = filterClock(clock, playing(position), at, 1.25); shown.push(clock.position); }
    // Never moves backwards and never jumps by much more than wall time × rate.
    for (let i = 1; i < shown.length; i++) {
      const wall = (reports[i]![0] - reports[i - 1]![0]) / 1000 * 1.25, step = shown[i]! - shown[i - 1]!;
      expect(step).toBeGreaterThan(0);
      expect(Math.abs(step - wall)).toBeLessThanOrEqual(.08 + 1e-9);
    }
  });
  it('takes pauses, buffering and real jumps over directly', () => {
    let clock = filterClock(undefined, playing(10), 0, 1);
    clock = filterClock(clock, { ...playing(10.4), playing: false }, 400, 1); expect(clock.position).toBe(10.4);
    clock = filterClock(clock, playing(10.4), 800, 1);
    clock = filterClock(clock, playing(60), 1200, 1); expect(clock.position).toBe(60);
    clock = filterClock(clock, { ...playing(60.1), buffering: true }, 1600, 1); expect(clock.position).toBe(60.1);
  });
  it('converges on a steady offset', () => {
    let clock = filterClock(undefined, playing(0), 0, 1);
    for (let t = 400; t <= 8000; t += 400) clock = filterClock(clock, playing(t / 1000 * 1.25 - .3), t, 1.25);
    expect(Math.abs(clock.position - (8 * 1.25 - .3))).toBeLessThan(.01);
  });
});
