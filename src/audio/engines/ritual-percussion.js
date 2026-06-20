import { getAudioContext } from '../context.js?v=20260524-cellnoise-02';
import { getMasterBus } from '../master.js?v=20260524-cellnoise-02';

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.1;

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function safeStop(node, time) {
  if (!node || typeof node.stop !== 'function') return;
  try { node.stop(time); } catch (_) {}
}

function safeDisconnect(node) {
  if (!node || typeof node.disconnect !== 'function') return;
  try { node.disconnect(); } catch (_) {}
}

export class RitualPercussion {
  constructor() {
    this.running = false;
    this.nodes = null;
    this.schedulerId = null;
    this.noiseBuffer = null;
    this.activeVoices = new Set();
    this.ratios = [1, 1, 1];
    this.nextTimes = [0, 0, 0];
    this.params = {
      mix: 0.7,
      tempo: 2,
      drive: 0,
    };
  }

  start() {
    if (this.running) return;

    const ctx = getAudioContext();
    const output = ctx.createGain();
    output.gain.value = this.params.mix;
    output.connect(getMasterBus().getInput());

    this.nodes = { output };
    this.noiseBuffer = this.noiseBuffer || this._createNoiseBuffer(ctx);

    const now = ctx.currentTime + 0.02;
    this.nextTimes = [now, now, now];
    this.schedulerId = setInterval(() => this._schedule(), LOOKAHEAD_MS);
    this.running = true;
    this._schedule();
  }

  stop() {
    if (!this.running && !this.nodes) return;

    this.running = false;
    if (this.schedulerId !== null) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }

    const ctx = getAudioContext();
    const now = ctx.currentTime;

    for (const voice of this.activeVoices) {
      this._disposeVoice(voice, now);
    }
    this.activeVoices.clear();

    if (this.nodes?.output) {
      this.nodes.output.gain.cancelScheduledValues(now);
      this.nodes.output.gain.setValueAtTime(this.nodes.output.gain.value, now);
      this.nodes.output.gain.setTargetAtTime(0, now, 0.03);
      const output = this.nodes.output;
      setTimeout(() => safeDisconnect(output), 250);
    }

    this.nodes = null;
  }

  update(features) {
    const density = clamp01(features?.density ?? 0);
    const edge = clamp01(features?.edgeIntensity ?? 0);
    const complexity = clamp01(features?.complexity ?? 0);
    this.params.drive = clamp01(density * 0.65 + edge * 0.2 + complexity * 0.15);
  }

  setParam(name, value) {
    switch (name) {
      case 'mix':
        this.params.mix = clamp01(value);
        if (this.nodes?.output) {
          const ctx = getAudioContext();
          const now = ctx.currentTime;
          this.nodes.output.gain.cancelScheduledValues(now);
          this.nodes.output.gain.setValueAtTime(this.nodes.output.gain.value, now);
          this.nodes.output.gain.setTargetAtTime(this.params.mix, now, 0.03);
        }
        break;
      case 'tempo':
        if (Number.isFinite(value) && value > 0) this.params.tempo = value;
        break;
      case 'drive':
        this.params.drive = clamp01(value);
        break;
      default:
        this.params[name] = value;
        break;
    }
  }

  setPolyrhythm(ratios, tempoHz) {
    if (Array.isArray(ratios) && ratios.length >= 3) {
      this.ratios = ratios.slice(0, 3).map((ratio) => (Number.isFinite(ratio) && ratio > 0 ? ratio : 1));
    }
    if (Number.isFinite(tempoHz) && tempoHz > 0) {
      this.params.tempo = tempoHz;
    }
  }

  _createNoiseBuffer(ctx) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * 0.5));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  _schedule() {
    if (!this.running || !this.nodes) return;

    const ctx = getAudioContext();
    const horizon = ctx.currentTime + SCHEDULE_AHEAD_SEC;

    for (let i = 0; i < 3; i += 1) {
      const ratio = this.ratios[i] > 0 ? this.ratios[i] : 1;
      const freq = Math.max(0.001, this.params.tempo * ratio);
      const period = 1 / freq;

      while (this.nextTimes[i] <= horizon) {
        this._scheduleHit(i, this.nextTimes[i]);
        this.nextTimes[i] += period;
      }
    }
  }

  _scheduleHit(index, time) {
    const drive = clamp01(this.params.drive);
    if (drive <= 0.01) return;

    const probability = clamp01(0.08 + drive * 0.9);
    if (Math.random() > probability) return;

    const velocity = clamp01((0.2 + drive * 0.8) * (0.85 + Math.random() * 0.3));
    if (velocity <= 0.02) return;

    if (index === 0) {
      this._triggerDrum(time, velocity);
    } else if (index === 1) {
      this._triggerWood(time, velocity);
    } else {
      this._triggerMetal(time, velocity);
    }
  }

  _registerVoice(voice, endTime) {
    this.activeVoices.add(voice);
    const ctx = getAudioContext();
    const delayMs = Math.max(0, (endTime - ctx.currentTime) * 1000 + 80);
    voice.cleanupId = setTimeout(() => this._disposeVoice(voice), delayMs);
  }

  _disposeVoice(voice, stopTime) {
    if (!voice || voice.disposed) return;
    voice.disposed = true;

    if (voice.cleanupId) {
      clearTimeout(voice.cleanupId);
      voice.cleanupId = null;
    }

    const when = Number.isFinite(stopTime) ? stopTime : undefined;
    for (const source of voice.sources) safeStop(source, when);
    for (const node of voice.nodes) safeDisconnect(node);
    this.activeVoices.delete(voice);
  }

  _triggerDrum(time, velocity) {
    if (!this.nodes?.output || !this.noiseBuffer) return;

    const ctx = getAudioContext();
    const endTime = time + 0.24;
    const amp = ctx.createGain();
    const toneGain = ctx.createGain();
    const noiseGain = ctx.createGain();
    const bodyFilter = ctx.createBiquadFilter();
    const noiseFilter = ctx.createBiquadFilter();
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const noise = ctx.createBufferSource();

    bodyFilter.type = 'lowpass';
    bodyFilter.frequency.value = 420;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1400;
    noiseFilter.Q.value = 0.8;

    oscA.type = 'sine';
    oscA.frequency.setValueAtTime(95, time);
    oscA.frequency.exponentialRampToValueAtTime(62, endTime);

    oscB.type = 'triangle';
    oscB.frequency.setValueAtTime(140, time);
    oscB.frequency.exponentialRampToValueAtTime(82, endTime);

    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(velocity * 0.9, time + 0.003);
    amp.gain.exponentialRampToValueAtTime(0.0001, endTime);

    toneGain.gain.setValueAtTime(velocity * 0.7, time);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, endTime);

    noiseGain.gain.setValueAtTime(velocity * 0.42, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);

    noise.buffer = this.noiseBuffer;

    oscA.connect(toneGain);
    oscB.connect(toneGain);
    toneGain.connect(bodyFilter);
    bodyFilter.connect(amp);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(amp);

    amp.connect(this.nodes.output);

    oscA.start(time);
    oscB.start(time);
    noise.start(time);
    safeStop(oscA, endTime);
    safeStop(oscB, endTime);
    safeStop(noise, time + 0.05);

    this._registerVoice(
      { sources: [oscA, oscB, noise], nodes: [oscA, oscB, noise, toneGain, noiseGain, bodyFilter, noiseFilter, amp] },
      endTime,
    );
  }

  _triggerWood(time, velocity) {
    if (!this.nodes?.output || !this.noiseBuffer) return;

    const ctx = getAudioContext();
    const endTime = time + 0.12;
    const amp = ctx.createGain();
    const noise = ctx.createBufferSource();
    const noiseFilter = ctx.createBiquadFilter();
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();

    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 2400;
    noiseFilter.Q.value = 5;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1800, time);
    osc.frequency.exponentialRampToValueAtTime(1200, endTime);

    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(velocity * 0.55, time + 0.0015);
    amp.gain.exponentialRampToValueAtTime(0.0001, endTime);

    oscGain.gain.setValueAtTime(velocity * 0.35, time);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, endTime);

    noise.buffer = this.noiseBuffer;
    noise.connect(noiseFilter);
    noiseFilter.connect(amp);
    osc.connect(oscGain);
    oscGain.connect(amp);
    amp.connect(this.nodes.output);

    noise.start(time);
    osc.start(time);
    safeStop(noise, time + 0.025);
    safeStop(osc, endTime);

    this._registerVoice(
      { sources: [noise, osc], nodes: [noise, osc, noiseFilter, oscGain, amp] },
      endTime,
    );
  }

  _triggerMetal(time, velocity) {
    if (!this.nodes?.output) return;

    const ctx = getAudioContext();
    const endTime = time + 1.8;
    const amp = ctx.createGain();
    const partials = [
      { ratio: 1, gain: 0.34 },
      { ratio: 1.47, gain: 0.24 },
      { ratio: 2.11, gain: 0.18 },
      { ratio: 2.93, gain: 0.12 },
    ];
    const baseFreq = 320 + velocity * 110;
    const voiceNodes = [amp];
    const sources = [];

    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(velocity * 0.42, time + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, endTime);
    amp.connect(this.nodes.output);

    for (const partial of partials) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq * partial.ratio, time);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * partial.ratio * 0.995, endTime);
      gain.gain.setValueAtTime(velocity * partial.gain, time);
      gain.gain.exponentialRampToValueAtTime(0.0001, endTime);
      osc.connect(gain);
      gain.connect(amp);
      osc.start(time);
      safeStop(osc, endTime);
      sources.push(osc);
      voiceNodes.push(osc, gain);
    }

    this._registerVoice({ sources, nodes: voiceNodes }, endTime);
  }
}
