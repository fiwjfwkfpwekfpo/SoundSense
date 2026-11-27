import { Capacitor, registerPlugin } from '@capacitor/core';
import type { AudioEngine, AudioSlot, AudioEvent, AudioStream } from '../core/audio-engine';
import type { Track } from '../core/types';
import { equalPower } from '../core/crossfade';
import { mediaUrl } from './local-media';
import { desktop, desktopMediaUrl } from './desktop';
import { playbackFailureReason } from '../core/audio-engine';
import type { PlaybackFailureReason } from '../core/types';
import type { DiagnosticsApi } from '../core/diagnostics';
import { processingRate, processingPitch } from '../core/audio-settings';
import { debugHooks } from '../core/debug-hooks';
import { filterClock } from '../core/clock-filter';
import { connectOutput } from './output-limiter';
import { loadPitchShifter, playbackPlan } from './pitch-shifter';

interface AudioClock { position: number; playing: boolean; ended: boolean; buffering: boolean; rate?: number }
export interface NativeAudioPlugin {
  prepare(options: { slot: AudioSlot; uri: string; headers?: Readonly<Record<string, string>>; trackId: string; title: string; artist: string; duration: number }): Promise<void>;
  command(options: { action: string; slot?: AudioSlot; position?: number; gain?: number; seconds?: number; to?: AudioSlot; metadata?: Record<string, unknown>; reason?: string; message?: string; processing?: { rate: number; pitch: number; volume: number }; trackId?: string; at?: number; until?: number; duration?: number; ms?: number }): Promise<void>;
  getDiagnostics(): Promise<{ entries: readonly unknown[] }>;
  addListener(event: 'state', listener: (value: { slot: AudioSlot; at?: number; duration?: number; backend?: string; offline?: boolean } & AudioClock) => void): Promise<{ remove(): Promise<void> }>;
  addListener(event: 'action', listener: (value: AudioEvent) => void): Promise<{ remove(): Promise<void> }>;
}
export const NativeAudio = registerPlugin<NativeAudioPlugin>('AudioEngine');
interface EngineOptions { diagnostics?: DiagnosticsApi; errorText?: (reason: PlaybackFailureReason) => string }
type Resolve = (track: Track, signal?: AbortSignal) => Promise<string | AudioStream>;
const streamValue = (value: string | AudioStream): AudioStream => typeof value === 'string' ? { uri: value } : value;
export function createAudioEngine(resolve: Resolve, options: EngineOptions = {}): AudioEngine {
  return Capacitor.isNativePlatform() ? nativeEngine(resolve, options) : webEngine(resolve, desktop ? options.diagnostics : undefined);
}
function nativeEngine(resolve: Resolve, options: EngineOptions): AudioEngine {
  const generation = { a: 0, b: 0 }, rates = { a: 1, b: 1 }, clock: Record<AudioSlot, AudioClock & { sampledAt: number }> = { a: empty(), b: empty() };
  const resolving: Partial<Record<AudioSlot, AbortController>> = {};
  const listeners = new Set<(event: AudioEvent) => void>();
  let disposed = false;
  // Hidden WebView: one position report a second is enough (the service switches tracks by itself).
  const visibility = () => { void NativeAudio.command({ action: 'reporting', ms: document.hidden ? 1000 : 250 }).catch(() => {}); };
  if (typeof document !== 'undefined') { document.addEventListener('visibilitychange', visibility); if (document.hidden) visibility(); }
  function empty() { return { position: 0, playing: false, ended: false, buffering: true, sampledAt: performance.now() }; }
  const subscriptions = [NativeAudio.addListener('state', value => {
    const { at, duration: _duration, backend: _backend, offline: _offline, slot, ...sample } = value;
    // Reports are filtered: some streams report a jittery position while the audio plays evenly.
    clock[slot] = filterClock(clock[slot], sample, performance.now() - (at ? Math.max(0, Math.min(1000, Date.now() - at)) : 0), sample.rate ?? rates[slot]);
    debugHooks.clock?.(value.slot, value);
  }), NativeAudio.addListener('action', value => {
    // The service already switched slots: start the new clock where it started the audio.
    if (value.type === 'advanced' && value.to) clock[value.to] = { position: value.position ?? 0, playing: true, ended: false, buffering: false, sampledAt: performance.now() - (value.at ? Math.max(0, Math.min(1000, Date.now() - value.at)) : 0) };
    for (const listener of listeners) listener(value);
  })];
  function select(slot: AudioSlot, track: Track) { void NativeAudio.command({ action: 'select', slot, metadata: { trackId: track.id, title: track.title, artist: track.artist.name, artwork: track.artwork.url ?? '', liked: track.liked } }).catch(() => options.diagnostics?.record('system-player', 'select.failed', { trackId: track.id }, 'warn')); }
  function command(action: string, slot?: AudioSlot, options: { position?: number; gain?: number; seconds?: number; to?: AudioSlot; loop?: boolean } = {}) { void NativeAudio.command({ action, slot, ...options }).catch(() => { if (!disposed) for (const listener of listeners) listener({ type: 'error', slot }); }); }
  return {
    select,
    async prepare(slot, track, intent = 'play') {
      const token = ++generation[slot]; clock[slot] = empty();
      resolving[slot]?.abort(); const controller = resolving[slot] = new AbortController();
      if (intent === 'play') select(slot, track);
      try {
        const stream = streamValue(await resolve(track, controller.signal));
        if (disposed || token !== generation[slot]) throw new DOMException('Superseded', 'AbortError');
        await NativeAudio.prepare({ slot, ...stream, trackId: track.id, title: track.title, artist: track.artist.name, duration: track.duration });
        if (disposed || token !== generation[slot]) throw new DOMException('Superseded', 'AbortError');
        clock[slot] = { ...empty(), buffering: false };
      } catch (error) {
        if (!disposed && token === generation[slot] && intent === 'play' && !(error instanceof DOMException && error.name === 'AbortError')) {
          const reason = playbackFailureReason(error);
          void NativeAudio.command({ action: 'failure', slot, reason, message: options.errorText?.(reason) ?? reason }).catch(() => {});
        }
        throw error;
      }
    },
    start(slot, position) { clock[slot] = { position, playing: true, ended: false, buffering: false, sampledAt: performance.now() }; command('start', slot, { position }); },
    pause(slot) { clock[slot] = { ...this.clock!(slot), playing: false, sampledAt: performance.now() }; command('pause', slot); },
    stop(slot) { generation[slot]++; resolving[slot]?.abort(); clock[slot] = empty(); command('stop', slot); },
    seek(slot, position) { clock[slot] = { ...clock[slot], position, ended: false, sampledAt: performance.now() }; command('seek', slot, { position }); },
    gain(slot, gain) { command('gain', slot, { gain }); }, loop(slot, loop) { command('loop', slot, { loop }); }, fadeOut(slot, seconds) { command('fadeOut', slot, { seconds }); },
    processing(slot, values, trackId) { rates[slot] = processingRate(values); void NativeAudio.command({ action: 'processing', slot, trackId, processing: { rate: rates[slot], pitch: processingPitch(values), volume: values.volume } }).catch(() => options.diagnostics?.record('audio', 'processing.failed', { slot }, 'error')); },
    crossfade(from, to, seconds, position) { clock[to] = { position, playing: true, ended: false, buffering: false, sampledAt: performance.now() }; command('crossfade', from, { to, seconds, position }); },
    arm(from, to, plan) {
      if (!plan) { void NativeAudio.command({ action: 'disarm', slot: from }).catch(() => {}); return; }
      const { track } = plan;
      void NativeAudio.command({ action: 'arm', slot: from, to, trackId: track.id, at: plan.at, until: plan.until, duration: plan.duration, position: plan.position, metadata: { trackId: track.id, title: track.title, artist: track.artist.name, artwork: track.artwork.url ?? '', liked: track.liked } })
        .catch(() => options.diagnostics?.record('system-player', 'arm.failed', { trackId: track.id }, 'warn'));
    },
    clock(slot) { const sample = clock[slot]; return { ...sample, rate: rates[slot], position: sample.position + (sample.playing && !sample.buffering && !sample.ended ? Math.min(1.5, (performance.now() - sample.sampledAt) / 1000) * rates[slot] : 0) }; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { disposed = true; if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibility); resolving.a?.abort(); resolving.b?.abort(); command('dispose'); for (const subscription of subscriptions) void subscription.then(handle => handle.remove()); listeners.clear(); },
  };
}
function webEngine(resolve: Resolve, diagnostics?: DiagnosticsApi): AudioEngine {
  const context = new AudioContext();
  const mix = context.createGain();
  const output = connectOutput(context, mix, diagnostics);
  let monitored: AudioSlot | undefined, overlapping: AudioSlot | undefined, outputPort: MessagePort | undefined;
  void output.then(port => { outputPort = port; });
  function meter(slot?: AudioSlot, from?: AudioSlot) {
    monitored = slot; overlapping = from;
    if (diagnostics) outputPort?.postMessage(slot ? { trackId: slots[slot].trackId, overlapFrom: from ? slots[from].trackId : undefined } : null);
  }
  let disposed = false;
  // Both slots feed the same peak limiter, including the sum during a crossfade.
  const make = () => {
    const media = new Audio(); media.preload = 'auto'; media.crossOrigin = 'anonymous';
    const source = context.createMediaElementSource(media), volume = context.createGain(), gain = context.createGain();
    source.connect(volume).connect(gain).connect(mix); gain.gain.value = 0;
    return { media, source, volume, gain, shifter: undefined as AudioWorkletNode | undefined, shift: 1, rate: 1, trackId: '', generation: 0, waiting: false, resolving: undefined as AbortController | undefined, hls: undefined as import('hls.js').default | undefined };
  };
  const slots = { a: make(), b: make() };
  const listeners = new Set<(event: AudioEvent) => void>();
  for (const slot of ['a', 'b'] as const) {
    const { media } = slots[slot];
    media.addEventListener('waiting', () => slots[slot].waiting = true); media.addEventListener('playing', () => slots[slot].waiting = false);
    media.addEventListener('error', () => { if (media.currentSrc) for (const listener of listeners) listener({ type: 'error', slot }); });
  }
  return {
    async prepare(slot, track) {
      const target = slots[slot], token = ++target.generation;
      target.resolving?.abort(); const controller = target.resolving = new AbortController();
      const { uri, headers, provider } = streamValue(await resolve(track, controller.signal));
      if (token !== target.generation) throw new DOMException('Superseded', 'AbortError');
      target.hls?.destroy(); target.hls = undefined; target.media.pause(); target.waiting = true;
      // Desktop: streams that need headers (User-Agent…) go through ss-media://stream, which <audio> can read.
      const url = desktop && /^https:/.test(uri) ? desktopMediaUrl(uri, headers, desktop.cache ? track.id : undefined) : await mediaUrl(uri);
      if (token !== target.generation) throw new DOMException('Superseded', 'AbortError');
      target.trackId = track.id;
      const hlsStream = /\.m3u8(?:\?|$)/i.test(url);
      const source = { trackId: track.id, provider: provider ?? 'unknown',
        delivery: uri.startsWith('ss-media:') ? 'cache' : uri.startsWith('file:') ? 'file' : hlsStream ? 'hls' : 'stream', outputSampleRate: context.sampleRate };
      if (hlsStream && !target.media.canPlayType('application/vnd.apple.mpegurl')) {
        const { default: Hls } = await import('hls.js'); if (token !== target.generation) throw new DOMException('Superseded', 'AbortError');
        if (!Hls.isSupported()) throw new Error('HLS is not supported');
        target.hls = new Hls({ maxBufferLength: 12, maxMaxBufferLength: 30, xhrSetup(xhr) { for (const [key, value] of Object.entries(headers ?? {})) if (!/^(user-agent|origin|referer)$/i.test(key)) xhr.setRequestHeader(key, value); } });
        if (diagnostics) {
          let bitrate: number | null = null, measured = false, audioOnly = true;
          let format: { codec: string | null; channels: number | null; sampleRate: number | null } | undefined;
          const report = () => {
            if (!format || controller.signal.aborted) return;
            diagnostics.record('audio', 'stream.format', { ...source, ...format, bitrate: audioOnly ? bitrate : null });
            measured = true;
          };
          target.hls.on(Hls.Events.FRAG_LOADED, (_, { frag, payload }) => {
            if (frag.duration <= 0 || frag.sn === 'initSegment' || measured && bitrate !== null) return;
            bitrate = Math.round(payload.byteLength * 8 / frag.duration);
            if (measured) report();
          });
          target.hls.on(Hls.Events.BUFFER_CODECS, (_, { audio, video }) => {
            if (!audio) return;
            audioOnly = !video;
            const fallback = { codec: audio.codec ?? null, channels: audio.metadata?.channelCount ?? null, sampleRate: null };
            const info = audio.initSegment?.length ? import('../debug/stream-format').then(m => m.formatFromBytes(audio.initSegment!, audio.container)).catch(() => fallback) : Promise.resolve(fallback);
            void info.then(parsed => { format = parsed; report(); });
          });
        }
        target.hls.loadSource(url); target.hls.attachMedia(target.media);
      } else { target.media.src = url; target.media.load(); }
      target.media.defaultPlaybackRate = target.rate; target.media.playbackRate = target.rate;
      await new Promise<void>((ok, fail) => {
        const timeout = setTimeout(() => finish(new Error('Audio load timeout')), 25000);
        function finish(error?: Error) { clearTimeout(timeout); target.media.removeEventListener('loadedmetadata', ready); target.media.removeEventListener('error', bad); error ? fail(error) : ok(); }
        const ready = () => finish(), bad = () => finish(new Error('Audio unavailable'));
        target.media.addEventListener('loadedmetadata', ready, { once: true }); target.media.addEventListener('error', bad, { once: true });
        if (target.media.readyState >= 1) finish();
      });
      if (token !== target.generation) throw new DOMException('Superseded', 'AbortError');
      target.waiting = false;
      if (diagnostics && hlsStream && !target.hls) diagnostics.record('audio', 'stream.format.unavailable', { ...source, reason: 'native-hls' });
      if (diagnostics && !hlsStream) {
        void import('../debug/stream-format').then(m => m.probeStream(url, target.media.duration, controller.signal))
          .then(format => { if (!controller.signal.aborted) diagnostics.record('audio', 'stream.format', { ...source, ...format }); })
          .catch(() => { if (!controller.signal.aborted) diagnostics.record('audio', 'stream.format.unavailable', source); });
      }
      await output;
      if (token !== target.generation) throw new DOMException('Superseded', 'AbortError');
    },
    start(slot, position) { const target = slots[slot]; meter(slot); void context.resume(); target.media.currentTime = position; void target.media.play().catch(() => { for (const listener of listeners) listener({ type: 'error', slot }); }); },
    pause(slot) { slots[slot].media.pause(); if (monitored === slot) meter(); }, stop(slot) { if (monitored === slot) meter(); else if (overlapping === slot) meter(monitored); const target = slots[slot]; target.generation++; target.resolving?.abort(); target.media.pause(); target.hls?.destroy(); target.hls = undefined; target.media.removeAttribute('src'); target.media.load(); },
    seek(slot, position) { const media = slots[slot].media; if (media.readyState >= 1) media.currentTime = position; },
    loop(slot, enabled) { slots[slot].media.loop = enabled; },
    gain(slot, value) { const gain = slots[slot].gain.gain; gain.cancelScheduledValues(context.currentTime); gain.setValueAtTime(Math.max(0, Math.min(1, value)), context.currentTime); },
    fadeOut(slot, seconds) { const gain = slots[slot].gain.gain; gain.cancelScheduledValues(context.currentTime); gain.setValueAtTime(gain.value, context.currentTime); gain.linearRampToValueAtTime(0, context.currentTime + seconds); },
    crossfade(from, to, seconds, position) { this.start(to, position); meter(to, from); const fromCurve = new Float32Array(128), toCurve = new Float32Array(128); for (let index = 0; index < 128; index++) { const gain = equalPower(index / 127); fromCurve[index] = gain.from; toCurve[index] = gain.to; } for (const [slot, curve] of [[from, fromCurve], [to, toCurve]] as const) { const gain = slots[slot].gain.gain; gain.cancelScheduledValues(context.currentTime); gain.setValueCurveAtTime(curve, context.currentTime, seconds); } },
    clock(slot) { const target = slots[slot], media = target.media; return { position: media.currentTime, playing: !media.paused, ended: media.ended, buffering: target.waiting || media.readyState < 3, rate: media.playbackRate }; },
    processing(slot, values) {
      const target = slots[slot], plan = playbackPlan(processingRate(values), processingPitch(values));
      target.rate = plan.rate; target.media.playbackRate = plan.rate; target.media.preservesPitch = plan.preservesPitch;
      target.volume.gain.setTargetAtTime(Math.max(0, Math.min(4, values.volume)), context.currentTime, .03);
      target.shift = plan.shift;
      if (Math.abs(plan.shift - 1) < 1e-3) {
        if (target.shifter) {
          target.source.disconnect(target.shifter); target.shifter.port.postMessage('stop'); target.shifter.disconnect(); target.shifter = undefined;
          target.source.connect(target.volume);
        }
        return;
      }
      void loadPitchShifter(context).then(ok => {
        if (!ok || disposed || Math.abs(target.shift - 1) < 1e-3) return;
        if (!target.shifter) {
          target.shifter = new AudioWorkletNode(context, 'soundsense-pitch', { outputChannelCount: [2] });
          target.source.disconnect(target.volume); target.source.connect(target.shifter).connect(target.volume);
        }
        target.shifter.parameters.get('ratio')!.setValueAtTime(target.shift, context.currentTime);
      });
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { disposed = true; for (const slot of ['a', 'b'] as const) { this.stop(slot); slots[slot].gain.disconnect(); } void context.close(); listeners.clear(); },
  };
}
