// One render quantum of lookahead. Both channels follow the same gain so the stereo image stays put.
class OutputLimiter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.previous = [];
    this.previousPeak = 0;
    this.gain = 1;
    this.release = Math.exp(-1 / (.08 * sampleRate));
    this.track = null;
    this.resetMeter();
    this.port.onmessage = ({ data }) => {
      this.report();
      this.track = data;
      this.resetMeter();
    };
  }
  resetMeter() { this.before = 0; this.after = 0; this.frames = 0; this.nextReport = sampleRate; }
  report() {
    if (this.track && this.frames) this.port.postMessage({ ...this.track, before: this.before, after: this.after, frames: this.frames });
  }
  process(inputs, outputs) {
    const input = inputs[0], output = outputs[0];
    if (!output.length) return true;
    const frames = output[0].length;
    let peak = 0;
    for (const channel of input) for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(channel[i]));
    const ceiling = 1 / Math.max(1, this.previousPeak, peak);
    const attack = Math.min(0, (ceiling - this.gain) / frames);
    for (let ch = 0; ch < output.length; ch++) {
      if (this.previous[ch]?.length !== frames) this.previous[ch] = new Float32Array(frames);
    }
    let outPeak = 0;
    for (let i = 0; i < frames; i++) {
      this.gain = attack < 0 ? Math.max(ceiling, this.gain + attack) : ceiling + (this.gain - ceiling) * this.release;
      for (let ch = 0; ch < output.length; ch++) {
        const previous = this.previous[ch];
        const value = previous[i] * this.gain;
        output[ch][i] = value;
        previous[i] = input[ch]?.[i] ?? 0;
        if (this.track) outPeak = Math.max(outPeak, Math.abs(value));
      }
    }
    if (this.track) {
      this.before = Math.max(this.before, this.previousPeak);
      this.after = Math.max(this.after, outPeak);
      this.frames += frames;
      if (this.frames >= this.nextReport) { this.report(); this.nextReport += 15 * sampleRate; }
    }
    this.previousPeak = peak;
    return true;
  }
}
registerProcessor('soundsense-output', OutputLimiter);
