import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { buildSystemPrompt, cleanup, CleanupError, CLEANUP_MODEL } from '../src/cleanup.js';

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

describe('buildSystemPrompt', () => {
  it('locks output language to Hebrew', () => {
    const p = buildSystemPrompt('he');
    expect(p).toContain('The message is in Hebrew');
    expect(p).toContain('Your entire output must be in Hebrew');
  });

  it('locks output language to English', () => {
    const p = buildSystemPrompt('en');
    expect(p).toContain('The message is in English');
    expect(p).toContain('Your entire output must be in English');
  });

  it('forbids translation of embedded words', () => {
    const p = buildSystemPrompt('he');
    expect(p).toContain('keep them exactly as spoken');
    expect(p).toContain('Never translate anything');
  });

  it('requires output-only response', () => {
    expect(buildSystemPrompt('he')).toContain('Output only the cleaned message');
  });

  it('leaves words already in Latin letters untouched', () => {
    const p = buildSystemPrompt('he');
    expect(p).toContain('already be written in Latin letters');
    expect(p).toContain('Leave them exactly as they are');
  });

  it('gives the model no mandate to rewrite words that look transliterated', () => {
    // The root cause of substituted place names: see src/loanwords.js.
    const p = buildSystemPrompt('he');
    expect(p).not.toContain('Undo this');
    expect(p).not.toContain('transliterates');
  });

  it('protects names of people and places from script changes', () => {
    expect(buildSystemPrompt('he')).toContain('Never change a name of a person or place');
  });

  it('forbids substituting a different name (guards against hallucinated corrections)', () => {
    const p = buildSystemPrompt('he');
    expect(p).toContain('never to a different name');
    expect(p).toContain('A wrong name is worse than an awkward one');
  });

  it('calls out prepositions and date expressions in the grammar rule', () => {
    const p = buildSystemPrompt('he');
    expect(p).toContain('prepositions');
    expect(p).toContain('date and number expressions');
  });

  it('unknown language falls back to English', () => {
    expect(buildSystemPrompt('xx')).toContain('The message is in English');
  });
});

describe('cleanup', () => {
  it('posts system + few-shot + user messages to the Anthropic Messages API and trims the reply', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ content: [{ type: 'text', text: '  נקי לגמרי  ' }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await cleanup('טקסט גולמי', 'he', 'sk-ant-test');

    expect(out).toBe('נקי לגמרי');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.headers['x-api-key']).toBe('sk-ant-test');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
    expect(opts.headers['anthropic-dangerous-direct-browser-access']).toBe('true');

    const body = JSON.parse(opts.body);
    expect(body.model).toBe(CLEANUP_MODEL);
    expect(body.max_tokens).toBe(4096);
    // Pinned: temperature isn't a valid parameter on this model — sending it (even 0) is a 400
    expect(body.temperature).toBeUndefined();
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.system).toBe(buildSystemPrompt('he'));

    // Few-shot examples precede the real message and alternate user/assistant
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'טקסט גולמי' });
    const fewShot = body.messages.slice(0, -1);
    expect(fewShot.length).toBeGreaterThan(0);
    fewShot.forEach((m, i) => {
      expect(m.role).toBe(i % 2 === 0 ? 'user' : 'assistant');
    });
    // The name-preservation example is the whole point of this migration
    expect(fewShot.some((m) => m.content.includes('רעננה'))).toBe(true);
  });

  it('uses English few-shot examples for English transcripts', async () => {
    const fetchMock = vi.fn(async () => okResponse({ content: [{ type: 'text', text: 'clean' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await cleanup('raw text', 'en', 'sk-ant-test');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const fewShot = body.messages.slice(0, -1);
    expect(fewShot.every((m) => /^[\x00-\x7F\s.,'-]*$/.test(m.content))).toBe(true);
    // The name-preservation example is the whole point of this migration
    expect(fewShot.some((m) => m.content.includes('Raanana'))).toBe(true);
  });

  it('parses the text block even when a thinking block precedes it', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '  clean output  ' }] })
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await cleanup('raw', 'en', 'sk-ant-test');
    expect(out).toBe('clean output');
  });

  it('throws CleanupError without calling fetch when no API key is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(cleanup('x', 'he', null)).rejects.toBeInstanceOf(CleanupError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws CleanupError on a terminal HTTP error (single attempt, no retry)', async () => {
    // 400 is a terminal status (malformed request) — distinct from the 5xx/429 retry
    // tests below, which need a transient status to exercise the retry loop.
    const fetchMock = vi.fn(async () => ({ ok: false, status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(cleanup('x', 'he', 'sk-ant-test')).rejects.toBeInstanceOf(CleanupError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws CleanupError on empty completion, without retrying', async () => {
    const fetchMock = vi.fn(async () => okResponse({ content: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(cleanup('x', 'he', 'sk-ant-test')).rejects.toBeInstanceOf(CleanupError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe('retry on transient failures', () => {
    it('recovers from 2 failed attempts (429) and returns the cleaned text from the 3rd', async () => {
      let calls = 0;
      const fetchMock = vi.fn(async () => {
        calls++;
        if (calls <= 2) {
          return errResponse(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } });
        }
        return okResponse({ content: [{ type: 'text', text: 'recovered cleanup' }] });
      });
      vi.stubGlobal('fetch', fetchMock);

      const promise = cleanup('raw text', 'en', 'sk-ant-test');
      await flushRetryDelays();
      const text = await promise;

      expect(text).toBe('recovered cleanup');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('retries Anthropic overload (529) the same as a 429', async () => {
      let calls = 0;
      const fetchMock = vi.fn(async () => {
        calls++;
        if (calls === 1) {
          return errResponse(529, { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } });
        }
        return okResponse({ content: [{ type: 'text', text: 'ok after overload' }] });
      });
      vi.stubGlobal('fetch', fetchMock);

      const promise = cleanup('raw text', 'en', 'sk-ant-test');
      await flushRetryDelays();
      const text = await promise;

      expect(text).toBe('ok after overload');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry a terminal error (authentication) — fails on the very first attempt', async () => {
      const fetchMock = vi.fn(async () =>
        errResponse(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })
      );
      vi.stubGlobal('fetch', fetchMock);

      await expect(cleanup('raw text', 'en', 'sk-ant-test')).rejects.toBeInstanceOf(CleanupError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // This is the core reliability guarantee of the retry layer: a recording is never
    // silently discarded just because the cleanup call never recovers. Once every retry
    // attempt is exhausted, cleanup() still throws CleanupError — app.js's existing
    // CLEANUP_FAIL handling then falls back to showing the raw transcript (see
    // tests/state.test.js: "CLEANUP_FAIL still reaches result, with raw transcript and
    // error") instead of losing the recording entirely.
    it('exhausts retries on a persistent 429 and still throws CleanupError (raw-transcript fallback path)', async () => {
      const fetchMock = vi.fn(async () =>
        errResponse(429, { type: 'error', error: { type: 'rate_limit_error', message: 'still limited' } })
      );
      vi.stubGlobal('fetch', fetchMock);

      const promise = cleanup('raw text', 'en', 'sk-ant-test').catch((e) => e);
      await flushRetryDelays();
      const result = await promise;

      expect(result).toBeInstanceOf(CleanupError);
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1); // it did retry, not just fail once
    });
  });
});
