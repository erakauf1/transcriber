export const MAX_DURATION_MS = 5 * 60 * 1000;

export function createRecorder({ onTick, onLevel, onAutoStop } = {}) {
  let mediaRecorder = null;
  let chunks = [];
  let stream = null;
  let startedAt = 0;
  let tickInterval = null;
  let levelRaf = null;
  let audioCtx = null;
  let pendingStop = null;

  function pickMimeType() {
    // iOS Safari records AAC in an MP4 container; webm is the Chrome/Firefox path.
    const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  }

  async function start() {
    if (mediaRecorder) {
      // A recording is already in flight (or its stop() hasn't torn down yet).
      // Without this guard a second start() orphans the old stream's tracks,
      // stomps tickInterval without clearing the old one, and leaks a second
      // AudioContext + rAF loop.
      throw new Error('Recorder already started');
    }
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
        // Stop ticking now. mediaRecorder.state flips to 'inactive' synchronously
        // inside stop() below, but the real dataavailable/stop events are still
        // async — without clearing the interval here, the next 250ms tick would
        // see elapsed >= MAX_DURATION_MS again and re-enter this branch before
        // the in-flight stop() has settled, firing onAutoStop a second time.
        clearInterval(tickInterval);
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
    // A stop is already in flight: mediaRecorder.state flips to 'inactive'
    // synchronously the moment our own stop() calls mediaRecorder.stop(), but the
    // real dataavailable/stop events (and therefore drainChunks/teardown) only
    // happen once the browser fires them asynchronously. A second, concurrent
    // stop() call (from the tick interval racing itself, or a manual stop landing
    // in that same window) must not treat that synchronous 'inactive' as "already
    // dead" and take the salvage branch early — that would drain the chunks
    // gathered so far and miss the tail chunk still to come. Instead, share the
    // one in-flight promise so every caller gets the same, single, complete blob.
    if (pendingStop) return pendingStop;

    pendingStop = new Promise((resolve) => {
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        // No stop of ours is in flight (checked above), so this is a genuinely
        // dead recorder — e.g. iOS killed it in the background, or a prior
        // stop() already ran to completion (double-stop) — not our own stop()
        // racing its own onstop event. Return whatever the 1s timeslices
        // managed to capture.
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

  return { start, stop, isRecording };
}
