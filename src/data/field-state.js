const ZERO = Object.freeze({
  seismic: 0,
  quakeCount: 0,
  solarWind: 0,
  kp: 0,
  ok: false,
  updatedAt: 0,
});

const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
const NOAA_SOLAR_WIND_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json';
const NOAA_KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
const FETCH_TIMEOUT_MS = 8000;

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function toFiniteNumber(value) {
  const num = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(num) ? num : null;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseEarthquake(data) {
  const features = Array.isArray(data?.features) ? data.features : [];
  let maxMag = 0;

  for (const feature of features) {
    const mag = toFiniteNumber(feature?.properties?.mag);
    if (mag !== null) {
      maxMag = Math.max(maxMag, Math.max(0, mag));
    }
  }

  return {
    seismic: clamp01(maxMag / 8),
    quakeCount: clamp01(features.length / 500),
  };
}

function latestNumericFromRows(rows, keys) {
  if (!Array.isArray(rows)) return null;

  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row) continue;

    if (Array.isArray(row)) {
      let valueIndex = -1;
      if (i > 0 && Array.isArray(rows[0])) {
        for (const key of keys) {
          const idx = rows[0].indexOf(key);
          if (idx !== -1) {
            valueIndex = idx;
            break;
          }
        }
      }
      if (valueIndex === -1) continue;
      const value = toFiniteNumber(row[valueIndex]);
      if (value !== null) return value;
      continue;
    }

    if (typeof row === 'object') {
      for (const key of keys) {
        const value = toFiniteNumber(row[key]);
        if (value !== null) return value;
      }
    }
  }

  return null;
}

function parseSolarWind(data) {
  const speed = latestNumericFromRows(data, ['speed']);
  return {
    solarWind: clamp01(((speed ?? 0) - 300) / 500),
  };
}

function parseKp(data) {
  const kpValue = latestNumericFromRows(data, ['Kp', 'kp_index']);
  return {
    kp: clamp01((kpValue ?? 0) / 9),
  };
}

export function createFieldState() {
  let cache = ZERO;

  return {
    async refresh() {
      const next = {
        seismic: cache.seismic,
        quakeCount: cache.quakeCount,
        solarWind: cache.solarWind,
        kp: cache.kp,
        ok: cache.ok,
        updatedAt: cache.updatedAt,
      };

      let successCount = 0;

      try {
        Object.assign(next, parseEarthquake(await fetchJson(USGS_URL)));
        successCount += 1;
      } catch (_) {}

      try {
        Object.assign(next, parseSolarWind(await fetchJson(NOAA_SOLAR_WIND_URL)));
        successCount += 1;
      } catch (_) {}

      try {
        Object.assign(next, parseKp(await fetchJson(NOAA_KP_URL)));
        successCount += 1;
      } catch (_) {}

      if (successCount > 0) {
        cache = {
          seismic: clamp01(next.seismic),
          quakeCount: clamp01(next.quakeCount),
          solarWind: clamp01(next.solarWind),
          kp: clamp01(next.kp),
          ok: true,
          updatedAt: Date.now(),
        };
      }

      return cache;
    },

    get() {
      return cache;
    },
  };
}
