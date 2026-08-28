import { RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';

let workletLoaded = false;

async function loadWorklet(audioCtx) {
  if (workletLoaded) return;
  await audioCtx.audioWorklet.addModule(rnnoiseWorkletUrl);
  workletLoaded = true;
}

export async function createPipeline(stream, { noiseSuppression = true } = {}) {
  const audioCtx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(stream);
  const destination = audioCtx.createMediaStreamDestination();
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;

  let lastNode = source;

  if (noiseSuppression) {
    try {
      await loadWorklet(audioCtx);
      const suppressor = new RnnoiseWorkletNode(audioCtx, { wasmUrl: rnnoiseWasmUrl });
      source.connect(suppressor);
      lastNode = suppressor;
    } catch (err) {
      console.warn('Noise suppression unavailable, falling back to passthrough:', err);
      workletLoaded = false;
    }
  }

  lastNode.connect(destination);
  lastNode.connect(analyser);

  return {
    cleanStream: destination.stream,
    analyser,
    destroy() {
      audioCtx.close();
    },
  };
}

export async function checkNoiseSuppressionSupport() {
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) return false;
  try {
    const ctx = new Ctor();
    const supported = !!ctx.audioWorklet;
    ctx.close();
    return supported;
  } catch {
    return false;
  }
}
