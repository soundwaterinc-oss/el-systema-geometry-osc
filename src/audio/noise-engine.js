import { getAudioContext } from './context.js?v=20260524-cellnoise-02';
import { getMasterBus } from './master.js?v=20260524-cellnoise-02';

/**
 * Noise Engine: 3 noise colors (white / pink / digital) routed through a
 * bandpass, with a parallel highpass "hiss" branch that fades in when
 * complexity + edgeIntensity rise. Buffers are pre-rendered for all 3 colors
 * and the active source is swapped on color change.
 */
export class NoiseEngine {
  constructor() {
    this.running = false;
    this.nodes = null;
    this.params = {
      noiseGain: 0.5,
      noiseBandFreq: 1200,
      noiseQ: 4.0,
      noiseColor: 'digital', // 'white' | 'pink' | 'digital'
      noiseMix: 0.4,
    };
    this._buffers = null;
  }

  _ensureBuffers() {
    if (this._buffers) return;
    const ctx = getAudioContext();
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 2);

    const white = ctx.createBuffer(1, len, sr);
    const w = white.getChannelData(0);
    for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;

    // Pink via Paul Kellet's IIR
    const pink = ctx.createBuffer(1, len, sr);
    const p = pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w0 = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w0 * 0.0555179;
      b1 = 0.99332 * b1 + w0 * 0.0750759;
      b2 = 0.96900 * b2 + w0 * 0.1538520;
      b3 = 0.86650 * b3 + w0 * 0.3104856;
      b4 = 0.55000 * b4 + w0 * 0.5329522;
      b5 = -0.7616 * b5 - w0 * 0.0168980;
      p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w0 * 0.5362) * 0.11;
      b6 = w0 * 0.115926;
    }

    // Digital: sample-and-hold of bipolar 1-bit fragments with occasional
    // mid-level holds → crunchy glitch texture
    const digital = ctx.createBuffer(1, len, sr);
    const d = digital.getChannelData(0);
    let held = 0;
    let cnt = 0;
    for (let i = 0; i < len; i++) {
      if (cnt-- <= 0) {
        const r = Math.random();
        held = r < 0.5 ? -1 : 1;
        if (r > 0.9) held *= 0.3;
        cnt = 8 + Math.floor(Math.random() * 40);
      }
      d[i] = held * 0.85;
    }

    this._buffers = { white, pink, digital };
  }

  _createSource(color) {
    const ctx = getAudioContext();
    const src = ctx.createBufferSource();
    src.buffer = this._buffers[color] || this._buffers.white;
    src.loop = true;
    return src;
  }

  start() {
    if (this.running) return;
    const ctx = getAudioContext();
    this._ensureBuffers();

    const src = this._createSource(this.params.noiseColor);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = this.params.noiseBandFreq;
    filter.Q.value = this.params.noiseQ;

    const hpFilter = ctx.createBiquadFilter();
    hpFilter.type = 'highpass';
    hpFilter.frequency.value = 3500;
    hpFilter.Q.value = 0.7;

    const hpGain = ctx.createGain();
    hpGain.gain.value = 0;

    const internalGain = ctx.createGain();
    internalGain.gain.value = 0;

    const output = ctx.createGain();
    output.gain.value = this.params.noiseMix;

    src.connect(filter);
    filter.connect(internalGain);
    internalGain.connect(output);

    src.connect(hpFilter);
    hpFilter.connect(hpGain);
    hpGain.connect(output);

    output.connect(getMasterBus().getInput());

    src.start();

    this.nodes = { src, filter, hpFilter, hpGain, internalGain, output };
    this.running = true;
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.nodes) {
      try { this.nodes.src.stop(); } catch (e) { }
      try { this.nodes.output.disconnect(); } catch (e) { }
      this.nodes = null;
    }
  }

  update(features) {
    if (!this.running || !this.nodes) return;
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const { density = 0, complexity = 0, toggleRate = 0, scanPhase = 0, edgeIntensity = 0, localContrast = 0, edgeCount = 0 } = features;
    const { filter, internalGain, hpGain } = this.nodes;
    const p = this.params;

    // density → noise level (so empty regions ≈ silence)
    const targetIntGain = p.noiseGain * (0.1 + density * 1.4);
    internalGain.gain.setTargetAtTime(targetIntGain, now, 0.04);

    // complexity → sharper Q
    const targetQ = p.noiseQ * (0.6 + complexity * 3.5 + localContrast * 1.2);
    filter.Q.setTargetAtTime(Math.min(40, targetQ), now, 0.08);

    // toggleRate + scanPhase → center-freq sweep (±1 octave from base)
    const sweep = Math.pow(2, (toggleRate - 0.5) * 1.8 + Math.sin(scanPhase * Math.PI * 2) * 0.4);
    const targetFreq = Math.max(40, Math.min(14000, p.noiseBandFreq * sweep));
    filter.frequency.setTargetAtTime(targetFreq, now, 0.06);

    // complexity + edgeIntensity → parallel hiss layer
    const hiss = Math.min(1, complexity * 0.55 + edgeIntensity * 0.45 + localContrast * 0.3 + edgeCount * 0.2) * p.noiseGain * 0.5;
    hpGain.gain.setTargetAtTime(hiss, now, 0.06);
  }

  _swapColor(color) {
    this.params.noiseColor = color;
    if (!this.running || !this.nodes) return;
    if (!this._buffers || !this._buffers[color]) return;

    const old = this.nodes.src;
    const newSrc = this._createSource(color);
    newSrc.connect(this.nodes.filter);
    newSrc.connect(this.nodes.hpFilter);
    newSrc.start();
    try { old.stop(); } catch (e) { }
    try { old.disconnect(); } catch (e) { }
    this.nodes.src = newSrc;
  }

  setParam(name, value) {
    if (name === 'noiseColor') {
      this._swapColor(value);
      return;
    }
    this.params[name] = value;
    if (!this.running || !this.nodes) return;
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const { filter, output } = this.nodes;
    if (name === 'noiseMix') {
      output.gain.setTargetAtTime(value, now, 0.02);
    } else if (name === 'noiseBandFreq') {
      filter.frequency.setTargetAtTime(value, now, 0.02);
    } else if (name === 'noiseQ') {
      filter.Q.setTargetAtTime(value, now, 0.02);
    }
    // noiseGain takes effect via update() through internalGain
  }
}
