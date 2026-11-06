export interface HapticsDriver { selectionStart(): Promise<void>; selectionChanged(): Promise<void>; selectionEnd(): Promise<void>; impact(strength: 'light' | 'medium'): Promise<void>; tick?(): Promise<void> }
export interface HapticsApi { pulse(): void; start(): void; wave(index: number, height: number): void; end(): void }
/** Scrubbing ticks once per waveform bar, like SoundCloud; only a tiny floor guards against bursts. */
export function createHaptics(driver: HapticsDriver, enabled: () => boolean, native: boolean, now = () => performance.now()): HapticsApi {
  let last = -Infinity, bar = -1;
  const run = (action: () => Promise<void>) => { if (native && enabled()) void action().catch(() => {}); };
  return {
    pulse: () => run(() => driver.impact('light')),
    start() { bar = -1; last = -Infinity; run(() => driver.selectionStart()); },
    wave(index) {
      if (bar === index) return; bar = index;
      if (now() - last < 8) return; last = now();
      run(() => driver.tick ? driver.tick() : driver.selectionChanged());
    },
    end: () => run(() => driver.selectionEnd()),
  };
}
