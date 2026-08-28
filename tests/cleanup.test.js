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
    // Pinned: nonzero temperature was measured to cause name substitution
    expect(body.temperature).toBe(0);
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
