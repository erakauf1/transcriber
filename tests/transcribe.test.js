import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { transcribe, TranscriptionError, TRANSCRIBE_MODEL } from '../src/transcribe.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const okResponse = (json) => ({ ok: true, json: async () => json });
const errResponse = (status, body) => ({ ok: false, status, json: async () => body });

// withRetry's default sleep uses setTimeout, which fake timers intercept — this drains
// any pending backoff waits so retry tests don't depend on wall-clock time.
async function flushRetryDelays() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
  }
}

describe('transcribe', () => {
  it('posts multipart form with file and model — and NO language param', async () => {
    const fetchMock = vi.fn(async () => okResponse({ text: '  שלום deploy  ' }));
    vi.stubGlobal('fetch', fetchMock);
    const blob = new Blob(['x'], { type: 'audio/mp4' });

    const text = await transcribe(blob, 'sk-test');

    expect(text).toBe('שלום deploy');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer sk-test');
    expect(opts.body).toBeInstanceOf(FormData);
    expect(opts.body.get('model')).toBe(TRANSCRIBE_MODEL);
    expect(opts.body.get('language')).toBeNull(); // spec: auto-detect preserves code-switching
    // Script hint: discourages transliterating English terms into Hebrew letters
    expect(opts.body.get('prompt')).toContain('original script');
    expect(opts.body.get('file')).toBeTruthy();
  });

  it('throws TranscriptionError on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));
    await expect(transcribe(new Blob(['x']), 'sk-bad')).rejects.toBeInstanceOf(TranscriptionError);
  });

  it('throws TranscriptionError on empty transcript', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ text: '   ' })));
    await expect(transcribe(new Blob(['x']), 'sk-test')).rejects.toBeInstanceOf(TranscriptionError);
  });

  it('does not retry on empty transcript — a single call is enough to know it will not change', async () => {
    const fetchMock = vi.fn(async () => okResponse({ text: '' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(transcribe(new Blob(['x']), 'sk-test')).rejects.toBeInstanceOf(TranscriptionError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe('retry on transient failures', () => {
    it('recovers from 2 failed attempts (429) and returns the transcript from the 3rd', async () => {
      let calls = 0;
      const fetchMock = vi.fn(async () => {
        calls++;
        if (calls <= 2) {
          return errResponse(429, { error: { message: 'rate limited', code: 'rate_limit_exceeded' } });
        }
        return okResponse({ text: 'recovered transcript' });
      });
      vi.stubGlobal('fetch', fetchMock);

      const promise = transcribe(new Blob(['x']), 'sk-test');
      await flushRetryDelays();
      const text = await promise;

      expect(text).toBe('recovered transcript');
      // Exactly 2 retry-state transitions: the 429 on attempt 1 and attempt 2 each led to
      // one more call; the 3rd call is the one that finally succeeds.
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('retries a network error (fetch throwing) the same as an HTTP 429', async () => {
      let calls = 0;
      const fetchMock = vi.fn(async () => {
        calls++;
        if (calls === 1) throw new TypeError('Failed to fetch');
        return okResponse({ text: 'ok after network blip' });
      });
      vi.stubGlobal('fetch', fetchMock);

      const promise = transcribe(new Blob(['x']), 'sk-test');
      await flushRetryDelays();
      const text = await promise;

      expect(text).toBe('ok after network blip');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry a terminal error (401) — fails on the very first attempt', async () => {
      const fetchMock = vi.fn(async () => errResponse(401, { error: { code: 'invalid_api_key' } }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(transcribe(new Blob(['x']), 'sk-bad')).rejects.toBeInstanceOf(TranscriptionError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('gives up after exhausting all attempts on a persistent 429 and still throws TranscriptionError', async () => {
      const fetchMock = vi.fn(async () =>
        errResponse(429, { error: { message: 'still rate limited', code: 'rate_limit_exceeded' } })
      );
      vi.stubGlobal('fetch', fetchMock);

      const promise = transcribe(new Blob(['x']), 'sk-test').catch((e) => e);
      await flushRetryDelays();
      const result = await promise;

      expect(result).toBeInstanceOf(TranscriptionError);
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1); // it did retry, not just fail once
    });

    it('does not retry insufficient_quota even though it is also a 429', async () => {
      const fetchMock = vi.fn(async () =>
        errResponse(429, { error: { message: 'out of credit', code: 'insufficient_quota' } })
      );
      vi.stubGlobal('fetch', fetchMock);

      await expect(transcribe(new Blob(['x']), 'sk-test')).rejects.toBeInstanceOf(TranscriptionError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
