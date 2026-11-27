import processor from './output-limiter.worklet.js?raw';
import type { DiagnosticsApi } from '../core/diagnostics';

export async function connectOutput(context: AudioContext, mix: GainNode, diagnostics?: DiagnosticsApi) {
  const url = URL.createObjectURL(new Blob([processor], { type: 'text/javascript' }));
  try {
    await context.audioWorklet.addModule(url);
    const channels = context.destination.channelCount;
    const limiter = new AudioWorkletNode(context, 'soundsense-output', {
      channelCount: channels, channelCountMode: 'explicit', outputChannelCount: [channels],
    });
    mix.connect(limiter).connect(context.destination);
    if (diagnostics) limiter.port.onmessage = ({ data }) => {
      const db = (peak: number) => peak > 0 ? Math.round(2000 * Math.log10(peak)) / 100 : null;
      diagnostics.record('audio', 'output.peak', { trackId: data.trackId, overlapFrom: data.overlapFrom ?? null,
        preLimitDbfs: db(data.before), outputDbfs: db(data.after), sampleRate: context.sampleRate, measuredFrames: data.frames });
    };
    return limiter.port;
  } catch {
    // Older browser previews may lack AudioWorklet. Keep a guarded output in that case.
    const guard = context.createDynamicsCompressor();
    guard.threshold.value = -1; guard.knee.value = 0; guard.ratio.value = 20; guard.attack.value = 0; guard.release.value = .08;
    mix.connect(guard).connect(context.destination);
    diagnostics?.record('audio', 'output.fallback', { sampleRate: context.sampleRate }, 'warn');
    return undefined;
  } finally { URL.revokeObjectURL(url); }
}
