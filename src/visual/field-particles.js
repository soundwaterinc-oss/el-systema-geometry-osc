/**
 * Field particles — the visual half of the unified field.
 *
 * The geometry scan already drives sound (sine / pulse / noise). Here the same
 * per-scan feature data spawns particles at the live scan-head position, so a
 * single geometry source is heard and seen at once: louder/denser regions of
 * the image emit more, brighter, faster particles. Each scan stream (A/B/C)
 * carries its own hue so the audio layers have visible counterparts.
 *
 * Coordinates are normalized 0–1 in source space; the renderer scales them to
 * the canvas. Physics are stepped at the rAF rate (full dt); drawing can run at
 * a lower throttled rate without affecting motion.
 */

// Base hue per scan index, loosely echoing the scan overlay colors
// (A green, B pink/magenta, C cyan).
const SCAN_HUES = [145, 325, 192];
const MAX_PARTICLES = 900;

/**
 * Spawn particles for one scan stream from its mapped features and live head.
 *
 * @param {Array} particles   shared particle pool (mutated in place)
 * @param {object} mapped     mapped features for this scan (density, edgeIntensity, complexity, ...)
 * @param {object} head       { x, y, angle } normalized scan-head position
 * @param {number} index      scan index (selects hue)
 * @param {number} strength   per-segment strength multiplier
 * @param {number} dt         seconds since last step (controls spawn count)
 * @param {object} state      per-stream carry accumulator { carry: number }
 * @param {number} breathGain background-breath multiplier (pulses emission in
 *                            lockstep with the grid/halo; 1 = no modulation)
 */
export function spawnFromScan(particles, mapped, head, index, strength, dt, state, breathGain = 1) {
  if (!head) return;
  const density = clamp01(mapped.density);
  const edge = clamp01(mapped.edgeIntensity);
  const complexity = clamp01(mapped.complexity);
  const contrast = clamp01(mapped.localContrast);

  // Spawn rate: quiet regions stay near silent, loud/dense regions stream hard.
  const drive = density * 0.7 + edge * 0.5 + strength * 0.4;
  const spawnRate = drive * 46 * Math.max(0, breathGain); // particles/sec at full drive
  state.carry += spawnRate * dt;

  const baseHue = SCAN_HUES[index % SCAN_HUES.length];

  while (state.carry >= 1) {
    state.carry -= 1;
    if (particles.length >= MAX_PARTICLES) {
      // Drop the oldest to keep the field bounded.
      particles.shift();
    }

    // Emit along the scan-line normal (perpendicular to segment angle), with a
    // spread that widens as complexity rises — busy geometry scatters more.
    const normal = head.angle + Math.PI / 2;
    const spread = (Math.random() - 0.5) * (0.4 + complexity * 1.6);
    const dir = normal + spread;
    const speed = 0.05 + edge * 0.22 + strength * 0.08;

    const maxLife = 0.5 + density * 1.1 + Math.random() * 0.4;

    particles.push({
      x: clamp01(head.x + (Math.random() - 0.5) * 0.02),
      y: clamp01(head.y + (Math.random() - 0.5) * 0.02),
      vx: Math.cos(dir) * speed,
      vy: Math.sin(dir) * speed,
      size: 1.2 + strength * 2.6 + edge * 2.0,
      life: maxLife,
      maxLife,
      brightness: clamp01(0.25 + contrast * 0.6),
      // Hue drifts with complexity so texture changes color subtly.
      hue: baseHue + (complexity - 0.5) * 36,
      alpha: 0.22 + density * 0.5 + strength * 0.12,
      drag: 0.86 + complexity * 0.08,
    });
  }
}

/** Advance particle motion and cull dead/out-of-bounds ones. */
export function stepParticles(particles, dt) {
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    // Mild drag so particles settle into a drifting field rather than fly off.
    const damp = Math.pow(p.drag, dt * 60);
    p.vx *= damp;
    p.vy *= damp;
    if (p.life <= 0 || p.x < -0.1 || p.x > 1.1 || p.y < -0.1 || p.y > 1.1) {
      particles.splice(i, 1);
    }
  }
}

/**
 * Draw particles onto an existing 2D context (the scan canvas), additively so
 * they sit as light over the geometry/scan overlay — one shared image.
 */
export function drawParticles(ctx, particles, width, height) {
  if (!particles.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of particles) {
    const life = p.maxLife > 0 ? Math.max(0, p.life / p.maxLife) : 0;
    const alpha = p.alpha * life;
    if (alpha <= 0.001) continue;
    const x = p.x * width;
    const y = p.y * height;
    const size = p.size * (0.8 + (1 - life) * 0.9);

    ctx.fillStyle = `hsla(${p.hue}, 100%, ${64 - p.brightness * 12}%, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();

    // Short motion trail toward where it came from.
    ctx.strokeStyle = `hsla(${p.hue}, 100%, 72%, ${alpha * 0.32})`;
    ctx.lineWidth = Math.max(1, size * 0.18);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - p.vx * width * 0.12, y - p.vy * height * 0.12);
    ctx.stroke();
  }
  ctx.restore();
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
