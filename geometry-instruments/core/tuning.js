// tuning.js — non-equal-temperament note→Hz.
//
// EL-SYSTEMA has dropped equal temperament, harmony and BPM. There is no
// 2^(n/12) anywhere. A MIDI note number becomes a frequency through one of
// the natural/irrational lattices in the catalog (A2): prime ratios, the
// golden ratio φ, the metallic ratios (silver/bronze), the harmonic series,
// or a continued-fraction lattice. None of these repeats at the octave the
// way tempered pitch does; that non-periodicity is the point.

export const PHI = (1 + Math.sqrt(5)) / 2;          // golden ratio, [1;1,1,1,…]
export const SILVER = 1 + Math.SQRT2;               // 1+√2
export const BRONZE = (3 + Math.sqrt(13)) / 2;      // (3+√13)/2

const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37];

// A cycle of just, prime-built ratios spanning roughly one "turn". Because the
// steps are prime fractions rather than a tempered log grid, transposing by a
// cycle does not land on a clean 2:1 — it drifts, which is intended.
const PRIME_CYCLE = [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 7 / 4, 11 / 6];

// Continued-fraction convergents of φ give the "most irrational" spacing.
function metallicStep(note, root, base) {
  // Spread notes geometrically along an irrational ratio, one step per note.
  // Divided by 12 so a MIDI keyboard octave still feels like a graspable span,
  // but the ratio is irrational so nothing ever recurs.
  return base * Math.pow(root, note / 12);
}

// mode: 'phi' | 'silver' | 'bronze' | 'prime' | 'harmonic' | 'octave-phi'
// opts: { base=110, refNote=48, primes=PRIMES }
export function tune(note, opts = {}) {
  const mode = opts.mode || 'phi';
  const base = opts.base || 110;
  const ref = opts.refNote ?? 48;
  const n = note - ref;

  switch (mode) {
    case 'phi':
      return metallicStep(n, PHI, base);
    case 'silver':
      return metallicStep(n, SILVER, base);
    case 'bronze':
      return metallicStep(n, BRONZE, base);
    case 'harmonic': {
      // note selects the k-th member of the harmonic series f = base * k.
      const k = Math.max(1, n + 1);
      return base * k;
    }
    case 'prime': {
      // Walk the prime cycle; each completed cycle multiplies by the next
      // prime ratio instead of a clean octave, so pitch space spirals.
      const cyc = PRIME_CYCLE.length;
      const turn = Math.floor(n / cyc);
      const idx = ((n % cyc) + cyc) % cyc;
      const primeMul = Math.pow(3 / 2, turn); // spiral by a fifth per turn
      return base * PRIME_CYCLE[idx] * primeMul;
    }
    case 'octave-phi': {
      // Golden-ratio spacing but anchored so every 8th note ~doubles: a hybrid
      // for players who still want a felt register while off the tempered grid.
      const oct = Math.floor(n / 8);
      const within = n - oct * 8;
      return base * Math.pow(2, oct) * Math.pow(PHI, within / 8 * 1.5);
    }
    default:
      return metallicStep(n, PHI, base);
  }
}

// Prime-ratio interval between two mode indices (used for detune spreads etc.)
export function primeRatio(i) {
  return PRIMES[i % PRIMES.length] / PRIMES[0];
}

export const TUNING_MODES = ['phi', 'silver', 'bronze', 'prime', 'harmonic', 'octave-phi'];
