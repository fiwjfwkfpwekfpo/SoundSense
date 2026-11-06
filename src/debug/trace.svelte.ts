import type { AppApi } from '../core/api';
import type { PlayerState } from '../core/types';
import { debugHooks } from '../core/debug-hooks';

/**
 * Beta trace tools for problems that only show on some tracks:
 *
 * - "clock": every native position report is checked against the previous one. A report that
 *   lands away from where the clock should be (> 40 ms) is a clock jump; corrections of the
 *   waveform and lyrics animations, position jumps of the player state and long frames are
 *   counted next to it, so the export shows whether a visible jerk came from the audio clock,
 *   from a stalled frame or from the animation code itself.
 * - "beat": every frame of the beat visuals (bass level, threshold, detected beats, glow level).
 *
 * Detailed events go to the journal as they happen (bounded per track); each track gets one
 * summary when it changes, when a trace is switched off and right before an export.
 */
const STORAGE_KEY = 'ss_trace_v1', MAX_EVENTS_PER_TRACK = 12, JUMP_SECONDS = .04, SEEK_SECONDS = 1.5;
type Level = 'info' | 'warn';
interface Sample { t: number; position: number; at: number; latency: number; residual: number }
const quantile = (values: readonly number[], q: number) => { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!; };
const round = (value: number, digits = 0) => { const scale = 10 ** digits; return Math.round(value * scale) / scale; };
const push = (list: number[], value: number, limit = 4000) => { list.push(value); if (list.length > limit) list.splice(0, list.length - limit); };

class ClockTrack {
  started = performance.now(); samples = 0; jumps = 0; seeks = 0; stateJumps = 0; events = 0;
  latencies: number[] = []; intervals: number[] = []; residuals: number[] = [];
  waveCorrections = 0; waveMaxDrift = 0; waveRebuilds: Record<string, number> = {}; lyricsCorrections = 0; lyricsMaxDrift = 0; lyricsBack = 0;
  frames = 0; longFrames = 0; worstFrame = 0;
  backend = ''; offline = false; rate = 1; mediaDuration = 0;
  recent: Sample[] = []; lastJumpAt = -1e9; lastLongFrameAt = -1e9;
  constructor(readonly trackId: string) {}
}
class BeatTrack {
  started = performance.now(); frames = 0; missing = 0; beats = 0; early = 0; dtSum = 0; valueSum = 0; averageSum = 0; levelSum = 0; levelMax = 0; kickMax = 0; particlesMax = 0;
  rhythm = 0; pulse = false; sparks = false; lastBeatPosition = -1; gaps: number[] = []; firstPosition = -1;
  constructor(readonly trackId: string) {}
}
export interface TraceHudState { trackId: string; backend: string; rate: number; latency: number; residual: number; jumps: number; waveCorrections: number; lyricsCorrections: number; stateJumps: number; longFrames: number; samples: number; beats: number; rhythm: number; expected: number }
export interface BeatPoint { value: number; threshold: number; level: number; beat: boolean }

export class Trace {
  clock = $state(false); beat = $state(false); hud = $state(false);
  hudState = $state.raw<TraceHudState | null>(null);
  /** Recent beat frames for the overlay graph (not reactive: drawn by the overlay itself). */
  readonly beatPoints: BeatPoint[] = [];
  private clockTrack: ClockTrack | undefined; private beatTrack: BeatTrack | undefined;
  private previous = new Map<'a' | 'b', { position: number; at: number; playing: boolean; t: number }>();
  private stateSample: { trackId: string | null; position: number; t: number; playing: boolean } | undefined;
  private unsubscribePlayer: (() => void) | undefined; private frame = 0; private lastFrame = 0; private hudTimer: ReturnType<typeof setInterval> | undefined;
  constructor(private api: AppApi, private context: () => { settings: Record<string, unknown>; streams: Readonly<Record<string, string>>; motion: number }) {
    try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'); this.clock = saved.clock === true; this.beat = saved.beat === true; this.hud = saved.hud === true; } catch { /* Defaults: off. */ }
    this.apply();
  }
  set(kind: 'clock' | 'beat' | 'hud', enabled: boolean) {
    if (kind === 'clock' && !enabled) this.finishClock();
    if (kind === 'beat' && !enabled) this.finishBeat();
    this[kind] = enabled;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ clock: this.clock, beat: this.beat, hud: this.hud })); } catch { /* Session only. */ }
    this.apply();
  }
  /** Writes the summaries of the tracks being traced now (before an export). */
  flush() { this.finishClock(); this.finishBeat(); }
  dispose() { this.flush(); this.clock = false; this.beat = false; this.hud = false; this.apply(); }

  private record(event: string, data: Record<string, unknown>, level: Level = 'info') { this.api.diagnostics?.record('trace', event, data, level); }
  private currentTrack() { return this.api.player.getSnapshot().trackId ?? ''; }
  private apply() {
    const any = this.clock || this.beat;
    debugHooks.clock = this.clock ? (slot, sample) => this.onClock(slot, sample) : undefined;
    debugHooks.wave = this.clock ? (event, data) => this.onWave(event, data) : undefined;
    debugHooks.lyrics = this.clock ? (event, data) => this.onLyrics(event, data) : undefined;
    debugHooks.beat = this.beat ? frame => this.onBeat(frame) : undefined;
    if (any && !this.unsubscribePlayer) this.unsubscribePlayer = this.api.player.subscribe(state => this.onState(state));
    if (!any && this.unsubscribePlayer) { this.unsubscribePlayer(); this.unsubscribePlayer = undefined; }
    if (this.clock && !this.frame) { this.lastFrame = 0; this.frame = requestAnimationFrame(this.onFrame); }
    if (!this.clock && this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
    if (this.hud && any && !this.hudTimer) this.hudTimer = setInterval(() => this.refreshHud(), 250);
    if ((!this.hud || !any) && this.hudTimer) { clearInterval(this.hudTimer); this.hudTimer = undefined; this.hudState = null; }
  }
  private clockFor(trackId: string) {
    if (this.clockTrack?.trackId !== trackId) { this.finishClock(); if (trackId) this.clockTrack = new ClockTrack(trackId); }
    return this.clockTrack;
  }
  private beatFor(trackId: string) {
    if (this.beatTrack?.trackId !== trackId) { this.finishBeat(); if (trackId) this.beatTrack = new BeatTrack(trackId); }
    return this.beatTrack;
  }
  private onState(state: PlayerState) {
    if (state.trackId !== this.clockTrack?.trackId && this.clock) this.clockFor(state.trackId ?? '');
    if (state.trackId !== this.beatTrack?.trackId && this.beat) this.beatFor(state.trackId ?? '');
    // Position jumps of the player state itself (what the plain waveform and progress bar draw).
    const now = performance.now(), last = this.stateSample, running = state.playing && !state.resolving && !state.crossfade;
    if (this.clock && last && running && last.playing && last.trackId === state.trackId) {
      const live = this.api.player.livePosition?.(), rate = live?.rate ?? 1, dt = (now - last.t) / 1000;
      const error = state.position - last.position - dt * rate;
      if (dt < 1 && Math.abs(error) > .15 && Math.abs(error) < SEEK_SECONDS) {
        const track = this.clockTrack; if (track) { track.stateJumps++; this.detail(track, 'state.jump', { errorMs: round(error * 1000), dtMs: round(dt * 1000), position: round(state.position, 3) }); }
      }
    }
    this.stateSample = { trackId: state.trackId, position: state.position, t: now, playing: running };
  }
  private onClock(slot: 'a' | 'b', sample: Parameters<NonNullable<typeof debugHooks.clock>>[1]) {
    const state = this.api.player.getSnapshot(); if (state.crossfade || !state.trackId) { this.previous.delete(slot); return; }
    const track = this.clockFor(state.trackId); if (!track) return;
    const now = performance.now(), at = sample.at ?? Date.now(), latency = Math.max(0, Date.now() - at), rate = sample.rate ?? 1;
    track.samples++; push(track.latencies, latency);
    if (sample.backend) track.backend = sample.backend; if (sample.offline !== undefined) track.offline = sample.offline; track.rate = rate;
    if (sample.duration && sample.duration > 0) track.mediaDuration = sample.duration;
    const previous = this.previous.get(slot), running = sample.playing && !sample.buffering && !sample.ended;
    let residual = 0;
    if (previous && running && previous.playing && at > previous.at && at - previous.at < 2000) {
      const interval = at - previous.at; push(track.intervals, interval);
      residual = sample.position - (previous.position + interval / 1000 * rate);
      if (Math.abs(residual) >= SEEK_SECONDS) track.seeks++;
      else {
        push(track.residuals, Math.abs(residual) * 1000);
        if (Math.abs(residual) > JUMP_SECONDS) {
          track.jumps++; track.lastJumpAt = now;
          this.detail(track, 'clock.jump', { residualMs: round(residual * 1000), intervalMs: interval, latencyMs: latency, position: round(sample.position, 3), rate, backend: track.backend, offline: track.offline, recent: track.recent.slice(-10).map(item => `${round(item.position, 3)}@${item.at % 100000}+${item.latency}`).join(' ') });
        }
      }
    }
    track.recent.push({ t: now, position: sample.position, at, latency, residual }); if (track.recent.length > 20) track.recent.shift();
    this.previous.set(slot, { position: sample.position, at, playing: running, t: now });
  }
  private cause(track: ClockTrack) {
    const now = performance.now();
    return { msSinceClockJump: now - track.lastJumpAt < 5000 ? round(now - track.lastJumpAt) : -1, msSinceLongFrame: now - track.lastLongFrameAt < 5000 ? round(now - track.lastLongFrameAt) : -1, hidden: document.hidden };
  }
  private onWave(event: string, data: Record<string, number | string | boolean>) {
    const track = this.clockFor(this.currentTrack()); if (!track) return;
    if (event === 'correct') { track.waveCorrections++; track.waveMaxDrift = Math.max(track.waveMaxDrift, Math.abs(Number(data.driftMs) || 0)); }
    else if (event === 'rebuild') { const reason = String(data.reason ?? 'other'); track.waveRebuilds[reason] = (track.waveRebuilds[reason] ?? 0) + 1; }
    this.detail(track, `wave.${event}`, { ...data, ...this.cause(track) });
  }
  private onLyrics(event: string, data: Record<string, number | string | boolean>) {
    const track = this.clockFor(this.currentTrack()); if (!track) return;
    if (event === 'line') return;
    if (event === 'correct') { track.lyricsCorrections++; track.lyricsMaxDrift = Math.max(track.lyricsMaxDrift, Math.abs(Number(data.driftMs) || 0)); }
    if (event === 'line.back') track.lyricsBack++;
    this.detail(track, `lyrics.${event}`, { ...data, ...this.cause(track) });
  }
  private detail(track: ClockTrack, event: string, data: Record<string, unknown>) {
    if (++track.events > MAX_EVENTS_PER_TRACK) return;
    this.record(event, { trackId: track.trackId, ...data }, 'warn');
  }
  private onFrame = (now: number) => {
    this.frame = requestAnimationFrame(this.onFrame);
    const dt = this.lastFrame ? now - this.lastFrame : 0; this.lastFrame = now;
    if (document.hidden || !dt || dt > 1000) return;
    const track = this.clockTrack, state = this.api.player.getSnapshot(); if (!track || !state.playing) return;
    track.frames++;
    if (dt > 50) { track.longFrames++; track.worstFrame = Math.max(track.worstFrame, dt); track.lastLongFrameAt = now; }
  };
  private onBeat(frame: Parameters<NonNullable<typeof debugHooks.beat>>[0]) {
    const track = this.beatFor(this.currentTrack()); if (!track) return;
    track.frames++; track.dtSum += frame.dt; track.rhythm = frame.rhythm; track.pulse = frame.pulse; track.sparks = frame.sparks;
    if (track.firstPosition < 0) track.firstPosition = frame.position;
    if (!frame.rhythm) track.missing++;
    track.valueSum += frame.value; track.averageSum += frame.average; track.levelSum += frame.level; track.levelMax = Math.max(track.levelMax, frame.level); track.kickMax = Math.max(track.kickMax, frame.kick); track.particlesMax = Math.max(track.particlesMax, frame.particles);
    if (frame.beat) {
      track.beats++; if (frame.position - track.firstPosition < 2) track.early++;
      if (track.lastBeatPosition >= 0 && frame.position > track.lastBeatPosition) push(track.gaps, (frame.position - track.lastBeatPosition) * 1000, 2000);
      track.lastBeatPosition = frame.position;
    }
    if (this.hud) { this.beatPoints.push({ value: frame.value, threshold: frame.average * 1.12 + .03 + .1, level: frame.level, beat: frame.beat }); if (this.beatPoints.length > 180) this.beatPoints.shift(); }
  }
  private refreshHud() {
    const clock = this.clockTrack, beat = this.beatTrack, track = this.api.library.getTrack(this.currentTrack());
    this.hudState = {
      trackId: this.currentTrack(), backend: clock?.backend ?? '', rate: clock?.rate ?? 1, latency: clock?.latencies.at(-1) ?? 0, residual: round((clock?.recent.at(-1)?.residual ?? 0) * 1000),
      jumps: clock?.jumps ?? 0, waveCorrections: clock?.waveCorrections ?? 0, lyricsCorrections: clock?.lyricsCorrections ?? 0, stateJumps: clock?.stateJumps ?? 0, longFrames: clock?.longFrames ?? 0, samples: clock?.samples ?? 0,
      beats: beat?.beats ?? 0, rhythm: beat?.rhythm ?? 0, expected: Math.ceil((track?.duration ?? 0) * 20),
    };
  }
  private finishClock() {
    const track = this.clockTrack; this.clockTrack = undefined; this.previous.clear(); if (!track || !track.samples) return;
    const info = this.api.library.getTrack(track.trackId), context = this.context(), seconds = (performance.now() - track.started) / 1000;
    const problems = track.jumps + track.waveCorrections + track.lyricsCorrections + track.stateJumps;
    this.record('clock.track', {
      trackId: track.trackId, title: info?.title ?? '', sources: info?.sources.map(source => source.kind).join(',') ?? '', streamedFrom: context.streams[track.trackId] ?? '', backend: track.backend, offline: track.offline, rate: round(track.rate, 3),
      libraryDuration: round(info?.duration ?? 0, 3), mediaDuration: round(track.mediaDuration, 3), durationDiffMs: info && track.mediaDuration ? round((track.mediaDuration - info.duration) * 1000) : null,
      seconds: round(seconds, 1), samples: track.samples, latencyP50: round(quantile(track.latencies, .5)), latencyP95: round(quantile(track.latencies, .95)), latencyMax: round(Math.max(0, ...track.latencies)),
      intervalP50: round(quantile(track.intervals, .5)), intervalMax: round(Math.max(0, ...track.intervals)), residualP50: round(quantile(track.residuals, .5)), residualP95: round(quantile(track.residuals, .95)), residualMax: round(Math.max(0, ...track.residuals)),
      jumps: track.jumps, seeks: track.seeks, stateJumps: track.stateJumps, waveCorrections: track.waveCorrections, waveMaxDriftMs: track.waveMaxDrift, waveRebuilds: Object.entries(track.waveRebuilds).map(([key, value]) => `${key}:${value}`).join(','),
      lyricsCorrections: track.lyricsCorrections, lyricsMaxDriftMs: track.lyricsMaxDrift, lyricsBack: track.lyricsBack, frames: track.frames, longFrames: track.longFrames, worstFrameMs: round(track.worstFrame),
      waveform: context.settings.waveform === false ? 'off' : context.settings.waveformZoom === false ? 'plain' : 'zoom', lyricsSmooth: context.settings.lyricsSmooth !== false,
    }, problems ? 'warn' : 'info');
  }
  private finishBeat() {
    const track = this.beatTrack; this.beatTrack = undefined; if (!track || !track.frames) return;
    const info = this.api.library.getTrack(track.trackId), frames = track.frames, seconds = track.dtSum, expected = Math.ceil((info?.duration ?? 0) * 20);
    const context = this.context();
    this.record('beat.track', {
      trackId: track.trackId, title: info?.title ?? '', seconds: round(seconds, 1), frames, fps: seconds ? round(frames / seconds, 1) : 0,
      rhythmLength: track.rhythm, expectedLength: expected, rhythmMissingFrames: track.missing, beats: track.beats, beatsPerMinute: seconds ? round(track.beats / seconds * 60, 1) : 0, medianGapMs: round(quantile(track.gaps, .5)), earlyBeats: track.early,
      valueMean: round(track.valueSum / frames, 3), averageMean: round(track.averageSum / frames, 3), kickMax: round(track.kickMax, 3), levelMean: round(track.levelSum / frames, 3), levelMax: round(track.levelMax, 3), particlesMax: track.particlesMax,
      pulse: track.pulse, sparks: track.sparks, motionDurationMs: context.motion,
    }, !track.rhythm || track.early > 2 || Math.abs(track.rhythm - expected) > 40 ? 'warn' : 'info');
  }
}
