import type { PlayerApi } from '../core/api';
/**
 * Frame-accurate playback position for animations (waveform, lyrics).
 * Reads the audio clock every frame and advances by real elapsed time; when a
 * native report corrects the clock, the error is absorbed by a slightly faster or
 * slower pace (never a step), and real seeks (> 0.75 s) snap immediately.
 */
export function createLivePosition(player: Pick<PlayerApi, 'livePosition' | 'getSnapshot'>) {
  let shown = player.getSnapshot().position, last = 0;
  return {
    read(now = performance.now()): number {
      const live = player.livePosition?.() ?? { position: player.getSnapshot().position, rate: 1, playing: false };
      const dt = last ? Math.min(.1, (now - last) / 1000) : 0; last = now;
      if (!live.playing) { shown = live.position; return shown; }
      // Like the Quickshell progress bar: the shown position only ever moves forward at the
      // playback rate. Small disagreements with the audio clock are absorbed by running up to
      // 6% faster or slower, so there is never a visible step back or jump; real seeks snap.
      const error = live.position - shown;
      if (Math.abs(error) > .75) { shown = live.position; return shown; }
      const pace = Math.max(-.06, Math.min(.06, error * .8));
      shown += dt * live.rate * (1 + pace);
      return shown;
    },
    reset(position: number) { shown = position; last = 0; },
  };
}
