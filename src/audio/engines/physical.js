const DEFAULT_PARAMS = {
  rate: 4.5,
  size: 0.1,
  density: 0.62,
  brightness: 0.52,
  scatter: 0.4,
  randomness: 0.55,
  level: 0.7,
  masterGain: 0.72,
};

export function createPhysicalEngine({ context, output }) {
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
    state.ticker = window.setInterval(tick, 28);
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

    const spawnRate = Math.max(0, state.params.rate) * (0.28 + state.params.density * 1.92);
    state.carry += spawnRate * delta;

    while (state.carry >= 1) {
      state.carry -= 1;
      spawnPhysicalParticle();
    }

    stepParticles(delta);
  }

  function spawnPhysicalParticle() {
    const params = state.params;
    const now = context.currentTime;
    const random = signedNoise(params.randomness);
    const centerFrequency = lerpLog(220, 14000, clamp(0.22 + params.brightness * 0.62 + random * 0.08, 0, 1));
    const duration = clamp(0.026 + params.size * 0.22, 0.026, 0.42);
    const noise = createNoiseBufferSource(context, duration + 0.05);
    const bodyFilter = context.createBiquadFilter();
    const presenceFilter = context.createBiquadFilter();
    const airFilter = context.createBiquadFilter();
    const gritFilter = context.createBiquadFilter();
    const gain = context.createGain();
    const panner = context.createStereoPanner();
    const tone = context.createOscillator();
    const tone2 = context.createOscillator();
    const toneGain = context.createGain();
    const bodyGain = context.createGain();

    bodyFilter.type = "bandpass";
    bodyFilter.frequency.setValueAtTime(clamp(centerFrequency * (0.82 + Math.random() * 0.1), 220, 12000), now);
    bodyFilter.Q.setValueAtTime(clamp(2.8 + params.size * 8, 1.6, 16), now);

    presenceFilter.type = "bandpass";
    presenceFilter.frequency.setValueAtTime(clamp(centerFrequency * (1.42 + random * 0.12), 400, 16000), now);
    presenceFilter.Q.setValueAtTime(clamp(8 + params.brightness * 10, 2, 20), now);

    airFilter.type = "highpass";
    airFilter.frequency.setValueAtTime(clamp(centerFrequency * 0.66, 500, 16000), now);
    airFilter.Q.setValueAtTime(clamp(0.9 + params.scatter * 3.5, 0.8, 8), now);

    gritFilter.type = "bandpass";
    gritFilter.frequency.setValueAtTime(clamp(centerFrequency * 2.2, 700, 16000), now);
    gritFilter.Q.setValueAtTime(4 + params.brightness * 8, now);

    tone.type = "sine";
    tone2.type = "triangle";
    tone.frequency.setValueAtTime(clamp(centerFrequency * (0.53 + Math.random() * 0.34), 180, 9000), now);
    tone2.frequency.setValueAtTime(clamp(centerFrequency * (1.03 + Math.random() * 0.56), 300, 16000), now);

    const attack = clamp(0.0008 + params.size * 0.008, 0.0008, 0.012);
    const release = Math.max(0.018, duration - attack);
    const gainAmount = params.level * (0.48 + params.density * 0.88) * (0.78 + Math.random() * 0.28);
    const pan = clamp((Math.random() * 2 - 1) * params.scatter + random * 0.55, -1, 1);

    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.exponentialRampToValueAtTime(gainAmount * 0.82, now + attack * 1.1);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + attack + release);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainAmount, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + release);

    toneGain.gain.setValueAtTime(0.0001, now);
    toneGain.gain.exponentialRampToValueAtTime(gainAmount * 0.34, now + attack * 0.9);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, now + Math.min(duration, attack + 0.028));

    panner.pan.setValueAtTime(pan, now);

    noise.connect(bodyFilter);
    bodyFilter.connect(presenceFilter);
    presenceFilter.connect(gritFilter);
    gritFilter.connect(airFilter);
    airFilter.connect(bodyGain);
    bodyGain.connect(gain);
    tone.connect(toneGain);
    tone2.connect(toneGain);
    toneGain.connect(gain);
    gain.connect(panner);
    panner.connect(output.input);

    const cleanupTime = now + duration + 0.08;
    state.voices.add(noise);
    state.voices.add(tone);
    state.voices.add(tone2);

    noise.start(now);
    tone.start(now);
    tone2.start(now);
    noise.stop(cleanupTime);
    tone.stop(Math.min(cleanupTime, now + Math.max(0.012, duration * 0.5)));
    tone2.stop(Math.min(cleanupTime, now + Math.max(0.012, duration * 0.44)));

    state.particles.push({
      x: 0.5 + pan * 0.38,
      y: 0.5 + random * 0.16,
      vx: random * 0.09 + params.scatter * (Math.random() - 0.5) * 0.16,
      vy: 0.018 + Math.random() * 0.05,
      size: 1.1 + params.size * 13,
      life: duration,
      maxLife: duration,
      brightness: Math.min(1, params.brightness * 0.88 + 0.08),
      scatter: params.scatter,
      hue: 200 + params.brightness * 20,
      alpha: 0.2 + params.level * 0.46,
    });
  }

  function stepParticles(delta) {
    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const particle = state.particles[i];
      particle.life -= delta;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vy += (0.02 + particle.brightness * 0.05) * delta;
      particle.vx += (Math.random() - 0.5) * particle.scatter * 0.03 * delta;
      if (particle.life <= 0 || particle.x < -0.1 || particle.x > 1.1 || particle.y > 1.25) {
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
