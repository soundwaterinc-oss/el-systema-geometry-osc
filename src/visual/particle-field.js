export function createParticleField(canvas, getState) {
  const context = canvas.getContext("2d");
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    const { particles, running } = getState();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#020305";
    context.fillRect(0, 0, width, height);

    drawGrid(context, width, height);
    drawHalo(context, width, height, running);

    context.save();
    context.globalCompositeOperation = "lighter";

    for (const particle of particles) {
      const life = Math.max(0, particle.life / particle.maxLife);
      const alpha = particle.alpha * life;
      const x = particle.x * width;
      const y = particle.y * height;
      const size = particle.size * (0.8 + (1 - life) * 0.9);

      context.fillStyle = `hsla(${particle.hue}, 100%, ${64 - particle.brightness * 12}%, ${alpha})`;
      context.beginPath();
      context.arc(x, y, size, 0, Math.PI * 2);
      context.fill();

      context.strokeStyle = `hsla(${particle.hue}, 100%, 72%, ${alpha * 0.32})`;
      context.lineWidth = Math.max(1, size * 0.18);
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x - particle.vx * 16, y - particle.vy * 16);
      context.stroke();
    }

    context.restore();

    requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(draw);

  return {
    resize,
  };
}

function drawGrid(context, width, height) {
  context.save();
  context.strokeStyle = "rgba(255,255,255,0.04)";
  context.lineWidth = 1;
  const spacing = 48;
  for (let x = 0; x <= width; x += spacing) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y <= height; y += spacing) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.restore();
}

function drawHalo(context, width, height, running) {
  const cx = width * 0.5;
  const cy = height * 0.5;
  const radius = Math.min(width, height) * 0.28;
  const glow = context.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius * 1.6);
  glow.addColorStop(0, running ? "rgba(194,255,77,0.14)" : "rgba(114,247,255,0.08)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = glow;
  context.beginPath();
  context.arc(cx, cy, radius * 1.6, 0, Math.PI * 2);
  context.fill();
}
