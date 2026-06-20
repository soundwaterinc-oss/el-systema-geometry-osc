const DEFAULT_PARAMS = {
  rate: 5,
  size: 0.08,
  density: 0.55,
  brightness: 0.72,
  scatter: 0.35,
  randomness: 0.45,
  level: 0.68,
  masterGain: 0.72,
};

export function createMetallicEngine({ context, output }) {
  const state = {
    running: false,
    ticker: null,
    carry: 0,
    lastTick: performance.now(),
    params: { ...DEFAULT_PARAMS },
    voices: new Set(),
    particles: [],
  };

  function setParams(nextParams) {
    state.params = { ...state.params, ...nextParams };
    output?.setGain?.(state.params.masterGain);
  }

  function start() {
    if (state.running) return;
    state.running = true;
    state.lastTick = performance.now();
    state.ticker = window.setInterval(tick, 24);
  }

  function stop() {
    state.running = false;
    if (state.ticker) {
      window.clearInterval(state.ticker);
      state.ticker = null;
    }
    stopVoices();
  }

  function stopAll() {
    stop();
    state.particles.length = 0;
    state.carry = 0;
  }

  function stopVoices() {
    for (const voice of state.voices) {
      try {
        voice.stop(context.currentTime + 0.02);
      } catch (error) {
        // ignore
      }
      try {
        voice.disconnect();
      } catch (error) {
        // ignore
      }
    }
    state.voices.clear();
  }

  function tick() {
    const now = performance.now();
    const delta = Math.min(0.2, (now - state.lastTick) / 1000);
    state.lastTick = now;

    const spawnRate = Math.max(0, state.params.rate) * (0.3 + state.params.density * 1.8);
    state.carry += spawnRate * delta;

    while (state.carry >= 1) {
      state.carry -= 1;
      spawnMetalHit();
    }

    stepParticles(delta);
  }

  function spawnMetalHit() {
    const params = state.params;
    const now = context.currentTime;
    const scrapeCount = 3 + Math.floor(params.density * 3);
    const baseFrequency = lerpLog(170, 1600, clamp(0.24 + params.brightness * 0.58 + signedNoise(params.randomness) * 0.08, 0, 1));
    const panBase = clamp((Math.random() * 2 - 1) * params.scatter + signedNoise(params.randomness) * 0.35, -1, 1);
    const gainAmount = params.level * (0.32 + params.density * 0.72) * (0.85 + Math.random() * 0.25);

    for (let i = 0; i < scrapeCount; i += 1) {
      spawnScrapeBurst({
        now: now + i * (0.014 + Math.random() * 0.02),
        params,
        baseFrequency: baseFrequency * (0.82 + Math.random() * 0.48),
        pan: clamp(panBase + (Math.random() * 2 - 1) * params.scatter * 0.34, -1, 1),
        gainAmount: gainAmount * (0.6 + Math.random() * 0.44),
      });
    }

    state.particles.push({
      x: 0.5 + panBase * 0.36,
      y: 0.46 + signedNoise(params.randomness) * 0.08,
      vx: signedNoise(params.randomness) * 0.02 + params.scatter * (Math.random() - 0.5) * 0.05,
      vy: 0.006 + Math.random() * 0.02,
      size: 2.4 + params.size * 12,
      life: 0.48 + params.size * 0.72,
      maxLife: 0.48 + params.size * 0.72,
      brightness: params.brightness,
      scatter: params.scatter,
      hue: 41 + params.brightness * 14,
      alpha: 0.24 + params.level * 0.46,
    });
  }

  function spawnScrapeBurst({ now, params, baseFrequency, pan, gainAmount }) {
    const random = signedNoise(params.randomness);
    const burstDuration = clamp(0.24 + params.size * 0.95, 0.18, 1.15);
    const attack = clamp(0.002 + params.size * 0.01, 0.0015, 0.018);
    const sustain = burstDuration * (0.18 + params.density * 0.16);
    const decay = Math.max(0.08, burstDuration - attack - sustain);

    const noise = createNoiseBufferSource(context, burstDuration + 0.1);
    const exciter = context.createBiquadFilter();
    const body = context.createBiquadFilter();
    const ring = context.createBiquadFilter();
    const shimmer = context.createBiquadFilter();
    const shaper = context.createWaveShaper();
    const mix = context.createGain();
    const panner = context.createStereoPanner();
    const direct = context.createGain();
    const ringBus = context.createGain();
    const burstGain = context.createGain();
    const resonanceGain = context.createGain();
    const oscillators = [];

    exciter.type = "bandpass";
    exciter.frequency.setValueAtTime(clamp(baseFrequency * (0.72 + Math.random() * 0.32), 120, 6000), now);
    exciter.Q.setValueAtTime(clamp(9 + params.brightness * 10, 5, 18), now);

    body.type = "bandpass";
    body.frequency.setValueAtTime(clamp(baseFrequency * (1.02 + random * 0.09), 150, 8000), now);
    body.Q.setValueAtTime(clamp(14 + params.size * 16, 8, 28), now);

    ring.type = "bandpass";
    ring.frequency.setValueAtTime(clamp(baseFrequency * 1.78, 220, 12000), now);
    ring.Q.setValueAtTime(clamp(18 + params.brightness * 14, 10, 34), now);

    shimmer.type = "highpass";
    shimmer.frequency.setValueAtTime(clamp(baseFrequency * 2.8, 500, 16000), now);
    shimmer.Q.setValueAtTime(clamp(0.8 + params.scatter * 3, 0.8, 8), now);

    shaper.curve = makeDriveCurve(2.2 + params.brightness * 4.2);
    shaper.oversample = "4x";

    direct.gain.setValueAtTime(0.0001, now);
    direct.gain.exponentialRampToValueAtTime(gainAmount * 0.36, now + attack);
    direct.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);

    ringBus.gain.setValueAtTime(0.0001, now);
    ringBus.gain.exponentialRampToValueAtTime(gainAmount * 0.88, now + attack * 1.4);
    ringBus.gain.exponentialRampToValueAtTime(gainAmount * 0.42, now + attack + sustain * 0.7);
    ringBus.gain.exponentialRampToValueAtTime(0.0001, now + attack + sustain + decay);

    burstGain.gain.setValueAtTime(0.0001, now);
    burstGain.gain.exponentialRampToValueAtTime(gainAmount, now + attack * 0.9);
    burstGain.gain.exponentialRampToValueAtTime(0.0001, now + burstDuration);

    resonanceGain.gain.setValueAtTime(0.0001, now);
    resonanceGain.gain.exponentialRampToValueAtTime(gainAmount * 0.76, now + attack * 1.15);
    resonanceGain.gain.exponentialRampToValueAtTime(gainAmount * 0.34, now + attack + sustain * 0.8);
    resonanceGain.gain.exponentialRampToValueAtTime(0.0001, now + burstDuration + 0.06);

    panner.pan.setValueAtTime(pan, now);

    noise.connect(exciter);
    exciter.connect(body);
    body.connect(shaper);
    shaper.connect(direct);
    direct.connect(mix);

    const modes = [
      { ratio: 1.02, gain: 0.24, q: 18, type: "square" },
      { ratio: 1.37, gain: 0.19, q: 22, type: "sawtooth" },
      { ratio: 1.88, gain: 0.17, q: 24, type: "square" },
      { ratio: 2.56, gain: 0.13, q: 26, type: "sawtooth" },
      { ratio: 3.91, gain: 0.1, q: 28, type: "triangle" },
    ];

    for (const mode of modes) {
      const oscillator = context.createOscillator();
      const modeFilter = context.createBiquadFilter();
      const modeGain = context.createGain();
      const detune = (Math.random() * 2 - 1) * (18 + params.randomness * 28);
      oscillator.type = mode.type;
      oscillator.frequency.setValueAtTime(clamp(baseFrequency * mode.ratio, 90, 16000), now);
      oscillator.detune.setValueAtTime(detune, now);
      modeFilter.type = "bandpass";
      modeFilter.frequency.setValueAtTime(clamp(baseFrequency * mode.ratio, 120, 16000), now);
      modeFilter.Q.setValueAtTime(mode.q, now);
      modeGain.gain.setValueAtTime(0.0001, now);
      modeGain.gain.exponentialRampToValueAtTime(mode.gain * gainAmount, now + attack * 1.2);
      modeGain.gain.exponentialRampToValueAtTime(0.0001, now + burstDuration);
      oscillator.connect(modeFilter);
      modeFilter.connect(modeGain);
      modeGain.connect(ringBus);
      oscillators.push(oscillator);
    }

    ringBus.connect(ring);
    ring.connect(shimmer);
    shimmer.connect(resonanceGain);
    resonanceGain.connect(mix);
    mix.connect(panner);
    panner.connect(output.input);

    const cleanupTime = now + burstDuration + 0.12;
    state.voices.add(noise);
    for (const oscillator of oscillators) {
      state.voices.add(oscillator);
    }

    noise.start(now);
    noise.stop(cleanupTime);
    for (const oscillator of oscillators) {
      oscillator.start(now);
      oscillator.stop(cleanupTime);
    }
  }

  function stepParticles(delta) {
    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const particle = state.particles[i];
      particle.life -= delta;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vx += (Math.random() - 0.5) * particle.scatter * 0.03 * delta;
      particle.vy += (0.01 + particle.brightness * 0.06) * delta;
      if (particle.life <= 0 || particle.x < -0.1 || particle.x > 1.1 || particle.y > 1.2) {
        state.particles.splice(i, 1);
      }
    }
  }

  return {
    start,
    stop,
    stopAll,
    setParams,
    getState() {
      return {
        params: { ...state.params },
        running: state.running,
        particles: state.particles,
      };
    },
  };
}

function createNoiseBufferSource(context, duration) {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < channel.length; i += 1) {
    channel[i] = Math.random() * 2 - 1;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  return source;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerpLog(min, max, t) {
  return min * (max / min) ** t;
}

function signedNoise(amount) {
  return (Math.random() * 2 - 1) * (0.5 + amount * 0.5);
}

function makeDriveCurve(amount) {
  const curve = new Float32Array(1024);
  const k = Math.max(1, amount * 12);
  for (let i = 0; i < curve.length; i += 1) {
    const x = (i * 2) / (curve.length - 1) - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}
