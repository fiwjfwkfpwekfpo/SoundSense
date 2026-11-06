import type { AppApi } from '../core/api';
import { APP_VERSION } from '../core/version';

/**
 * UI profiler for field reports. While recording it measures, per user action
 * (tap on a button, tab, row…): time to the next painted frame and the frames
 * during the following second (p95, worst, frames over 34 ms), plus long tasks,
 * event timing, memory and playback events. Results go into the diagnostics
 * journal ("profile" scope), so the regular export contains them.
 */
interface ActionSample { label: string; route: string; overlay: string; at: number; inputDelay?: number; firstFrame?: number; frames: number[]; longTasks: number }
export interface ProfileSummary { durationS: number; actions: number; frames: number; p50: number; p95: number; p99: number; worst: number; janky: number; longTasks: number; longTaskMs: number }

export class Profiler {
  recording = $state(false);
  startedAt = $state(0);
  actions = $state(0);
  private frames: number[] = [];
  private current: ActionSample | undefined;
  private longTasks: number[] = [];
  private frame = 0; private last = 0;
  private observers: PerformanceObserver[] = [];
  private disposers: (() => void)[] = [];
  private memoryTimer: ReturnType<typeof setInterval> | undefined;
  constructor(private api: AppApi, private context: () => { route: string; overlay: string; settings: Record<string, unknown> }) {}

  private record(event: string, data: Record<string, unknown>, level: 'info' | 'warn' = 'info') { this.api.diagnostics?.record('profile', event, data, level); }

  start() {
    if (this.recording) return;
    this.recording = true; this.startedAt = Date.now(); this.actions = 0; this.frames = []; this.longTasks = []; this.current = undefined;
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string; downlink?: number; saveData?: boolean } };
    const settings = this.context().settings;
    this.record('start', {
      version: APP_VERSION, cores: navigator.hardwareConcurrency, memoryGb: nav.deviceMemory ?? null, dpr: devicePixelRatio, screen: `${screen.width}x${screen.height}`, viewport: `${innerWidth}x${innerHeight}`,
      network: nav.connection?.effectiveType ?? null, downlink: nav.connection?.downlink ?? null, saveData: nav.connection?.saveData ?? null, ua: navigator.userAgent,
      style: settings.appearanceStyle ?? null, colors: settings.appearanceColors ?? null, motion: settings.appearanceMotion ?? null, waveform: settings.waveform ?? null, waveformZoom: settings.waveformZoom ?? null, lyricsSmooth: settings.lyricsSmooth ?? null, crossfade: settings.crossfade ?? null,
      library: this.api.library.getSnapshot().tracks.length, queue: this.api.player.getSnapshot().queue.length,
    });
    const loop = (now: number) => {
      if (!this.recording) return;
      if (this.last && !document.hidden) {
        const interval = now - this.last; this.frames.push(interval);
        const action = this.current;
        if (action) {
          if (action.firstFrame === undefined) action.firstFrame = Math.round(now - action.at);
          action.frames.push(interval);
          if (now - action.at > 1000) this.finish();
        }
      }
      this.last = now; this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
    const pointer = (event: Event) => {
      const target = (event.target as Element | null)?.closest<HTMLElement>('button, [role="slider"], [role="switch"], [role="option"], a, input, [data-testid]');
      if (!target || target.closest('[data-profiler]')) return;
      this.finish();
      const label = (target.getAttribute('aria-label') || target.dataset.testid || target.textContent || target.tagName).trim().replace(/\s+/g, ' ').slice(0, 60);
      const { route, overlay } = this.context();
      this.current = { label, route, overlay, at: performance.now(), frames: [], longTasks: 0 };
      this.actions++;
    };
    document.addEventListener('pointerdown', pointer, { capture: true, passive: true });
    this.disposers.push(() => document.removeEventListener('pointerdown', pointer, { capture: true }));
    const observe = (type: string, callback: (entry: PerformanceEntry & { processingStart?: number; interactionId?: number; name: string }) => void, extra: Record<string, unknown> = {}) => {
      try { const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) callback(entry as never); }); observer.observe({ type, buffered: false, ...extra } as PerformanceObserverInit); this.observers.push(observer); } catch { /* Not supported by this WebView. */ }
    };
    observe('longtask', entry => { this.longTasks.push(entry.duration); if (this.current) this.current.longTasks++; if (entry.duration > 120) this.record('longtask', { ms: Math.round(entry.duration), route: this.context().route, overlay: this.context().overlay, action: this.current?.label ?? null }, 'warn'); });
    // Long animation frames (Chromium 123+) split a stall into script, style/layout and render time
    // and name the slowest script, so a freeze can be attributed without guessing.
    observe('long-animation-frame', entry => {
      const frame = entry as unknown as { duration: number; blockingDuration?: number; renderStart?: number; styleAndLayoutStart?: number; startTime: number; scripts?: { duration: number; invoker?: string; invokerType?: string; sourceFunctionName?: string; sourceURL?: string; forcedStyleAndLayoutDuration?: number }[] };
      if (frame.duration < 150) return;
      const scripts = [...(frame.scripts ?? [])].sort((a, b) => b.duration - a.duration).slice(0, 3).map(script => `${script.invokerType ?? ''}:${(script.sourceFunctionName || script.invoker || '').slice(0, 60)}@${(script.sourceURL ?? '').split('/').pop()} ${Math.round(script.duration)}ms${script.forcedStyleAndLayoutDuration ? ` forced ${Math.round(script.forcedStyleAndLayoutDuration)}` : ''}`);
      const scriptMs = (frame.scripts ?? []).reduce((sum, script) => sum + script.duration, 0), end = frame.startTime + frame.duration;
      this.record('longframe', { ms: Math.round(frame.duration), scriptMs: Math.round(scriptMs), renderMs: frame.renderStart ? Math.round(end - frame.renderStart) : null, styleLayoutMs: frame.styleAndLayoutStart ? Math.round(end - frame.styleAndLayoutStart) : null, blockingMs: Math.round(frame.blockingDuration ?? 0), scripts, route: this.context().route, overlay: this.context().overlay, action: this.current?.label ?? null }, 'warn');
    }, { durationThreshold: 100 });
    observe('event', entry => {
      if (!entry.interactionId || !this.current || entry.duration < 40) return;
      // Input delay = time until the handler ran (main thread busy), duration = until the next paint.
      if (this.current.inputDelay === undefined) this.current.inputDelay = Math.round((entry.processingStart ?? entry.startTime) - entry.startTime);
    }, { durationThreshold: 40 });
    // Playback and network events with timings, so slow loads can be matched to taps.
    const events = this.api.extensions.events;
    this.disposers.push(events.on('source:resolve', result => this.record('resolve', { trackId: result.trackId, provider: result.provider, outcome: result.outcome, ms: result.ms, reason: result.reason ?? null })));
    this.disposers.push(events.on('track:change', change => this.record('track.change', { trackId: change.trackId, previous: change.previous })));
    const memory = () => { const value = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory; if (value) this.record('memory', { usedMb: Math.round(value.usedJSHeapSize / 1048576), totalMb: Math.round(value.totalJSHeapSize / 1048576), dom: document.getElementsByTagName('*').length }); };
    memory(); this.memoryTimer = setInterval(memory, 15000);
  }

  /** Closes the current action and writes its numbers. */
  private finish() {
    const action = this.current; this.current = undefined;
    if (!action || !action.frames.length) return;
    const frames = [...action.frames].sort((a, b) => a - b), at = (q: number) => Math.round(frames[Math.min(frames.length - 1, Math.floor(frames.length * q))]!);
    this.record('action', {
      label: action.label, route: action.route, overlay: action.overlay, firstFrameMs: action.firstFrame ?? null, inputDelayMs: action.inputDelay ?? null,
      p95: at(.95), worst: Math.round(frames.at(-1)!), janky: frames.filter(value => value > 34).length, frames: frames.length, longTasks: action.longTasks,
    }, (action.firstFrame ?? 0) > 150 || frames.at(-1)! > 120 ? 'warn' : 'info');
  }

  stop(): ProfileSummary | undefined {
    if (!this.recording) return;
    this.finish(); this.recording = false; cancelAnimationFrame(this.frame); this.last = 0;
    this.observers.forEach(observer => observer.disconnect()); this.observers = [];
    this.disposers.forEach(dispose => dispose()); this.disposers = []; clearInterval(this.memoryTimer);
    const frames = [...this.frames].sort((a, b) => a - b), at = (q: number) => Math.round((frames[Math.min(frames.length - 1, Math.floor(frames.length * q))] ?? 0) * 10) / 10;
    const summary: ProfileSummary = { durationS: Math.round((Date.now() - this.startedAt) / 1000), actions: this.actions, frames: frames.length, p50: at(.5), p95: at(.95), p99: at(.99), worst: Math.round(frames.at(-1) ?? 0), janky: frames.filter(value => value > 34).length, longTasks: this.longTasks.length, longTaskMs: Math.round(this.longTasks.reduce((sum, value) => sum + value, 0)) };
    this.record('summary', { ...summary });
    return summary;
  }
}
