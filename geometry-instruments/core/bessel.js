// bessel.js — Bessel functions of the first kind J_m(x) and their zeros.
// No external libraries. Used by the modal engines (A1 / A8 of the catalog).
//
// J_m(x) is computed for all orders 0..M at once with Miller's downward
// recurrence, which is numerically stable for the argument range we need
// (x up to ~22, m up to ~6). The naive power series is unstable for large x
// because of catastrophic cancellation, so we do not use it.

// Zeros of J_m: alpha_{m,n} = j_{m,n}. Rows m=0..5, columns n=1..5.
// These set the eigenfrequencies of a circular membrane (f ∝ alpha_mn).
export const BESSEL_ZEROS = [
  [2.404826, 5.520078, 8.653728, 11.791534, 14.930918], // m=0
  [3.831706, 7.015587, 10.173468, 13.323692, 16.470630], // m=1
  [5.135622, 8.417244, 11.619841, 14.795952, 17.959819], // m=2
  [6.380162, 9.761023, 13.015201, 16.223466, 19.409415], // m=3
  [7.588342, 11.064709, 14.372537, 17.615966, 20.826933], // m=4
  [8.771484, 12.338604, 15.700174, 18.980134, 22.217800], // m=5
];

export const ALPHA_01 = BESSEL_ZEROS[0][0]; // 2.404826 — the reference mode.

// Return an array [J_0(x), J_1(x), ... J_M(x)] via Miller's algorithm.
// N is the number of high-order terms to seed the downward recurrence with;
// it must comfortably exceed both M and x for accuracy.
export function besselJArray(x, M) {
  const ax = Math.abs(x);
  if (ax < 1e-12) {
    const out = new Array(M + 1).fill(0);
    out[0] = 1; // J_0(0)=1, all others 0
    return out;
  }
  // Seed order high above max(M, x).
  const N = Math.max(M, Math.ceil(ax)) + 20;
  let jp1 = 0.0; // J_{k+1}
  let j = 1.0e-30; // J_k, arbitrary small seed
  const vals = new Array(N + 1);
  vals[N] = jp1;
  vals[N - 1] = j;
  // Normalisation accumulator: J_0 + 2*(J_2 + J_4 + ...) = 1
  let sum = 0;
  for (let k = N - 1; k >= 1; k--) {
    const jm1 = (2 * k / x) * j - jp1; // downward recurrence
    vals[k - 1] = jm1;
    jp1 = j;
    j = jm1;
    // Rescale if magnitudes blow up (keeps doubles in range).
    if (Math.abs(j) > 1e10) {
      for (let i = k - 1; i <= N; i++) vals[i] *= 1e-10;
      j *= 1e-10;
      jp1 *= 1e-10;
      sum *= 1e-10;
    }
    if (k % 2 === 0) sum += 2 * vals[k - 1]; // even orders (this is k-1)
  }
  // vals[0] currently holds unnormalised J_0; but our sum loop added even
  // orders >=2. Recompute the normalisation cleanly to avoid off-by-one.
  let norm = vals[0];
  for (let k = 2; k <= N; k += 2) norm += 2 * vals[k];
  const out = new Array(M + 1);
  for (let m = 0; m <= M; m++) out[m] = vals[m] / norm;
  // Odd orders carry the sign of x (J_m(-x) = (-1)^m J_m(x)); x is positive here.
  return out;
}

// Convenience: single order J_m(x).
export function besselJ(m, x) {
  return besselJArray(x, m)[m];
}
