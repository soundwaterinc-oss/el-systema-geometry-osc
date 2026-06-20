const THRESHOLD = 0.5;

/**
 * Extract perceptual features from a grayscale pixel array (0=dark, 1=bright).
 * All returned values are normalised to [0, 1].
 */
export function extractFeatures(pixels) {
  const n = pixels.length;
  if (n === 0) {
    return { density: 0, toggleRate: 0, complexity: 0, edgeIntensity: 0, localContrast: 0, edgeCount: 0, symmetry: 0, periodicity: 0 };
  }

  let darkCount = 0;
  let toggles = 0;
  let sum = 0;
  let sumSq = 0;
  let edgeSum = 0;
  let edgePeak = 0;
  let prevDark = pixels[0] < THRESHOLD;
  let prev = pixels[0];

  for (let i = 0; i < n; i++) {
    const v = pixels[i];
    sum += v;
    sumSq += v * v;
    if (v < THRESHOLD) darkCount++;
    if (i > 0) {
      const isDark = v < THRESHOLD;
      if (isDark !== prevDark) toggles++;
      prevDark = isDark;
      const d = Math.abs(v - prev);
      edgeSum += d;
      if (d > edgePeak) edgePeak = d;
    }
    prev = v;
  }

  const density = darkCount / n;
  const toggleRate = Math.min(1, toggles / Math.max(1, n - 1));
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  const complexity = Math.min(1, variance * 4);

  // edgeIntensity blends average gradient magnitude with peak gradient
  const avgEdge = edgeSum / Math.max(1, n - 1);
  const edgeIntensity = Math.min(1, avgEdge * 6 + edgePeak * 0.25);
  const localContrast = Math.min(1, avgEdge * 5 + variance * 2);
  const edgeCount = Math.min(1, toggles / Math.max(1, n - 1));

  // --- Geometric features (structure of the scanned material) ---
  // symmetry: how mirror-symmetric the line is about its centre (1 = perfect).
  const half = n >> 1;
  let symDiff = 0;
  for (let i = 0; i < half; i++) symDiff += Math.abs(pixels[i] - pixels[n - 1 - i]);
  const symmetry = half > 0 ? Math.max(0, 1 - (symDiff / half) * 2) : 0;

  // periodicity: strongest normalised autocorrelation over a bounded lag window
  // — high when the material repeats (phyllotaxis spirals, gratings, tilings).
  let periodicity = 0;
  let denom = 0;
  for (let i = 0; i < n; i++) {
    const d = pixels[i] - mean;
    denom += d * d;
  }
  if (denom > 1e-6) {
    const maxLag = Math.min(64, half);
    for (let lag = 2; lag < maxLag; lag++) {
      let num = 0;
      for (let i = 0; i + lag < n; i++) num += (pixels[i] - mean) * (pixels[i + lag] - mean);
      const corr = num / denom;
      if (corr > periodicity) periodicity = corr;
    }
  }
  periodicity = Math.max(0, Math.min(1, periodicity));

  return {
    density, toggleRate, complexity, edgeIntensity, localContrast, edgeCount,
    symmetry, periodicity,
  };
}
