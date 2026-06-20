export class PatternSource {
  constructor() {
    // High source resolution so the original material is reflected at maximum
    // fidelity through the GPU processing (the FX treat the source, not cover it).
    this.sourceCanvas = document.createElement('canvas');
    this.sourceCanvas.width = 1024;
    this.sourceCanvas.height = 1024;
    this._ctx = this.sourceCanvas.getContext('2d', { willReadFrequently: true });
    this.sourceLabel = '—';
  }

  // Try to load from URL; falls back to generated pattern on failure
  async tryLoadAsset(url) {
    try {
      await this._loadUrl(url);
      this.sourceLabel = url.split('/').pop();
      return true;
    } catch {
      this.generateDefaultPattern();
      return false;
    }
  }

  loadFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        this._loadUrl(e.target.result)
          .then(() => {
            this.sourceLabel = file.name;
            resolve();
          })
          .catch(reject);
      };
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.readAsDataURL(file);
    });
  }

  _loadUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const { width, height } = this.sourceCanvas;
        this._ctx.clearRect(0, 0, width, height);
        this._ctx.drawImage(img, 0, 0, width, height);
        this._toGrayscale();
        resolve();
      };
      img.onerror = () => reject(new Error(`Failed to load: ${url}`));
      // crossOrigin only needed for external URLs, not data: or same-origin
      if (!url.startsWith('data:')) img.crossOrigin = 'anonymous';
      img.src = url;
    });
  }

  _toGrayscale() {
    const { width, height } = this.sourceCanvas;
    const imageData = this._ctx.getImageData(0, 0, width, height);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    this._ctx.putImageData(imageData, 0, 0);
  }

  // Alternating filled/empty triangular grid — ~50% dark density ensures audible default sound
  generateDefaultPattern() {
    const { width, height } = this.sourceCanvas;
    const ctx = this._ctx;
    const step = 40;
    const rowH = step * Math.sqrt(3) / 2;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const rows = Math.ceil(height / rowH) + 2;
    const cols = Math.ceil(width / step) + 2;

    for (let row = -1; row < rows; row++) {
      const xOffset = (row % 2 !== 0) ? step / 2 : 0;
      for (let col = -1; col < cols; col++) {
        const x = col * step + xOffset;
        const y = row * rowH;

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + step, y);
        ctx.lineTo(x + step / 2, y + rowH);
        ctx.closePath();

        if ((row + col) % 2 === 0) {
          ctx.fillStyle = '#1a1a1a';
          ctx.fill();
        }
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    this.sourceLabel = 'Default Pattern';
  }
}
