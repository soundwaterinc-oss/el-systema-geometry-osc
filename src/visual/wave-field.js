// Wave-equation natural field — a second "natural function" for the柱3 nature
// core, drop-in compatible with the reaction-diffusion module's API
// (reset/step/render/nudge/setPreset/getParams/setParams).
//
// Where reaction-diffusion grows Turing spots, this propagates a damped, driven
// 2D wave. The plant's dark structure is both the initial displacement and a
// set of continuous oscillating sources, so the still photo "rings": ripples
// radiate from the veins, interfere, and stand — a living field, not a decay.
//
// Stability: explicit finite-difference wave update on a toroidal grid. The CFL
// limit in 2D is c² ≤ 0.5; we clamp c² to ≤ 0.45 and damp every step, so it
// never blows up regardless of the driving amplitude or feedback nudges.

const PRESETS = {
  // c2 = wave speed², damping = energy bleed/step, forcing = source amplitude,
  // dPhase = how fast the plant sources oscillate (radians/sub-step).
  default: { c2: 0.14, damping: 0.02, forcing: 0.06, dPhase: 0.06 },
  coral: { c2: 0.14, damping: 0.02, forcing: 0.06, dPhase: 0.06 }, // slow swells
  mitosis: { c2: 0.22, damping: 0.008, forcing: 0.05, dPhase: 0.12 }, // standing interference
  waves: { c2: 0.38, damping: 0.004, forcing: 0.07, dPhase: 0.2 }, // fast travelling ripples
};

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function createWaveField(opts = {}) {
  const size = Math.max(8, Math.floor(Number.isFinite(opts.size) ? opts.size : 200));
  const cellCount = size * size;
  let params = { ...PRESETS.default, feedback: 0.5, preset: 'default' };
  let baseParams = { ...PRESETS.default };
  let phase = 0;

  // u = current displacement, uPrev = previous, uNext = scratch for the next step.
  let u = new Float32Array(cellCount);
  let uPrev = new Float32Array(cellCount);
  let uNext = new Float32Array(cellCount);
  // seed = plant luminance (dark structure → 1); spatial phase offset per source
  // so sources don't fire in unison (that just pumps a flat field).
  const seed = new Float32Array(cellCount);
  const seedPhase = new Float32Array(cellCount);

  const seedCanvas = document.createElement('canvas');
  seedCanvas.width = size;
  seedCanvas.height = size;
  const seedCtx = seedCanvas.getContext('2d', { willReadFrequently: true });

  const renderCanvas = document.createElement('canvas');
  renderCanvas.width = size;
  renderCanvas.height = size;
  const renderCtx = renderCanvas.getContext('2d');
  const renderImage = renderCtx.createImageData(size, size);

  function clearBuffers() {
    u.fill(0);
    uPrev.fill(0);
    uNext.fill(0);
  }

  function applyPreset(name) {
    const presetName = PRESETS[name] ? name : 'default';
    baseParams = { ...PRESETS[presetName] };
    params = { ...params, ...baseParams, preset: presetName };
  }

  clearBuffers();

  return {
    reset(sourceCanvas) {
      clearBuffers();
      phase = 0;
      seed.fill(0);
      seedPhase.fill(0);
      if (!sourceCanvas || !seedCtx) return;

      seedCtx.clearRect(0, 0, size, size);
      seedCtx.drawImage(sourceCanvas, 0, 0, size, size);
      const data = seedCtx.getImageData(0, 0, size, size).data;

      // Mean luminance, so the initial displacement is plant-vs-background
      // (zero-mean) rather than a DC offset that the wave can't propagate.
      let lumSum = 0;
      for (let i = 0; i < cellCount; i += 1) {
        const di = i * 4;
        lumSum += (data[di] + data[di + 1] + data[di + 2]) / (255 * 3);
      }
      const lumMean = lumSum / cellCount;

      for (let i = 0; i < cellCount; i += 1) {
        const di = i * 4;
        const lum = (data[di] + data[di + 1] + data[di + 2]) / (255 * 3);
        const dark = clamp(1 - lum, 0, 1);
        seed[i] = dark; // dark structure drives the field
        // Spatial phase offset (0..2π) keyed to luminance so sources interfere.
        seedPhase[i] = (lum - lumMean) * Math.PI * 4;
        // Initial displacement: the plant shape, zero-mean, as a standing front.
        const disp = (lum - lumMean) * 0.8;
        u[i] = disp;
        uPrev[i] = disp; // start at rest (velocity 0) so it rings symmetrically
      }
    },

    step(dt, iterations = 8) {
      const steps = Math.max(1, Math.floor(Number.isFinite(iterations) ? iterations : 8));
      const c2 = clamp(params.c2, 0.02, 0.45);
      const damping = clamp(params.damping, 0, 0.2);
      const forcing = clamp(params.forcing, 0, 0.3);
      const dPhase = clamp(params.dPhase, 0.01, 0.5);

      for (let iter = 0; iter < steps; iter += 1) {
        phase += dPhase;
        const drive = forcing;

        for (let y = 0; y < size; y += 1) {
          const ym = y > 0 ? y - 1 : size - 1;
          const yp = y < size - 1 ? y + 1 : 0;

          for (let x = 0; x < size; x += 1) {
            const xm = x > 0 ? x - 1 : size - 1;
            const xp = x < size - 1 ? x + 1 : 0;
            const i = y * size + x;

            const center = u[i];
            // 5-point toroidal Laplacian.
            const lap =
              u[ym * size + x] +
              u[yp * size + x] +
              u[y * size + xm] +
              u[y * size + xp] -
              4 * center;

            // Damped wave: next = 2u − uPrev + c²∇²u − damping·(u − uPrev),
            // plus the plant sources driving the field where structure is dark.
            const velocity = center - uPrev[i];
            let next =
              center + velocity + c2 * lap - damping * velocity +
              drive * seed[i] * Math.sin(phase + seedPhase[i]);

            if (!Number.isFinite(next)) next = 0;
            uNext[i] = clamp(next, -1.5, 1.5);
          }
        }

        // Rotate buffers: uPrev <- u, u <- uNext, uNext reused as next scratch.
        const recycled = uPrev;
        uPrev = u;
        u = uNext;
        uNext = recycled;
      }
    },

    render(targetCanvas) {
      if (!targetCanvas || !renderCtx) return;

      let minU = Infinity;
      let maxU = -Infinity;
      for (let i = 0; i < cellCount; i += 1) {
        const value = u[i];
        if (value < minU) minU = value;
        if (value > maxU) maxU = value;
      }

      const span = Math.max(0.0001, maxU - minU);
      const pixels = renderImage.data;
      for (let i = 0; i < cellCount; i += 1) {
        // Signed amplitude → brightness; interference fringes read as bands.
        const v = Math.round(clamp((u[i] - minU) / span, 0, 1) * 255);
        const di = i * 4;
        pixels[di] = v;
        pixels[di + 1] = v;
        pixels[di + 2] = v;
        pixels[di + 3] = 255;
      }

      renderCtx.putImageData(renderImage, 0, 0);

      const targetCtx = targetCanvas.getContext('2d');
      if (!targetCtx) return;
      targetCtx.save();
      targetCtx.imageSmoothingEnabled = true;
      targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      targetCtx.drawImage(renderCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
      targetCtx.restore();
    },

    // Bidirectional loop: what the scans hear bends how the field propagates.
    // density → drive harder, edgeIntensity → faster waves, complexity → less
    // damping (the field rings longer when the scanned geometry is busy).
    nudge(features) {
      const density = clamp(features?.density ?? 0, 0, 1);
      const edgeIntensity = clamp(features?.edgeIntensity ?? 0, 0, 1);
      const complexity = clamp(features?.complexity ?? 0, 0, 1);
      const feedback = clamp(params.feedback, 0, 1);

      params.forcing = clamp(
        baseParams.forcing + (density - 0.5) * 0.06 * feedback,
        0.005,
        0.3,
      );
      params.c2 = clamp(
        baseParams.c2 + (edgeIntensity - 0.5) * 0.18 * feedback,
        0.02,
        0.45,
      );
      params.damping = clamp(
        baseParams.damping - (complexity - 0.5) * 0.02 * feedback,
        0,
        0.2,
      );
    },

    setPreset(name) {
      applyPreset(name);
    },

    setParams(nextParams) {
      if (!nextParams || typeof nextParams !== 'object') return;
      if (nextParams.c2 !== undefined) params.c2 = clamp(nextParams.c2, 0.02, 0.45);
      if (nextParams.damping !== undefined) params.damping = clamp(nextParams.damping, 0, 0.2);
      if (nextParams.forcing !== undefined) params.forcing = clamp(nextParams.forcing, 0, 0.3);
      if (nextParams.dPhase !== undefined) params.dPhase = clamp(nextParams.dPhase, 0.01, 0.5);
      if (nextParams.feedback !== undefined) params.feedback = clamp(nextParams.feedback, 0, 1);
    },

    getParams() {
      return { ...params, kind: 'wave' };
    },
  };
}
