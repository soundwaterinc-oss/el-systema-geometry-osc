// fieldtransform.js — the FIELD layer.
//
// Everything the eight slots make is summed into one field. This layer takes that
// whole field and transforms it *one dimension up*: it treats the stereo signal as
// a 2-vector and rotates its basis, differentiates / integrates it in time, folds
// it through a natural function, and shifts its spectrum by a geometric-constant
// carrier. No scale, no tempo — only linear algebra, calculus and physical
// functions applied to the aggregate wave. Each operator can also be *driven* by a
// natural LFO (its MOTION), so the field breathes on its own and becomes playable.
//
//   input (all slots) → ROT → ∂/∫ → FOLD → SHIFT → wet ┐
//   input ───────────────────────────────── dry ───────┴→ output → master
//
// Graph note: gains may go negative (rotation matrix, difference filters) — fine.

import { besselJArray } from './bessel.js';
import { PHI, SILVER } from './tuning.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const FOLD_TYPES = ['sin', 'tanh', 'bessel'];
// operators that can be animated by a natural LFO, and the LFO menu itself
export const FIELD_MOTION_TARGETS = ['rot', 'order', 'fold', 'shift', 'res'];
export const FIELD_LFOS = ['off', 'golden', 'lorenz', 'kuramoto_r', 'pink', 'gauss', 'bessel'];

export class FieldTransform {
  constructor(ctx) {
    this.ctx = ctx;
    const G = () => ctx.createGain();
    this.input = G();
    this.output = G();

    // ---- dry tap (bypasses the whole layer) ----
    this.dry = G(); this.dry.gain.value = 1;
    this.input.connect(this.dry).connect(this.output);

    // ---- ROT: stereo vector rotation (2×2 orthogonal matrix) ----
    this.split = ctx.createChannelSplitter(2);
    this.merge = ctx.createChannelMerger(2);
    this.m00 = G(); this.m01 = G(); this.m10 = G(); this.m11 = G();
    this.input.connect(this.split);
    this.split.connect(this.m00, 0); this.m00.connect(this.merge, 0, 0);   // L' += cosθ·L
    this.split.connect(this.m01, 1); this.m01.connect(this.merge, 0, 0);   // L' += -sinθ·R
    this.split.connect(this.m10, 0); this.m10.connect(this.merge, 0, 1);   // R' += sinθ·L
    this.split.connect(this.m11, 1); this.m11.connect(this.merge, 0, 1);   // R' += cosθ·R
    this.m00.gain.value = 1; this.m11.gain.value = 1; this.m01.gain.value = 0; this.m10.gain.value = 0;

    // ---- ∂/∫: parallel integrate / dry / d/dt / d²/dt² blended by `order` ----
    // FIR difference filters are unconditionally stable; the leaky integrator has a
    // pole at 0.95 (DC gain normalised to 1). order ∈ [-1,2]: -1 ∫, 0 thru, 1 ∂, 2 ∂².
    this.integ = ctx.createIIRFilter([0.05], [1, -0.95]);   // leaky integrator (∫)
    this.diff1 = ctx.createIIRFilter([1, -1], [1]);         // first difference (d/dt)
    this.diff2 = ctx.createIIRFilter([1, -2, 1], [1]);      // second difference (d²/dt²)
    this.gI = G(); this.gD = G(); this.g1 = G(); this.g2 = G();
    this.diffOut = G();
    this.merge.connect(this.integ).connect(this.gI).connect(this.diffOut);
    this.merge.connect(this.gD).connect(this.diffOut);                     // dry-through of ROT
    this.merge.connect(this.diff1).connect(this.g1).connect(this.diffOut);
    this.merge.connect(this.diff2).connect(this.g2).connect(this.diffOut);
    this.gI.gain.value = 0; this.gD.gain.value = 1; this.g1.gain.value = 0; this.g2.gain.value = 0;

    // ---- FOLD: natural-function wavefolder ----
    this.shaper = ctx.createWaveShaper(); this.shaper.oversample = '4x';
    this.diffOut.connect(this.shaper);
    this._foldAmt = -1; this._foldType = 'sin'; this._buildCurve(0, 'sin');

    // ---- SHIFT: ring-modulate by a geometric-constant carrier ----
    this.shiftDry = G(); this.shiftDry.gain.value = 1;
    this.ring = G(); this.ring.gain.value = 0;              // gain driven by carrier·amount
    this.carrier = ctx.createOscillator(); this.carrier.type = 'sine';
    this.carDepth = G(); this.carDepth.gain.value = 0;      // = shift amount
    this.carrier.connect(this.carDepth).connect(this.ring.gain);
    this.carrier.frequency.value = 55; this.carrier.start();
    this.shiftOut = G();
    this.shaper.connect(this.shiftDry).connect(this.shiftOut);
    this.shaper.connect(this.ring).connect(this.shiftOut);

    // ---- RES: a 1D waveguide / feedback comb — pour the whole field into a
    // resonant cavity (standing waves of the wave equation in a tube). res = amount
    // and ring-length, resTune = cavity pitch (golden-spaced). ----
    this.resDry = G(); this.resDry.gain.value = 1;
    this.resSum = G();
    this.resDelay = ctx.createDelay(0.05);
    this.resDamp = ctx.createBiquadFilter(); this.resDamp.type = 'lowpass'; this.resDamp.frequency.value = 3000;
    this.resFB = G(); this.resFB.gain.value = 0;            // feedback (<1 for stability)
    this.resWet = G(); this.resWet.gain.value = 0;
    this.resOut = G();
    this.shiftOut.connect(this.resDry).connect(this.resOut);
    this.shiftOut.connect(this.resSum);
    this.resSum.connect(this.resDelay).connect(this.resDamp);
    this.resDamp.connect(this.resFB).connect(this.resSum); // the loop = the standing wave
    this.resDamp.connect(this.resWet).connect(this.resOut);
    this.resDelay.delayTime.value = 1 / 160;

    // ---- wet trim into output ----
    this.wet = G(); this.wet.gain.value = 0;               // mix (0 = layer bypassed)
    this.resOut.connect(this.wet).connect(this.output);

    // ---- stereo vectorscope taps (view the field as a vector) ----
    this.scopeSplit = ctx.createChannelSplitter(2);
    this.output.connect(this.scopeSplit);
    this.anL = ctx.createAnalyser(); this.anR = ctx.createAnalyser();
    this.anL.fftSize = 1024; this.anR.fftSize = 1024;
    this.scopeSplit.connect(this.anL, 0); this.scopeSplit.connect(this.anR, 1);

    // ---- parameters (all default to identity / bypass) ----
    this.p = { mix: 0, rot: 0, order: 0, fold: 0, shift: 0, shiftFreq: 0.25, res: 0, resTune: 0.4 };
    this.foldType = 'sin';
    this.motion = { rot: { src: 'off', depth: 0 }, order: { src: 'off', depth: 0 },
                    fold: { src: 'off', depth: 0 }, shift: { src: 'off', depth: 0 },
                    res: { src: 'off', depth: 0 } };
    this.eff = { ...this.p };                               // last effective values (for UI/viz)
  }

  // wavefold curve; amount 0 = identity, blended with a natural nonlinearity.
  _buildCurve(amt, type) {
    const n = 2048, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      let s;
      if (type === 'tanh') s = Math.tanh(x * (1 + amt * 6));
      else if (type === 'bessel') s = clamp(besselJArray(x * (1 + amt * 8) * 3, 1)[1] * 2.2, -1, 1);
      else s = Math.sin(Math.PI * x * (1 + amt * 3));       // sinusoidal fold
      c[i] = (1 - amt) * x + amt * s;
    }
    this.shaper.curve = c;
    this._foldAmt = amt; this._foldType = type;
  }

  setParam(name, v) {
    if (name in this.p) this.p[name] = v;
  }
  setFoldType(t) { if (FOLD_TYPES.includes(t)) this.foldType = t; }
  setMotion(target, src, depth) {
    const m = this.motion[target]; if (!m) return;
    if (src !== undefined) m.src = src;
    if (depth !== undefined) m.depth = depth;
  }
  _mot(name, lfos) {
    const m = this.motion[name];
    if (!m || m.src === 'off' || !m.depth) return 0;
    return (lfos[m.src] || 0) * m.depth;
  }

  // control-rate update. lfos = matrix.lfos.values (the natural functions).
  process(dt, lfos = {}) {
    const t = this.ctx.currentTime, TC = 0.03;
    const p = this.p, e = this.eff;

    // MIX (whole-layer dry/wet, equal-power)
    e.mix = clamp(p.mix + this._mot('mix', lfos), 0, 1);
    this.wet.gain.setTargetAtTime(Math.sin(e.mix * Math.PI / 2), t, TC);
    this.dry.gain.setTargetAtTime(Math.cos(e.mix * Math.PI / 2), t, TC);

    // ROT: θ ∈ [-π, π]
    e.rot = clamp(p.rot + this._mot('rot', lfos), -1, 1);
    const th = e.rot * Math.PI, cs = Math.cos(th), sn = Math.sin(th);
    this.m00.gain.setTargetAtTime(cs, t, TC); this.m11.gain.setTargetAtTime(cs, t, TC);
    this.m01.gain.setTargetAtTime(-sn, t, TC); this.m10.gain.setTargetAtTime(sn, t, TC);

    // ∂/∫: order ∈ [-1,2] across nodes at positions [-1,0,1,2] = [∫, dry, ∂, ∂²]
    e.order = clamp(p.order + this._mot('order', lfos), -1, 2);
    const w = this._orderWeights(e.order);
    this.gI.gain.setTargetAtTime(w[0] * 1.0, t, TC);
    this.gD.gain.setTargetAtTime(w[1] * 1.0, t, TC);
    this.g1.gain.setTargetAtTime(w[2] * 0.8, t, TC);   // makeup: ∂ boosts highs, trim level
    this.g2.gain.setTargetAtTime(w[3] * 0.5, t, TC);

    // FOLD: rebuild the shaper curve only when it actually moves (throttle)
    e.fold = clamp(p.fold + this._mot('fold', lfos), 0, 1);
    if (Math.abs(e.fold - this._foldAmt) > 0.02 || this.foldType !== this._foldType)
      this._buildCurve(e.fold, this.foldType);

    // SHIFT: ring-mod amount + geometric-constant carrier frequency
    e.shift = clamp(p.shift + this._mot('shift', lfos), 0, 1);
    this.carDepth.gain.setTargetAtTime(e.shift, t, TC);
    this.shiftDry.gain.setTargetAtTime(1 - e.shift, t, TC);
    e.shiftFreq = clamp(p.shiftFreq, 0, 1);
    // 18 Hz … ~18·φ^7 ≈ 530 Hz, spaced by the golden ratio (inharmonic translation)
    const cf = 18 * Math.pow(PHI, e.shiftFreq * 7) * (1 + 0.0001 * SILVER);
    this.carrier.frequency.setTargetAtTime(cf, t, TC);

    // RES: waveguide cavity — delay = 1/pitch, feedback = ring length (stable <1)
    e.res = clamp(p.res + this._mot('res', lfos), 0, 1);
    e.resTune = clamp(p.resTune, 0, 1);
    const rf = 40 * Math.pow(PHI, e.resTune * 6);          // 40 … ~715 Hz, golden-spaced
    this.resDelay.delayTime.setTargetAtTime(clamp(1 / rf, 0.0004, 0.05), t, 0.05);
    this.resDamp.frequency.setTargetAtTime(clamp(rf * 6, 500, 9000), t, TC);
    this.resWet.gain.setTargetAtTime(e.res, t, TC);
    this.resDry.gain.setTargetAtTime(1 - e.res * 0.7, t, TC);   // keep some dry through
    this.resFB.gain.setTargetAtTime(e.res * 0.88, t, TC);       // ring ∝ amount, <1 stable
  }

  // four-point crossfade weights for `order` over node positions [-1,0,1,2].
  _orderWeights(o) {
    const pos = [-1, 0, 1, 2], w = [0, 0, 0, 0];
    if (o <= pos[0]) { w[0] = 1; return w; }
    if (o >= pos[3]) { w[3] = 1; return w; }
    for (let i = 0; i < 3; i++) {
      if (o >= pos[i] && o <= pos[i + 1]) {
        const f = (o - pos[i]) / (pos[i + 1] - pos[i]);
        w[i] = 1 - f; w[i + 1] = f; return w;
      }
    }
    return w;
  }

  getState() { return { ...this.eff, foldType: this.foldType,
    motion: JSON.parse(JSON.stringify(this.motion)) }; }

  // full snapshot for save/score
  snapshot() {
    return { p: { ...this.p }, foldType: this.foldType,
      motion: JSON.parse(JSON.stringify(this.motion)) };
  }
  applySnapshot(s) {
    if (!s) return;
    if (s.p) Object.assign(this.p, s.p);
    if (s.foldType) this.foldType = s.foldType;
    if (s.motion) for (const k of FIELD_MOTION_TARGETS)
      if (s.motion[k]) this.motion[k] = { ...s.motion[k] };
  }
}
