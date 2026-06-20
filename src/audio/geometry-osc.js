import { getAudioContext } from './context.js?v=20260524-cellnoise-02';
import { getMasterBus } from './master.js?v=20260524-cellnoise-02';

export class GeometryOsc {
  constructor() {
    this.running = false;
    this.nodes = null;
    // Optional pitch quantizer: hz => hz snapped to a musical scale. When null
    // the oscillator glides continuously (original behaviour).
    this.quantizer = null;
    this.params = {
      pitchBase: 110,
      pitchRange: 1200,
      fmAmount: 50,
      sineMix: 0.5,
      densitySensitivity: 0.8,
    };
  }

  start() {
    if (this.running) return;
    const ctx = getAudioContext();

    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = this.params.pitchBase;

    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = 2;

    const fmDepth = ctx.createGain();
    fmDepth.gain.value = this.params.fmAmount;

    const amp = ctx.createGain();
    amp.gain.value = 0;

    const output = ctx.createGain();
    output.gain.value = this.params.sineMix;

    // FM: mod → fmDepth → carrier.frequency (audio-rate)
    mod.connect(fmDepth);
    fmDepth.connect(carrier.frequency);

    // Signal path: carrier → amp → output → master
    carrier.connect(amp);
    amp.connect(output);
    output.connect(getMasterBus().getInput());

    carrier.start();
    mod.start();

    this.nodes = { carrier, mod, fmDepth, amp, output };
    this.running = true;
  }

  stop() {
    if (!this.running || !this.nodes) return;
    this.running = false;

    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const { amp } = this.nodes;

    amp.gain.cancelScheduledValues(now);
    amp.gain.setValueAtTime(amp.gain.value, now);
    amp.gain.setTargetAtTime(0, now, 0.03);

    const savedNodes = this.nodes;
    this.nodes = null;

    setTimeout(() => {
      try { savedNodes.carrier.stop(); } catch (_) {}
      try { savedNodes.mod.stop(); } catch (_) {}
    }, 250);
  }

  // Called every animation frame with extracted features
  update(features) {
    if (!this.running || !this.nodes) return;
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const p = this.params;
    const { carrier, mod, fmDepth, amp, output } = this.nodes;
    const { density, toggleRate, complexity, scanPhase } = features;

    // density → amp gain
    const targetAmp = Math.max(0, Math.min(1, density * p.densitySensitivity));
    amp.gain.cancelScheduledValues(now);
    amp.gain.setValueAtTime(amp.gain.value, now);
    amp.gain.setTargetAtTime(targetAmp, now, 0.04);

    // density → carrier pitch (pitchBase + density * pitchRange cents)
    let targetFreq = p.pitchBase * Math.pow(2, (density * p.pitchRange) / 1200);
    // Snap to the active ethnic scale (root = pitchBase) when a quantizer is set.
    if (this.quantizer) targetFreq = this.quantizer(targetFreq, p.pitchBase);
    carrier.frequency.cancelScheduledValues(now);
    carrier.frequency.setValueAtTime(carrier.frequency.value, now);
    carrier.frequency.setTargetAtTime(targetFreq, now, 0.03);

    // complexity → fmDepth
    const targetFmDepth = Math.max(0, complexity * p.fmAmount);
    fmDepth.gain.cancelScheduledValues(now);
    fmDepth.gain.setValueAtTime(fmDepth.gain.value, now);
    fmDepth.gain.setTargetAtTime(targetFmDepth, now, 0.05);

    // toggleRate → mod frequency (0.5 – 20 Hz)
    const targetModFreq = 0.5 + Math.min(1, toggleRate) * 20;
    mod.frequency.cancelScheduledValues(now);
    mod.frequency.setValueAtTime(mod.frequency.value, now);
    mod.frequency.setTargetAtTime(targetModFreq, now, 0.05);

    // scanPhase → slow gain wobble on output
    const wobble = 0.85 + 0.15 * Math.sin(scanPhase * Math.PI * 2);
    output.gain.cancelScheduledValues(now);
    output.gain.setValueAtTime(output.gain.value, now);
    output.gain.setTargetAtTime(p.sineMix * wobble, now, 0.12);
  }

  // Install / clear the scale quantizer. fn(hz, rootHz) => hz, or null to glide.
  setQuantizer(fn) {
    this.quantizer = typeof fn === "function" ? fn : null;
  }

  // Immediate UI param update
  setParam(name, value) {
    this.params[name] = value;
    if (!this.running || !this.nodes) return;

    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const { carrier, fmDepth, amp, output } = this.nodes;

    switch (name) {
      case 'sineMix':
        output.gain.cancelScheduledValues(now);
        output.gain.setValueAtTime(output.gain.value, now);
        output.gain.setTargetAtTime(value, now, 0.03);
        break;
      case 'fmAmount':
        fmDepth.gain.cancelScheduledValues(now);
        fmDepth.gain.setValueAtTime(fmDepth.gain.value, now);
        fmDepth.gain.setTargetAtTime(value, now, 0.03);
        break;
      case 'pitchBase': {
        const density = amp.gain.value / Math.max(0.001, this.params.densitySensitivity);
        const freq = value * Math.pow(2, (density * this.params.pitchRange) / 1200);
        carrier.frequency.cancelScheduledValues(now);
        carrier.frequency.setValueAtTime(carrier.frequency.value, now);
        carrier.frequency.setTargetAtTime(freq, now, 0.03);
        break;
      }
    }
  }
}
