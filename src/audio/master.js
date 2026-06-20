let masterBus = null;

export function setMasterBus(bus) {
  masterBus = bus;
}

export function getMasterBus() {
  if (!masterBus) {
    throw new Error("Master bus has not been initialized.");
  }
  return masterBus;
}

export function createMasterGraph(context) {
  const input = context.createGain();
  const masterGain = context.createGain();
  const analyser = context.createAnalyser();

  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.82;
  masterGain.gain.value = 0.72;

  input.connect(masterGain);
  masterGain.connect(analyser);
  analyser.connect(context.destination);

  return {
    input,
    masterGain,
    analyser,
    setGain(value) {
      masterGain.gain.setTargetAtTime(value, context.currentTime, 0.03);
    },
  };
}
