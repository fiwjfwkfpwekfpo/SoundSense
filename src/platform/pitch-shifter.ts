/*
 * Pitch shifting for the desktop/browser engine (Android does it natively in AudioTrack).
 * <audio> can change speed with or without keeping pitch (preservesPitch); a pitch change
 * that is not tied to speed (Daycore, "pitch ±N semitones") needs this AudioWorklet: two read
 * heads glide through a short delay line at the new rate and cross-fade (sin²/cos² windows),
 * the classic delay-line shifter. Ratio 1 passes audio through untouched.
 */
const WORKLET = `
class PitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }]; }
  constructor() { super(); this.size = Math.round(sampleRate * 0.06); this.buffers = []; this.write = 0; this.phase = 0; }
  process(inputs, outputs, parameters) {
    const input = inputs[0], output = outputs[0], ratio = parameters.ratio[0];
    if (!input || !input.length) return true;
    while (this.buffers.length < input.length) this.buffers.push(new Float32Array(this.size));
    const frames = input[0].length, size = this.size, step = (1 - ratio) / size;
    for (let channel = 0; channel < output.length; channel++) {
      const source = input[Math.min(channel, input.length - 1)], target = output[channel], buffer = this.buffers[Math.min(channel, input.length - 1)];
      let write = this.write, phase = this.phase;
      for (let i = 0; i < frames; i++) {
        if (channel < input.length) buffer[write] = source[i];
        if (Math.abs(ratio - 1) < 1e-4) target[i] = source[i];
        else {
          const p2 = (phase + 0.5) % 1, d1 = phase * size, d2 = p2 * size;
          const a = buffer[((write - Math.floor(d1)) % size + size) % size], b = buffer[((write - Math.floor(d2)) % size + size) % size];
          const w1 = Math.sin(Math.PI * phase) ** 2, w2 = Math.sin(Math.PI * p2) ** 2;
          target[i] = a * w1 + b * w2;
          phase += step; if (phase >= 1) phase -= 1; if (phase < 0) phase += 1;
        }
        write = (write + 1) % size;
      }
      if (channel === output.length - 1) { this.write = write; this.phase = phase; }
    }
    return true;
  }
}
registerProcessor('soundsense-pitch', PitchShifter);
`;
const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();
/** Loads the worklet once per context; false when AudioWorklet is unavailable. */
export function loadPitchShifter(context: AudioContext): Promise<boolean> {
  let pending = loaded.get(context);
  if (!pending) {
    pending = (async () => {
      if (!context.audioWorklet) return false;
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      try { await context.audioWorklet.addModule(url); return true; } catch { return false; } finally { URL.revokeObjectURL(url); }
    })();
    loaded.set(context, pending);
  }
  return pending;
}
/**
 * How to reach a playback rate and a pitch factor with <audio> plus the shifter:
 * pitch following speed (Nightcore, Slowed) needs no shifter, speed alone keeps pitch.
 */
export function playbackPlan(rate: number, pitch: number): { rate: number; preservesPitch: boolean; shift: number } {
  if (Math.abs(pitch - rate) < 1e-3) return { rate, preservesPitch: false, shift: 1 };
  return { rate, preservesPitch: true, shift: pitch };
}
