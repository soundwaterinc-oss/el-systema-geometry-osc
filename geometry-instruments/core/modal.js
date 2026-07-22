// modal.js — the shared physical sound engine.
//
// A struck plate/membrane/shape is a sum of eigenmodes, each a decaying
// sinusoid. The SHAPE fixes the (inharmonic) frequency ratios; the STRIKE
// point fixes how strongly each mode is excited (its projection onto the mode
// shape). This is the core of EL-SYSTEMA: geometry, not a scale, decides pitch.
//
// This module builds mode tables and renders a one-shot additive voice into a
// short AudioBuffer, which is cheap and polyphonic. No BPM, no scale.

import { besselJArray, BESSEL_ZEROS, ALPHA_01 } from './bessel.js';

// ---- Circular membrane (A1): f_mn = f_base * alpha_mn / alpha_01 --------------
// Mode shape φ_mn(r,θ) = J_m(alpha_mn * r) * cos(m θ), r ∈ [0,1].
export function membraneModes(mMax = 5, nMax = 5) {
  const modes = [];
  for (let m = 0; m <= mMax; m++) {
    for (let n = 1; n <= nMax; n++) {
      const alpha = BESSEL_ZEROS[m][n - 1];
      modes.push({ m, n, alpha, ratio: alpha / ALPHA_01 });
    }
  }
  return modes; // f_mn = f_base * ratio
}

// Amplitude of each membrane mode when struck at (r, theta), r in [0,1].
export function membraneExcitation(modes, r, theta) {
  // besselJArray gives all orders at once for the argument alpha*r.
  return modes.map((mode) => {
    const arr = besselJArray(mode.alpha * r, mode.m);
    return arr[mode.m] * Math.cos(mode.m * theta);
  });
}

// ---- Thin circular plate / Chladni (A1, A8): f ∝ λ² ---------------------------
// λ_mn for three edge conditions (rows m=0..5, cols n=1..4). Frequencies go as
// (λ_mn / λ_01)². These are the Kirchhoff circular-plate eigenvalue roots,
// computed from the characteristic equations and cross-checked against scipy
// (Poisson ν=0.30; free/ss also match Leissa's published values):
//   clamped : J_m'(λ)I_m(λ) − J_m(λ)I_m'(λ) = 0
//   ss      : 2λ J_m(λ)I_m(λ) + (ν−1)[J_m(λ)I_m'(λ) − I_m(λ)J_m'(λ)] = 0
//   free    : det of [M_r=0, Kirchhoff V_r=0] on A·J_m(λr)+B·I_m(λr)
// (free rows exclude the λ=0 rigid-body modes; m=2 carries the global fundamental.)
export const PLATE_LAMBDA = {
  clamped: [
    [3.1962, 6.3064, 9.4395, 12.5771],
    [4.6109, 7.7993, 10.9581, 14.1086],
    [5.9057, 9.1969, 12.4022, 15.5795],
    [7.1435, 10.5367, 13.7951, 17.0053],
    [8.3466, 11.8367, 15.1499, 18.3960],
    [9.5257, 13.1074, 16.4751, 19.7583],
  ],
  ss: [ // simply supported
    [2.2215, 5.4516, 8.6114, 11.7609],
    [3.7280, 6.9627, 10.1377, 13.2967],
    [5.0610, 8.3736, 11.5887, 14.7717],
    [6.3212, 9.7236, 12.9875, 16.2014],
    [7.5393, 11.0319, 14.3475, 17.5957],
    [8.7294, 12.3093, 15.6773, 18.9613],
  ],
  free: [
    [3.0005, 6.2003, 9.3675, 12.5227],
    [4.5249, 7.7338, 10.9068, 14.0667],
    [2.3148, 5.9380, 9.1851, 12.3817],
    [3.5269, 7.2806, 10.5804, 13.8091],
    [4.6728, 8.5757, 11.9344, 15.1997],
    [5.7875, 9.8364, 13.2565, 16.5606],
  ],
};

export function plateModes(edge = 'clamped', mMax = 5, nMax = 4) {
  const tab = PLATE_LAMBDA[edge] || PLATE_LAMBDA.clamped;
  const ref = tab[0][0];
  const modes = [];
  for (let m = 0; m <= mMax; m++) {
    for (let n = 1; n <= nMax; n++) {
      const lam = tab[m][n - 1];
      modes.push({ m, n, lambda: lam, ratio: (lam / ref) ** 2 });
    }
  }
  return modes;
}

// Blend three plate spectra (clamped↔ss↔free) by a morph 0..1 → freq ratios.
// morph 0 = clamped, 0.5 = ss, 1 = free. Linear interpolation of ratios.
export function plateMorphRatios(morph, mMax = 5, nMax = 4) {
  const c = plateModes('clamped', mMax, nMax);
  const s = plateModes('ss', mMax, nMax);
  const f = plateModes('free', mMax, nMax);
  return c.map((cm, i) => {
    let ratio;
    if (morph <= 0.5) {
      const t = morph / 0.5;
      ratio = cm.ratio * (1 - t) + s[i].ratio * t;
    } else {
      const t = (morph - 0.5) / 0.5;
      ratio = s[i].ratio * (1 - t) + f[i].ratio * t;
    }
    return { m: cm.m, n: cm.n, ratio };
  });
}

// ---- Render an additive decaying-sinusoid voice into an AudioBuffer ----------
// modes: [{ratio}], amps: parallel array of excitation amplitudes.
// opts: { fBase, tauRef, tauExp, bright, dur, gain }
//   tau ∝ (fMin/f)^tauExp  → higher modes decay faster (physical).
//   bright 0..1 tilts energy toward higher modes (velocity/brightness).
export function renderModalBuffer(ctx, modes, amps, opts = {}) {
  const fBase = opts.fBase ?? 220;
  const tauRef = opts.tauRef ?? 2.4;
  const tauExp = opts.tauExp ?? 0.6;
  const bright = opts.bright ?? 0.5;
  const dur = opts.dur ?? Math.min(6, tauRef * 2.5);
  const gain = opts.gain ?? 0.9;
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(dur * sr));
  const buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);

  // Establish fMin for the tau law and cull inaudible modes.
  const freqs = modes.map((md) => fBase * md.ratio);
  const fMin = Math.min(...freqs);

  // Precompute per-mode params.
  const voices = [];
  let ampSum = 0;
  for (let i = 0; i < modes.length; i++) {
    const f = freqs[i];
    if (f < 20 || f > sr * 0.45) continue; // skip sub-audio / near-Nyquist
    const tau = tauRef * Math.pow(fMin / f, tauExp);
    // Brightness tilts amplitude by frequency; bright=1 lifts highs.
    const tilt = Math.pow(f / fMin, (bright - 0.5) * 1.4);
    const a = Math.abs(amps[i]) * tilt;
    if (a < 1e-4) continue;
    ampSum += a;
    voices.push({ w: 2 * Math.PI * f, tau, a, phase: Math.random() * 0.2 });
  }
  if (ampSum < 1e-9) return buf;
  const norm = (gain / ampSum);

  for (const v of voices) {
    const a = v.a * norm;
    const w = v.w;
    const invTau = 1 / v.tau;
    for (let t = 0; t < len; t++) {
      const time = t / sr;
      out[t] += a * Math.exp(-time * invTau) * Math.sin(w * time + v.phase);
    }
  }
  // Soft limiter to avoid clipping on dense strikes.
  for (let t = 0; t < len; t++) out[t] = Math.tanh(out[t] * 1.2);
  return buf;
}

// Fire a rendered buffer through a gain node (one-shot, polyphonic).
// `when` is an absolute AudioContext time; omit for "now". The scheduler passes
// a future time so auto-play stays smooth even when a background tab throttles
// the JS timer.
export function playBuffer(ctx, buf, destination, vel = 1, when = 0) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = 0.25 + 0.75 * vel;
  src.connect(g).connect(destination || ctx.destination);
  src.start(when && when > ctx.currentTime ? when : ctx.currentTime);
  return src;
}
