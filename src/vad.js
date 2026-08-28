export function createVAD(analyser, { onSpeechStart, onSpeechEnd, threshold = 0.05, silenceMs = 800 } = {}) {
  const data = new Uint8Array(analyser.frequencyBinCount);
  let rafId = null;
  let speaking = false;
  let aboveCount = 0;
  let silenceSince = null;

  function getPeak() {
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
    return peak;
  }

  function loop() {
    const peak = getPeak();

    if (peak >= threshold) {
      silenceSince = null;
      aboveCount++;
      if (!speaking && aboveCount >= 2) {
        speaking = true;
        onSpeechStart?.();
      }
    } else {
      aboveCount = 0;
      if (speaking) {
        if (silenceSince === null) {
          silenceSince = Date.now();
        } else if (Date.now() - silenceSince >= silenceMs) {
          speaking = false;
          silenceSince = null;
          onSpeechEnd?.();
        }
      }
    }

    rafId = requestAnimationFrame(loop);
  }

  return {
    start() { rafId = requestAnimationFrame(loop); },
    stop() { if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; } },
    isSpeaking() { return speaking; },
  };
}
