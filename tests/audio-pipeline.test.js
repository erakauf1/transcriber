import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPipeline, checkNoiseSuppressionSupport } from '../src/audio-pipeline.js';

vi.mock('@sapphi-red/web-noise-suppressor', () => ({
  RnnoiseWorkletNode: vi.fn(),
}));
vi.mock('@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url', () => ({ default: 'mock-worklet-url' }));
vi.mock('@sapphi-red/web-noise-suppressor/rnnoise.wasm?url', () => ({ default: 'mock-wasm-url' }));

function mockAudioContext({ workletSupported = true } = {}) {
  const destination = { stream: 'mock-clean-stream' };
  const analyser = { fftSize: 0, frequencyBinCount: 128 };
  const source = { connect: vi.fn(() => source) };
  const suppressorNode = { connect: vi.fn(() => suppressorNode) };

  const ctx = {
    createMediaStreamSource: vi.fn(() => source),
    createMediaStreamDestination: vi.fn(() => destination),
    createAnalyser: vi.fn(() => analyser),
    audioWorklet: workletSupported
      ? { addModule: vi.fn(() => Promise.resolve()) }
      : undefined,
    close: vi.fn(),
  };

  return { ctx, source, analyser, destination, suppressorNode };
}

describe('audio-pipeline', () => {
  let origAudioContext;

  beforeEach(() => {
    origAudioContext = globalThis.AudioContext;
  });

  afterEach(() => {
    globalThis.AudioContext = origAudioContext;
    vi.restoreAllMocks();
  });

  it('creates a passthrough pipeline when noiseSuppression is false', async () => {
    const { ctx, source, analyser, destination } = mockAudioContext();
    globalThis.AudioContext = vi.fn(() => ctx);

    const pipeline = await createPipeline('mock-stream', { noiseSuppression: false });

    expect(ctx.createMediaStreamSource).toHaveBeenCalledWith('mock-stream');
    // source connects to both destination and analyser (passthrough)
    expect(source.connect).toHaveBeenCalledWith(destination);
    expect(source.connect).toHaveBeenCalledWith(analyser);
    expect(pipeline.cleanStream).toBe('mock-clean-stream');
    expect(pipeline.analyser).toBe(analyser);
    expect(typeof pipeline.destroy).toBe('function');
  });

  it('destroy closes the AudioContext', async () => {
    const { ctx } = mockAudioContext();
    globalThis.AudioContext = vi.fn(() => ctx);

    const pipeline = await createPipeline('mock-stream', { noiseSuppression: false });
    pipeline.destroy();

    expect(ctx.close).toHaveBeenCalled();
  });

  it('falls back to passthrough when noiseSuppression is true but worklet fails', async () => {
    const { ctx, source, analyser, destination } = mockAudioContext();
    ctx.audioWorklet.addModule = vi.fn(() => Promise.reject(new Error('worklet load failed')));
    globalThis.AudioContext = vi.fn(() => ctx);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pipeline = await createPipeline('mock-stream', { noiseSuppression: true });

    expect(warnSpy).toHaveBeenCalled();
    // Should still produce a working pipeline (passthrough)
    expect(source.connect).toHaveBeenCalledWith(destination);
    expect(pipeline.cleanStream).toBe('mock-clean-stream');
  });
});

describe('checkNoiseSuppressionSupport', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns false when AudioContext is missing', async () => {
    globalThis.AudioContext = undefined;
    globalThis.webkitAudioContext = undefined;
    expect(await checkNoiseSuppressionSupport()).toBe(false);
  });

  it('returns false when audioWorklet is missing', async () => {
    globalThis.AudioContext = vi.fn(() => ({
      audioWorklet: undefined,
      close: vi.fn(),
    }));
    expect(await checkNoiseSuppressionSupport()).toBe(false);
  });

  it('returns true when AudioContext and audioWorklet exist', async () => {
    globalThis.AudioContext = vi.fn(() => ({
      audioWorklet: { addModule: vi.fn() },
      close: vi.fn(),
    }));
    expect(await checkNoiseSuppressionSupport()).toBe(true);
  });
});
