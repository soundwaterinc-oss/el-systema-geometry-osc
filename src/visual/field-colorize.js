const PALETTES = {
  coral: [
    { t: 0, rgb: [24, 30, 68] },
    { t: 0.32, rgb: [112, 42, 94] },
    { t: 0.68, rgb: [232, 108, 68] },
    { t: 1, rgb: [250, 242, 214] },
  ],
  moss: [
    { t: 0, rgb: [42, 28, 18] },
    { t: 0.3, rgb: [74, 86, 40] },
    { t: 0.7, rgb: [96, 148, 72] },
    { t: 1, rgb: [222, 239, 150] },
  ],
  ocean: [
    { t: 0, rgb: [10, 25, 66] },
    { t: 0.35, rgb: [18, 88, 126] },
    { t: 0.72, rgb: [54, 195, 188] },
    { t: 1, rgb: [238, 250, 255] },
  ],
  sand: [
    { t: 0, rgb: [54, 38, 26] },
    { t: 0.34, rgb: [128, 90, 48] },
    { t: 0.72, rgb: [206, 176, 96] },
    { t: 1, rgb: [248, 243, 228] },
  ],
};

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(a, b, t) {
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ];
}

function sampleRamp(ramp, t) {
  const x = clamp01(t);
  for (let i = 1; i < ramp.length; i += 1) {
    const prev = ramp[i - 1];
    const next = ramp[i];
    if (x <= next.t) {
      const localT = (x - prev.t) / Math.max(0.0001, next.t - prev.t);
      return mixColor(prev.rgb, next.rgb, localT);
    }
  }
  return ramp[ramp.length - 1].rgb.slice();
}

export function createFieldColorizer() {
  let scratchCanvas = null;
  let scratchCtx = null;
  let imageData = null;

  function ensureScratch(width, height) {
    if (!scratchCanvas) {
      scratchCanvas = document.createElement('canvas');
      scratchCtx = scratchCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (scratchCanvas.width !== width || scratchCanvas.height !== height) {
      scratchCanvas.width = width;
      scratchCanvas.height = height;
      imageData = null;
    }
    if (!imageData && scratchCtx) {
      imageData = scratchCtx.createImageData(width, height);
    }
  }

  return {
    colorize(srcCanvas, destCanvas, opts = {}) {
      if (!srcCanvas || !destCanvas) return;

      const srcWidth = srcCanvas.width;
      const srcHeight = srcCanvas.height;
      if (!(srcWidth > 0) || !(srcHeight > 0)) return;

      const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
      const destCtx = destCanvas.getContext('2d');
      if (!srcCtx || !destCtx) return;

      const palette = PALETTES[opts.palette] || PALETTES.coral;
      const intensity = clamp01(opts.intensity === undefined ? 1 : opts.intensity);

      ensureScratch(srcWidth, srcHeight);
      if (!scratchCtx || !imageData) return;

      let srcImage;
      try {
        srcImage = srcCtx.getImageData(0, 0, srcWidth, srcHeight);
      } catch (_) {
        return;
      }

      const srcPixels = srcImage.data;
      const outPixels = imageData.data;

      for (let i = 0; i < srcPixels.length; i += 4) {
        const lum = clamp01((srcPixels[i] + srcPixels[i + 1] + srcPixels[i + 2]) / 765);
        const shapedLum = clamp01(lum * (0.85 + intensity * 0.25) + intensity * 0.03);
        const base = sampleRamp(palette, shapedLum);
        const gray = lum * 255;
        const blend = 0.18 + intensity * 0.82;

        outPixels[i] = Math.round(lerp(gray, base[0], blend));
        outPixels[i + 1] = Math.round(lerp(gray, base[1], blend));
        outPixels[i + 2] = Math.round(lerp(gray, base[2], blend));
        outPixels[i + 3] = 255;
      }

      scratchCtx.putImageData(imageData, 0, 0);

      destCtx.save();
      destCtx.imageSmoothingEnabled = true;
      destCtx.clearRect(0, 0, destCanvas.width, destCanvas.height);
      destCtx.drawImage(scratchCanvas, 0, 0, destCanvas.width, destCanvas.height);
      destCtx.restore();
    },
  };
}
