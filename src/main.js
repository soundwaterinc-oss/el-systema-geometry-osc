import { ensureAudioContext, resumeAudioContext, suspendAudioContext, getAudioContext } from "./audio/context.js?v=20260524-cellnoise-02";
import { createMasterGraph, setMasterBus } from "./audio/master.js?v=20260524-cellnoise-02";
import { GeometryOsc } from "./audio/geometry-osc.js?v=20260524-cellnoise-02";
import { PulseEngine } from "./audio/pulse-engine.js?v=20260524-cellnoise-02";
import { NoiseEngine } from "./audio/noise-engine.js?v=20260524-cellnoise-02";
import { Degradation } from "./audio/degradation.js?v=20260524-cellnoise-02";
import { PatternSource } from "./geometry/pattern-source.js?v=20260524-cellnoise-02";
import { ScanEngine } from "./geometry/scan-engine.js?v=20260524-cellnoise-03";
import { extractFeatures } from "./geometry/feature-extractor.js?v=20260524-cellnoise-02";
import { bindRange, bindSelect, bindButtonGroup, bindButton, bindFileInput } from "./ui/bindings.js?v=20260524-cellnoise-02";
import { spawnFromScan, stepParticles, drawParticles } from "./visual/field-particles.js?v=20260524-cellnoise-02";
import { createGlitch } from "./visual/glitch.js?v=20260524-cellnoise-02";
import { createReactionDiffusion } from "./visual/reaction-diffusion.js?v=20260524-cellnoise-02";
import { createWaveField } from "./visual/wave-field.js?v=20260620-nature-wave-01";
import { createDiffuseField } from "./visual/diffuse-field.js?v=20260620-nature-diffuse-01";
import { createGenerativeRenderer, GENERATIVE_FX_MODES } from "./visual/generative-gl.js?v=20260623-genfx-05";
import { capturePreset, validatePreset, normalizeSettings } from "./hub/presets.js?v=20260524-cellnoise-02";
import { createFieldColorizer } from "./visual/field-colorize.js?v=20260524-cellnoise-02";
import { createFieldState } from "./data/field-state.js?v=20260524-cellnoise-02";
import { quantizeHzToScale } from "./music/scales.js?v=20260524-cellnoise-02";
import { RitualPercussion } from "./audio/engines/ritual-percussion.js?v=20260524-cellnoise-02";
import { createProcessingBridge } from "./net/processing-bridge.js?v=20260524-cellnoise-02";

const SOURCE_PRESETS = [
  { label: "spiral-aloe.png", url: "./assets/spiral-aloe.png" },
  { label: "spiral-phyllotaxis.svg", url: "./assets/spiral-phyllotaxis.svg" },
  { label: "cell2.vector.svg", url: "./assets/cell2.vector.svg" },
  { label: "cells_lithocyst_001.svg", url: "./assets/cells_lithocyst_001.svg" },
];

const SCAN_COLORS = ["0, 255, 136", "255, 80, 180", "80, 200, 255"];
const SCAN_LABELS = ["A", "B", "C"];

// HUB mode shell — each workspace mode curates which control panels are visible.
// The stage (canvas/metrics) is never touched; only left-rail panels toggle, and
// every panel stays in the DOM with its bindings intact (visibility is CSS-only).
const MODES = ["studio", "perform", "patch"];
const MODE_PANELS = {
  // studio = the full lab: every panel shown (no allow-list needed).
  studio: null,
  // perform = live gestures: transport, source, nature field FX, master mix.
  perform: ["transport", "source", "nature", "mix"],
  // patch = sound design: presets, motion, the full audio voice chain.
  patch: ["transport", "presets", "geometry", "mix", "pulsenoise", "degradation"],
};
const MODE_KEY = "el-systema-mode";
const DEFAULT_PRESET = SOURCE_PRESETS[0].url;
const MAX_RENDER_FPS = 30;
const MAX_CANVAS_DPR = 1.25;
// Field colourise/scan resolution — independent of the (high-res) source so the
// per-frame colourise stays cheap while the source is reflected at full fidelity.
const NATURE_FIELD_RES = 512;

const elements = {
  startAudioButton: document.querySelector("#startAudioButton"),
  startScanButton: document.querySelector("#startScanButton"),
  startAllButton: document.querySelector("#startAllButton"),
  stopButton: document.querySelector("#stopButton"),
  stopAllButton: document.querySelector("#stopAllButton"),
  presetStrip: document.querySelector("#presetStrip"),
  imageUpload: document.querySelector("#imageUpload"),
  sourceLabel: document.querySelector("#sourceLabel"),
  sourceLabelPreview: document.querySelector("#sourceLabelPreview"),
  sourceLabelInline: document.querySelector("#sourceLabelInline"),
  sourcePreviewImage: document.querySelector("#sourcePreviewImage"),
  statusValue: document.querySelector("#statusValue"),
  sbStatus: document.querySelector("#sbStatus"),
  sbEarth: document.querySelector("#sbEarth"),
  sbNature: document.querySelector("#sbNature"),
  sbLink: document.querySelector("#sbLink"),
  sbMode: document.querySelector("#sbMode"),
  modeButtons: Array.from(document.querySelectorAll(".hub-mode-btn")),
  modePanels: Array.from(document.querySelectorAll("[data-panel]")),
  featureSymmetryValue: document.querySelector("#featureSymmetryValue"),
  featurePeriodicityValue: document.querySelector("#featurePeriodicityValue"),
  earthSeismicValue: document.querySelector("#earthSeismicValue"),
  earthSolarValue: document.querySelector("#earthSolarValue"),
  earthKpValue: document.querySelector("#earthKpValue"),
  ryukyuToggle: document.querySelector("#ryukyuToggle"),
  scaleValue: document.querySelector("#scaleValue"),
  natureToggle: document.querySelector("#natureToggle"),
  natureFunction: document.querySelector("#natureFunction"),
  naturePreset: document.querySelector("#naturePreset"),
  natureValue: document.querySelector("#natureValue"),
  fxMode: document.querySelector("#fxMode"),
  fxWarp: document.querySelector("#fxWarp"),
  fxWarpValue: document.querySelector("#fxWarpValue"),
  fxColorMix: document.querySelector("#fxColorMix"),
  fxColorMixValue: document.querySelector("#fxColorMixValue"),
  scanLineWidth: document.querySelector("#scanLineWidth"),
  scanLineWidthValue: document.querySelector("#scanLineWidthValue"),
  scanLineGlow: document.querySelector("#scanLineGlow"),
  scanLineGlowValue: document.querySelector("#scanLineGlowValue"),
  presetName: document.querySelector("#presetName"),
  presetSave: document.querySelector("#presetSave"),
  presetList: document.querySelector("#presetList"),
  presetLoad: document.querySelector("#presetLoad"),
  presetDelete: document.querySelector("#presetDelete"),
  presetExport: document.querySelector("#presetExport"),
  presetImport: document.querySelector("#presetImport"),
  processingUrl: document.querySelector("#processingUrl"),
  processingToggle: document.querySelector("#processingToggle"),
  processingStatus: document.querySelector("#processingStatus"),
  scanAValue: document.querySelector("#scanAValue"),
  scanBValue: document.querySelector("#scanBValue"),
  scanCValue: document.querySelector("#scanCValue"),
  featureDensityValue: document.querySelector("#featureDensityValue"),
  featureToggleRateValue: document.querySelector("#featureToggleRateValue"),
  featureComplexityValue: document.querySelector("#featureComplexityValue"),
  featureEdgeIntensityValue: document.querySelector("#featureEdgeIntensityValue"),
  featureLocalContrastValue: document.querySelector("#featureLocalContrastValue"),
  featureEdgeCountValue: document.querySelector("#featureEdgeCountValue"),
  scanCanvas: document.querySelector("#scanCanvas"),
  fieldCanvas: document.querySelector("#fieldCanvas"),
  scanSpeed: document.querySelector("#scanSpeed"),
  scanSpeedValue: document.querySelector("#scanSpeedValue"),
  scanAngle: document.querySelector("#scanAngle"),
  scanAngleValue: document.querySelector("#scanAngleValue"),
  pitchBase: document.querySelector("#pitchBase"),
  pitchBaseValue: document.querySelector("#pitchBaseValue"),
  sineMix: document.querySelector("#sineMix"),
  sineMixValue: document.querySelector("#sineMixValue"),
  pulseMix: document.querySelector("#pulseMix"),
  pulseMixValue: document.querySelector("#pulseMixValue"),
  noiseMix: document.querySelector("#noiseMix"),
  noiseMixValue: document.querySelector("#noiseMixValue"),
  masterGain: document.querySelector("#masterGain"),
  masterGainValue: document.querySelector("#masterGainValue"),
  clickGain: document.querySelector("#clickGain"),
  clickGainValue: document.querySelector("#clickGainValue"),
  pulseRate: document.querySelector("#pulseRate"),
  pulseRateValue: document.querySelector("#pulseRateValue"),
  pulseWidth: document.querySelector("#pulseWidth"),
  pulseWidthValue: document.querySelector("#pulseWidthValue"),
  burstDensity: document.querySelector("#burstDensity"),
  burstDensityValue: document.querySelector("#burstDensityValue"),
  noiseGain: document.querySelector("#noiseGain"),
  noiseGainValue: document.querySelector("#noiseGainValue"),
  noiseBandFreq: document.querySelector("#noiseBandFreq"),
  noiseBandFreqValue: document.querySelector("#noiseBandFreqValue"),
  noiseQ: document.querySelector("#noiseQ"),
  noiseQValue: document.querySelector("#noiseQValue"),
  noiseColor: document.querySelector("#noiseColor"),
  noiseColorValue: document.querySelector("#noiseColorValue"),
  bitDepth: document.querySelector("#bitDepth"),
  bitDepthValue: document.querySelector("#bitDepthValue"),
  sampleRateReduction: document.querySelector("#sampleRateReduction"),
  sampleRateReductionValue: document.querySelector("#sampleRateReductionValue"),
  clipAmount: document.querySelector("#clipAmount"),
  clipAmountValue: document.querySelector("#clipAmountValue"),
};

const state = {
  audioContext: null,
  masterGraph: null,
  degradation: null,
  source: null,
  scans: [],
  engines: null,
  running: false,
  mode: "studio",
  rafId: 0,
  lastStamp: 0,
  lastRenderStamp: 0,
  controls: null,
  presetButtons: [],
  particles: [],
  particleCarry: [],
  aggregate: null,
  breath: { phase: 0, complexity: 0, energy: 0 },
  glitch: createGlitch(),
  rd: createReactionDiffusion({ size: 320 }),
  wave: createWaveField({ size: 320 }),
  diffuse: createDiffuseField({ size: 320 }),
  fieldKind: "rd", // natural function driving the field: "rd" | "wave" | "diffuse"
  gl: null, // lazy WebGL2 generative renderer (null until first display)
  fxMode: "flow", // generative FX: flow | refract | kaleido | contour | mirror | slice | tile
  fxWarp: 0.06,
  fxColorMix: 0, // off by default — the field warps the image, doesn't colour-cover it
  scanLineWidth: 1.6, // scan-line thickness multiplier
  scanLineGlow: 1.0, // scan-line opacity multiplier
  geo: { symmetry: 0, periodicity: 0 }, // live geometric features of the material
  morphPhase: 0, // slow spin of the source plant in the generative composite
  colorizer: createFieldColorizer(),
  evolveCanvas: null,
  colorCanvas: null,
  natureOn: false,
  rdFrame: 0,
  rdAccum: 0,
  fieldState: createFieldState(),
  earth: { seismic: 0, quakeCount: 0, solarWind: 0, kp: 0, ok: false, updatedAt: 0 },
  earthTimer: 0,
  ryukyuOn: true,
  presets: [],
  bridge: createProcessingBridge({ url: "ws://localhost:8081", fps: 20 }),
};

const EARTH_REFRESH_MS = 10 * 60 * 1000;
const EARTH_CACHE_KEY = "el-systema-earth-state";
const PRESETS_KEY = "el-systema-presets";

// Faithful to Okinawa: the Ryukyu scale is the only tonal basis. World ethnic
// scales and polyrhythm were intentionally removed; the three scans run in
// unison and the percussion is a single Okinawan pulse.
const RYUKYU_SCALE_ID = "ryukyu";

const presetGroup = bindButtonGroup(elements.presetStrip, {
  onSelect: (preset) => {
    void loadPreset(preset);
  },
});
state.presetButtons = presetGroup.buttons;
presetGroup.setActive(DEFAULT_PRESET);

bindFileInput(elements.imageUpload, (file) => {
  void loadFile(file);
});

bindButton(elements.startAudioButton, () => {
  void startAudio();
});
bindButton(elements.startScanButton, () => {
  void startScan();
});
bindButton(elements.startAllButton, () => {
  void startAll();
});
bindButton(elements.stopButton, () => {
  stop();
});
bindButton(elements.stopAllButton, () => {
  void stopAll();
});

const reapply = () => {
  applyControls();
  renderUI(false);
};

bindRange(elements.scanSpeed, elements.scanSpeedValue, {
  format: (value) => value.toFixed(2),
  onChange: reapply,
});
bindRange(elements.scanAngle, elements.scanAngleValue, {
  format: (value) => `${value.toFixed(0)}°`,
  onChange: reapply,
});
bindRange(elements.pitchBase, elements.pitchBaseValue, {
  format: (value) => `${value.toFixed(0)}Hz`,
  onChange: reapply,
});
bindRange(elements.sineMix, elements.sineMixValue, {
  format: (value) => value.toFixed(2),
  onChange: reapply,
});
bindRange(elements.pulseMix, elements.pulseMixValue, {
  format: (value) => value.toFixed(2),
  onChange: reapply,
});
bindRange(elements.noiseMix, elements.noiseMixValue, {
  format: (value) => value.toFixed(2),
  onChange: reapply,
});
bindRange(elements.masterGain, elements.masterGainValue, {
  format: (value) => value.toFixed(2),
  onChange: reapply,
});
bindRange(elements.clickGain, elements.clickGainValue, {
  format: (value) => value.toFixed(2),
  onChange: reapply,
});
bindRange(elements.pulseRate, elements.pulseRateValue, {
  format: (value) => value.toFixed(2),
  onChange: reapply,
});
bindRange(elements.pulseWidth, elements.pulseWidthValue, {
  format: (value) => `${value.toFixed(1)}ms`,
  onChange: reapply,
});
bindRange(elements.burstDensity, elements.burstDensityValue, {
  format: (value) => value.toFixed(2),
  onChange: reapply,
});
bindRange(elements.noiseGain, elements.noiseGainValue, {
  format: (value) => value.toFixed(2),
  onChange: reapply,
});
bindRange(elements.noiseBandFreq, elements.noiseBandFreqValue, {
  format: formatHz,
  onChange: reapply,
});
bindRange(elements.noiseQ, elements.noiseQValue, {
  format: (value) => value.toFixed(2),
  onChange: reapply,
});
bindSelect(elements.noiseColor, elements.noiseColorValue, {
  onChange: reapply,
});
bindRange(elements.bitDepth, elements.bitDepthValue, {
  format: (value) => `${Math.round(value)}`,
  onChange: reapply,
});
bindRange(elements.sampleRateReduction, elements.sampleRateReductionValue, {
  format: (value) => `${Math.round(value)}`,
  onChange: reapply,
});
bindRange(elements.clipAmount, elements.clipAmountValue, {
  format: (value) => value.toFixed(2),
  onChange: reapply,
});

window.addEventListener("resize", () => {
  resizeCanvas();
  renderFrame();
});

initialize().catch(reportError);

async function initialize() {
  ensureSource();
  resizeCanvas();
  renderUI(true);
  await loadPreset(DEFAULT_PRESET, { quiet: true });
  setupOkinawaControls();
  setupNatureControls();
  setupHub();
  setupModeShell();
  setupKeyboard();
  setupProcessingLink();
  startEarthState();
  setStatus("Ready");
}

/** Bind the Processing WebSocket link: connect/disconnect, URL, status. */
function setupProcessingLink() {
  if (elements.processingUrl) {
    elements.processingUrl.addEventListener("change", () => {
      state.bridge?.setUrl?.(elements.processingUrl.value.trim());
    });
  }
  elements.processingToggle?.addEventListener("click", () => {
    const open = state.bridge?.isOpen?.() || state.bridge?.getStatus?.() === "connecting";
    if (open) {
      state.bridge?.disconnect?.();
    } else {
      state.bridge?.setUrl?.(elements.processingUrl?.value?.trim() || "ws://localhost:8081");
      state.bridge?.connect?.();
    }
    updateProcessingUI();
  });
  // Reflect live link status without coupling to the audio loop.
  setInterval(updateProcessingUI, 500);
  updateProcessingUI();
}

function updateProcessingUI() {
  const status = state.bridge?.getStatus?.() ?? "disconnected";
  if (elements.processingStatus) elements.processingStatus.textContent = status;
  if (elements.sbLink) elements.sbLink.textContent = status;
  if (elements.processingToggle) {
    elements.processingToggle.textContent =
      status === "disconnected" ? "Connect Processing" : "Disconnect Processing";
  }
}

/** Performable transport: Space toggles scan; 1/2/3 switch workspace mode
 * (all ignored while typing in a field). */
function setupKeyboard() {
  window.addEventListener("keydown", (e) => {
    const t = e.target;
    const tag = t && t.tagName ? t.tagName.toUpperCase() : "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;

    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      if (state.running) {
        stop();
      } else {
        void startScan();
      }
      return;
    }

    if (e.key >= "1" && e.key <= "3") {
      const mode = MODES[Number(e.key) - 1];
      if (mode) {
        e.preventDefault();
        applyMode(mode);
      }
    }
  });
}

// ---- HUB: mode shell (curate visible control panels per workspace) ---------

/** Show only the panels for `mode` (studio shows all); persist + mirror to bar. */
function applyMode(mode) {
  if (!MODES.includes(mode)) mode = "studio";
  state.mode = mode;
  const allow = MODE_PANELS[mode]; // null => show every panel
  for (const panel of elements.modePanels) {
    const key = panel.dataset.panel;
    const show = !allow || allow.includes(key);
    panel.classList.toggle("is-hidden", !show);
  }
  for (const btn of elements.modeButtons) {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  }
  document.body.dataset.mode = mode;
  if (elements.sbMode) elements.sbMode.textContent = mode;
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // storage unavailable — non-fatal
  }
}

/** Wire mode buttons and restore the last-used workspace mode. */
function setupModeShell() {
  for (const btn of elements.modeButtons) {
    btn.addEventListener("click", () => applyMode(btn.dataset.mode));
  }
  let stored = "studio";
  try {
    stored = localStorage.getItem(MODE_KEY) || "studio";
  } catch {
    // ignore
  }
  applyMode(stored);
}

// ---- HUB: presets (save/load the whole instrument state) -------------------

const PRESET_RANGE_ELS = [
  "scanSpeed", "scanAngle", "pitchBase", "sineMix", "pulseMix", "noiseMix",
  "masterGain", "clickGain", "pulseRate", "pulseWidth", "burstDensity",
  "noiseGain", "noiseBandFreq", "noiseQ", "bitDepth", "sampleRateReduction",
  "clipAmount",
];

/** Snapshot every instrument setting into a plain object (preset settings). */
function gatherSettings() {
  const s = {};
  for (const id of PRESET_RANGE_ELS) s[id] = Number(elements[id]?.value);
  s.noiseColor = elements.noiseColor?.value ?? "digital";
  // Ryukyu is the only tuning now (always on); keep the flag for preset compat.
  s.ryukyuOn = elements.ryukyuToggle ? !!elements.ryukyuToggle.checked : state.ryukyuOn;
  s.natureOn = !!elements.natureToggle?.checked;
  s.natureFunction = elements.natureFunction?.value ?? "rd";
  s.naturePreset = elements.naturePreset?.value ?? "coral";
  s.fxMode = elements.fxMode?.value ?? state.fxMode;
  s.fxWarp = elements.fxWarp ? Number(elements.fxWarp.value) : state.fxWarp;
  s.fxColorMix = elements.fxColorMix ? Number(elements.fxColorMix.value) : state.fxColorMix;
  s.scanLineWidth = elements.scanLineWidth ? Number(elements.scanLineWidth.value) : state.scanLineWidth;
  s.scanLineGlow = elements.scanLineGlow ? Number(elements.scanLineGlow.value) : state.scanLineGlow;
  return normalizeSettings(s);
}

/** Apply a normalized settings object to the UI; dispatched events re-run the
 * existing binding handlers so audio/visual state follows. */
function applySettings(raw) {
  const s = normalizeSettings(raw);
  for (const id of PRESET_RANGE_ELS) {
    const el = elements[id];
    if (!el) continue;
    el.value = String(s[id]);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (elements.noiseColor) {
    elements.noiseColor.value = s.noiseColor;
    elements.noiseColor.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (elements.ryukyuToggle) {
    elements.ryukyuToggle.checked = s.ryukyuOn;
    elements.ryukyuToggle.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (elements.natureFunction) {
    elements.natureFunction.value = s.natureFunction;
    elements.natureFunction.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (elements.naturePreset) {
    elements.naturePreset.value = s.naturePreset;
    elements.naturePreset.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (elements.fxMode) {
    elements.fxMode.value = s.fxMode;
    elements.fxMode.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (elements.fxWarp) {
    elements.fxWarp.value = String(s.fxWarp);
    elements.fxWarp.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (elements.fxColorMix) {
    elements.fxColorMix.value = String(s.fxColorMix);
    elements.fxColorMix.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (elements.scanLineWidth) {
    elements.scanLineWidth.value = String(s.scanLineWidth);
    elements.scanLineWidth.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (elements.scanLineGlow) {
    elements.scanLineGlow.value = String(s.scanLineGlow);
    elements.scanLineGlow.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (elements.natureToggle) {
    elements.natureToggle.checked = s.natureOn;
    elements.natureToggle.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function loadStoredPresets() {
  try {
    const arr = JSON.parse(localStorage.getItem(PRESETS_KEY) || "[]");
    if (!Array.isArray(arr)) return [];
    return arr.map(validatePreset).filter(Boolean);
  } catch {
    return [];
  }
}

function storePresets(list) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable — non-fatal
  }
}

function refreshPresetList() {
  const sel = elements.presetList;
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = "";
  for (const p of state.presets) {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function setupHub() {
  state.presets = loadStoredPresets();
  refreshPresetList();

  elements.presetSave?.addEventListener("click", () => {
    const name = (elements.presetName?.value || "").trim() || `preset ${state.presets.length + 1}`;
    const preset = capturePreset(name, gatherSettings());
    const idx = state.presets.findIndex((p) => p.name === name);
    if (idx >= 0) state.presets[idx] = preset; else state.presets.push(preset);
    storePresets(state.presets);
    refreshPresetList();
    if (elements.presetList) elements.presetList.value = name;
    setStatus(`Saved preset: ${name}`);
  });

  elements.presetLoad?.addEventListener("click", () => {
    const name = elements.presetList?.value;
    const preset = state.presets.find((p) => p.name === name);
    if (!preset) return;
    applySettings(preset.settings);
    setStatus(`Loaded preset: ${name}`);
  });

  elements.presetDelete?.addEventListener("click", () => {
    const name = elements.presetList?.value;
    if (!name) return;
    state.presets = state.presets.filter((p) => p.name !== name);
    storePresets(state.presets);
    refreshPresetList();
    setStatus(`Deleted preset: ${name}`);
  });

  elements.presetExport?.addEventListener("click", exportPresets);
  elements.presetImport?.addEventListener("change", () => {
    const file = elements.presetImport.files?.[0];
    if (file) void importPresets(file);
    elements.presetImport.value = ""; // allow re-importing the same file
  });
}

/** Download all presets as a JSON file (backup / share beyond localStorage). */
function exportPresets() {
  try {
    const blob = new Blob([JSON.stringify(state.presets, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "el-systema-presets.json";
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${state.presets.length} preset(s)`);
  } catch {
    setStatus("Export failed");
  }
}

/** Merge presets from an uploaded JSON file (validated; dedupe by name). */
async function importPresets(file) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const incoming = (Array.isArray(parsed) ? parsed : [parsed]).map(validatePreset).filter(Boolean);
    if (!incoming.length) {
      setStatus("No valid presets in file");
      return;
    }
    for (const p of incoming) {
      const idx = state.presets.findIndex((q) => q.name === p.name);
      if (idx >= 0) state.presets[idx] = p; else state.presets.push(p);
    }
    storePresets(state.presets);
    refreshPresetList();
    setStatus(`Imported ${incoming.length} preset(s)`);
  } catch {
    setStatus("Import failed");
  }
}

/** The natural function currently driving the nature field: reaction-diffusion
 * or the wave equation. Both share the same simulator API. */
function activeField() {
  if (state.fieldKind === "wave") return state.wave;
  if (state.fieldKind === "diffuse") return state.diffuse;
  return state.rd;
}

const FIELD_KINDS = ["rd", "wave", "diffuse"];

/** Apply a preset name to all natural functions so switching stays seamless. */
function setAllFieldPresets(name) {
  const preset = name || "coral";
  state.rd.setPreset(preset);
  state.wave.setPreset(preset);
  state.diffuse.setPreset(preset);
}

/** Bind the natural-field toggle, function (rd/wave/diffuse), preset and the
 * generative FX controls (mode / warp / colour-mix). */
function setupNatureControls() {
  if (elements.natureToggle) {
    elements.natureToggle.checked = state.natureOn;
    elements.natureToggle.addEventListener("change", () => {
      state.natureOn = elements.natureToggle.checked;
      refreshScansFromSource();
      updateNatureLabel();
      renderFrame();
    });
  }
  if (elements.natureFunction) {
    const read = () => (FIELD_KINDS.includes(elements.natureFunction.value) ? elements.natureFunction.value : "rd");
    state.fieldKind = read();
    elements.natureFunction.addEventListener("change", () => {
      state.fieldKind = read();
      // Switching the natural function re-seeds the newly active field from the
      // current plant and re-points the scans at its evolving image.
      refreshScansFromSource();
      updateNatureLabel();
      renderFrame();
    });
  }
  if (elements.naturePreset) {
    elements.naturePreset.addEventListener("change", () => {
      setAllFieldPresets(elements.naturePreset.value);
      updateNatureLabel();
    });
    setAllFieldPresets(elements.naturePreset.value);
  }
  // Generative FX mode (how the field transforms the image on the GPU).
  if (elements.fxMode) {
    const readMode = () => (GENERATIVE_FX_MODES.includes(elements.fxMode.value) ? elements.fxMode.value : "flow");
    state.fxMode = readMode();
    elements.fxMode.addEventListener("change", () => {
      state.fxMode = readMode();
      updateNatureLabel();
    });
  }
  if (elements.fxWarp) {
    bindRange(elements.fxWarp, elements.fxWarpValue, {
      format: (v) => v.toFixed(3),
      onChange: (v) => { state.fxWarp = v; },
    });
  }
  if (elements.fxColorMix) {
    bindRange(elements.fxColorMix, elements.fxColorMixValue, {
      format: (v) => v.toFixed(2),
      onChange: (v) => { state.fxColorMix = v; },
    });
  }
  if (elements.scanLineWidth) {
    bindRange(elements.scanLineWidth, elements.scanLineWidthValue, {
      format: (v) => v.toFixed(1),
      onChange: (v) => { state.scanLineWidth = v; },
    });
  }
  if (elements.scanLineGlow) {
    bindRange(elements.scanLineGlow, elements.scanLineGlowValue, {
      format: (v) => v.toFixed(2),
      onChange: (v) => { state.scanLineGlow = v; },
    });
  }
  updateNatureLabel();
}

function updateNatureLabel() {
  if (!elements.natureValue) return;
  if (!state.natureOn) {
    elements.natureValue.textContent = "off";
    return;
  }
  const p = activeField().getParams?.() ?? {};
  const gpu = state.gl?.isAvailable ? state.fxMode : "2d";
  elements.natureValue.textContent = `${state.fieldKind} · ${p.preset ?? "on"} · ${gpu}`;
}

/** Bind the Okinawa (Ryukyu) tuning toggle. */
function setupOkinawaControls() {
  if (elements.ryukyuToggle) {
    elements.ryukyuToggle.checked = state.ryukyuOn;
    elements.ryukyuToggle.addEventListener("change", () => {
      state.ryukyuOn = elements.ryukyuToggle.checked;
      updateScaleLabel();
      applyScale();
    });
  }
  updateScaleLabel();
  applyScale();
}

/** Ryukyu state plus the live seismic transpose (e.g. "Ryukyu +9", or "off"). */
function updateScaleLabel() {
  const text = !state.ryukyuOn
    ? "off"
    : (() => { const s = earthTransposeSemis(); return s > 0 ? `Ryukyu +${s}` : "Ryukyu"; })();
  if (elements.scaleValue) elements.scaleValue.textContent = text;
  if (elements.sbNature) elements.sbNature.textContent = text; // global bar "tuning" chip
}

/**
 * Quantize the sine to the Ryukyu (Okinawan) scale, coupled to the live earth
 * state: today's largest quake transposes the tonic, and the geomagnetic Kp
 * index micro-detunes. The closure reads state.earth per note, so the tuning
 * drifts as the planet's state updates. Toggle off for a continuous glide.
 */
function applyScale() {
  const sine = state.engines?.sine;
  if (!sine?.setQuantizer) return;
  if (!state.ryukyuOn) {
    sine.setQuantizer(null);
    return;
  }
  sine.setQuantizer((hz, rootHz) => {
    const e = state.earth;
    const earthRoot = rootHz * Math.pow(2, earthTransposeSemis() / 12);
    const snapped = quantizeHzToScale(hz, RYUKYU_SCALE_ID, earthRoot);
    return snapped * Math.pow(2, (e.kp * 25) / 1200); // up to ~25c geomagnetic detune
  });
}

/** Today's max-magnitude quake → 0..12 semitone transpose of the tonic. */
function earthTransposeSemis() {
  return Math.round(state.earth.seismic * 12);
}

/** Earth couplings into the tonal engine (called whenever earth state changes). */
function applyEarthAudio() {
  const sine = state.engines?.sine;
  // Active solar wind widens the melodic ambitus.
  sine?.setParam?.("pitchRange", 880 * (1 + state.earth.solarWind * 0.8));
}

/**
 * Pull live earth state (USGS quakes / NOAA solar wind) and refresh it slowly.
 * Each session inherits a different planetary bias — the "discontinuous
 * continuity" the instrument is built around. Never blocks startup or throws.
 */
function startEarthState() {
  // Seed from the last session so a planetary bias is present instantly and the
  // field still "remembers the earth" when offline / before the fetch lands.
  const cached = loadCachedEarth();
  if (cached) {
    state.earth = cached;
    updateEarthUI();
  }

  const pull = async () => {
    try {
      const next = await state.fieldState.refresh();
      if (next && next.ok) {
        state.earth = next;
        saveCachedEarth(next);
      }
    } catch {
      // keep last cached earth state
    }
    updateEarthUI();
  };
  void pull();
  if (state.earthTimer) clearInterval(state.earthTimer);
  state.earthTimer = setInterval(pull, EARTH_REFRESH_MS);
}

function loadCachedEarth() {
  try {
    const raw = localStorage.getItem(EARTH_CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return {
      seismic: clamp01(Number(obj.seismic) || 0),
      quakeCount: clamp01(Number(obj.quakeCount) || 0),
      solarWind: clamp01(Number(obj.solarWind) || 0),
      kp: clamp01(Number(obj.kp) || 0),
      ok: Boolean(obj.ok),
      updatedAt: Number(obj.updatedAt) || 0,
    };
  } catch {
    return null;
  }
}

function saveCachedEarth(earth) {
  try {
    localStorage.setItem(EARTH_CACHE_KEY, JSON.stringify(earth));
  } catch {
    // storage unavailable (private mode / quota) — non-fatal
  }
}

function updateEarthUI() {
  const e = state.earth;
  if (elements.earthSeismicValue) elements.earthSeismicValue.textContent = e.seismic.toFixed(2);
  if (elements.earthSolarValue) elements.earthSolarValue.textContent = e.solarWind.toFixed(2);
  if (elements.earthKpValue) elements.earthKpValue.textContent = e.kp.toFixed(2);
  if (elements.sbEarth) {
    elements.sbEarth.textContent = `S${e.seismic.toFixed(2)} W${e.solarWind.toFixed(2)} K${e.kp.toFixed(2)}`;
  }

  applyEarthAudio();
  updateScaleLabel();
}

function ensureSource() {
  if (!state.source) {
    state.source = new PatternSource();
    state.source.generateDefaultPattern();
  }
  if (state.scans.length === 0) {
    state.scans = SCAN_COLORS.map((color) => new ScanEngine({ color }));
  }
  // Field canvases stay at a modest resolution (the field sim is ~320 and the
  // GPU upsamples it smoothly) so the per-frame colourise stays cheap even
  // though the source is now high-res.
  for (const key of ["evolveCanvas", "colorCanvas"]) {
    if (!state[key]) {
      state[key] = document.createElement("canvas");
      state[key].width = NATURE_FIELD_RES;
      state[key].height = NATURE_FIELD_RES;
    }
  }
  // morphCanvas = the spinning/breathing plant (full source resolution so the
  // GPU FX process the original at maximum fidelity); displayCanvas = the 2D
  // fallback composite.
  for (const key of ["morphCanvas", "displayCanvas"]) {
    if (!state[key]) {
      state[key] = document.createElement("canvas");
      state[key].width = state.source.sourceCanvas.width;
      state[key].height = state.source.sourceCanvas.height;
    }
  }
}

const NATURE_PALETTE = { coral: "coral", mitosis: "moss", waves: "ocean" };

/** Lazily create the WebGL2 generative renderer and keep it sized to the stage.
 * Returns an object with isAvailable=false if WebGL2 is unsupported. */
function ensureGenerative(w, h) {
  if (state.gl === null) {
    try {
      state.gl = createGenerativeRenderer({ width: w, height: h });
    } catch (_) {
      state.gl = { isAvailable: false, render() {}, setSize() {} };
    }
  }
  if (state.gl && state.gl.isAvailable) state.gl.setSize(w, h);
  return state.gl;
}

/** The image shown on the scan stage. With nature off it is the pristine plant.
 * With nature on it is a generative composite: the plant slowly spins and
 * breathes underneath, and the high-res evolving field is colourised and
 * screened over it translucently so the source shows through and keeps morphing
 * — a living image rather than a flat replacement. */
function displaySource() {
  if (!(state.natureOn && state.evolveCanvas && state.colorCanvas && state.displayCanvas)) {
    return state.source.sourceCanvas;
  }
  const base = state.source.sourceCanvas;
  const w = state.displayCanvas.width;
  const h = state.displayCanvas.height;
  const breathWave = Math.sin(state.breath.phase) * 0.5 + 0.5;

  // 1. Morph the plant: slow spin + gentle breathing zoom about the centre.
  const mctx = state.morphCanvas.getContext("2d");
  const zoom = 1 + 0.05 * breathWave * (0.4 + state.breath.complexity);
  mctx.save();
  mctx.fillStyle = "#04080a";
  mctx.fillRect(0, 0, w, h);
  mctx.translate(w / 2, h / 2);
  mctx.rotate(state.morphPhase);
  mctx.scale(zoom, zoom);
  mctx.drawImage(base, -w / 2, -h / 2, w, h);
  mctx.restore();

  // 2. Colourise the evolving field; vividness breathes + brightens on solar wind.
  const palette = NATURE_PALETTE[elements.naturePreset?.value ?? "coral"] ?? "coral";
  const intensity = clamp01(0.5 + 0.3 * breathWave * state.breath.complexity + 0.3 * state.earth.solarWind);
  state.colorizer.colorize(state.evolveCanvas, state.colorCanvas, { palette, intensity });

  // 3a. Modern path (GPU): the field flow *transforms* the plant on the GPU —
  //     domain-warp / refract / kaleido / contour — instead of being layered
  //     over it. The plant is never covered; it morphs and re-colours.
  const gl = ensureGenerative(w, h);
  if (gl && gl.isAvailable) {
    const rgb = (FIELD_RGB[palette] ?? FIELD_RGB.moss).split(",").map((n) => Number(n) / 255);
    gl.render(state.morphCanvas, state.colorCanvas, {
      time: state.morphPhase,
      breath: breathWave,
      // Geometric feedback: repetitive material (high periodicity) flows a touch
      // more — the source's own structure drives the FX.
      warp: state.fxWarp * (1 + 0.6 * (state.geo?.periodicity ?? 0)),
      colorMix: state.fxColorMix,
      mode: state.fxMode,
      fieldRgb: rgb,
    });
    return gl.canvas;
  }

  // 3b. Fallback (no WebGL2): the earlier 2D translucent composite, plant kept
  //     legible — a soft field bloom, the sharp field screened lightly, then the
  //     plant re-asserted faintly so it never disappears.
  const dctx = state.displayCanvas.getContext("2d");
  const sharp = clamp01(0.2 + 0.25 * breathWave * (0.5 + 0.5 * state.breath.complexity));
  dctx.save();
  dctx.globalCompositeOperation = "source-over";
  dctx.globalAlpha = 1;
  dctx.clearRect(0, 0, w, h);
  dctx.drawImage(state.morphCanvas, 0, 0, w, h);
  dctx.globalCompositeOperation = "screen";
  dctx.filter = `blur(${Math.round(w / 220)}px)`;
  dctx.globalAlpha = sharp * 0.7;
  dctx.drawImage(state.colorCanvas, 0, 0, w, h);
  dctx.filter = "none";
  dctx.globalAlpha = sharp;
  dctx.drawImage(state.colorCanvas, 0, 0, w, h);
  dctx.globalCompositeOperation = "source-over";
  dctx.globalAlpha = 0.22;
  dctx.drawImage(state.morphCanvas, 0, 0, w, h);
  dctx.restore();
  dctx.filter = "none";
  return state.displayCanvas;
}

/** The canvas the scans read: the live reaction-diffusion field when the
 * nature simulation is on, otherwise the pristine plant source. */
function scanSource() {
  return state.natureOn && state.evolveCanvas ? state.evolveCanvas : state.source.sourceCanvas;
}

function buildAudioGraph() {
  if (state.masterGraph) return;

  const context = ensureAudioContext();
  state.audioContext = context;
  state.masterGraph = createMasterGraph(context);
  state.degradation = new Degradation();
  state.degradation.getOutput().connect(state.masterGraph.input);
  setMasterBus({
    getInput: () => state.degradation.getInput(),
    setGain: (value) => state.masterGraph.setGain(value),
  });

  state.engines = {
    sine: new GeometryOsc(),
    pulse: new PulseEngine(),
    noise: new NoiseEngine(),
    percussion: new RitualPercussion(),
  };

  state.engines.sine.setParam("pitchBase", 80);
  state.engines.sine.setParam("pitchRange", 880);
  state.engines.sine.setParam("fmAmount", 30);
  state.engines.sine.setParam("densitySensitivity", 0.72);

  refreshScansFromSource();
  applyControls();
  applyScale();
  applyPercussionPulse();
}

/** Average the geometric features (symmetry / periodicity) across the raw scans. */
function aggregateGeo(mappedFeatures) {
  let s = 0;
  let p = 0;
  let n = 0;
  for (const entry of mappedFeatures) {
    const r = entry?.raw;
    if (!r) continue;
    s += r.symmetry ?? 0;
    p += r.periodicity ?? 0;
    n += 1;
  }
  return { symmetry: n ? s / n : 0, periodicity: n ? p / n : 0 };
}

/** Drive the percussion as a single Okinawan pulse (unison, no polyrhythm). */
function applyPercussionPulse() {
  const perc = state.engines?.percussion;
  if (!perc?.setPolyrhythm) return;
  // Base pulse scales gently with scanSpeed so visual motion and pulse agree.
  const tempoHz = 2 * (0.6 + 0.4 * (state.controls?.scanSpeed ?? 1));
  perc.setPolyrhythm([1, 1, 1], tempoHz);
}

async function startAudio() {
  buildAudioGraph();
  await resumeAudioContext();
  setStatus("Audio ready");
  renderFrame();
}

async function startScan() {
  await startAudio();
  startEngines();
  startLoop();
  setStatus("Scanning");
}

async function startAll() {
  await startScan();
}

function startEngines() {
  state.engines?.sine?.start();
  state.engines?.pulse?.start();
  state.engines?.noise?.start();
  state.engines?.percussion?.start();
}

function stopEngines() {
  state.engines?.sine?.stop();
  state.engines?.pulse?.stop();
  state.engines?.noise?.stop();
  state.engines?.percussion?.stop();
}

function startLoop() {
  if (state.running) return;
  state.running = true;
  state.lastStamp = performance.now();
  state.lastRenderStamp = 0;
  for (const scan of state.scans) {
    scan.advance(0);
  }
  const frame = (stamp) => {
    if (!state.running) return;
    const dt = Math.min(0.05, (stamp - state.lastStamp) / 1000 || 0.016);
    state.lastStamp = stamp;
    stepScans(dt);
    if (stamp - state.lastRenderStamp >= 1000 / MAX_RENDER_FPS) {
      renderFrame();
      state.lastRenderStamp = stamp;
    }
    state.rafId = requestAnimationFrame(frame);
  };
  state.rafId = requestAnimationFrame(frame);
}

function stop() {
  state.running = false;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  stopEngines();
  state.particles.length = 0;
  for (const c of state.particleCarry) if (c) c.carry = 0;
  state.breath.complexity = 0;
  state.breath.energy = 0;
  setStatus("Stopped");
  renderFrame();
}

async function stopAll() {
  stop();
  await suspendAudioContext();
  setStatus("Suspended");
}

function stepScans(dt) {
  if (!state.scans.length) return;

  // Breath gain pulses emission around 1.0; modulation depth grows with the
  // smoothed complexity, so particles surge and recede with the same wave that
  // drives the grid and halo — sound source, particles and background as one.
  const breathWave = Math.sin(state.breath.phase) * 0.5 + 0.5;
  const breathDepth = 0.6 * state.breath.complexity;
  // Earthquake frequency adds a steady emission boost to the whole field.
  const breathGain = ((1 - breathDepth) + 2 * breathDepth * breathWave) * (1 + state.earth.quakeCount * 0.4);

  // Advance the natural field (reaction-diffusion) and let scans re-read the
  // evolving image. Stepped on a wall-clock cadence (~60/s) decoupled from the
  // uncapped rAF physics loop, so the simulation evolves at the same rate at
  // any frame rate instead of racing to a dead equilibrium.
  if (state.natureOn) {
    const RD_DT = 1 / 60;
    state.rdAccum += dt;
    let stepped = false;
    // Bound per-frame field work at the higher (320) grid: fewer catch-up steps
    // and fewer iterations keep a single frame from stalling on heavy machines —
    // under load the field just evolves a touch slower, never freezes the loop.
    let budget = 2;
    while (state.rdAccum >= RD_DT && budget-- > 0) {
      state.rdAccum -= RD_DT;
      activeField().step(RD_DT, 6);
      stepped = true;
    }
    if (state.rdAccum > RD_DT) state.rdAccum = 0; // drop backlog beyond budget
    if (stepped) {
      activeField().render(state.evolveCanvas);
      state.rdFrame++;
    }
  }

  const mappedFeatures = [];
  for (let index = 0; index < state.scans.length; index++) {
    const scan = state.scans[index];
    if (state.natureOn) scan.refresh(state.evolveCanvas, state.rdFrame % 30 === 0);
    scan.advance(dt);
    const pixels = scan.getScanLine();
    const raw = extractFeatures(pixels);
    const mapped = mapFeaturesForEngine(raw, scan, index);
    mappedFeatures.push({ raw, mapped, scan });

    // Visual field: spawn particles at the same scan head that feeds the audio.
    if (!state.particleCarry[index]) state.particleCarry[index] = { carry: 0 };
    spawnFromScan(
      state.particles,
      mapped,
      scan.getHeadNormalized(),
      index,
      scan.strength ?? 1,
      dt,
      state.particleCarry[index],
      breathGain,
    );
  }

  stepParticles(state.particles, dt);

  state.engines?.sine?.update(mappedFeatures[0]?.mapped ?? emptyFeatures());
  state.engines?.pulse?.update(mappedFeatures[1]?.mapped ?? emptyFeatures());
  state.engines?.noise?.update(mappedFeatures[2]?.mapped ?? emptyFeatures());

  const aggregate = aggregateFeatures(mappedFeatures.map((entry) => entry?.mapped ?? emptyFeatures()));
  // Geometric features (symmetry / periodicity) averaged across the raw scans.
  state.geo = aggregateGeo(mappedFeatures);
  state.degradation?.update(aggregate);
  state.engines?.percussion?.update(aggregate);
  // Bidirectional loop: what the scans hear (plus the material's geometry) feeds
  // back into how the field grows.
  if (state.natureOn) activeField().nudge({ ...aggregate, ...state.geo });
  state.aggregate = aggregate;
  advanceBreath(aggregate, dt);
  // The plant in the generative composite turns slowly, a touch faster when the
  // field is energetic — the spiral itself becomes a living, evolving image.
  state.morphPhase += dt * (0.05 + 0.12 * state.breath.energy);
  sendProcessingFrame(mappedFeatures, aggregate);
  renderStats(mappedFeatures, aggregate);
}

/**
 * Emit the live state to the Processing link (WebSocket). The bridge throttles
 * and silently drops when not connected, so this is safe to call every frame.
 */
function sendProcessingFrame(mappedFeatures, aggregate) {
  if (!state.bridge?.isOpen?.()) return;
  const scans = mappedFeatures.map((entry) => {
    const head = entry.scan?.getHeadNormalized?.() ?? { x: 0, y: 0, angle: 0 };
    const m = entry.mapped;
    return {
      strength: entry.scan?.strength ?? 0,
      density: m.density,
      edgeIntensity: m.edgeIntensity,
      complexity: m.complexity,
      x: head.x,
      y: head.y,
      phase: m.scanPhase,
    };
  });
  const rootHz = state.controls?.pitchBase ?? 80;
  state.bridge.send({
    t: Date.now(),
    scans,
    aggregate,
    breath: { phase: state.breath.phase, complexity: state.breath.complexity, energy: state.breath.energy },
    earth: {
      seismic: state.earth.seismic,
      quakeCount: state.earth.quakeCount,
      solarWind: state.earth.solarWind,
      kp: state.earth.kp,
    },
    music: {
      scaleId: state.ryukyuOn ? RYUKYU_SCALE_ID : "off",
      rootHz,
      transposeSemis: earthTransposeSemis(),
      degrade: state.degradation?.getDegradeAmount?.() ?? 0,
    },
    nature: natureFrame(),
  });
}

/** Nature-field state for the Processing link: which natural function is live,
 * its preset, and the parameters being modulated by the bidirectional loop. */
function natureFrame() {
  if (!state.natureOn) return { on: false };
  const p = activeField()?.getParams?.() ?? {};
  return {
    on: true,
    kind: state.fieldKind,
    preset: p.preset ?? "default",
    feedback: p.feedback ?? 0,
    fx: { mode: state.fxMode, warp: state.fxWarp, colorMix: state.fxColorMix, gpu: !!state.gl?.isAvailable },
    geo: { symmetry: state.geo?.symmetry ?? 0, periodicity: state.geo?.periodicity ?? 0 },
    // reaction-diffusion params
    feed: p.feed ?? 0,
    kill: p.kill ?? 0,
    // wave params
    c2: p.c2 ?? 0,
    damping: p.damping ?? 0,
    forcing: p.forcing ?? 0,
    // diffuse params
    rate: p.rate ?? 0,
    decay: p.decay ?? 0,
    inject: p.inject ?? 0,
  };
}

/**
 * The background field breathes: a slow phase whose rate rises with overall
 * energy, and smoothed complexity/energy levels that the grid and halo read.
 * Complex, energetic geometry → faster, deeper breathing.
 */
function advanceBreath(aggregate, dt) {
  const breath = state.breath;
  // Seismic activity raises the resting energy so quiet geometry still breathes
  // when the earth is active.
  const energy = clamp01(aggregate.density * 0.6 + aggregate.edgeIntensity * 0.4 + state.earth.seismic * 0.35);
  // Exponential smoothing so the field swells and settles instead of flickering.
  const smooth = 1 - Math.pow(0.0001, dt); // ~time-constant ≈ 0.1s
  breath.complexity += (aggregate.complexity - breath.complexity) * smooth;
  breath.energy += (energy - breath.energy) * smooth;
  // 0.12–0.55 Hz: idle slow breath that quickens with energy.
  const rate = 0.12 + breath.energy * 0.43;
  breath.phase = (breath.phase + dt * rate * Math.PI * 2) % (Math.PI * 2);
}

function mapFeaturesForEngine(features, scan, index) {
  const strength = scan?.strength ?? 1;
  const speedFactor = clamp01((state.controls?.scanSpeed ?? Number(elements.scanSpeed.value)) / 2.2);
  const angleFactor = 0.9 + 0.1 * Math.abs(Math.sin((state.controls?.scanAngle ?? 0) + index));
  const drive = 0.6 + strength * 0.7 + speedFactor * 0.4;

  return {
    density: clamp01(features.density * drive),
    toggleRate: clamp01(features.toggleRate * (0.7 + strength * 0.8 + speedFactor * 0.2)),
    complexity: clamp01(features.complexity * (0.65 + strength * 0.9) * angleFactor),
    edgeIntensity: clamp01(features.edgeIntensity * (0.75 + strength * 0.7)),
    localContrast: clamp01(features.localContrast * (0.7 + strength * 0.6 + speedFactor * 0.2)),
    edgeCount: clamp01(features.edgeCount * (0.6 + strength * 0.8)),
    scanPhase: scan?.position ?? 0,
  };
}

function aggregateFeatures(list) {
  if (!list.length) return emptyFeatures();
  let density = 0;
  let toggleRate = 0;
  let complexity = 0;
  let edgeIntensity = 0;
  let localContrast = 0;
  let edgeCount = 0;
  let scanPhase = 0;

  for (const item of list) {
    density += item.density;
    toggleRate += item.toggleRate;
    complexity = Math.max(complexity, item.complexity);
    edgeIntensity = Math.max(edgeIntensity, item.edgeIntensity);
    localContrast += item.localContrast;
    edgeCount = Math.max(edgeCount, item.edgeCount);
    scanPhase += item.scanPhase;
  }

  const count = list.length;
  return {
    density: density / count,
    toggleRate: toggleRate / count,
    complexity,
    edgeIntensity,
    localContrast: localContrast / count,
    edgeCount,
    scanPhase: scanPhase / count,
  };
}

function emptyFeatures() {
  return {
    density: 0,
    toggleRate: 0,
    complexity: 0,
    edgeIntensity: 0,
    localContrast: 0,
    edgeCount: 0,
    scanPhase: 0,
  };
}

function applyControls() {
  state.controls = readControls();

  if (state.scans.length) {
    for (const scan of state.scans) {
      scan.scanSpeed = state.controls.scanSpeed;
      scan.scanAngle = state.controls.scanAngle;
    }
  }

  if (state.engines) {
    state.engines.sine?.setParam("pitchBase", state.controls.pitchBase);
    state.engines.sine?.setParam("sineMix", state.controls.sineMix);
    state.engines.pulse?.setParam("pulseMix", state.controls.pulseMix);
    state.engines.pulse?.setParam("clickGain", state.controls.clickGain);
    state.engines.pulse?.setParam("pulseRate", state.controls.pulseRate);
    state.engines.pulse?.setParam("pulseWidth", state.controls.pulseWidth / 1000);
    state.engines.pulse?.setParam("burstDensity", state.controls.burstDensity);
    state.engines.noise?.setParam("noiseMix", state.controls.noiseMix);
    state.engines.noise?.setParam("noiseGain", state.controls.noiseGain);
    state.engines.noise?.setParam("noiseBandFreq", state.controls.noiseBandFreq);
    state.engines.noise?.setParam("noiseQ", state.controls.noiseQ);
    state.engines.noise?.setParam("noiseColor", state.controls.noiseColor);
  }

  if (state.degradation) {
    state.degradation.setParam("bitDepth", state.controls.bitDepth);
    state.degradation.setParam("sampleRateReduction", state.controls.sampleRateReduction);
    state.degradation.setParam("clipAmount", state.controls.clipAmount);
  }

  if (state.masterGraph) {
    state.masterGraph.setGain(state.controls.masterGain);
  }
}

function readControls() {
  return {
    scanSpeed: Number(elements.scanSpeed.value),
    scanAngle: degToRad(Number(elements.scanAngle.value)),
    pitchBase: Number(elements.pitchBase.value),
    sineMix: Number(elements.sineMix.value),
    pulseMix: Number(elements.pulseMix.value),
    noiseMix: Number(elements.noiseMix.value),
    masterGain: Number(elements.masterGain.value),
    clickGain: Number(elements.clickGain.value),
    pulseRate: Number(elements.pulseRate.value),
    pulseWidth: Number(elements.pulseWidth.value),
    burstDensity: Number(elements.burstDensity.value),
    noiseGain: Number(elements.noiseGain.value),
    noiseBandFreq: Number(elements.noiseBandFreq.value),
    noiseQ: Number(elements.noiseQ.value),
    noiseColor: elements.noiseColor.value,
    bitDepth: Number(elements.bitDepth.value),
    sampleRateReduction: Number(elements.sampleRateReduction.value),
    clipAmount: Number(elements.clipAmount.value),
  };
}

async function loadPreset(url, { quiet = false } = {}) {
  ensureSource();
  if (!quiet) setStatus(`Loading ${labelFromPreset(url)}...`);
  presetGroup.setActive(url);
  try {
    await state.source.tryLoadAsset(url);
  } catch {
    state.source.generateDefaultPattern();
  }
  refreshScansFromSource();
  updateSourceLabels();
  renderSourcePreview();
  applyControls();
  renderFrame();
  if (!quiet) setStatus(`Source: ${state.source.sourceLabel}`);
}

async function loadFile(file) {
  ensureSource();
  presetGroup.setActive("");
  setStatus(`Loading ${file.name}...`);
  await state.source.loadFromFile(file);
  refreshScansFromSource();
  updateSourceLabels();
  renderSourcePreview();
  applyControls();
  renderFrame();
  setStatus(`Source: ${file.name}`);
}

function refreshScansFromSource() {
  if (!state.source || !state.scans.length) return;
  // Seed the nature field from the freshly loaded plant, then point scans at
  // whichever canvas is live (evolving field or pristine source).
  if (state.natureOn) {
    activeField().reset(state.source.sourceCanvas);
    activeField().render(state.evolveCanvas);
  }
  const src = scanSource();
  for (const scan of state.scans) {
    scan.setSource(src);
  }
}

function updateSourceLabels() {
  const label = state.source?.sourceLabel ?? "—";
  elements.sourceLabel.textContent = label;
  elements.sourceLabelPreview.textContent = label;
  elements.sourceLabelInline.textContent = label;
}

function renderSourcePreview() {
  if (!state.source || !elements.sourcePreviewImage) return;
  try {
    elements.sourcePreviewImage.src = state.source.sourceCanvas.toDataURL("image/png");
  } catch {
    elements.sourcePreviewImage.removeAttribute("src");
  }
}

function renderStats(mappedFeatures, aggregate) {
  const first = mappedFeatures[0]?.scan;
  const second = mappedFeatures[1]?.scan;
  const third = mappedFeatures[2]?.scan;

  elements.scanAValue.textContent = first ? first.strength.toFixed(2) : "0.00";
  elements.scanBValue.textContent = second ? second.strength.toFixed(2) : "0.00";
  elements.scanCValue.textContent = third ? third.strength.toFixed(2) : "0.00";

  elements.featureDensityValue.textContent = aggregate.density.toFixed(2);
  elements.featureToggleRateValue.textContent = aggregate.toggleRate.toFixed(2);
  elements.featureComplexityValue.textContent = aggregate.complexity.toFixed(2);
  elements.featureEdgeIntensityValue.textContent = aggregate.edgeIntensity.toFixed(2);
  elements.featureLocalContrastValue.textContent = aggregate.localContrast.toFixed(2);
  elements.featureEdgeCountValue.textContent = aggregate.edgeCount.toFixed(2);
  if (elements.featureSymmetryValue) elements.featureSymmetryValue.textContent = (state.geo?.symmetry ?? 0).toFixed(2);
  if (elements.featurePeriodicityValue) elements.featurePeriodicityValue.textContent = (state.geo?.periodicity ?? 0).toFixed(2);
}

function renderUI(resetStats = false) {
  updateSourceLabels();
  if (resetStats) {
    elements.scanAValue.textContent = "0.00";
    elements.scanBValue.textContent = "0.00";
    elements.scanCValue.textContent = "0.00";
    elements.featureDensityValue.textContent = "0.00";
    elements.featureToggleRateValue.textContent = "0.00";
    elements.featureComplexityValue.textContent = "0.00";
    elements.featureEdgeIntensityValue.textContent = "0.00";
    elements.featureLocalContrastValue.textContent = "0.00";
    elements.featureEdgeCountValue.textContent = "0.00";
  }
}

function renderFrame() {
  const canvas = elements.scanCanvas;
  const ctx = canvas.getContext("2d", { alpha: false });
  resizeCanvas();

  const width = canvas.width;
  const height = canvas.height;

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#020305";
  ctx.fillRect(0, 0, width, height);

  if (state.source) {
    ctx.globalAlpha = 0.92;
    ctx.drawImage(displaySource(), 0, 0, width, height);
    ctx.globalAlpha = 1;
  }

  // With the GPU generative image active it is the artwork — skip the legacy 2D
  // background washes (additive halo + grid) that blew it out to a cream stain.
  if (!state.natureOn) {
    drawBreathingHalo(ctx, width, height);
    drawOverlayGrid(ctx, width, height);
  }

  if (state.scans.length) {
    const lineOpts = { width: state.scanLineWidth, glow: state.scanLineGlow };
    for (const scan of state.scans) {
      scan.drawScanLine(ctx, width, height, lineOpts);
    }
  }

  ctx.restore();

  // Organic skin: the chassis breathes with the same wave as the field.
  reflectOrganicSkin();

  // Particles + afterimage + glitch live on the overlay field canvas so they
  // can accumulate trails independently of the geometry redraw beneath.
  renderField();
}

// Hue the whole instrument by the live nature palette; default to the lime
// accent when the field is off. Drives the organic skin's tint.
const FIELD_RGB = {
  coral: "255, 138, 120",
  moss: "159, 209, 78",
  ocean: "90, 200, 232",
  sand: "232, 200, 122",
};

/** Push the live breath + field colour into CSS custom properties so the whole
 * chassis (brand glow, module ticks, canvas frame, active mode) pulses on the
 * same wave as the geometry — the pro-gear skeleton with a living skin. */
function reflectOrganicSkin() {
  const root = document.documentElement;
  const breathWave = Math.sin(state.breath.phase) * 0.5 + 0.5;
  // Depth scales with smoothed complexity so a quiet field barely breathes.
  const breath = clamp01(0.18 + breathWave * (0.35 + 0.6 * state.breath.complexity));
  root.style.setProperty("--breath", breath.toFixed(3));
  root.style.setProperty("--energy", clamp01(state.breath.energy).toFixed(3));
  const palette = state.natureOn
    ? (NATURE_PALETTE[elements.naturePreset?.value ?? "coral"] ?? "coral")
    : null;
  root.style.setProperty("--field-rgb", palette ? (FIELD_RGB[palette] ?? FIELD_RGB.moss) : "208, 255, 90");
}

function renderField() {
  const canvas = elements.fieldCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;

  if (!state.running && state.particles.length === 0) {
    ctx.clearRect(0, 0, width, height);
    return;
  }

  // GPU generative image is the art: keep faint, fast-fading particle glints
  // over it for life, but never let them accumulate into a wash — short trails
  // (erase 55%/frame) and low alpha so they glint without covering. The scan
  // expression stays as the crisp scan lines on the layer beneath.
  if (state.natureOn) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.28; // multiplies the additive particle alpha — glints, not cover
    drawParticles(ctx, state.particles, width, height);
    ctx.restore();
    return;
  }

  // Afterimage: erase a fraction of existing content toward transparent each
  // frame instead of clearing — heavier degradation smears longer trails.
  // Solar wind raises a baseline glitch/smear floor on top of audio degradation.
  const rawDegrade = state.degradation?.getDegradeAmount?.() ?? 0;
  const degrade = Math.min(1, Math.max(rawDegrade, state.earth.solarWind * 0.45));
  const fade = 0.18 - degrade * 0.12; // 0.06 (smeary) .. 0.18 (crisp)
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0.04, fade)})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  drawParticles(ctx, state.particles, width, height);

  // Glitch intensity rides the same breath wave as the grid/halo/particles, so
  // digital tearing surges on the inhale — but only when geometry is complex.
  const wave = Math.sin(state.breath.phase) * 0.5 + 0.5;
  const glitchAmount = Math.min(1, degrade * (0.85 + 0.3 * wave * state.breath.complexity));
  if (glitchAmount > 0.02) {
    state.glitch.apply(ctx, width, height, glitchAmount);
  }
}

function drawOverlayGrid(ctx, width, height) {
  const breath = state.breath;
  // 0..1 breathing curve, depth scaled by smoothed complexity.
  const swell = (Math.sin(breath.phase) * 0.5 + 0.5) * breath.complexity;
  const alpha = 0.03 + swell * 0.11;
  // Hue shifts faintly from cool idle to warm/green at full complexity.
  const hue = 150 + breath.complexity * 60 + state.earth.kp * 50;
  const sat = 30 + swell * 50;
  const light = 60 + swell * 24;

  ctx.save();
  ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
  ctx.lineWidth = 1 + swell * 0.6;
  const spacing = Math.max(32, Math.round(Math.min(width, height) / 20));
  for (let x = 0; x <= width; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Central halo that swells with the breath phase and overall complexity, drawn
 * additively so the whole background field appears to inhale and exhale light.
 */
function drawBreathingHalo(ctx, width, height) {
  const breath = state.breath;
  const wave = Math.sin(breath.phase) * 0.5 + 0.5;
  const intensity = breath.complexity * (0.35 + breath.energy * 0.65);
  if (intensity <= 0.001) return;

  const cx = width * 0.5;
  const cy = height * 0.5;
  const base = Math.min(width, height) * 0.3;
  const radius = base * (1.1 + wave * 0.55 + breath.energy * 0.4);
  const hue = 150 + breath.complexity * 70 + state.earth.kp * 50;
  const peak = (0.05 + wave * 0.12) * intensity;

  // Guard degenerate dimensions (e.g. a zero-sized canvas before layout) so the
  // radial gradient never receives a non-positive radius.
  if (!(radius > 0) || !Number.isFinite(radius)) return;
  const glow = ctx.createRadialGradient(cx, cy, radius * 0.08, cx, cy, radius);
  glow.addColorStop(0, `hsla(${hue}, 100%, 60%, ${peak})`);
  glow.addColorStop(0.5, `hsla(${hue}, 100%, 55%, ${peak * 0.4})`);
  glow.addColorStop(1, "rgba(0,0,0,0)");

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function resizeCanvas() {
  const canvas = elements.scanCanvas;
  const dpr = Math.min(MAX_CANVAS_DPR, Math.max(1, window.devicePixelRatio || 1));
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  // Keep the overlay field canvas pixel-locked to the scan canvas.
  const field = elements.fieldCanvas;
  if (field) {
    if (field.width !== width) field.width = width;
    if (field.height !== height) field.height = height;
  }
}

function setStatus(text) {
  elements.statusValue.textContent = text;
  if (elements.sbStatus) elements.sbStatus.textContent = text;
}

function labelFromPreset(url) {
  const found = SOURCE_PRESETS.find((item) => item.url === url);
  return found ? found.label : url.split("/").pop();
}

function degToRad(value) {
  return (value * Math.PI) / 180;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function formatHz(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(2)}kHz` : `${Math.round(value)}Hz`;
}

function reportError(error) {
  console.error(error);
  setStatus("Error");
}
