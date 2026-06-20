const PRESETS = {
  default: { feed: 0.0545, kill: 0.062, dA: 1.0, dB: 0.5 },
  coral: { feed: 0.0545, kill: 0.062, dA: 1.0, dB: 0.5 },
  mitosis: { feed: 0.0367, kill: 0.0649, dA: 1.0, dB: 0.5 },
  waves: { feed: 0.014, kill: 0.054, dA: 1.0, dB: 0.62 },
};

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function createReactionDiffusion(opts = {}) {
  const size = Math.max(8, Math.floor(Number.isFinite(opts.size) ? opts.size : 200));
  const cellCount = size * size;
  let params = { ...PRESETS.default, feedback: 0.5, preset: 'default' };
  let baseParams = { ...PRESETS.default };

  let a0 = new Float32Array(cellCount);
  let b0 = new Float32Array(cellCount);
  let a1 = new Float32Array(cellCount);
  let b1 = new Float32Array(cellCount);

  const seedCanvas = document.createElement('canvas');
  seedCanvas.width = size;
  seedCanvas.height = size;
  const seedCtx = seedCanvas.getContext('2d', { willReadFrequently: true });

  const renderCanvas = document.createElement('canvas');
  renderCanvas.width = size;
  renderCanvas.height = size;
  const renderCtx = renderCanvas.getContext('2d');
  const renderImage = renderCtx.createImageData(size, size);

  function resetBuffers() {
    a0.fill(1);
    a1.fill(1);
    b0.fill(0);
    b1.fill(0);
  }

  function swap() {
    [a0, a1] = [a1, a0];
    [b0, b1] = [b1, b0];
  }

  function applyPreset(name) {
    const presetName = PRESETS[name] ? name : 'default';
    baseParams = { ...PRESETS[presetName] };
    params = { ...params, ...baseParams, preset: presetName };
  }

  resetBuffers();

  return {
    reset(sourceCanvas) {
      resetBuffers();
      if (!sourceCanvas || !seedCtx) return;

      seedCtx.clearRect(0, 0, size, size);
      seedCtx.drawImage(sourceCanvas, 0, 0, size, size);
      const image = seedCtx.getImageData(0, 0, size, size);
      const data = image.data;

      // Seed B *sparsely* in the plant's dark structure (not a saturated wash):
      // canonical Gray-Scott needs localized B patches in an A-rich field, or it
      // relaxes to a uniform dead state within seconds. A is depleted where B is
      // seeded so spots can grow and sustain.
      for (let i = 0; i < cellCount; i += 1) {
        const di = i * 4;
        const lum = (data[di] + data[di + 1] + data[di + 2]) / (255 * 3);
        const dark = 1 - lum;
        let b = 0;
        // Sparse nucleation: a few seed cells in the darkest plant structure,
        // surrounded by A-rich field, so spots can grow/divide and fill rather
        // than starving A everywhere (dense seeding collapses to a dead state).
        if (dark > 0.5 && Math.random() < 0.08) {
          b = clamp(0.6 + Math.random() * 0.3, 0, 1);
        }
        a0[i] = b > 0 ? 0.5 : 1;
        b0[i] = b;
        a1[i] = a0[i];
        b1[i] = b0[i];
      }
    },

    step(dt, iterations = 8) {
      const steps = Math.max(1, Math.floor(Number.isFinite(iterations) ? iterations : 8));
      const rate = clamp((Number.isFinite(dt) ? dt : 1 / 60) * 60 / steps, 0.05, 1.2);

      for (let iter = 0; iter < steps; iter += 1) {
        for (let y = 0; y < size; y += 1) {
          const ym = y > 0 ? y - 1 : size - 1;
          const yp = y < size - 1 ? y + 1 : 0;

          for (let x = 0; x < size; x += 1) {
            const xm = x > 0 ? x - 1 : size - 1;
            const xp = x < size - 1 ? x + 1 : 0;
            const i = y * size + x;

            const a = a0[i];
            const b = b0[i];

            const lapA =
              a0[ym * size + xm] * 0.05 +
              a0[ym * size + x] * 0.2 +
              a0[ym * size + xp] * 0.05 +
              a0[y * size + xm] * 0.2 -
              a +
              a0[y * size + xp] * 0.2 +
              a0[yp * size + xm] * 0.05 +
              a0[yp * size + x] * 0.2 +
              a0[yp * size + xp] * 0.05;

            const lapB =
              b0[ym * size + xm] * 0.05 +
              b0[ym * size + x] * 0.2 +
              b0[ym * size + xp] * 0.05 +
              b0[y * size + xm] * 0.2 -
              b +
              b0[y * size + xp] * 0.2 +
              b0[yp * size + xm] * 0.05 +
              b0[yp * size + x] * 0.2 +
              b0[yp * size + xp] * 0.05;

            const reaction = a * b * b;
            let nextA = a + (params.dA * lapA - reaction + params.feed * (1 - a)) * rate;
            let nextB = b + (params.dB * lapB + reaction - (params.kill + params.feed) * b) * rate;

            if (!Number.isFinite(nextA) || !Number.isFinite(nextB)) {
              nextA = 1;
              nextB = 0;
            }

            a1[i] = clamp(nextA, 0, 1);
            b1[i] = clamp(nextB, 0, 1);
          }
        }

        swap();
      }
    },

    render(targetCanvas) {
      if (!targetCanvas || !renderCtx) return;

      let minB = Infinity;
      let maxB = -Infinity;
      for (let i = 0; i < cellCount; i += 1) {
        const value = b0[i];
        if (value < minB) minB = value;
        if (value > maxB) maxB = value;
      }

      const span = Math.max(0.0001, maxB - minB);
      const pixels = renderImage.data;
      for (let i = 0; i < cellCount; i += 1) {
        const v = Math.round(clamp((b0[i] - minB) / span, 0, 1) * 255);
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

    nudge(features) {
      const density = clamp(features?.density ?? 0, 0, 1);
      const edgeIntensity = clamp(features?.edgeIntensity ?? 0, 0, 1);
      const complexity = clamp(features?.complexity ?? 0, 0, 1);
      const feedback = clamp(params.feedback, 0, 1);

      params.feed = clamp(
        baseParams.feed + ((density - 0.5) * 0.008 + (complexity - 0.5) * 0.004) * feedback,
        0.01,
        0.09,
      );
      params.kill = clamp(
        baseParams.kill + ((edgeIntensity - 0.5) * 0.006 + (complexity - 0.5) * 0.002) * feedback,
        0.03,
        0.07,
      );
    },

    setPreset(name) {
      applyPreset(name);
    },

    setParams(nextParams) {
      if (!nextParams || typeof nextParams !== 'object') return;

      if (nextParams.feed !== undefined) params.feed = clamp(nextParams.feed, 0.01, 0.09);
      if (nextParams.kill !== undefined) params.kill = clamp(nextParams.kill, 0.03, 0.07);
      if (nextParams.dA !== undefined) params.dA = clamp(nextParams.dA, 0.1, 2.5);
      if (nextParams.dB !== undefined) params.dB = clamp(nextParams.dB, 0.05, 1.5);
      if (nextParams.feedback !== undefined) params.feedback = clamp(nextParams.feedback, 0, 1);
    },

    getParams() {
      return { ...params };
    },
  };
}
