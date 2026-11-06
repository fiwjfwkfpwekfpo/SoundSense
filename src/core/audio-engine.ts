import type { Track, PlaybackFailureReason } from './types';
export class PlaybackFailure extends Error {
  constructor(readonly reason: PlaybackFailureReason, message: string, readonly status?: number, readonly code?: string) { super(message); this.name = 'PlaybackFailure'; }
}
export function playbackFailureReason(error: unknown): PlaybackFailureReason {
  if (error instanceof PlaybackFailure) return error.reason;
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {}, status = Number(value.status ?? /^HTTP_(\d+)$/.exec(String(value.code))?.[1]), message = String(value.message ?? error);
  return value.kind === 'auth' || value.kind === 'expired' ? 'auth' : value.kind === 'region' || status === 451 ? 'region' : status === 401 || status === 403 ? 'auth' : value.kind === 'not_found' || status === 404 ? 'unavailable' : /timed?\s*out|timeout/i.test(message) ? 'timeout' : /drm|widevine|fairplay/i.test(message) ? 'protected' : /network|fetch|connection|http/i.test(message) ? 'network' : /content:|file|permission/i.test(message) ? 'file' : 'decoder';
}
export type AudioSlot = 'a' | 'b';
export interface AudioStream { uri: string; headers?: Readonly<Record<string, string>> }
export interface AudioEvent {
  type: 'error' | 'pause' | 'play' | 'next' | 'previous' | 'like' | 'seek' | 'advanced'; slot?: AudioSlot; liked?: boolean; position?: number; reason?: PlaybackFailureReason; message?: string; code?: string; status?: number;
  /** "advanced": the engine switched from `slot` to `to` on its own (armed hand-off). */
  to?: AudioSlot; trackId?: string; seconds?: number; manual?: boolean; at?: number;
}
/** Where the engine may switch to the armed next slot by itself: crossfade window (media seconds of the current slot) or the end. */
export interface HandOffPlan { track: Track; at: number; until: number; duration: number; position: number }
/** Each slot maps to one source + GainNode in a future real engine. No UI dependency. */
export interface AudioEngine {
  /** Select metadata even when a prepared slot is reused while paused. */
  select?(slot: AudioSlot, track: Track): void;
  prepare(slot: AudioSlot, track: Track, intent?: 'play' | 'preload'): Promise<void>;
  start(slot: AudioSlot, position: number): void;
  pause(slot: AudioSlot): void;
  stop(slot: AudioSlot): void;
  seek(slot: AudioSlot, position: number): void;
  gain(slot: AudioSlot, value: number): void;
  /** Loop the slot natively (repeat one): keeps working while the UI thread is frozen in the background. */
  loop?(slot: AudioSlot, enabled: boolean): void;
  processing?(slot: AudioSlot, values: import('./audio-settings').AudioProcessing): void;
  /** Schedule a short envelope on the audio clock, even while JS timers are throttled. */
  fadeOut(slot: AudioSlot, seconds: number): void;
  /** The media clock is authoritative: buffering must never advance a pretend playhead. */
  clock?(slot: AudioSlot): { position: number; playing: boolean; ended: boolean; buffering: boolean; rate?: number };
  crossfade?(from: AudioSlot, to: AudioSlot, seconds: number, position: number): void;
  /**
   * Arm a native switch to the prepared `to` slot (null disarms). The engine then crossfades or
   * starts it by itself and reports "advanced", so a frozen/throttled WebView cannot miss it.
   */
  arm?(from: AudioSlot, to: AudioSlot, plan: HandOffPlan | null): void;
  subscribe?(listener: (event: AudioEvent) => void): () => void;
  dispose(): void;
}
