import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createVAD } from '../src/vad.js';

function makeMockAnalyser(peakSequence) {
  let callIndex = 0;
  return {
    fftSize: 256,
    frequencyBinCount: 128,
    getByteTimeDomainData(arr) {
      const peak = peakSequence[Math.min(callIndex++, peakSequence.length - 1)];
      // 128 = silence center; peak of 0.1 means value 128 + 0.1*128 = 140.8
      arr.fill(128);
      arr[0] = Math.round(128 + peak * 128);
    },
  };
}

describe('vad', () => {
  let rafCallbacks;
  let rafId;

  beforeEach(() => {
    rafCallbacks = [];
    rafId = 0;
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      rafCallbacks.push(cb);
      return ++rafId;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function flush(n = 1) {
    for (let i = 0; i < n; i++) {
      const cbs = rafCallbacks.splice(0);
      cbs.forEach((cb) => cb());
    }
  }

  it('fires onSpeechStart after 2 consecutive frames above threshold', () => {
    const onSpeechStart = vi.fn();
    const onSpeechEnd = vi.fn();
    const analyser = makeMockAnalyser([0.0, 0.1, 0.1, 0.1]);

    const vad = createVAD(analyser, { onSpeechStart, onSpeechEnd, threshold: 0.05 });
    vad.start();

    flush(1); // peak 0.0 — below threshold
    expect(onSpeechStart).not.toHaveBeenCalled();

    flush(1); // peak 0.1 — above, count=1
    expect(onSpeechStart).not.toHaveBeenCalled();

    flush(1); // peak 0.1 — above, count=2 → fire
    expect(onSpeechStart).toHaveBeenCalledOnce();

    flush(1); // peak 0.1 — still above, should not fire again
    expect(onSpeechStart).toHaveBeenCalledOnce();
  });

  it('fires onSpeechEnd after silenceMs of silence', () => {
    const onSpeechStart = vi.fn();
    const onSpeechEnd = vi.fn();
    // Start with speech, then go silent
    const analyser = makeMockAnalyser([0.1, 0.1, 0.0, 0.0, 0.0, 0.0]);

    const vad = createVAD(analyser, {
      onSpeechStart,
      onSpeechEnd,
      threshold: 0.05,
      silenceMs: 100,
    });
    vad.start();

    flush(2); // two frames above → speech starts
    expect(onSpeechStart).toHaveBeenCalledOnce();

    // Simulate time passing during silence frames
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000) // frame 3: silence begins
      .mockReturnValueOnce(1050) // frame 4: 50ms in
      .mockReturnValueOnce(1101); // frame 5: 101ms in → fire

    flush(3);
    expect(onSpeechEnd).toHaveBeenCalledOnce();
  });

  it('isSpeaking reflects current state', () => {
    const analyser = makeMockAnalyser([0.1, 0.1, 0.1]);
    const vad = createVAD(analyser, {
      onSpeechStart: vi.fn(),
      onSpeechEnd: vi.fn(),
      threshold: 0.05,
    });
    vad.start();

    expect(vad.isSpeaking()).toBe(false);
    flush(2);
    expect(vad.isSpeaking()).toBe(true);
  });

  it('stop cancels the rAF loop', () => {
    const analyser = makeMockAnalyser([0.1]);
    const vad = createVAD(analyser, {
      onSpeechStart: vi.fn(),
      onSpeechEnd: vi.fn(),
    });
    vad.start();
    vad.stop();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
});
