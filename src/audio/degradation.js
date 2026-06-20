import { getAudioContext } from './context.js?v=20260524-cellnoise-02';

/**
 * Digital Degradation chain: bitcrush + sample-rate reduction + clip/fold
 * waveshaper. Always-on insert before master gain. With defaults
 * (bitDepth=16, srReduction=1, clipAmount=0) it is near-passthrough — but
 * feature modulation always nudges it: complexity + edgeIntensity push bits
 * down, toggleRate adds SR decimation, complexity + toggleRate stack onto
 * clipAmount.
 *
 * Uses ScriptProcessorNode for the temporal hold-and-quantize stage
 * (AudioWorklet is intentionally avoided per project constraints).
 */
export class Degradation {
  constructor() {
    this.params = {
      bitDepth: 16,
      sampleRateReduction: 1,
      clipAmount: 0,
    };
    this._featureMod = { bits: 0, sr: 0, clip: 0 };
    this._activeClip = 0;
    this._build();
  }

  _build() {
    const ctx = getAudioContext();

    this.input = ctx.createGain();
    this.input.gain.value = 1;

    this.proc = ctx.createScriptProcessor(1024, 1, 1);
    let phaser = 0;
    let held = 0;
    this.proc.onaudioprocess = (e) => {
      const inBuf = e.inputBuffer.getChannelData(0);
      const outBuf = e.outputBuffer.getChannelData(0);
      const baseBits = this.params.bitDepth;
      const bits = Math.max(1, Math.min(16, baseBits - this._featureMod.bits));
      const step = Math.pow(2, bits - 1);
      const baseSr = this.params.sampleRateReduction;
      const srReduction = Math.max(1, Math.min(80, Math.round(baseSr + this._featureMod.sr)));

      for (let i = 0; i < inBuf.length; i++) {
        if (phaser <= 0) {
          phaser = srReduction;
          held = Math.round(inBuf[i] * step) / step;
        }
        phaser -= 1;
        outBuf[i] = held;
      }
    };

    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = this._makeClipCurve(0);
    this.shaper.oversample = '2x';

    this.output = ctx.createGain();
    this.output.gain.value = 1;

    this.input.connect(this.proc);
    this.proc.connect(this.shaper);
    this.shaper.connect(this.output);
  }

  _makeClipCurve(amount) {
    const N = 4096;
    const curve = new Float32Array(N);
    const a = Math.max(0, Math.min(1, amount));
    const drive = 1 + a * 8;
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      const clip = Math.tanh(x * drive);
      const fold = Math.sin(x * drive * Math.PI * 0.5);
      const wet = 0.55 * clip + 0.45 * fold;
      curve[i] = (1 - a) * x + a * wet;
    }
    return curve;
  }

  getInput() { return this.input; }
  getOutput() { return this.output; }

  /**
   * Feature-driven modulation on top of user params.
   * complexity + edgeIntensity → bitDepth reduction (up to ~8 bits down)
   * toggleRate → extra SR decimation (up to +12)
   * complexity + toggleRate → clip auto-mod stacked on manual clipAmount
   */
  update(features) {
    const { complexity = 0, toggleRate = 0, edgeIntensity = 0, localContrast = 0, edgeCount = 0 } = features;
    this._featureMod.bits = complexity * 6 + edgeIntensity * 2 + localContrast * 1.5;
    this._featureMod.sr = toggleRate * 12 + edgeCount * 8;

    const target = Math.min(1, this.params.clipAmount + complexity * 0.35 + toggleRate * 0.2 + localContrast * 0.15);
    if (Math.abs(target - this._activeClip) > 0.04) {
      this._activeClip = target;
      this.shaper.curve = this._makeClipCurve(target);
    }
  }

  setParam(name, value) {
    this.params[name] = value;
    if (name === 'clipAmount') {
      // refresh immediately so manual slider feels responsive
      const target = Math.min(1, value);
      this._activeClip = target;
      this.shaper.curve = this._makeClipCurve(target);
    }
  }

  /**
   * Current effective degradation as a single 0..1 value, for visual glitch.
   * Combines bit reduction, sample-rate decimation and clip/fold amount
   * (user params + live feature modulation).
   */
  getDegradeAmount() {
    const bits = Math.max(1, Math.min(16, this.params.bitDepth - this._featureMod.bits));
    const sr = Math.max(1, Math.min(80, this.params.sampleRateReduction + this._featureMod.sr));
    const bitN = (16 - bits) / 15;
    const srN = Math.min(1, (sr - 1) / 24);
    const clip = Math.max(0, Math.min(1, this._activeClip));
    const amt = bitN * 0.45 + srN * 0.3 + clip * 0.5;
    return Math.max(0, Math.min(1, amt));
  }
}
