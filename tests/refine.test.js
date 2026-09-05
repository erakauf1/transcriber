import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateRefinementChips, applyRefinement, RefineError } from '../src/refine.js';

afterEach(() => vi.unstubAllGlobals());

const okResponse = (json) => ({ ok: true, json: async () => json });
const chipResponse = (chips) =>
  okResponse({ choices: [{ message: { content: JSON.stringify({ chips }) } }] });

describe('generateRefinementChips', () => {
  it('returns parsed chips from GPT response', async () => {
    const chips = [
      { label: 'Make shorter', instruction: 'Condense to key points' },
      { label: 'More formal', instruction: 'Rewrite in a professional tone' },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => chipResponse(chips)));

    const result = await generateRefinementChips('Some voice note text', 'en', { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' });
    expect(result).toEqual(chips);
  });

  it('caps results at 4 chips', async () => {
    const chips = Array.from({ length: 6 }, (_, i) => ({
      label: `Option ${i}`,
      instruction: `Do thing ${i}`,
    }));
    vi.stubGlobal('fetch', vi.fn(async () => chipResponse(chips)));

    const result = await generateRefinementChips('text', 'en', { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' });
    expect(result).toHaveLength(4);
  });

  it('filters out chips missing label or instruction', async () => {
    const chips = [
      { label: 'Good chip', instruction: 'Do something' },
      { label: 'Missing instruction' },
      { instruction: 'Missing label' },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => chipResponse(chips)));

    const result = await generateRefinementChips('text', 'en', { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' });
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Good chip');
  });

  it('sends request to chat completions with json_object format', async () => {
    const fetchMock = vi.fn(async () =>
      chipResponse([{ label: 'Shorter', instruction: 'Condense' }])
    );
    vi.stubGlobal('fetch', fetchMock);

    await generateRefinementChips('text', 'he', { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(opts.headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('gpt-4o');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('Hebrew');
    expect(body.messages[1].content).toBe('text');
  });

  it('accepts chips array at top-level JSON', async () => {
    const chips = [{ label: 'A', instruction: 'B' }];
    vi.stubGlobal('fetch', vi.fn(async () =>
      okResponse({ choices: [{ message: { content: JSON.stringify(chips) } }] })
    ));

    const result = await generateRefinementChips('text', 'en', { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' });
    expect(result).toHaveLength(1);
  });

  it('throws RefineError on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429 })));
    await expect(generateRefinementChips('x', 'en', { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' })).rejects.toBeInstanceOf(RefineError);
  });

  it('throws RefineError on empty response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ choices: [] })));
    await expect(generateRefinementChips('x', 'en', { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' })).rejects.toBeInstanceOf(RefineError);
  });

  it('throws RefineError on malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      okResponse({ choices: [{ message: { content: 'not json at all' } }] })
    ));
    await expect(generateRefinementChips('x', 'en', { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' })).rejects.toBeInstanceOf(RefineError);
  });

  it('throws RefineError on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await expect(generateRefinementChips('x', 'en', { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' })).rejects.toBeInstanceOf(RefineError);
  });

  it('routes to OpenRouter when provider is openrouter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chipResponse([{ label: 'A', instruction: 'B' }])));
    const result = await generateRefinementChips('text', 'en', {
      provider: 'openrouter', model: 'openrouter/auto', apiKey: 'sk-or-test',
    });
    expect(result).toEqual([{ label: 'A', instruction: 'B' }]);
  });
});

describe('applyRefinement', () => {
  it('returns trimmed refined text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      okResponse({ choices: [{ message: { content: '  refined output  ' } }] })
    ));

    const out = await applyRefinement('original', 'en', 'Make shorter', { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' });
    expect(out).toBe('refined output');
  });

  it('sends system+user messages with instruction prepended', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ choices: [{ message: { content: 'done' } }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    await applyRefinement('my text', 'he', 'Condense this', { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('gpt-4o');
    expect(body.temperature).toBe(0);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('Hebrew');
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content).toContain('Condense this');
    expect(body.messages[1].content).toContain('my text');
  });

  it('throws RefineError on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(applyRefinement('x', 'en', 'instruction', { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' })).rejects.toBeInstanceOf(RefineError);
  });

  it('throws RefineError on empty completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ choices: [] })));
    await expect(applyRefinement('x', 'en', 'instruction', { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' })).rejects.toBeInstanceOf(RefineError);
  });

  it('throws RefineError on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    await expect(applyRefinement('x', 'en', 'instruction', { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' })).rejects.toBeInstanceOf(RefineError);
  });

  it('routes to OpenRouter when provider is openrouter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ choices: [{ message: { content: 'refined' } }] })));
    const out = await applyRefinement('x', 'en', 'instr', {
      provider: 'openrouter', model: 'openrouter/auto', apiKey: 'sk-or-test',
    });
    expect(out).toBe('refined');
  });
});
