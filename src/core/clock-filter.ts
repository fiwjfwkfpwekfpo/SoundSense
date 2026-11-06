/**
 * Smooth media clock for animations and transitions.
 *
 * Some streams report a jittery position: on Yandex MP3 streams the native player's
 * position stalls for ~0.5 s and then jumps ahead, while the audio itself plays evenly
 * (beta trace, Nov 2026). Following every report made the waveform and lyrics jerk.
 *
 * While playing, the clock runs on wall time at the playback rate and is only nudged
 * towards the reported position (a fraction of the error, capped per report). Pauses,
 * buffering, rate changes and real jumps (seeks, a new track) are taken over directly.
 */
export interface ClockSample { position: number; playing: boolean; ended: boolean; buffering: boolean; rate?: number }
export interface FilteredClock extends ClockSample { sampledAt: number }

const JUMP_SECONDS = 2.5, GAIN = .2, MAX_STEP = .08;

export function filterClock(previous: FilteredClock | undefined, sample: ClockSample, sampledAt: number, rate: number): FilteredClock {
  const running = sample.playing && !sample.buffering && !sample.ended;
  const wasRunning = !!previous && previous.playing && !previous.buffering && !previous.ended && (previous.rate ?? 1) === rate;
  if (!previous || !running || !wasRunning) return { ...sample, rate, sampledAt };
  const predicted = previous.position + Math.max(0, sampledAt - previous.sampledAt) / 1000 * rate;
  const error = sample.position - predicted;
  if (Math.abs(error) > JUMP_SECONDS) return { ...sample, rate, sampledAt };
  const step = Math.max(-MAX_STEP, Math.min(MAX_STEP, error * GAIN));
  return { ...sample, rate, position: Math.max(0, predicted + step), sampledAt };
}
