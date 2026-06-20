export function createGlitch() {
  const scratch = document.createElement('canvas');
  const buf = scratch.getContext('2d', { alpha: true });

  function ensureSize(width, height) {
    if (scratch.width !== width || scratch.height !== height) {
      scratch.width = width;
      scratch.height = height;
    }
  }

  function snapshot(ctx, width, height) {
    ensureSize(width, height);
    buf.globalCompositeOperation = 'copy';
    buf.imageSmoothingEnabled = true;
    buf.clearRect(0, 0, width, height);
    buf.drawImage(ctx.canvas, 0, 0);
    buf.globalCompositeOperation = 'source-over';
  }

  function applyTearing(ctx, width, height, amount) {
    const bands = Math.round(amount * 6);
    for (let i = 0; i < bands; i++) {
      if (Math.random() >= 0.5 + amount * 0.5) continue;
      const bandH = Math.max(
        1,
        Math.round(height * (0.03 + Math.random() * 0.09)),
      );
      const y = Math.max(0, Math.min(height - bandH, Math.floor(Math.random() * height)));
      const dx = (Math.random() * 2 - 1) * amount * width * 0.06;
      ctx.clearRect(0, y, width, bandH);
      ctx.drawImage(scratch, 0, y, width, bandH, dx, y, width, bandH);
    }
  }

  function applyChromatic(ctx, width, height, amount) {
    if (amount < 0.18) return;

    const cx = amount * width * 0.012;
    const alpha = Math.min(0.22, amount * 0.18);

    snapshot(ctx, width, height);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.filter = 'sepia(1) saturate(8) hue-rotate(-35deg)';
    ctx.drawImage(scratch, cx, 0);
    ctx.globalAlpha = alpha * 0.9;
    ctx.filter = 'sepia(1) saturate(8) hue-rotate(160deg)';
    ctx.drawImage(scratch, -cx, 0);
    ctx.filter = 'none';
    ctx.restore();
  }

  function applyPosterize(ctx, width, height, amount) {
    if (amount < 0.45) return;

    const q = Math.max(0.5, 1 - amount * 0.5);
    const scaledW = Math.max(1, Math.round(width * q));
    const scaledH = Math.max(1, Math.round(height * q));

    ensureSize(width, height);
    buf.globalCompositeOperation = 'copy';
    buf.clearRect(0, 0, width, height);
    buf.imageSmoothingEnabled = false;
    buf.drawImage(ctx.canvas, 0, 0, width, height, 0, 0, scaledW, scaledH);
    buf.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scratch, 0, 0, scaledW, scaledH, 0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.restore();

    buf.imageSmoothingEnabled = true;
  }

  return {
    apply(ctx, width, height, amount) {
      if (!ctx || width <= 0 || height <= 0 || amount <= 0.02) return;

      const strength = Math.max(0, Math.min(1, amount));
      snapshot(ctx, width, height);
      applyTearing(ctx, width, height, strength);
      applyChromatic(ctx, width, height, strength);
      applyPosterize(ctx, width, height, strength);
    },
  };
}
