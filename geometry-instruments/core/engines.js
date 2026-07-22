// engines.js — the eight ENGINE SLOTS of the master platform.
//
// Every engine speaks one interface so the mod matrix and the control surface
// can treat them uniformly:
//   engine.output               AudioNode fed into the slot's level→panner→bus
//   engine.setParam(name, val)  name ∈ fBase | shape1 | shape2   (val 0..1 for shapes)
//   engine.trigger(excite)      inject energy (a strike / a pulse)
//   engine.setLatch(bool)       freeze the field into a sustained drone
//   engine.processControl(dt)   step control-rate state → returns {env, x, y}
// Sound material is only eigenmodes / dynamical systems (catalog A1–A8). No
// scale, no tempo. fBase is Hz; shape1/shape2 are normalised 0..1 dials whose
// meaning depends on the engine (documented per class).

import { membraneModes, membraneExcitation, plateMorphRatios } from './modal.js';
import { besselJArray } from './bessel.js';
import { tune, primeRatio, PHI, SILVER } from './tuning.js';

const TWO_PI = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------- modal base
// Shared by membrane / plate / spatial: a bank of decaying sinusoids whose
// amplitudes are the strike excitation and whose frequencies are the shape's
// eigen-ratios. Gains may go negative (phase) — that is fine for a GainNode.
class ModalBank {
  constructor(ctx, meta) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 1;
    this.meta = meta;                 // [{ratio, m, coef}] coef = J_m radial factor helper
    this.voices = meta.map((md) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g).connect(this.output);
      osc.start();
      return { osc, g, amp: 0 };
    });
    this.fBase = 200;
    this.tau = 2.6;
    this.strikeR = 0.42;
    this.latched = false;
    this.env = 0;
    this.x = 0; this.y = 0;
    this._setFreqs();
  }
  _setFreqs() {
    const t = this.ctx.currentTime;
    for (let i = 0; i < this.voices.length; i++)
      this.voices[i].osc.frequency.setTargetAtTime(this.fBase * this.meta[i].ratio, t, 0.03);
  }
  setParam(name, v) {
    if (name === 'fBase') { this.fBase = v; this._setFreqs(); }
    else if (name === 'shape1') { this.strikeR = clamp(v, 0, 0.98); }   // strike radius = timbre
    else if (name === 'shape2') { this.tau = 0.25 + v * 6; }            // decay τ
  }
  trigger(excite = 1) {
    // excitation = projection of the strike point onto each mode shape.
    const amps = membraneExcitation(
      this.meta.map((m) => ({ m: m.m, alpha: m.alpha })), this.strikeR, this.theta || 0);
    for (let i = 0; i < this.voices.length; i++) this.voices[i].amp = amps[i] * excite;
    this.env = 1;
  }
  setLatch(b) { this.latched = b; }
  processControl(dt) {
    const dec = this.latched ? 1 : Math.exp(-dt / this.tau);
    const norm = 0.13 / Math.sqrt(this.voices.length);
    let e = 0;
    const t = this.ctx.currentTime;
    for (const v of this.voices) {
      v.amp *= dec;
      e += Math.abs(v.amp);
      v.g.gain.setTargetAtTime(v.amp * norm, t, 0.006);
    }
    this.env = clamp(e, 0, 1);
    return { env: this.env, x: this.x, y: this.y };
  }
}

// Membrane: circular-membrane Bessel modes (A1). shape1=strike radius, shape2=τ.
export class MembraneEngine extends ModalBank {
  constructor(ctx) {
    const modes = membraneModes(3, 3); // 12 modes — enough colour, cheap
    super(ctx, modes.map((m) => ({ ratio: m.ratio, m: m.m, alpha: m.alpha })));
    this.fBase = 190; this._setFreqs();
    this.kind = 'membrane';
  }
}

// Spatial: same modal material, meant to be moved through space (A1/A5). The
// slot panner does the HRTF; here we bias toward lower, longer modes.
export class SpatialEngine extends ModalBank {
  constructor(ctx) {
    const modes = membraneModes(4, 2);
    super(ctx, modes.map((m) => ({ ratio: m.ratio, m: m.m, alpha: m.alpha })));
    this.fBase = 150; this.tau = 4; this._setFreqs();
    this.kind = 'spatial';
  }
}

// Plate / Chladni: f∝λ², shape1 morphs clamped↔ss↔free (A1/A8). shape2=τ.
export class PlateEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.morph = 0;
    this.M = 4; this.N = 3;
    this.modeList = plateMorphRatios(this.morph, this.M, this.N);
    this.voices = this.modeList.map((md) => {
      const osc = ctx.createOscillator(); osc.type = 'sine';
      const g = ctx.createGain(); g.gain.value = 0;
      osc.connect(g).connect(this.output); osc.start();
      return { osc, g, amp: 0, m: md.m };
    });
    this.fBase = 130; this.tau = 3.4; this.strikeR = 0.4;
    this.latched = false; this.env = 0; this.x = 0; this.y = 0;
    this.kind = 'plate';
    this._setFreqs();
  }
  _setFreqs() {
    const t = this.ctx.currentTime;
    for (let i = 0; i < this.voices.length; i++)
      this.voices[i].osc.frequency.setTargetAtTime(this.fBase * this.modeList[i].ratio, t, 0.03);
  }
  setParam(name, v) {
    if (name === 'fBase') { this.fBase = v; this._setFreqs(); }
    else if (name === 'shape1') {                       // edge morph
      this.morph = clamp(v, 0, 1);
      this.modeList = plateMorphRatios(this.morph, this.M, this.N);
      this._setFreqs();
    } else if (name === 'shape2') { this.tau = 0.3 + v * 6; }
  }
  trigger(excite = 1) {
    for (let i = 0; i < this.voices.length; i++) {
      const lam = Math.sqrt(this.modeList[i].ratio) * 2.3;
      const jr = besselJArray(lam * this.strikeR, this.voices[i].m)[this.voices[i].m];
      this.voices[i].amp = jr * excite;
    }
    this.env = 1;
  }
  setLatch(b) { this.latched = b; }
  processControl(dt) {
    const dec = this.latched ? 1 : Math.exp(-dt / this.tau);
    const norm = 0.12 / Math.sqrt(this.voices.length);
    let e = 0; const t = this.ctx.currentTime;
    for (const v of this.voices) { v.amp *= dec; e += Math.abs(v.amp); v.g.gain.setTargetAtTime(v.amp * norm, t, 0.006); }
    this.env = clamp(e, 0, 1);
    return { env: this.env, x: this.x, y: this.y };
  }
}

// Lorenz: continuous chaotic voice (A3). shape1=ρ, shape2=β. env=|velocity|.
export class LorenzEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.osc = ctx.createOscillator(); this.osc.type = 'sawtooth';
    this.sub = ctx.createOscillator(); this.sub.type = 'sine';
    this.subG = ctx.createGain(); this.subG.gain.value = 0.4;
    this.filt = ctx.createBiquadFilter(); this.filt.type = 'lowpass'; this.filt.Q.value = 5;
    this.osc.connect(this.filt); this.sub.connect(this.subG).connect(this.filt);
    this.filt.connect(this.output); this.osc.start(); this.sub.start();
    this.s = { x: 0.9, y: 0, z: 20 };
    this.rho = 28; this.sig = 10; this.bet = 8 / 3;
    this.fBase = 260; this.latched = false;
    this.env = 0; this.x = 0; this.y = 0;
    this.kind = 'lorenz';
  }
  setParam(name, v) {
    if (name === 'fBase') this.fBase = v;
    else if (name === 'shape1') this.rho = 24 + clamp(v, 0, 1) * 22;   // ρ 24..46
    else if (name === 'shape2') this.bet = 1.6 + clamp(v, 0, 1) * 2.4; // β
  }
  trigger() { this.s.x += 4; }          // kick the trajectory
  setLatch(b) { this.latched = b; }
  _d(p) { return { x: this.sig * (p.y - p.x), y: p.x * (this.rho - p.z) - p.y, z: p.x * p.y - this.bet * p.z }; }
  processControl(dt) {
    if (!this.latched) {
      const h = Math.min(0.02, dt) * 1.2;
      const p = this.s, a = this._d(p);
      const b = this._d({ x: p.x + a.x * h / 2, y: p.y + a.y * h / 2, z: p.z + a.z * h / 2 });
      const c = this._d({ x: p.x + b.x * h / 2, y: p.y + b.y * h / 2, z: p.z + b.z * h / 2 });
      const d = this._d({ x: p.x + c.x * h, y: p.y + c.y * h, z: p.z + c.z * h });
      this.s = { x: p.x + h / 6 * (a.x + 2 * b.x + 2 * c.x + d.x), y: p.y + h / 6 * (a.y + 2 * b.y + 2 * c.y + d.y), z: p.z + h / 6 * (a.z + 2 * b.z + 2 * c.z + d.z) };
    }
    const t = this.ctx.currentTime;
    const norm = clamp((this.s.x + 25) / 50, 0, 1);
    const f = this.fBase / 260 * (60 * Math.pow(1200 / 60, norm));
    this.osc.frequency.setTargetAtTime(f, t, 0.02);
    this.sub.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    this.filt.frequency.setTargetAtTime(300 + Math.abs(this.s.z) * 90, t, 0.03);
    this.x = clamp(this.s.x / 25, -1, 1); this.y = clamp(this.s.y / 26, -1, 1);
    this.env = clamp(Math.abs(this._d(this.s).x) / 200, 0, 1);
    return { env: this.env, x: this.x, y: this.y };
  }
}

// Kuramoto: N phase oscillators that lock with coupling K (A4). shape1=K, shape2=spread.
export class KuramotoEngine {
  constructor(ctx) {
    this.ctx = ctx; this.N = 8;
    this.output = ctx.createGain();
    this.omega = []; this.theta = []; this.voices = [];
    for (let i = 0; i < this.N; i++) {
      this.omega.push(0.7 + primeRatio(i) * 0.5);
      this.theta.push(Math.random() * TWO_PI);
      const osc = ctx.createOscillator(); osc.type = 'sine';
      const g = ctx.createGain(); g.gain.value = 0.6 / this.N;
      osc.connect(g).connect(this.output); osc.start();
      this.voices.push({ osc, g });
    }
    this.K = 0.6; this.spread = 1; this.fBase = 170;
    this.latched = false; this.env = 0; this.x = 0; this.y = 0;
    this.kind = 'kuramoto';
  }
  setParam(name, v) {
    if (name === 'fBase') this.fBase = v;
    else if (name === 'shape1') this.K = clamp(v, 0, 1) * 6;
    else if (name === 'shape2') this.spread = clamp(v, 0, 1) * 2;
  }
  trigger() { for (let i = 0; i < this.N; i++) this.theta[i] += (Math.random() - 0.5) * 0.8; }
  setLatch(b) { this.latched = b; }
  processControl(dt) {
    let sx = 0, sy = 0;
    for (let i = 0; i < this.N; i++) { sx += Math.cos(this.theta[i]); sy += Math.sin(this.theta[i]); }
    sx /= this.N; sy /= this.N;
    const r = Math.hypot(sx, sy), psi = Math.atan2(sy, sx);
    const vels = new Array(this.N); let vbar = 0;
    for (let i = 0; i < this.N; i++) { const v = this.omega[i] * this.spread + this.K * r * Math.sin(psi - this.theta[i]); vels[i] = v; vbar += v; }
    vbar /= this.N;
    const step = this.latched ? 0 : dt;
    const t = this.ctx.currentTime;
    for (let i = 0; i < this.N; i++) {
      this.theta[i] += vels[i] * step;
      this.voices[i].osc.frequency.setTargetAtTime(this.fBase * Math.exp(0.28 * (vels[i] - vbar)), t, 0.03);
    }
    // fuller when synced
    this.output.gain.setTargetAtTime(0.5 + 0.5 * r, t, 0.1);
    this.x = clamp(sx, -1, 1); this.y = clamp(sy, -1, 1);
    this.env = clamp(r, 0, 1);
    return { env: this.env, x: this.x, y: this.y };
  }
}

// Phyllotaxis: golden-angle seeds, a log-spiral playhead fires them (A7). shape1=scan, shape2=winding.
export class PhyllotaxisEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.Nseeds = 200; this.scan = 0.5; this.bWind = Math.log(PHI) / (Math.PI / 2);
    this.fBase = 120; this.latched = false;
    this.env = 0; this.x = 0; this.y = 0; this.headTh = 0; this.kind = 'phyllotaxis';
    this._build();
  }
  _build() {
    this.seeds = [];
    const c = 1 / Math.sqrt(this.Nseeds);
    for (let k = 1; k <= this.Nseeds; k++) {
      const r = c * Math.sqrt(k), th = k * 137.507 * Math.PI / 180;
      this.seeds.push({ r, th, freq: 90 * Math.pow(PHI, r * 3.2), pan: Math.cos(th), cool: 0 });
    }
  }
  setParam(name, v) {
    if (name === 'fBase') this.fBase = v;
    else if (name === 'shape1') this.scan = clamp(v, 0, 1);
    else if (name === 'shape2') this.bWind = 0.15 + clamp(v, 0, 1) * 0.4;
  }
  trigger() { this.headTh = 0; }
  setLatch(b) { this.latched = b; }
  _fire(sd) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.value = sd.freq * (this.fBase / 120);
    const g = ctx.createGain(); const p = ctx.createStereoPanner(); p.pan.value = clamp(sd.pan, -1, 1);
    o.connect(g).connect(p).connect(this.output);
    const tau = 0.4 + 60 / sd.freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0006, t + tau);
    o.start(t); o.stop(t + tau + 0.05);
    this.env = 1;
  }
  processControl(dt) {
    if (!this.latched) {
      this.headTh += this.scan * dt * 9;
      let headR = 0.03 * Math.exp(this.bWind * this.headTh);
      if (headR > 1.05) { this.headTh = 0; headR = 0.03; }
      const hx = headR * Math.cos(this.headTh), hy = headR * Math.sin(this.headTh);
      this.x = clamp(hx, -1, 1); this.y = clamp(hy, -1, 1);
      const thr = 0.05;
      for (const sd of this.seeds) {
        if (sd.cool > 0) { sd.cool -= dt; continue; }
        const sx = sd.r * Math.cos(sd.th), sy = sd.r * Math.sin(sd.th);
        if (Math.hypot(sx - hx, sy - hy) < thr) { sd.cool = 0.15; this._fire(sd); }
      }
    }
    this.env *= Math.exp(-dt / 0.25);
    return { env: clamp(this.env, 0, 1), x: this.x, y: this.y };
  }
}

// String: eigenmodes of a plucked ideal string (1D wave equation) with a little
// stiffness inharmonicity B → f_n = n·f·√(1+B n²). shape1 = pluck position (which
// partials are excited — the timbre), shape2 = decay. Struck via trigger (a pluck).
// A genuinely plucked/struck material, unlike the soft modal pads.
export class StringEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.P = 18;                       // partials
    this.B = 0.0006;                   // stiffness inharmonicity
    this.voices = [];
    for (let n = 1; n <= this.P; n++) {
      const osc = ctx.createOscillator(); osc.type = 'sine';
      const g = ctx.createGain(); g.gain.value = 0;
      osc.connect(g).connect(this.output); osc.start();
      this.voices.push({ osc, g, amp: 0, n });
    }
    this.fBase = 140; this.pluck = 0.22; this.tau = 2.4;
    this.latched = false; this.env = 0; this.x = 0; this.y = 0; this.kind = 'string';
    this._setFreqs();
  }
  _ratio(n) { return n * Math.sqrt(1 + this.B * n * n); }
  _setFreqs() {
    const t = this.ctx.currentTime;
    for (const v of this.voices)
      v.osc.frequency.setTargetAtTime(clamp(this.fBase * this._ratio(v.n), 20, 18000), t, 0.02);
  }
  setParam(name, v) {
    if (name === 'fBase') { this.fBase = v; this._setFreqs(); }
    else if (name === 'shape1') { this.pluck = 0.02 + clamp(v, 0, 1) * 0.46; }  // pluck position
    else if (name === 'shape2') { this.tau = 0.4 + clamp(v, 0, 1) * 5; }        // decay
  }
  trigger(excite = 1) {
    const p = this.pluck;
    // modal amplitude of a string plucked at position p: ∝ sin(nπp)/n²
    for (const v of this.voices) v.amp = (Math.sin(v.n * Math.PI * p) / (v.n * v.n)) * excite * 3.4;
    this.env = 1;
  }
  setLatch(b) { this.latched = b; }
  processControl(dt) {
    const t = this.ctx.currentTime; const norm = 0.5 / Math.sqrt(this.P); let e = 0;
    for (const v of this.voices) {
      const tauN = this.latched ? 1e9 : this.tau / (1 + 0.12 * (v.n - 1));   // highs damp faster
      v.amp *= Math.exp(-dt / tauN); e += Math.abs(v.amp);
      v.g.gain.setTargetAtTime(v.amp * norm, t, 0.005);
    }
    this.env = clamp(e, 0, 1);
    return { env: this.env, x: this.x, y: this.y };
  }
}

// FM: two-operator frequency modulation whose modulator ratio is a geometric
// constant (φ, √2, √5, 1+√2, φ², 3.5) → inharmonic bell / mallet / metallic
// timbres. shape1 = ratio select, shape2 = mod index (brightness). The index rides
// the amplitude envelope, so struck notes brighten then darken like real bells.
const FM_RATIOS = [Math.SQRT2, PHI, Math.sqrt(5), SILVER, PHI * PHI, 3.5];
export class FMEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.car = ctx.createOscillator(); this.car.type = 'sine';
    this.mod = ctx.createOscillator(); this.mod.type = 'sine';
    this.modG = ctx.createGain(); this.modG.gain.value = 0;
    this.amp = ctx.createGain(); this.amp.gain.value = 0;
    this.mod.connect(this.modG).connect(this.car.frequency);
    this.car.connect(this.amp).connect(this.output);
    this.car.start(); this.mod.start();
    this.fBase = 180; this.ratioSel = 1; this.index = 3.5; this.tau = 2.2;
    this.a = 0; this.latched = false; this.env = 0; this.x = 0; this.y = 0; this.kind = 'fm';
    this._setFreqs();
  }
  _ratio() { return FM_RATIOS[this.ratioSel % FM_RATIOS.length]; }
  _setFreqs() {
    const t = this.ctx.currentTime;
    this.car.frequency.setTargetAtTime(this.fBase, t, 0.02);
    this.mod.frequency.setTargetAtTime(this.fBase * this._ratio(), t, 0.02);
  }
  setParam(name, v) {
    if (name === 'fBase') { this.fBase = v; this._setFreqs(); }
    else if (name === 'shape1') { this.ratioSel = Math.floor(clamp(v, 0, 0.999) * FM_RATIOS.length); this._setFreqs(); }
    else if (name === 'shape2') { this.index = 0.5 + clamp(v, 0, 1) * 9; }
  }
  trigger(excite = 1) { this.a = excite; this.env = 1; }
  setLatch(b) { this.latched = b; }
  processControl(dt) {
    const t = this.ctx.currentTime;
    this.a *= this.latched ? 1 : Math.exp(-dt / this.tau);
    // FM depth in Hz = carrier·ratio·index·envelope → spectrum evolves with the strike
    this.modG.gain.setTargetAtTime(this.fBase * this._ratio() * this.index * this.a, t, 0.01);
    this.amp.gain.setTargetAtTime(this.a * 0.32, t, 0.008);
    this.env = clamp(this.a, 0, 1);
    return { env: this.env, x: this.x, y: this.y };
  }
}

// Noise-resonator: filtered noise drives a bank of band-passes tuned to membrane
// eigen-ratios — the driven wave equation, i.e. a bowed / blown / scraped body.
// A sustained texture (no strike needed). shape1 = excitation brightness, shape2 =
// resonance Q. Fills the palette's "continuous airy" corner.
export class NoiseEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.src = ctx.createBufferSource(); this.src.buffer = buf; this.src.loop = true; this.src.start();
    this.exG = ctx.createGain(); this.exG.gain.value = 0;
    this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 1400;
    this.src.connect(this.tone).connect(this.exG);
    this.ratios = membraneModes(3, 2).map((m) => m.ratio);   // 8 resonator modes
    this.bp = this.ratios.map(() => {
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 18;
      this.exG.connect(f).connect(this.output); return f;
    });
    this.fBase = 160; this.drive = 0;
    this.latched = false; this.env = 0; this.x = 0; this.y = 0; this.kind = 'noise';
    this._setFreqs();
  }
  _setFreqs() {
    const t = this.ctx.currentTime;
    for (let i = 0; i < this.bp.length; i++)
      this.bp[i].frequency.setTargetAtTime(clamp(this.fBase * this.ratios[i], 20, 16000), t, 0.03);
  }
  setParam(name, v) {
    const t = this.ctx.currentTime;
    if (name === 'fBase') { this.fBase = v; this._setFreqs(); }
    else if (name === 'shape1') { this.tone.frequency.setTargetAtTime(300 + clamp(v, 0, 1) * 5200, t, 0.05); }
    else if (name === 'shape2') { const q = 4 + clamp(v, 0, 1) * 42; for (const f of this.bp) f.Q.setTargetAtTime(q, t, 0.05); }
  }
  trigger(excite = 1) { this.drive = Math.min(1.4, this.drive + excite * 0.5); this.env = 1; }
  setLatch(b) { this.latched = b; }
  processControl(dt) {
    const t = this.ctx.currentTime;
    if (!this.latched) this.drive *= Math.exp(-dt / 1.6);
    const level = this.latched ? 0.5 : (0.12 + this.drive * 0.55);   // always a floor of texture
    this.exG.gain.setTargetAtTime(level * 0.5, t, 0.05);
    this.env = clamp(level, 0, 1);
    return { env: this.env, x: this.x, y: this.y };
  }
}

// Rössler: a single-scroll chaotic attractor — a smoother, more tonal sibling of
// Lorenz (A3). shape1 = a (spiral tightness), shape2 = c (folding). Gliding voice.
export class RosslerEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.osc = ctx.createOscillator(); this.osc.type = 'triangle';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'sine';
    this.g2 = ctx.createGain(); this.g2.gain.value = 0.3;
    this.filt = ctx.createBiquadFilter(); this.filt.type = 'bandpass'; this.filt.Q.value = 3;
    this.osc.connect(this.filt); this.osc2.connect(this.g2).connect(this.filt); this.filt.connect(this.output);
    this.osc.start(); this.osc2.start();
    this.s = { x: 0.1, y: 0, z: 0 };
    this.a = 0.2; this.b = 0.2; this.c = 5.7;
    this.fBase = 200; this.latched = false; this.env = 0; this.x = 0; this.y = 0; this.kind = 'rossler';
  }
  setParam(name, v) {
    if (name === 'fBase') this.fBase = v;
    else if (name === 'shape1') this.a = 0.1 + clamp(v, 0, 1) * 0.28;   // a 0.1..0.38
    else if (name === 'shape2') this.c = 3 + clamp(v, 0, 1) * 9;        // c 3..12 (folding)
  }
  trigger() { this.s.x += 1.5; }
  setLatch(b) { this.latched = b; }
  _d(p) { return { x: -p.y - p.z, y: p.x + this.a * p.y, z: this.b + p.z * (p.x - this.c) }; }
  processControl(dt) {
    if (!this.latched) {
      const h = Math.min(0.03, dt) * 2.2;          // Rössler is slow → speed the clock
      const p = this.s, a = this._d(p);
      const b = this._d({ x: p.x + a.x * h / 2, y: p.y + a.y * h / 2, z: p.z + a.z * h / 2 });
      const c = this._d({ x: p.x + b.x * h / 2, y: p.y + b.y * h / 2, z: p.z + b.z * h / 2 });
      const d = this._d({ x: p.x + c.x * h, y: p.y + c.y * h, z: p.z + c.z * h });
      this.s = { x: p.x + h / 6 * (a.x + 2 * b.x + 2 * c.x + d.x), y: p.y + h / 6 * (a.y + 2 * b.y + 2 * c.y + d.y), z: p.z + h / 6 * (a.z + 2 * b.z + 2 * c.z + d.z) };
    }
    const t = this.ctx.currentTime;
    const norm = clamp((this.s.x + 10) / 20, 0, 1);
    const f = this.fBase * (0.5 + 1.6 * norm);
    this.osc.frequency.setTargetAtTime(f, t, 0.02);
    this.osc2.frequency.setTargetAtTime(f * 1.5, t, 0.03);
    this.filt.frequency.setTargetAtTime(clamp(f * (1 + Math.abs(this.s.z) * 0.15), 60, 8000), t, 0.03);
    this.output.gain.setTargetAtTime(0.5, t, 0.1);
    this.x = clamp(this.s.x / 9, -1, 1); this.y = clamp(this.s.y / 9, -1, 1);
    this.env = clamp(Math.abs(this._d(this.s).x) / 12, 0, 1);
    return { env: this.env, x: this.x, y: this.y };
  }
}

const REGISTRY = {
  membrane: MembraneEngine, plate: PlateEngine, lorenz: LorenzEngine,
  kuramoto: KuramotoEngine, phyllotaxis: PhyllotaxisEngine, spatial: SpatialEngine,
  string: StringEngine, fm: FMEngine, noise: NoiseEngine, rossler: RosslerEngine,
};
export const ENGINE_TYPES = Object.keys(REGISTRY);
export function createEngine(ctx, type) {
  const C = REGISTRY[type] || MembraneEngine;
  return new C(ctx);
}
