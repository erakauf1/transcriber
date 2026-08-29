import { createPipeline } from './audio-pipeline.js';

export const MAX_DURATION_MS = 5 * 60 * 1000;

export function createRecorder({ onTick, onLevel, onAutoStop, noiseSuppression = true } = {}) {
  let mediaRecorder = null;
  let chunks = [];
  let stream = null;
  let startedAt = 0;
  let tickInterval = null;
  let levelRaf = null;
  let pipeline = null;
  let pendingStop = null;

  function pickMimeType() {
    // iOS Safari records AAC in an MP4 container; webm is the Chrome/Firefox path.
    const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  }

  async function start() {
    if (mediaRecorder) {
      // A recording is already in flight (or its stop() hasn't torn down yet).
      throw new Error('Recorder already started');
    }
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      pipeline = await createPipeline(stream, { noiseSuppression });

      chunks = [];
      const mimeType = pickMimeType();
      mediaRecorder = new MediaRecorder(pipeline.rawStream, mimeType ? { mimeType } : undefined);
      mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      // 1s timeslice so partial audio survives iOS killing the recorder in the background.
      mediaRecorder.start(1000);
      startedAt = Date.now();

      tickInterval = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        onTick?.(elapsed);
        if (elapsed >= MAX_DURATION_MS) {
          // Stop ticking now to prevent re-entry before the in-flight stop() settles.
          clearInterval(tickInterval);
          stop().then((blob) => { if (blob) onAutoStop?.(blob); });
        }
      }, 250);

      if (onLevel) startLevelMeter();
    } catch (err) {
      teardown();
      throw err;
    }
  }

  function startLevelMeter() {
    const analyser = pipeline.analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      onLevel(peak);
      levelRaf = requestAnimationFrame(loop);
    };
    levelRaf = requestAnimationFrame(loop);
  }

  function teardown() {
    clearInterval(tickInterval);
    if (levelRaf) cancelAnimationFrame(levelRaf);
    pipeline?.destroy();
    stream?.getTracks().forEach((t) => t.stop());
    mediaRecorder = null;
    stream = null;
    pipeline = null;
  }

  function drainChunks(type) {
    const blob = chunks.length ? new Blob(chunks, { type }) : null;
    chunks = [];
    return blob;
  }

  function stop() {
    // A stop is already in flight — share the one in-flight promise so every
    // caller gets the same, single, complete blob.
    if (pendingStop) return pendingStop;

    pendingStop = new Promise((resolve) => {
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        // No stop of ours is in flight — this is a genuinely dead recorder.
        const blob = drainChunks(chunks[0]?.type || 'audio/mp4');
        teardown();
        resolve(blob);
        return;
      }
      const type = mediaRecorder.mimeType || 'audio/mp4';
      mediaRecorder.onstop = () => {
        const blob = drainChunks(type);
        teardown();
        resolve(blob);
      };
      mediaRecorder.stop();
    }).finally(() => {
      pendingStop = null;
    });

    return pendingStop;
  }

  function isRecording() {
    return !!mediaRecorder && mediaRecorder.state === 'recording';
  }

  function getAnalyser() {
    return pipeline?.analyser ?? null;
  }

  return { start, stop, isRecording, getAnalyser };
}
