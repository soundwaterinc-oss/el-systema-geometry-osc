const SAMPLES = 160;

/**
 * Segment-based scan: instead of a global linear sweep, the scan head walks a
 * sequence of randomized line segments anchored to detected edge points in the
 * source image. Each segment has a randomized duration (= length-in-time) and
 * a randomized `strength` (= overall loudness multiplier applied by main.js).
 *
 * - position: 0–1 progress within the current segment (also used as scanPhase)
 * - strength: per-segment multiplier (read by main.js, applied to features)
 * - scanAngle is kept as a class field for UI compatibility but is no longer
 *   used to set the global sweep direction; each segment carries its own
 *   angle derived from its endpoints.
 */
export class ScanEngine {
  constructor(opts = {}) {
    this.position = 0;
    this.scanAngle = 0;
    this.scanSpeed = 0.5;
    this.strength = 1;
    // RGB triplet string used by drawScanLine — caller composes alpha
    this.color = opts.color || '0, 255, 136';

    this._imageData = null;
    this._imgW = 0;
    this._imgH = 0;
    this._edgePoints = [];
    this._currentSeg = null;
  }

  setSource(sourceCanvas) {
    this.refreshImageData(sourceCanvas);
    this._buildEdgePoints();
    this._currentSeg = null;
    this.position = 0;
  }

  refreshImageData(sourceCanvas) {
    const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    this._imgW = sourceCanvas.width;
    this._imgH = sourceCanvas.height;
    this._imageData = ctx.getImageData(0, 0, this._imgW, this._imgH).data;
  }

  /**
   * Re-read an evolving source (e.g. a reaction-diffusion field) without
   * resetting the current segment, so the scan keeps walking smoothly while the
   * image changes underneath it. Optionally rebuild edge points so new segment
   * endpoints land on the evolved structure.
   */
  refresh(sourceCanvas, rebuildEdges = false) {
    this.refreshImageData(sourceCanvas);
    if (rebuildEdges) this._buildEdgePoints();
  }

  /**
   * Random-sample the image for points with high local gradient. Keeps the top
   * N candidates so segment endpoints land on visible edges.
   */
  _buildEdgePoints() {
    const W = this._imgW, H = this._imgH, data = this._imageData;
    this._edgePoints = [];
    if (!data || W < 4 || H < 4) return;

    const candidates = [];
    const N = 2500;
    for (let i = 0; i < N; i++) {
      const x = 1 + ((Math.random() * (W - 2)) | 0);
      const y = 1 + ((Math.random() * (H - 2)) | 0);
      const c = data[(y * W + x) * 4] / 255;
      const r = data[(y * W + (x + 1)) * 4] / 255;
      const d = data[((y + 1) * W + x) * 4] / 255;
      const grad = Math.abs(c - r) + Math.abs(c - d);
      if (grad > 0.12) candidates.push({ x, y, grad });
    }
    candidates.sort((a, b) => b.grad - a.grad);
    this._edgePoints = candidates.slice(0, 300);

    // Fallback for very uniform images
    if (this._edgePoints.length < 20) {
      while (this._edgePoints.length < 60) {
        this._edgePoints.push({
          x: Math.random() * W,
          y: Math.random() * H,
          grad: 0.01,
        });
      }
    }
  }

  _generateSegment() {
    const W = this._imgW, H = this._imgH;
    const pts = this._edgePoints;

    if (pts.length < 2) {
      const x0 = Math.random() * W, y0 = Math.random() * H;
      const x1 = Math.random() * W, y1 = Math.random() * H;
      return {
        x0, y0, x1, y1,
        angle: Math.atan2(y1 - y0, x1 - x0),
        duration: 0.25 + Math.random() * 1.4,
        strength: 0.4 + Math.random() * 0.8,
      };
    }

    const a = pts[(Math.random() * pts.length) | 0];
    const maxR = Math.min(W, H) * 0.55;
    const minR = Math.min(W, H) * 0.05;
    let b = null;
    for (let tries = 0; tries < 8; tries++) {
      const cand = pts[(Math.random() * pts.length) | 0];
      const dx = cand.x - a.x, dy = cand.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > minR && dist < maxR) { b = cand; break; }
    }
    if (!b) b = pts[(Math.random() * pts.length) | 0];

    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const norm = len / Math.max(W, H);
    // Longer edges → longer events. Add jitter for variety.
    const duration = 0.15 + norm * 1.6 + Math.random() * 0.35;
    // Strength: random 0.3–1.3, biased slightly by edge gradient strength
    const grad = (a.grad + b.grad) * 0.5;
    const strength = 0.3 + Math.random() * 1.0 + Math.min(0.3, grad);
    const angle = Math.atan2(dy, dx);
    const bias = Number.isFinite(this.scanAngle) ? this.scanAngle : angle;
    const blend = 0.22 + Math.random() * 0.38;
    const biasedAngle = lerpAngle(angle, bias, blend);
    const x1 = a.x + Math.cos(biasedAngle) * len;
    const y1 = a.y + Math.sin(biasedAngle) * len;

    return { x0: a.x, y0: a.y, x1, y1, angle: biasedAngle, duration, strength };
  }

  advance(dt) {
    if (!this._currentSeg) {
      this._currentSeg = this._generateSegment();
      this.position = 0;
      this.strength = this._currentSeg.strength;
      return;
    }
    const seg = this._currentSeg;
    const speed = Math.max(0.05, this.scanSpeed);
    this.position += (dt * speed) / seg.duration;
    while (this.position >= 1) {
      this.position -= 1;
      this._currentSeg = this._generateSegment();
      this.strength = this._currentSeg.strength;
    }
  }

  _currentHead() {
    const seg = this._currentSeg;
    if (!seg) return { x: this._imgW * 0.5, y: this._imgH * 0.5, angle: 0 };
    const t = Math.min(1, Math.max(0, this.position));
    return {
      x: seg.x0 + (seg.x1 - seg.x0) * t,
      y: seg.y0 + (seg.y1 - seg.y0) * t,
      angle: seg.angle,
    };
  }

  /**
   * Current scan-head position normalized to 0–1 in source space, plus the
   * segment angle. Used by the visual field so particles spawn exactly where
   * the audio is being read from — sound and image share one source point.
   */
  getHeadNormalized() {
    const head = this._currentHead();
    const W = this._imgW || 1;
    const H = this._imgH || 1;
    return {
      x: Math.min(1, Math.max(0, head.x / W)),
      y: Math.min(1, Math.max(0, head.y / H)),
      angle: head.angle,
    };
  }

  getScanLine() {
    if (!this._imageData) return [];
    const { _imgW: W, _imgH: H, _imageData: data } = this;
    const head = this._currentHead();
    const lineLen = Math.min(W, H) * 0.5;
    const lx = -Math.sin(head.angle);
    const ly = Math.cos(head.angle);

    const pixels = new Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      const t = (i / (SAMPLES - 1) - 0.5) * lineLen;
      let sx = Math.round(head.x + lx * t);
      let sy = Math.round(head.y + ly * t);
      sx = ((sx % W) + W) % W;
      sy = ((sy % H) + H) % H;
      pixels[i] = data[(sy * W + sx) * 4] / 255;
    }
    return pixels;
  }

  drawScanLine(ctx, W, H, opts = {}) {
    const seg = this._currentSeg;
    if (!seg || !this._imgW) return;

    const scaleX = W / this._imgW;
    const scaleY = H / this._imgH;

    const rgb = this.color;
    // width/glow multipliers (1 = default); base width scales with the canvas
    // so the line reads the same at any resolution.
    const wMul = Number.isFinite(opts.width) ? opts.width : 1;
    const aMul = Number.isFinite(opts.glow) ? opts.glow : 1;
    const baseW = Math.max(1, (Math.min(W, H) / 480) * wMul);
    const a = (v) => Math.max(0, Math.min(1, v * aMul));

    // Current segment path (ghosted)
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = `rgba(${rgb}, ${a(0.3)})`;
    ctx.lineWidth = baseW * 0.55;
    ctx.beginPath();
    ctx.moveTo(seg.x0 * scaleX, seg.y0 * scaleY);
    ctx.lineTo(seg.x1 * scaleX, seg.y1 * scaleY);
    ctx.stroke();

    // Perpendicular scan line at current head
    const head = this._currentHead();
    const hx = head.x * scaleX;
    const hy = head.y * scaleY;
    const lineLen = Math.min(W, H) * 0.5;
    const halfLen = lineLen / 2;
    const lx = -Math.sin(head.angle);
    const ly = Math.cos(head.angle);

    ctx.strokeStyle = `rgba(${rgb}, ${a(0.72)})`;
    ctx.lineWidth = baseW;
    ctx.beginPath();
    ctx.moveTo(hx + lx * halfLen, hy + ly * halfLen);
    ctx.lineTo(hx - lx * halfLen, hy - ly * halfLen);
    ctx.stroke();

    // Head dot scaled by per-segment strength
    const r = (3 + this.strength * 3.5) * (0.7 + 0.6 * wMul);
    ctx.fillStyle = `rgba(${rgb}, ${a(0.95)})`;
    ctx.beginPath();
    ctx.arc(hx, hy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function lerpAngle(a, b, t) {
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + delta * t;
}
