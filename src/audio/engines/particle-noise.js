const DEFAULT_PARAMS = {
  rate: 7,
  size: 0.08,
  density: 0.55,
  brightness: 0.65,
  scatter: 0.35,
  randomness: 0.45,
  level: 0.72,
  masterGain: 0.72,
};

export function createParticleNoiseEngine({ context, output }) {
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
    if (output?.masterGain) {
      output.setGain(state.params.masterGain);
    }
  }

  function start() {
    if (state.running) return;
    state.running = true;
    state.lastTick = performance.now();
    state.ticker = window.setInterval(tick, 25);
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
        // Ignore already-stopped voices.
      }
      try {
        voice.disconnect();
      } catch (error) {
        // Ignore disconnect errors on dead nodes.
      }
    }
    state.voices.clear();
  }

  function tick() {
    const now = performance.now();
    const delta = Math.min(0.2, (now - state.lastTick) / 1000);
    state.lastTick = now;

    const densityMultiplier = 0.35 + state.params.density * 1.65;
    const spawnRate = Math.max(0, state.params.rate) * densityMultiplier;
    state.carry += spawnRate * delta;

    while (state.carry >= 1) {
      state.carry -= 1;
      spawnParticle();
    }

    stepParticles(delta);
  }

  function spawnParticle() {
    const params = state.params;
    const now = context.currentTime;
    const rand = signedNoise(params.randomness);
    const duration = clamp(0.018 + params.size * 0.22 + Math.random() * params.size * 0.12, 0.016, 0.34);
    const attack = clamp(0.001 + params.size * 0.008, 0.001, 0.016);
    const release = Math.max(0.01, duration - attack);
    const brightnessCurve = Math.pow(params.brightness, 1.45);
    const centerFrequency = lerpLog(650, 14000, clamp(brightnessCurve + rand * 0.09, 0, 1));
    const bandwidth = centerFrequency * clamp(0.06 + params.size * 0.28 + (1 - params.brightness) * 0.08, 0.05, 0.32);
    const pannerValue = clamp((Math.random() * 2 - 1) * params.scatter + rand * 0.28, -1, 1);
    const gainAmount = params.level * (0.38 + params.density * 0.56) * (0.72 + Math.random() * 0.22);

    const noise = createNoiseBufferSource(context, duration + 0.04);
    const bandpass = context.createBiquadFilter();
    const highpass = context.createBiquadFilter();
    const gain = context.createGain();
    const panner = context.createStereoPanner();
    const click = context.createOscillator();
    const clickGain = context.createGain();
    const clickFilter = context.createBiquadFilter();
    const halo = context.createOscillator();
    const haloGain = context.createGain();

    bandpass.type = "bandpass";
    bandpass.frequency.setValueAtTime(centerFrequency, now);
    bandpass.Q.setValueAtTime(clamp(centerFrequency / Math.max(180, bandwidth), 0.7, 28), now);

    highpass.type = "highpass";
    highpass.frequency.setValueAtTime(clamp(centerFrequency * 0.42, 500, 16000), now);
    highpass.Q.setValueAtTime(0.8 + params.brightness * 2.5, now);

    click.type = Math.random() > 0.5 ? "triangle" : "sine";
    click.frequency.setValueAtTime(clamp(centerFrequency * (0.7 + Math.random() * 1.1), 440, 12000), now);
    clickFilter.type = "bandpass";
    clickFilter.frequency.setValueAtTime(clamp(centerFrequency * 1.12, 500, 16000), now);
    clickFilter.Q.setValueAtTime(8 + params.brightness * 6, now);

    halo.type = "sine";
    halo.frequency.setValueAtTime(clamp(centerFrequency * (1.97 + Math.random() * 0.5), 700, 16000), now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainAmount, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    clickGain.gain.setValueAtTime(0.0001, now);
    clickGain.gain.exponentialRampToValueAtTime(gainAmount * 0.45, now + Math.max(0.0005, attack * 0.8));
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + Math.min(duration, attack + 0.016));

    haloGain.gain.setValueAtTime(0.0001, now);
    haloGain.gain.exponentialRampToValueAtTime(gainAmount * 0.2, now + attack + 0.004);
    haloGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    panner.pan.setValueAtTime(pannerValue, now);

    noise.connect(highpass);
    highpass.connect(bandpass);
    bandpass.connect(gain);
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    halo.connect(haloGain);
    haloGain.connect(gain);
    gain.connect(panner);
    clickGain.connect(panner);
    panner.connect(output.input);

    const cleanupTime = now + duration + 0.06;
    state.voices.add(noise);
    state.voices.add(click);
    state.voices.add(halo);

    noise.start(now);
    noise.stop(cleanupTime);
    click.start(now);
    click.stop(Math.min(cleanupTime, now + Math.max(0.01, duration * 0.55)));
    halo.start(now);
    halo.stop(cleanupTime);

    state.particles.push({
      x: 0.5 + pannerValue * 0.42,
      y: 0.44 + rand * 0.14 + (1 - params.brightness) * 0.06,
      vx: rand * 0.08 + params.scatter * (Math.random() - 0.5) * 0.12,
      vy: 0.012 + Math.random() * 0.05,
      size: 1.1 + params.size * 14,
      life: duration,
      maxLife: duration,
      brightness: Math.min(1, params.brightness * 0.92 + 0.06),
      scatter: params.scatter,
      hue: 160 + params.brightness * 52,
      alpha: 0.22 + params.level * 0.48,
    });
  }

  function stepParticles(delta) {
    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const particle = state.particles[i];
      particle.life -= delta;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vx += (Math.random() - 0.5) * particle.scatter * 0.04 * delta;
      particle.vy += (0.02 + particle.brightness * 0.08) * delta;
      if (particle.life <= 0 || particle.x < -0.1 || particle.x > 1.1 || particle.y > 1.2) {
        state.particles.splice(i, 1);
      }
    }
  }

  function getState() {
    return {
      params: { ...state.params },
      running: state.running,
      particles: state.particles,
    };
  }

  return {
    start,
    stop,
    stopAll,
    setParams,
    getState,
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
