// modmatrix.js — the heart of the master platform.
//
// Modulation is itself natural: rates of change (d/dt), slow drift (∫), the
// interaction of two natural functions (cross product a·b), and non-periodic
// natural-function LFOs (golden / Lorenz / Kuramoto-r / 1f / gauss / Bessel).
// No tempo anywhere. Everything updates at the control rate (~200 Hz).

import { besselJArray } from './bessel.js';
import { PHI } from './tuning.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const GOLDEN = 137.507 * Math.PI / 180;

// ------------------------------------------------------- global natural LFOs
export class GlobalLFOs {
  constructor() {
    this.gA = 0;                       // golden angle accumulator
    this.lz = { x: 0.6, y: 0, z: 18 }; // small Lorenz
    this.kN = 6; this.kth = []; this.kom = [];
    for (let i = 0; i < this.kN; i++) { this.kth.push(Math.random() * 6.28); this.kom.push(0.5 + i * 0.23); }
    this.gaussPh = 0; this.besT = 0;
    this.pink = { b0: 0, b1: 0, b2: 0, v: 0 };
    this.values = { golden: 0, lorenz: 0, kuramoto_r: 0, pink: 0, gauss: 0, bessel: 0 };
  }
  update(dt, running = true) {
    if (!running) return this.values;  // global freeze holds the field
    // golden: two incommensurate golden sines → quasi-periodic, never repeats
    this.gA += dt * GOLDEN * 2.4;
    this.values.golden = 0.6 * Math.sin(this.gA) + 0.4 * Math.sin(this.gA * PHI);
    // lorenz
    const s = this.lz, sig = 10, rho = 28, bet = 8 / 3, h = Math.min(dt, 0.02);
    const dx = sig * (s.y - s.x), dy = s.x * (rho - s.z) - s.y, dz = s.x * s.y - bet * s.z;
    s.x += dx * h; s.y += dy * h; s.z += dz * h;
    this.values.lorenz = clamp(s.x / 22, -1, 1);
    // kuramoto order parameter r
    let sx = 0, sy = 0;
    for (let i = 0; i < this.kN; i++) { sx += Math.cos(this.kth[i]); sy += Math.sin(this.kth[i]); }
    sx /= this.kN; sy /= this.kN;
    const r = Math.hypot(sx, sy), psi = Math.atan2(sy, sx);
    for (let i = 0; i < this.kN; i++) this.kth[i] += (this.kom[i] + 1.4 * r * Math.sin(psi - this.kth[i])) * dt;
    this.values.kuramoto_r = r * 2 - 1;         // → [-1,1]
    // pink (Paul Kellet economy filter on white)
    const w = Math.random() * 2 - 1, p = this.pink;
    p.b0 = 0.99765 * p.b0 + w * 0.0990460;
    p.b1 = 0.96300 * p.b1 + w * 0.2965164;
    p.b2 = 0.57000 * p.b2 + w * 1.0526913;
    this.values.pink = clamp((p.b0 + p.b1 + p.b2 + w * 0.1848) * 0.18, -1, 1);
    // gauss window, non-periodic advance
    this.gaussPh += dt * 0.37;
    const frac = this.gaussPh - Math.floor(this.gaussPh);
    this.values.gauss = 2 * Math.exp(-((frac - 0.5) ** 2) / (2 * 0.11 ** 2)) - 1;
    // bessel J0 (argument wrapped so Miller recurrence stays cheap)
    this.besT = (this.besT + dt * 3.2) % 30;
    this.values.bessel = besselJArray(this.besT, 0)[0] * 1.6;
    return this.values;
  }
}

// ------------------------------------------------------------- source lookup
// name: 'off' | 'sl{i}' (slot env) | one of the global LFO names
export function sourceValue(name, slots, lfos) {
  if (!name || name === 'off') return 0;
  if (name[0] === 's' && name[1] >= '0' && name[1] <= '9') {
    const i = parseInt(name.slice(1), 10);
    const sl = slots[i];
    return sl ? sl.env * 2 - 1 : 0;   // slot env 0..1 → [-1,1]
  }
  return lfos.values[name] ?? 0;
}

export const SOURCE_NAMES = (n) => {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push('s' + i);
  return arr.concat(['golden', 'lorenz', 'kuramoto_r', 'pink', 'gauss', 'bessel']);
};
export const OPERATORS = ['thru', 'differentiate', 'integrate', 'sample&hold', 'abs'];
export const DEST_PARAMS = ['fBase', 'shape1', 'shape2', 'space', 'level'];

// --------------------------------------------------------------- the matrix
export class ModMatrix {
  constructor(nSlots, ctrlRate = 200) {
    this.n = nSlots;
    this.ctrlRate = ctrlRate;
    this.lfos = new GlobalLFOs();
    this.routes = [];                 // {src, op, cross, depth, destSlot, destParam, _st}
  }
  addRoute(r) {
    this.routes.push(Object.assign(
      { src: 'off', op: 'thru', cross: 'none', depth: 0, destSlot: 0, destParam: 'fBase',
        _st: { prev: 0, lp: 0, max: 1e-6, I: 0, hold: 0, acc: 0, interval: 0.3 } }, r));
    return this.routes.length - 1;
  }
  _applyOp(op, v, st, dt) {
    switch (op) {
      case 'differentiate': {
        const d = (v - st.prev) * this.ctrlRate; st.prev = v;
        st.lp += (d - st.lp) * 0.15;                       // one-pole smooth
        st.max = Math.max(st.max * 0.9995, Math.abs(st.lp));
        return clamp(st.lp / st.max, -1, 1);               // active only while moving
      }
      case 'integrate':
        st.I = 0.999 * st.I + 0.001 * v; return clamp(st.I * 4, -1, 1);
      case 'sample&hold':
        st.acc += dt;
        if (st.acc >= st.interval) { st.hold = v; st.acc = 0; st.interval = 0.18 + Math.random() * 0.6; }
        return st.hold;
      case 'abs': return Math.abs(v) * 2 - 1;
      default: return v;
    }
  }
  // Returns { '<slot>:<param>': summedOffset } to be added to base params.
  compute(slots, dt, running = true) {
    this.lfos.update(dt, running);
    const out = {};
    for (const rt of this.routes) {
      if (rt.depth === 0 || rt.src === 'off') continue;
      let v = sourceValue(rt.src, slots, this.lfos);
      v = this._applyOp(rt.op, v, rt._st, dt);
      if (rt.cross && rt.cross !== 'none') v *= sourceValue(rt.cross, slots, this.lfos);
      const key = rt.destSlot + ':' + rt.destParam;
      out[key] = (out[key] || 0) + rt.depth * v;
    }
    return out;
  }
}
