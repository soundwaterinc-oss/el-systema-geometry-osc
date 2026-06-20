// Diffusion-bloom natural field — a third natural function, drop-in compatible
// with the reaction-diffusion / wave APIs (reset/step/render/nudge/setPreset/
// getParams/setParams). The plant's dark structure is a continuous source that
// blooms outward by anisotropic diffusion and slowly decays, so the image
// dissolves and re-forms like ink in water or spreading lichen — a softer,
// flowing alternative to RD's spots and the wave's ripples.

const PRESETS = {
  // rate = diffusion per step, decay = bleed/step, inject = source feed.
  default: { rate: 0.22, decay: 0.012, inject: 0.06 },
  coral: { rate: 0.22, decay: 0.012, inject: 0.06 }, // slow lichen creep
  mitosis: { rate: 0.34, decay: 0.02, inject: 0.05 }, // quick dissolve/reform
  waves: { rate: 0.42, decay: 0.006, inject: 0.07 }, // wide soft bloom
};

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function createDiffuseField(opts = {}) {
  const size = Math.max(8, Math.floor(Number.isFinite(opts.size) ? opts.size : 200));
  const cellCount = size * size;
  let params = { ...PRESETS.default, feedback: 0.5, preset: 'default' };
  let baseParams = { ...PRESETS.default };
  let phase = 0;

  let u = new Float32Array(cellCount);
  let next = new Float32Array(cellCount);
  const seed = new Float32Array(cellCount); // plant luminance (dark = source)

  const seedCanvas = document.createElement('canvas');
  seedCanvas.width = size;
  seedCanvas.height = size;
  const seedCtx = seedCanvas.getContext('2d', { willReadFrequently: true });

  const renderCanvas = document.createElement('canvas');
  renderCanvas.width = size;
  renderCanvas.height = size;
  const renderCtx = renderCanvas.getContext('2d');
  const renderImage = renderCtx.createImageData(size, size);

  return {
    reset(sourceCanvas) {
      u.fill(0);
      next.fill(0);
      seed.fill(0);
      phase = 0;
      if (!sourceCanvas || !seedCtx) return;
      seedCtx.clearRect(0, 0, size, size);
      seedCtx.drawImage(sourceCanvas, 0, 0, size, size);
      const data = seedCtx.getImageData(0, 0, size, size).data;
      for (let i = 0; i < cellCount; i += 1) {
        const di = i * 4;
        const lum = (data[di] + data[di + 1] + data[di + 2]) / (255 * 3);
        const dark = clamp(1 - lum, 0, 1);
        seed[i] = dark;
        u[i] = dark; // start as the plant, then let it bloom away
      }
    },

    step(dt, iterations = 8) {
      const steps = Math.max(1, Math.floor(Number.isFinite(iterations) ? iterations : 8));
      const rate = clamp(params.rate, 0.02, 0.45);
      const decay = clamp(params.decay, 0, 0.1);
      const inject = clamp(params.inject, 0, 0.3);

      for (let iter = 0; iter < steps; iter += 1) {
        phase += 0.08;
        const pulse = 0.6 + 0.4 * Math.sin(phase);
        for (let y = 0; y < size; y += 1) {
          const ym = y > 0 ? y - 1 : size - 1;
          const yp = y < size - 1 ? y + 1 : 0;
          for (let x = 0; x < size; x += 1) {
            const xm = x > 0 ? x - 1 : size - 1;
            const xp = x < size - 1 ? x + 1 : 0;
            const i = y * size + x;
            const c = u[i];
            const lap =
              u[ym * size + x] + u[yp * size + x] +
              u[y * size + xm] + u[y * size + xp] - 4 * c;
            let v = c + rate * lap - decay * c + inject * seed[i] * pulse;
            if (!Number.isFinite(v)) v = 0;
            next[i] = clamp(v, 0, 1.5);
          }
        }
        const tmp = u; u = next; next = tmp;
      }
    },

    render(targetCanvas) {
      if (!targetCanvas || !renderCtx) return;
      let minV = Infinity, maxV = -Infinity;
      for (let i = 0; i < cellCount; i += 1) {
        const v = u[i];
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
      const span = Math.max(0.0001, maxV - minV);
      const pixels = renderImage.data;
      for (let i = 0; i < cellCount; i += 1) {
        const v = Math.round(clamp((u[i] - minV) / span, 0, 1) * 255);
        const di = i * 4;
        pixels[di] = v; pixels[di + 1] = v; pixels[di + 2] = v; pixels[di + 3] = 255;
      }
      renderCtx.putImageData(renderImage, 0, 0);
      const ctx = targetCanvas.getContext('2d');
      if (!ctx) return;
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      ctx.drawImage(renderCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
      ctx.restore();
    },

    // Bidirectional loop: density feeds the bloom, edge sharpens diffusion,
    // complexity slows the decay so busy geometry lingers longer.
    nudge(features) {
      const density = clamp(features?.density ?? 0, 0, 1);
      const edgeIntensity = clamp(features?.edgeIntensity ?? 0, 0, 1);
      const complexity = clamp(features?.complexity ?? 0, 0, 1);
      const feedback = clamp(params.feedback, 0, 1);
      params.inject = clamp(baseParams.inject + (density - 0.5) * 0.06 * feedback, 0.005, 0.3);
      params.rate = clamp(baseParams.rate + (edgeIntensity - 0.5) * 0.18 * feedback, 0.02, 0.45);
      params.decay = clamp(baseParams.decay - (complexity - 0.5) * 0.012 * feedback, 0, 0.1);
    },

    setPreset(name) {
      const presetName = PRESETS[name] ? name : 'default';
      baseParams = { ...PRESETS[presetName] };
      params = { ...params, ...baseParams, preset: presetName };
    },

    setParams(nextParams) {
      if (!nextParams || typeof nextParams !== 'object') return;
      if (nextParams.rate !== undefined) params.rate = clamp(nextParams.rate, 0.02, 0.45);
      if (nextParams.decay !== undefined) params.decay = clamp(nextParams.decay, 0, 0.1);
      if (nextParams.inject !== undefined) params.inject = clamp(nextParams.inject, 0, 0.3);
      if (nextParams.feedback !== undefined) params.feedback = clamp(nextParams.feedback, 0, 1);
    },

    getParams() {
      return { ...params, kind: 'diffuse' };
    },
  };
}
