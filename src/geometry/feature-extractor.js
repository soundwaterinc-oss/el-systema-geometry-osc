const THRESHOLD = 0.5;

/**
 * Extract perceptual features from a grayscale pixel array (0=dark, 1=bright).
 * All returned values are normalised to [0, 1].
 */
export function extractFeatures(pixels) {
  const n = pixels.length;
  if (n === 0) {
    return { density: 0, toggleRate: 0, complexity: 0, edgeIntensity: 0, localContrast: 0, edgeCount: 0 };
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

  return { density, toggleRate, complexity, edgeIntensity, localContrast, edgeCount };
}
