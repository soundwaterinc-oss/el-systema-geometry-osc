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
// Pre-tabulated λ_mn for three edge conditions (m=0..5, n=1..4). Frequencies
// go as (λ_mn / λ_01)². These are the standard clamped / simply-supported /
// free plate eigenvalue roots (rounded); good enough for a playable timbre.
export const PLATE_LAMBDA = {
  clamped: [
    [3.196, 6.306, 9.440, 12.577],
    [4.611, 7.799, 10.958, 14.108],
    [5.906, 9.197, 12.402, 15.580],
    [7.144, 10.537, 13.795, 17.005],
    [8.347, 11.837, 15.148, 18.396],
    [9.526, 13.107, 16.471, 19.758],
  ],
  ss: [ // simply supported
    [2.222, 5.452, 8.611, 11.761],
    [3.728, 6.960, 10.137, 13.297],
    [5.061, 8.373, 11.590, 14.769],
    [6.309, 9.720, 12.982, 16.191],
    [7.501, 11.016, 14.331, 17.571],
    [8.653, 12.276, 15.649, 18.919],
  ],
  free: [
    [2.315, 5.940, 9.286, 12.548],
    [1.640, 4.157, 7.501, 10.780],
    [2.793, 5.882, 9.180, 12.500],
    [4.089, 7.409, 10.769, 14.100],
    [5.319, 8.860, 12.290, 15.660],
    [6.500, 10.240, 13.740, 17.150],
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
export function playBuffer(ctx, buf, destination, vel = 1) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = 0.25 + 0.75 * vel;
  src.connect(g).connect(destination || ctx.destination);
  src.start();
  return src;
}
