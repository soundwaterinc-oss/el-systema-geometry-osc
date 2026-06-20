import { getAudioContext } from './context.js?v=20260524-cellnoise-02';
import { getMasterBus } from './master.js?v=20260524-cellnoise-02';

/**
 * Pulse / Click Engine: scheduled short noise bursts.
 * - pulseRate sets base slot rate, which is also stretched by featureGate.
 * - burstDensity sets per-slot trigger probability (baseline 0.25, ×featureGate).
 * - When edgeIntensity / gate is high, additional sub-clicks fire within the
 *   slot → bursts.
 * - Click pitch is driven by density+complexity blend.
 * - Output is high-passed for a sharper transient.
 */
export class PulseEngine {
  constructor() {
    this.running = false;
    this.nodes = null;
    this.params = {
      clickGain: 0.7,
      pulseRate: 6,
      pulseWidth: 0.014,
      burstDensity: 0.5,
      pulseMix: 0.5,
    };
    this._noiseBuffer = null;
    this._nextClickTime = 0;
    this._scheduler = null;
    this._featureGate = 0;
    this._featurePitch = 0.5;
    this._featureEdge = 0;
  }

  _ensureBuffer() {
    if (this._noiseBuffer) return;
    const ctx = getAudioContext();
    const len = Math.floor(ctx.sampleRate * 0.05);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    this._noiseBuffer = buf;
  }

  start() {
    if (this.running) return;
    const ctx = getAudioContext();
    this._ensureBuffer();

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    hp.Q.value = 0.7;

    const output = ctx.createGain();
    output.gain.value = this.params.pulseMix;

    hp.connect(output);
    output.connect(getMasterBus().getInput());

    this.nodes = { hp, output };
    this.running = true;
    this._nextClickTime = ctx.currentTime + 0.05;
    this._tick();
  }

  _tick() {
    if (!this.running) return;
    const ctx = getAudioContext();
    const lookAhead = 0.12;
    const now = ctx.currentTime;

    // featureGate stretches the rate (more activity → more clicks)
    const rate = Math.max(0.25, this.params.pulseRate * (0.5 + this._featureGate * 1.5));
    const slot = 1 / rate;

    while (this._nextClickTime < now + lookAhead) {
      const baseP = Math.min(1, this.params.burstDensity * (0.25 + this._featureGate * 1.3));
      if (Math.random() < baseP) {
        this._scheduleClick(this._nextClickTime);

        // Burst mode: when edgeIntensity / featureGate is high, fire sub-clicks
        const burstChance = this._featureEdge * 0.7 + this._featureGate * 0.4;
        if (Math.random() < burstChance) {
          const extras = 1 + Math.floor(Math.random() * 3);
          for (let k = 1; k <= extras; k++) {
            const jitter = (slot * 0.6) * (k / (extras + 1)) + Math.random() * 0.004;
            this._scheduleClick(this._nextClickTime + jitter);
          }
        }
      }
      this._nextClickTime += slot;
    }

    this._scheduler = setTimeout(() => this._tick(), 25);
  }

  _scheduleClick(when) {
    const ctx = getAudioContext();
    const { hp } = this.nodes;

    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    // density+complexity pitched playback, plus random jitter for variety
    src.playbackRate.value = 0.4 + this._featurePitch * 2.2 + Math.random() * 0.6;

    const env = ctx.createGain();
    const g = this.params.clickGain;
    const dur = Math.max(0.002, this.params.pulseWidth);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(g, when + 0.0005);
    env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    src.connect(env);
    env.connect(hp);

    src.start(when);
    src.stop(when + dur + 0.02);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this._scheduler) {
      clearTimeout(this._scheduler);
      this._scheduler = null;
    }
    if (this.nodes) {
      try { this.nodes.output.disconnect(); } catch (e) { }
      this.nodes = null;
    }
  }

  /**
   * toggleRate + edgeIntensity + complexity drive the per-slot trigger
   * probability and the burst chance. density + complexity drive click pitch.
   */
  update(features) {
    if (!this.running) return;
    const { toggleRate = 0, edgeIntensity = 0, localContrast = 0, edgeCount = 0, complexity = 0, density = 0 } = features;
    this._featureGate = Math.min(1, toggleRate * 0.7 + edgeIntensity * 0.7 + localContrast * 0.4 + edgeCount * 0.5 + complexity * 0.3);
    this._featurePitch = Math.min(1, density * 0.6 + complexity * 0.6);
    this._featureEdge = Math.min(1, edgeIntensity * 0.6 + localContrast * 0.4 + edgeCount * 0.5);
  }

  setParam(name, value) {
    this.params[name] = value;
    if (!this.running || !this.nodes) return;
    if (name === 'pulseMix') {
      const ctx = getAudioContext();
      this.nodes.output.gain.setTargetAtTime(value, ctx.currentTime, 0.02);
    }
  }
}
