export const MAX_DURATION_MS = 5 * 60 * 1000;

export function createRecorder({ onTick, onLevel, onAutoStop } = {}) {
  let mediaRecorder = null;
  let chunks = [];
  let stream = null;
  let startedAt = 0;
  let tickInterval = null;
  let levelRaf = null;
  let audioCtx = null;

  function pickMimeType() {
    // iOS Safari records AAC in an MP4 container; webm is the Chrome/Firefox path.
    const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  }

  async function start() {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    const mimeType = pickMimeType();
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    // 1s timeslice so partial audio survives iOS killing the recorder in the background.
    mediaRecorder.start(1000);
    startedAt = Date.now();

    tickInterval = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      onTick?.(elapsed);
      if (elapsed >= MAX_DURATION_MS) {
        stop().then((blob) => { if (blob) onAutoStop?.(blob); });
      }
    }, 250);

    if (onLevel) startLevelMeter();
  }

  function startLevelMeter() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
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
    audioCtx?.close();
    stream?.getTracks().forEach((t) => t.stop());
    mediaRecorder = null;
    stream = null;
    audioCtx = null;
  }

  function drainChunks(type) {
    const blob = chunks.length ? new Blob(chunks, { type }) : null;
    chunks = [];
    return blob;
  }

  function stop() {
    return new Promise((resolve) => {
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        // Already stopped (double-stop, or iOS killed it in the background):
        // return whatever the 1s timeslices managed to capture.
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
    });
  }

  function isRecording() {
    return !!mediaRecorder && mediaRecorder.state === 'recording';
  }

  return { start, stop, isRecording };
}
