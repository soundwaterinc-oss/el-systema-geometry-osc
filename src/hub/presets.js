export const PRESET_VERSION = 1;

export const DEFAULT_SETTINGS = {
  scanSpeed: 0.78,
  scanAngle: 24,
  pitchBase: 80,
  sineMix: 0.38,
  pulseMix: 0.56,
  noiseMix: 0.62,
  masterGain: 0.74,
  clickGain: 0.72,
  pulseRate: 6.2,
  pulseWidth: 14,
  burstDensity: 0.46,
  noiseGain: 0.56,
  noiseBandFreq: 1450,
  noiseQ: 5.5,
  noiseColor: 'digital',
  bitDepth: 13,
  sampleRateReduction: 2,
  clipAmount: 0.18,
  ryukyuOn: true,
  natureOn: false,
  natureFunction: 'rd',
  naturePreset: 'coral',
  fxMode: 'flow',
  fxWarp: 0.06,
  fxColorMix: 0.6,
};

const ENUMS = {
  noiseColor: new Set(['white', 'pink', 'digital']),
  natureFunction: new Set(['rd', 'wave', 'diffuse']),
  naturePreset: new Set(['coral', 'mitosis', 'waves']),
  fxMode: new Set(['flow', 'refract', 'kaleido', 'contour']),
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeNumber(value, fallback, min, max) {
  return Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function normalizeInteger(value, fallback, min, max) {
  if (!Number.isFinite(value)) return fallback;
  return clamp(Math.round(value), min, max);
}

function normalizeEnum(value, fallback, allowed) {
  return allowed.has(value) ? value : fallback;
}

function normalizeBoolean(value, fallback) {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

export function normalizeSettings(partial) {
  const input = partial && typeof partial === 'object' ? partial : {};

  return {
    scanSpeed: normalizeNumber(input.scanSpeed, DEFAULT_SETTINGS.scanSpeed, 0.05, 3),
    scanAngle: normalizeNumber(input.scanAngle, DEFAULT_SETTINGS.scanAngle, -180, 180),
    pitchBase: normalizeNumber(input.pitchBase, DEFAULT_SETTINGS.pitchBase, 40, 240),
    sineMix: normalizeNumber(input.sineMix, DEFAULT_SETTINGS.sineMix, 0, 1.2),
    pulseMix: normalizeNumber(input.pulseMix, DEFAULT_SETTINGS.pulseMix, 0, 1.2),
    noiseMix: normalizeNumber(input.noiseMix, DEFAULT_SETTINGS.noiseMix, 0, 1.2),
    masterGain: normalizeNumber(input.masterGain, DEFAULT_SETTINGS.masterGain, 0, 1.4),
    clickGain: normalizeNumber(input.clickGain, DEFAULT_SETTINGS.clickGain, 0, 1.4),
    pulseRate: normalizeNumber(input.pulseRate, DEFAULT_SETTINGS.pulseRate, 0.25, 18),
    pulseWidth: normalizeNumber(input.pulseWidth, DEFAULT_SETTINGS.pulseWidth, 2, 120),
    burstDensity: normalizeNumber(input.burstDensity, DEFAULT_SETTINGS.burstDensity, 0, 1),
    noiseGain: normalizeNumber(input.noiseGain, DEFAULT_SETTINGS.noiseGain, 0, 1.4),
    noiseBandFreq: normalizeNumber(input.noiseBandFreq, DEFAULT_SETTINGS.noiseBandFreq, 80, 12000),
    noiseQ: normalizeNumber(input.noiseQ, DEFAULT_SETTINGS.noiseQ, 0.2, 24),
    noiseColor: normalizeEnum(input.noiseColor, DEFAULT_SETTINGS.noiseColor, ENUMS.noiseColor),
    bitDepth: normalizeInteger(input.bitDepth, DEFAULT_SETTINGS.bitDepth, 1, 16),
    sampleRateReduction: normalizeInteger(
      input.sampleRateReduction,
      DEFAULT_SETTINGS.sampleRateReduction,
      1,
      48,
    ),
    clipAmount: normalizeNumber(input.clipAmount, DEFAULT_SETTINGS.clipAmount, 0, 1),
    ryukyuOn: normalizeBoolean(input.ryukyuOn, DEFAULT_SETTINGS.ryukyuOn),
    natureOn: normalizeBoolean(input.natureOn, DEFAULT_SETTINGS.natureOn),
    natureFunction: normalizeEnum(input.natureFunction, DEFAULT_SETTINGS.natureFunction, ENUMS.natureFunction),
    naturePreset: normalizeEnum(input.naturePreset, DEFAULT_SETTINGS.naturePreset, ENUMS.naturePreset),
    fxMode: normalizeEnum(input.fxMode, DEFAULT_SETTINGS.fxMode, ENUMS.fxMode),
    fxWarp: normalizeNumber(input.fxWarp, DEFAULT_SETTINGS.fxWarp, 0, 0.2),
    fxColorMix: normalizeNumber(input.fxColorMix, DEFAULT_SETTINGS.fxColorMix, 0, 1),
  };
}

export function capturePreset(name, settings) {
  return {
    version: PRESET_VERSION,
    name: typeof name === 'string' && name ? name : 'untitled',
    savedAt: Date.now(),
    settings: normalizeSettings(settings),
  };
}

export function validatePreset(obj) {
  if (!obj || typeof obj !== 'object') return null;

  try {
    const settings = normalizeSettings(obj.settings);
    const savedAt = Number.isFinite(obj.savedAt) ? obj.savedAt : Date.now();

    return {
      version: PRESET_VERSION,
      name: typeof obj.name === 'string' && obj.name ? obj.name : 'untitled',
      savedAt,
      settings,
    };
  } catch (_) {
    return null;
  }
}
