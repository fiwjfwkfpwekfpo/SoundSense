import { Capacitor } from '@capacitor/core';
import type { LibraryApi } from '../core/api';
import type { Waveform } from '../core/types';
import { loadLocalBlob } from './local-media';
import { SystemUi } from './system-ui';
import { desktop, desktopWaves } from './desktop';
/** Device analysis backend: the Android plugin or the desktop process (ffmpeg); none in the browser preview. */
const backend = desktop ? desktopWaves(desktop) : Capacitor.isNativePlatform() ? SystemUi : undefined;
export function createWaveforms(library: LibraryApi, diagnostics?: import('../core/diagnostics').DiagnosticsApi) {
  const cache = new Map<string, Promise<Waveform | null>>();
  let queue = Promise.resolve();
  const callbacks = new Map<string, Set<(waveform: Waveform) => void>>();
  let wanted = new Set<string>(), managed = false, disposed = false;
  const deferred = new Set<string>(), loudnessOnly = new Set<string>();
  const listener = backend ? backend.addListener('waveformProgress', data => {
    for (const id of wanted) {
      // Loudness-only analysis (SoundCloud already supplies the waveform) must not replace the shown wave.
      if (loudnessOnly.has(id)) continue;
      if (data.uri === `stream:${id}` || library.getTrack(id)?.sources.some(source => source.kind === 'local' && source.externalId === data.uri)) for (const callback of callbacks.get(id) ?? []) callback(data);
    }
  }) : undefined;
  const powerListener = Capacitor.isNativePlatform() ? SystemUi.addListener('powerChanged', power => { if (!power.deferred) for (const id of deferred) if (wanted.has(id)) { cache.delete(id); void get(id).then(waveform => { if (waveform) for (const callback of callbacks.get(id) ?? []) callback(waveform); }); } }) : undefined;
  const get: LibraryApi['getWaveform'] = (id, signal) => {
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    let pending = cache.get(id);
    if (!pending) {
      const track = library.getTrack(id), source = track?.sources.find(source => source.kind === 'local');
      if (!track) return Promise.resolve(null);
      if (!source) {
        // Streamed track (Yandex, YouTube Music, …): computed natively from the playback cache.
        if (!backend || !track.duration) return Promise.resolve(null);
        if (!managed) wanted.add(id);
        const stream = async (attempt = 0): Promise<Waveform | null> => {
          if (disposed || managed && !wanted.has(id)) return null;
          try { const started = performance.now(); const result = await backend.readStreamWaveform({ id, duration: track.duration }); if (result.status === 'deferred') deferred.add(id); else deferred.delete(id); diagnostics?.record('waveform', 'stream', { trackId: id, status: result.status ?? 'ready', cached: !!result.cached, ms: Math.round(performance.now() - started), computeMs: (result as { computeMs?: number }).computeMs ?? null, attempt }); return result; }
          catch (error) {
            // The player registers the stream address when it starts preparing the track.
            if ((error as { code?: string }).code === 'NOT_READY' && attempt < 20) { await new Promise(resolve => setTimeout(resolve, 1500)); return stream(attempt + 1); }
            return null;
          }
        };
        const task = stream(); cache.set(id, task);
        void task.then(value => { if ((!value || value.status === 'deferred') && cache.get(id) === task) cache.delete(id); });
        if (cache.size > 20) cache.delete(cache.keys().next().value!);
        return task;
      }
      const load = async () => {
        if (disposed || managed && !wanted.has(id)) return null;
        try {
          if (backend) { const result = await backend.readWaveform({ uri: source.externalId, duration: track.duration }); if (result.status === 'deferred') deferred.add(id); else deferred.delete(id); return result; }
          const blob = await loadLocalBlob(source.externalId); if (!blob || blob.size > 100 * 1024 * 1024) return null;
          const context = new AudioContext();
          try {
            const audio = await context.decodeAudioData(await blob.arrayBuffer()), data = audio.getChannelData(0), count = 512;
            const samples = Array.from({ length: count }, (_, index) => {
              const start = Math.floor(index * data.length / count), end = Math.floor((index + 1) * data.length / count);
              let squares = 0, peak = 0, measured = 0;
              for (let sample = start; sample < end; sample += 8) { const value = Math.abs(data[sample]!); peak = Math.max(peak, value); squares += value * value; measured++; }
              return Math.sqrt(squares / Math.max(1, measured)) * .65 + peak * .35;
            });
            const maximum = Math.max(.001, ...samples); return { samples: samples.map(value => value / maximum) };
          } finally { await context.close(); }
        } catch { return null; }
      };
      // Decode one local file at a time; large libraries never allocate a buffer per track.
      if (!managed) wanted.add(id);
      pending = queue.then(load); queue = pending.then(() => {}); cache.set(id, pending);
      const task = pending;
      void pending.then(value => { if ((!value || value.status === 'deferred') && cache.get(id) === task) cache.delete(id); });
      if (cache.size > 20) cache.delete(cache.keys().next().value!);
    }
    return pending;
  };
  /*
   * Full device analysis (loudness + bass rhythm) of one track, shared by loudness
   * normalization and beat visuals: one decode, and the two never cancel each other.
   * SoundCloud already supplies the waveform, so its analysis never replaces the shown wave.
   */
  const analyses = new Map<string, Promise<Waveform | undefined>>();
  function analyze(id: string): Promise<Waveform | undefined> {
    if (!backend) return Promise.resolve(undefined);
    const known = analyses.get(id); if (known) return known;
    const track = library.getTrack(id); if (!track?.duration) return Promise.resolve(undefined);
    const source = track.sources.find(item => item.kind === 'local');
    // Its progress never replaces the shown wave (SoundCloud's server wave, or an already cached one).
    const task = (async () => {
      try {
        for (let attempt = 0; attempt < 20; attempt++) {
          // The shown waveform may be decoding the same file: wait for it (its decode also stores loudness and rhythm).
          const shown = cache.get(id); if (shown) await shown.catch(() => null);
          loudnessOnly.add(id);
          try { return source ? await backend.readWaveform({ uri: source.externalId, duration: track.duration, loudness: true, rhythm: true }) : await backend.readStreamWaveform({ id, duration: track.duration, loudness: true, rhythm: true }); }
          catch (error) { const code = (error as { code?: string }).code; if (code !== 'NOT_READY' && !cache.has(id)) return undefined; await new Promise(resolve => setTimeout(resolve, code === 'NOT_READY' ? 1500 : 200)); }
        }
        return undefined;
      } finally { loudnessOnly.delete(id); }
    })();
    analyses.set(id, task); void task.then(value => { if (!value) analyses.delete(id); });
    if (analyses.size > 8) analyses.delete(analyses.keys().next().value!);
    return task;
  }
  async function loudness(id: string): Promise<number | undefined> { const result = await analyze(id); return Number.isFinite(result?.loudness) ? result!.loudness : undefined; }
  /** Bass energy for beat visuals (20 frames per second). Old cache entries without it are analysed once more. */
  async function rhythm(id: string): Promise<Uint8Array | undefined> {
    const encoded = (await analyze(id))?.rhythm; if (!encoded) return undefined;
    const text = atob(encoded), bytes = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
  }
  return { get, loudness, rhythm,
    subscribe(id: string, callback: (waveform: Waveform) => void) { const listeners = callbacks.get(id) ?? new Set(); listeners.add(callback); callbacks.set(id, listeners); return () => { listeners.delete(callback); if (!listeners.size) callbacks.delete(id); }; },
    setTargets(ids: readonly string[]) { managed = true; const next = new Set(ids); for (const id of wanted) if (!next.has(id)) { const source = library.getTrack(id)?.sources.find(source => source.kind === 'local'); if (backend) void backend.cancelWaveform({ uri: source ? source.externalId : `stream:${id}` }); cache.delete(id); deferred.delete(id); } wanted = next; },
    dispose() { disposed = true; for (const id of wanted) { const source = library.getTrack(id)?.sources.find(source => source.kind === 'local'); if (source && backend) void backend.cancelWaveform({ uri: source.externalId }); } wanted.clear(); if (listener) void listener.then(handle => handle.remove()); if (powerListener) void powerListener.then(handle => handle.remove()); callbacks.clear(); },
  };
}
