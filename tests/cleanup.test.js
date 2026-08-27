import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildSystemPrompt, cleanup, CleanupError, CLEANUP_MODEL } from '../src/cleanup.js';

afterEach(() => vi.unstubAllGlobals());

const okResponse = (json) => ({ ok: true, json: async () => json });

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

  it('forbids translation and transliteration of embedded words', () => {
    const p = buildSystemPrompt('he');
    expect(p).toContain('Never translate or transliterate');
    expect(p).toContain('original script');
  });

  it('requires output-only response', () => {
    expect(buildSystemPrompt('he')).toContain('Output only the cleaned message');
  });

  it('unknown language falls back to English', () => {
    expect(buildSystemPrompt('xx')).toContain('The message is in English');
  });
});

describe('cleanup', () => {
  it('posts system+user messages to chat completions and trims the reply', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ choices: [{ message: { content: '  נקי לגמרי  ' } }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await cleanup('טקסט גולמי', 'he', 'sk-test');

    expect(out).toBe('נקי לגמרי');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(opts.headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(opts.body);
    expect(body.model).toBe(CLEANUP_MODEL);
    expect(body.messages[0]).toEqual({ role: 'system', content: buildSystemPrompt('he') });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'טקסט גולמי' });
  });

  it('throws CleanupError on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(cleanup('x', 'he', 'sk-test')).rejects.toBeInstanceOf(CleanupError);
  });

  it('throws CleanupError on empty completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ choices: [] })));
    await expect(cleanup('x', 'he', 'sk-test')).rejects.toBeInstanceOf(CleanupError);
  });
});
