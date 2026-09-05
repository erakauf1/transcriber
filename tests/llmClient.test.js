import { describe, it, expect, vi, afterEach } from 'vitest';
import { callChatModel } from '../src/llmClient.js';

afterEach(() => vi.unstubAllGlobals());

const okResponse = (json) => ({ ok: true, json: async () => json });

describe('callChatModel — anthropic', () => {
  it('posts to the Anthropic Messages API and returns trimmed text', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ content: [{ type: 'text', text: '  hi  ' }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await callChatModel({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      apiKey: 'sk-ant-test',
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 4096,
    });

    expect(out).toBe('hi');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.headers['x-api-key']).toBe('sk-ant-test');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
    expect(opts.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.max_tokens).toBe(4096);
    expect(body.temperature).toBeUndefined();
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.system).toBe('sys');
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('finds the text block even when a thinking block precedes it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      okResponse({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'ok' }] })
    ));
    const out = await callChatModel({
      provider: 'anthropic', model: 'claude-sonnet-5', apiKey: 'k',
      systemPrompt: 's', messages: [{ role: 'user', content: 'x' }], maxTokens: 100,
    });
    expect(out).toBe('ok');
  });

  it('throws on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(callChatModel({
      provider: 'anthropic', model: 'm', apiKey: 'k', systemPrompt: 's',
      messages: [{ role: 'user', content: 'x' }], maxTokens: 100,
    })).rejects.toThrow();
  });

  it('throws on empty content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ content: [] })));
    await expect(callChatModel({
      provider: 'anthropic', model: 'm', apiKey: 'k', systemPrompt: 's',
      messages: [{ role: 'user', content: 'x' }], maxTokens: 100,
    })).rejects.toThrow();
  });

  it('throws on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    await expect(callChatModel({
      provider: 'anthropic', model: 'm', apiKey: 'k', systemPrompt: 's',
      messages: [{ role: 'user', content: 'x' }], maxTokens: 100,
    })).rejects.toThrow();
  });
});

describe('callChatModel — openai', () => {
  it('posts to OpenAI chat completions and returns trimmed text', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ choices: [{ message: { content: '  hi  ' } }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await callChatModel({
      provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test',
      systemPrompt: 'sys', messages: [{ role: 'user', content: 'hello' }],
      temperature: 0,
    });

    expect(out).toBe('hi');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(opts.headers.Authorization).toBe('Bearer sk-test');
    expect(opts.headers['HTTP-Referer']).toBeUndefined();
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('gpt-4o');
    expect(body.temperature).toBe(0);
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
    ]);
    expect(body.response_format).toBeUndefined();
  });

  it('requests json_object format when jsonMode is true', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ choices: [{ message: { content: '{}' } }] })
    );
    vi.stubGlobal('fetch', fetchMock);
    await callChatModel({
      provider: 'openai', model: 'gpt-4o', apiKey: 'k', systemPrompt: 's',
      messages: [{ role: 'user', content: 'x' }], jsonMode: true,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('throws on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429 })));
    await expect(callChatModel({
      provider: 'openai', model: 'm', apiKey: 'k', systemPrompt: 's',
      messages: [{ role: 'user', content: 'x' }],
    })).rejects.toThrow();
  });

  it('throws on empty completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ choices: [] })));
    await expect(callChatModel({
      provider: 'openai', model: 'm', apiKey: 'k', systemPrompt: 's',
      messages: [{ role: 'user', content: 'x' }],
    })).rejects.toThrow();
  });
});

describe('callChatModel — openrouter', () => {
  it('posts to the OpenRouter endpoint with attribution headers', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ choices: [{ message: { content: 'ok' } }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    await callChatModel({
      provider: 'openrouter', model: 'openrouter/auto', apiKey: 'sk-or-test',
      systemPrompt: 's', messages: [{ role: 'user', content: 'x' }],
    });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(opts.headers.Authorization).toBe('Bearer sk-or-test');
    expect(opts.headers['HTTP-Referer']).toBeTruthy();
    expect(opts.headers['X-Title']).toBeTruthy();
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('openrouter/auto');
  });
});

describe('callChatModel — unknown provider', () => {
  it('throws synchronously without calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(callChatModel({
      provider: 'bogus', model: 'm', apiKey: 'k', systemPrompt: 's', messages: [],
    })).rejects.toThrow('Unknown provider: bogus');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
