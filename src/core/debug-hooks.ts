/**
 * Optional observers for the beta trace tools. Production code calls them only through
 * optional chaining; nothing is installed unless the beta channel turns a trace on.
 */
export interface DebugHooks {
  /** Every native clock report (position, report time, backend). */
  clock?(slot: 'a' | 'b', sample: { position: number; playing: boolean; ended: boolean; buffering: boolean; rate?: number; at?: number; duration?: number; backend?: string; offline?: boolean }): void;
  /** Waveform motion corrections and rebuilds. */
  wave?(event: string, data: Record<string, number | string | boolean>): void;
  /** Lyrics sweep corrections and line changes. */
  lyrics?(event: string, data: Record<string, number | string | boolean>): void;
  /** One beat-visuals frame. */
  beat?(frame: { position: number; value: number; average: number; kick: number; level: number; beat: boolean; dt: number; rhythm: number; pulse: boolean; sparks: boolean; particles: number }): void;
}
export const debugHooks: DebugHooks = {};
