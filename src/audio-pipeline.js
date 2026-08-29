import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

export async function createPipeline(stream, { noiseSuppression = true } = {}) {
  const audioCtx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();

  // iOS can create AudioContexts in a 'suspended' state — resume before wiring
  // the graph so that audio actually flows.
  if (audioCtx.state === 'suspended') {
    try { await audioCtx.resume(); } catch {}
  }

  const source = audioCtx.createMediaStreamSource(stream);
  const destination = audioCtx.createMediaStreamDestination();
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;

  let lastNode = source;

  if (noiseSuppression && audioCtx.audioWorklet) {
    try {
      await audioCtx.audioWorklet.addModule(rnnoiseWorkletUrl);
      const wasmBinary = await loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl });
      const suppressor = new RnnoiseWorkletNode(audioCtx, { maxChannels: 1, wasmBinary });
      source.connect(suppressor);
      lastNode = suppressor;
    } catch (err) {
      console.warn('Noise suppression unavailable, falling back to passthrough:', err);
    }
  }

  lastNode.connect(destination);
  lastNode.connect(analyser);

  return {
    cleanStream: destination.stream,
    rawStream: stream,
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
