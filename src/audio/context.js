let audioContext = null;

export function ensureAudioContext() {
  if (audioContext) return audioContext;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("Web Audio API is not available in this browser.");
  }
  audioContext = new AudioContextCtor();
  return audioContext;
}

export async function resumeAudioContext() {
  const context = ensureAudioContext();
  if (context.state !== "running") {
    await context.resume();
  }
  return context;
}

export async function suspendAudioContext() {
  if (audioContext && audioContext.state === "running") {
    await audioContext.suspend();
  }
}

export function getAudioContext() {
  return audioContext;
}
