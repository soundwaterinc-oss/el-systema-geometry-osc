// Faithful to Okinawa: the Ryukyu scale is the only tonal basis. World ethnic
// scales were intentionally removed from the project's scope. Scale degrees are
// cents within an octave (leading 0), so the tuning can stay just/microtonal.
const RYUKYU = {
  id: 'ryukyu',
  label: 'Ryukyu',
  tradition: 'Okinawa / Ryukyuan',
  cents: [0, 400, 500, 700, 1100],
};

const SCALES = [RYUKYU];
const SCALE_MAP = new Map(SCALES.map((scale) => [scale.id, scale]));

function normalizeRoot(rootHz) {
  return rootHz > 0 && Number.isFinite(rootHz) ? rootHz : 440;
}

export function listScales() {
  return SCALES.map(({ id, label, tradition }) => ({ id, label, tradition }));
}

export function getScale(id) {
  return SCALE_MAP.get(id) || RYUKYU;
}

/**
 * Quantize a continuous frequency to the nearest scale degree, anchored at
 * rootHz, searching across octaves in log/cents space. Invalid hz returns root.
 */
export function quantizeHzToScale(hz, scaleId, rootHz) {
  const baseHz = normalizeRoot(rootHz);
  if (!(hz > 0) || !Number.isFinite(hz)) return baseHz;

  const scale = getScale(scaleId);
  const targetCents = 1200 * Math.log2(hz / baseHz);
  let bestHz = baseHz;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let octave = -4; octave <= 5; octave += 1) {
    const octaveOffset = octave * 1200;
    for (const cents of scale.cents) {
      const candidateCents = octaveOffset + cents;
      const distance = Math.abs(targetCents - candidateCents);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestHz = baseHz * Math.pow(2, candidateCents / 1200);
      }
    }
  }

  return bestHz;
}
