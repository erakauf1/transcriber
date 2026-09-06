# OpenRouter Provider Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Cleanup and Refine each independently use OpenAI, Anthropic, or OpenRouter (with free/low-cost model choices), while Transcription stays hardcoded to OpenAI.

**Architecture:** A new `src/llmClient.js` module exposes one `callChatModel()` function that knows how to talk to Anthropic's Messages API or an OpenAI-compatible Chat Completions API (OpenAI and OpenRouter share this shape). `cleanup.js` and `refine.js` keep their prompt-building logic unchanged but delegate the actual network call to `callChatModel()`, receiving `{provider, model, apiKey}` from their caller instead of hardcoding a provider/model/endpoint. `app.js` resolves which provider/model/key to use per step from new `settings.js` entries, and the Settings UI gains a provider `<select>` + model `<select>` per step plus an OpenRouter key field.

**Tech Stack:** Vanilla JS (ES modules), Vitest, `fetch`, no framework, no backend — this is a client-only PWA; all API keys stay in `localStorage`.

## Global Constraints

- Transcription (`src/transcribe.js`) is unaffected — stays hardcoded to OpenAI `gpt-4o-transcribe`. Do not touch this file.
- Defaults must exactly reproduce current behavior: Cleanup defaults to Anthropic `claude-sonnet-5`; Refine defaults to OpenAI `gpt-4o`. Existing users see no change until they open Settings.
- Anthropic requests must never include a `temperature` field (sending one, even `0`, is a 400 on `claude-sonnet-5` — see `tests/cleanup.test.js`'s pinned comment).
- OpenRouter requests use endpoint `https://openrouter.ai/api/v1/chat/completions` and add two static attribution headers: `HTTP-Referer` and `X-Title`.
- `CleanupError` / `RefineError` remain the public error types thrown by `cleanup.js` / `refine.js` — `llmClient.js` throws plain `Error`, which callers wrap.
- Follow existing code style: no comments except where a non-obvious constraint needs explaining (see e.g. `cleanup.js`'s existing comments) — do not add explanatory comments for straightforward code.

---

### Task 1: `src/llmClient.js` — shared chat request helper

**Files:**
- Create: `src/llmClient.js`
- Test: `tests/llmClient.test.js`

**Interfaces:**
- Produces: `export async function callChatModel({ provider, model, apiKey, systemPrompt, messages, temperature, maxTokens, jsonMode = false, timeoutMs })` — returns the assistant's reply as a trimmed string. `provider` is `'openai' | 'anthropic' | 'openrouter'`. `messages` is an array of `{role: 'user'|'assistant', content}` (system prompt is separate, passed as `systemPrompt`). Throws a plain `Error` on network failure, non-OK HTTP response, or empty/unparseable output.

- [ ] **Step 1: Write failing tests for the Anthropic branch**

```js
// tests/llmClient.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/llmClient.test.js`
Expected: FAIL — `src/llmClient.js` does not exist yet.

- [ ] **Step 3: Implement the Anthropic branch**

```js
// src/llmClient.js
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ATTRIBUTION_TITLE = 'Voice Note Transcriber';
const ATTRIBUTION_REFERER = 'https://the-transcriber.netlify.app';

async function callAnthropic({ model, apiKey, systemPrompt, messages, maxTokens, timeoutMs }) {
  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        thinking: { type: 'disabled' },
        system: systemPrompt,
        messages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(`Network error: ${err.message}`);
  }
  if (!res.ok) throw new Error(`Request failed (HTTP ${res.status})`);
  const data = await res.json();
  const out = data.content?.find((b) => b.type === 'text')?.text?.trim();
  if (!out) throw new Error('Empty response');
  return out;
}

export async function callChatModel({
  provider, model, apiKey, systemPrompt, messages,
  temperature, maxTokens, jsonMode = false, timeoutMs = 60000,
}) {
  if (provider === 'anthropic') {
    return callAnthropic({ model, apiKey, systemPrompt, messages, maxTokens, timeoutMs });
  }
  throw new Error(`Unknown provider: ${provider}`);
}
```

- [ ] **Step 4: Run tests to verify the Anthropic branch passes**

Run: `npx vitest run tests/llmClient.test.js`
Expected: the 5 `callChatModel — anthropic` tests PASS.

- [ ] **Step 5: Write failing tests for the OpenAI-compatible branch (openai + openrouter)**

Append to `tests/llmClient.test.js`:

```js
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
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run tests/llmClient.test.js`
Expected: the new `openai`/`openrouter` describe blocks FAIL (no such branch implemented yet).

- [ ] **Step 7: Implement the OpenAI-compatible branch**

Replace the body of `callChatModel` in `src/llmClient.js`:

```js
async function callOpenAICompatible({
  provider, model, apiKey, systemPrompt, messages, temperature, jsonMode, timeoutMs,
}) {
  const url = provider === 'openrouter' ? OPENROUTER_URL : OPENAI_URL;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = ATTRIBUTION_REFERER;
    headers['X-Title'] = ATTRIBUTION_TITLE;
  }

  const body = {
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (jsonMode) body.response_format = { type: 'json_object' };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(`Network error: ${err.message}`);
  }
  if (!res.ok) throw new Error(`Request failed (HTTP ${res.status})`);
  const data = await res.json();
  const out = data.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error('Empty response');
  return out;
}

export async function callChatModel({
  provider, model, apiKey, systemPrompt, messages,
  temperature, maxTokens, jsonMode = false, timeoutMs = 60000,
}) {
  if (provider === 'anthropic') {
    return callAnthropic({ model, apiKey, systemPrompt, messages, maxTokens, timeoutMs });
  }
  if (provider === 'openai' || provider === 'openrouter') {
    return callOpenAICompatible({ provider, model, apiKey, systemPrompt, messages, temperature, jsonMode, timeoutMs });
  }
  throw new Error(`Unknown provider: ${provider}`);
}
```

- [ ] **Step 8: Run all llmClient tests to verify they pass**

Run: `npx vitest run tests/llmClient.test.js`
Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/llmClient.js tests/llmClient.test.js
git commit -m "feat: add shared llmClient for openai/anthropic/openrouter chat calls"
```

---

### Task 2: Refactor `cleanup.js` to use `llmClient` with a provider/model/key object

**Files:**
- Modify: `src/cleanup.js`
- Test: `tests/cleanup.test.js`

**Interfaces:**
- Consumes: `callChatModel({ provider, model, apiKey, systemPrompt, messages, maxTokens, timeoutMs })` from Task 1 (`src/llmClient.js`).
- Produces: `export async function cleanup(text, language, { provider, model, apiKey })` — same return value and `CleanupError` behavior as before, but the third parameter is now an object instead of a bare API key string. `buildSystemPrompt` and `CleanupError` keep their existing signatures/exports. `CLEANUP_MODEL` constant is removed (model is now a caller-supplied parameter).

- [ ] **Step 1: Update `tests/cleanup.test.js` for the new call shape (still asserting the exact Anthropic request)**

Replace the `cleanup` describe block's calls and imports:

```js
import { buildSystemPrompt, cleanup, CleanupError } from '../src/cleanup.js';
```

(remove `CLEANUP_MODEL` from the import — it no longer exists)

```js
describe('cleanup', () => {
  const anthropicOpts = { provider: 'anthropic', model: 'claude-sonnet-5', apiKey: 'sk-ant-test' };

  it('posts system + few-shot + user messages to the Anthropic Messages API and trims the reply', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ content: [{ type: 'text', text: '  נקי לגמרי  ' }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await cleanup('טקסט גולמי', 'he', anthropicOpts);

    expect(out).toBe('נקי לגמרי');
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
    expect(body.system).toBe(buildSystemPrompt('he'));

    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'טקסט גולמי' });
    const fewShot = body.messages.slice(0, -1);
    expect(fewShot.length).toBeGreaterThan(0);
    fewShot.forEach((m, i) => {
      expect(m.role).toBe(i % 2 === 0 ? 'user' : 'assistant');
    });
    expect(fewShot.some((m) => m.content.includes('רעננה'))).toBe(true);
  });

  it('uses English few-shot examples for English transcripts', async () => {
    const fetchMock = vi.fn(async () => okResponse({ content: [{ type: 'text', text: 'clean' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await cleanup('raw text', 'en', anthropicOpts);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const fewShot = body.messages.slice(0, -1);
    expect(fewShot.every((m) => /^[\x00-\x7F\s.,'-]*$/.test(m.content))).toBe(true);
    expect(fewShot.some((m) => m.content.includes('Raanana'))).toBe(true);
  });

  it('parses the text block even when a thinking block precedes it', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '  clean output  ' }] })
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await cleanup('raw', 'en', anthropicOpts);
    expect(out).toBe('clean output');
  });

  it('throws CleanupError without calling fetch when no API key is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(cleanup('x', 'he', { provider: 'anthropic', model: 'claude-sonnet-5', apiKey: null }))
      .rejects.toBeInstanceOf(CleanupError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws CleanupError on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(cleanup('x', 'he', anthropicOpts)).rejects.toBeInstanceOf(CleanupError);
  });

  it('throws CleanupError on empty completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ content: [] })));
    await expect(cleanup('x', 'he', anthropicOpts)).rejects.toBeInstanceOf(CleanupError);
  });

  it('routes to OpenRouter when provider is openrouter', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ choices: [{ message: { content: 'clean via openrouter' } }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await cleanup('raw', 'en', {
      provider: 'openrouter', model: 'openrouter/auto', apiKey: 'sk-or-test',
    });

    expect(out).toBe('clean via openrouter');
    expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cleanup.test.js`
Expected: FAIL — `cleanup()` still takes a bare API key string and imports `CLEANUP_MODEL`.

- [ ] **Step 3: Update `src/cleanup.js`**

```js
import { callChatModel } from './llmClient.js';

export class CleanupError extends Error {}

// ... buildSystemPrompt, FEW_SHOT_EXAMPLES, buildFewShotMessages unchanged ...

export async function cleanup(text, language, { provider, model, apiKey }) {
  if (!apiKey) throw new CleanupError(`No ${provider} API key configured`);

  try {
    return await callChatModel({
      provider,
      model,
      apiKey,
      systemPrompt: buildSystemPrompt(language),
      messages: [...buildFewShotMessages(language), { role: 'user', content: text }],
      maxTokens: 4096,
      timeoutMs: 120000,
    });
  } catch (err) {
    throw new CleanupError(err.message.replace(/^Request failed/, 'Cleanup failed').replace(/^Empty response/, 'Cleanup returned empty output'));
  }
}
```

Remove the top-line `export const CLEANUP_MODEL = 'claude-sonnet-5';` — the model now always comes from the caller.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cleanup.test.js`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cleanup.js tests/cleanup.test.js
git commit -m "refactor: route cleanup.js through llmClient, accept {provider,model,apiKey}"
```

---

### Task 3: Refactor `refine.js` to use `llmClient` with a provider/model/key object

**Files:**
- Modify: `src/refine.js`
- Test: `tests/refine.test.js`

**Interfaces:**
- Consumes: `callChatModel(...)` from Task 1.
- Produces: `export async function generateRefinementChips(text, language, { provider, model, apiKey })` and `export async function applyRefinement(text, language, instruction, { provider, model, apiKey })` — same return values and `RefineError` behavior as before, third/fourth parameter is now an object. `REFINE_MODEL` constant is removed.

- [ ] **Step 1: Update `tests/refine.test.js` for the new call shape**

```js
import { generateRefinementChips, applyRefinement, RefineError } from '../src/refine.js';
```

(remove `REFINE_MODEL` from the import)

Replace every call site's trailing `'sk-test'` argument with `{ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' }`, and every `body.model).toBe(REFINE_MODEL)` assertion with `body.model).toBe('gpt-4o')`. Example for the two request-shape tests:

```js
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
```

```js
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
```

Apply the same `{ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' }` substitution to every remaining call in both describe blocks (the ones currently passing bare `'sk-test'`). Also add one new test per function for OpenRouter routing:

```js
it('routes to OpenRouter when provider is openrouter', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => chipResponse([{ label: 'A', instruction: 'B' }])));
  const result = await generateRefinementChips('text', 'en', {
    provider: 'openrouter', model: 'openrouter/auto', apiKey: 'sk-or-test',
  });
  expect(result).toEqual([{ label: 'A', instruction: 'B' }]);
});
```

```js
it('routes to OpenRouter when provider is openrouter', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => okResponse({ choices: [{ message: { content: 'refined' } }] })));
  const out = await applyRefinement('x', 'en', 'instr', {
    provider: 'openrouter', model: 'openrouter/auto', apiKey: 'sk-or-test',
  });
  expect(out).toBe('refined');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/refine.test.js`
Expected: FAIL — `generateRefinementChips`/`applyRefinement` still take a bare API key string and `REFINE_MODEL` no longer exists.

- [ ] **Step 3: Update `src/refine.js`**

```js
import { callChatModel } from './llmClient.js';

export class RefineError extends Error {}

const LANGUAGE_NAMES = { he: 'Hebrew', en: 'English' };

export async function generateRefinementChips(text, language, { provider, model, apiKey }) {
  const lang = LANGUAGE_NAMES[language] || 'English';

  let content;
  try {
    content = await callChatModel({
      provider,
      model,
      apiKey,
      temperature: 0.7,
      jsonMode: true,
      timeoutMs: 30000,
      systemPrompt: [
        `You suggest specific, useful one-tap refinement actions for a cleaned-up voice note message.`,
        `The message is in ${lang}. Suggest 3–4 short actions that would genuinely improve THIS specific message.`,
        `Return a JSON object in this exact shape: {"chips": [{"label": "...", "instruction": "..."}, ...]}`,
        `Rules:`,
        `- "label" is 2–4 words max, written in ${lang} (so the user sees it in their language)`,
        `- "instruction" is always in English — it is the prompt used to transform the message`,
        `- Options must be specific to this content, not generic filler`,
        `- Do not suggest formatting already present in the message (e.g. don't suggest bullet points if they're already there)`,
        `- Examples of good labels: "Make shorter", "More formal", "Add details", "Softer tone", "Clearer request"`,
      ].join('\n'),
      messages: [{ role: 'user', content: text }],
    });
  } catch (err) {
    throw new RefineError(err.message.replace(/^Request failed/, 'Could not generate suggestions'));
  }

  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new RefineError('Could not parse suggestions'); }

  const arr = Array.isArray(parsed) ? parsed : (parsed.chips || parsed.options || null);
  if (!Array.isArray(arr) || arr.length === 0) throw new RefineError('No valid suggestions returned');

  return arr
    .slice(0, 4)
    .filter((c) => c && c.label && c.instruction)
    .map(({ label, instruction }) => ({ label: String(label).trim(), instruction: String(instruction).trim() }));
}

export async function applyRefinement(text, language, instruction, { provider, model, apiKey }) {
  const lang = LANGUAGE_NAMES[language] || 'English';

  try {
    return await callChatModel({
      provider,
      model,
      apiKey,
      temperature: 0,
      timeoutMs: 60000,
      systemPrompt: [
        `You refine voice-note messages by applying a specific transformation.`,
        `The message is in ${lang}. Never translate anything — preserve the language throughout.`,
        `Keep the personal tone and meaning unless the instruction explicitly asks to change it.`,
        `Output only the refined message. No preamble, no quotes, no explanations.`,
      ].join('\n'),
      messages: [{ role: 'user', content: `${instruction}:\n\n${text}` }],
    });
  } catch (err) {
    throw new RefineError(err.message.replace(/^Request failed/, 'Refinement failed').replace(/^Empty response/, 'Refinement returned empty output'));
  }
}
```

Remove the top-line `export const REFINE_MODEL = 'gpt-4o';`.

Note: `generateRefinementChips`'s empty-completion case (`data.choices?.[0]?.message?.content` falsy) is now caught inside `llmClient.js` as `'Empty response'`, which the existing `try/catch` around `callChatModel` re-labels via the same `.replace(...)` pattern used elsewhere — add `.replace(/^Empty response/, 'No suggestions returned')` to that catch block too, so the `'throws RefineError on empty response'` test (asserting only `toBeInstanceOf(RefineError)`, not message text) keeps passing regardless.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/refine.test.js`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/refine.js tests/refine.test.js
git commit -m "refactor: route refine.js through llmClient, accept {provider,model,apiKey}"
```

---

### Task 4: `settings.js` — OpenRouter key + per-step provider/model storage

**Files:**
- Modify: `src/settings.js`
- Test: `tests/settings.test.js`

**Interfaces:**
- Produces:
  - `getOpenRouterKey()` / `setOpenRouterKey(key)` / `hasOpenRouterKey()` — storage key `openrouter_api_key`, same shape as the existing key functions.
  - `getCleanupProvider()` / `setCleanupProvider(provider)` — storage key `cleanup_provider`, default `'anthropic'`.
  - `getRefineProvider()` / `setRefineProvider(provider)` — storage key `refine_provider`, default `'openai'`.
  - `getCleanupModel()` / `setCleanupModel(model)` — storage key `cleanup_model`, default `'openrouter/auto'`.
  - `getRefineModel()` / `setRefineModel(model)` — storage key `refine_model`, default `'openrouter/auto'`.

- [ ] **Step 1: Write failing tests**

Append to `tests/settings.test.js` (add `getOpenRouterKey, setOpenRouterKey, hasOpenRouterKey, getCleanupProvider, setCleanupProvider, getRefineProvider, setRefineProvider, getCleanupModel, setCleanupModel, getRefineModel, setRefineModel` to the import):

```js
describe('OpenRouter key storage', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when no key stored', () => {
    expect(getOpenRouterKey()).toBeNull();
    expect(hasOpenRouterKey()).toBe(false);
  });

  it('stores and retrieves a key, trimmed', () => {
    setOpenRouterKey('  sk-or-test-123  ');
    expect(getOpenRouterKey()).toBe('sk-or-test-123');
    expect(hasOpenRouterKey()).toBe(true);
    expect(localStorage.getItem('openrouter_api_key')).toBe('sk-or-test-123');
  });
});

describe('cleanup provider setting', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to anthropic', () => {
    expect(getCleanupProvider()).toBe('anthropic');
  });

  it('persists a chosen provider', () => {
    setCleanupProvider('openrouter');
    expect(getCleanupProvider()).toBe('openrouter');
    expect(localStorage.getItem('cleanup_provider')).toBe('openrouter');
  });
});

describe('refine provider setting', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to openai', () => {
    expect(getRefineProvider()).toBe('openai');
  });

  it('persists a chosen provider', () => {
    setRefineProvider('anthropic');
    expect(getRefineProvider()).toBe('anthropic');
    expect(localStorage.getItem('refine_provider')).toBe('anthropic');
  });
});

describe('cleanup/refine model settings', () => {
  beforeEach(() => localStorage.clear());

  it('default to openrouter/auto', () => {
    expect(getCleanupModel()).toBe('openrouter/auto');
    expect(getRefineModel()).toBe('openrouter/auto');
  });

  it('persist a chosen model independently', () => {
    setCleanupModel('deepseek/deepseek-chat-v3.1:free');
    setRefineModel('meta-llama/llama-3.3-70b-instruct:free');
    expect(getCleanupModel()).toBe('deepseek/deepseek-chat-v3.1:free');
    expect(getRefineModel()).toBe('meta-llama/llama-3.3-70b-instruct:free');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/settings.test.js`
Expected: FAIL — the new functions don't exist yet.

- [ ] **Step 3: Implement in `src/settings.js`**

```js
const OPENROUTER_STORAGE_KEY = 'openrouter_api_key';

export function getOpenRouterKey() {
  return readKey(OPENROUTER_STORAGE_KEY);
}
export function setOpenRouterKey(key) {
  writeKey(OPENROUTER_STORAGE_KEY, key);
}
export function hasOpenRouterKey() {
  return getOpenRouterKey() !== null;
}

function readSetting(storageKey, fallback) {
  try {
    return localStorage.getItem(storageKey) || fallback;
  } catch {
    return fallback;
  }
}

function writeSetting(storageKey, value) {
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    // Storage blocked — no-op.
  }
}

export function getCleanupProvider() {
  return readSetting('cleanup_provider', 'anthropic');
}
export function setCleanupProvider(provider) {
  writeSetting('cleanup_provider', provider);
}

export function getRefineProvider() {
  return readSetting('refine_provider', 'openai');
}
export function setRefineProvider(provider) {
  writeSetting('refine_provider', provider);
}

export function getCleanupModel() {
  return readSetting('cleanup_model', 'openrouter/auto');
}
export function setCleanupModel(model) {
  writeSetting('cleanup_model', model);
}

export function getRefineModel() {
  return readSetting('refine_model', 'openrouter/auto');
}
export function setRefineModel(model) {
  writeSetting('refine_model', model);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/settings.test.js`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings.js tests/settings.test.js
git commit -m "feat: add OpenRouter key and per-step provider/model settings"
```

---

### Task 5: Settings UI markup — provider/model pickers and OpenRouter key field

**Files:**
- Modify: `index.html:126-152` (the `#settings .sheet-body`)
- Modify: `src/styles.css` (add `.field select` rules near `src/styles.css:436-448`)

**Interfaces:**
- Produces (new DOM ids consumed by Task 6):
  - `api-key-openrouter`, `btn-save-key-openrouter`, `key-status-openrouter`
  - `provider-cleanup` (`<select>`), `provider-refine` (`<select>`) — option values `openai` / `anthropic` / `openrouter`
  - `model-row-cleanup`, `model-row-refine` — wrapper `<div>`s toggled hidden/visible depending on the paired provider select
  - `model-cleanup` (`<select>`), `model-refine` (`<select>`) — option values are model ID strings, plus a literal `custom` option
  - `model-custom-cleanup` (`<input type="text">`), `model-custom-refine` (`<input type="text">`) — shown only when the paired model select is set to `custom`

- [ ] **Step 1: Add the OpenRouter key field**

In `index.html`, after the existing Anthropic key `.field` (ends at line 138) and before the Noise suppression `.field`:

```html
<div class="field">
  <label for="api-key-openrouter">OpenRouter API key</label>
  <input id="api-key-openrouter" type="password" autocomplete="off" placeholder="sk-or-••••••••••••••" />
  <button id="btn-save-key-openrouter" class="btn btn-primary btn-block" type="button">Save key</button>
  <p id="key-status-openrouter" class="hint hint-tight"></p>
</div>
```

- [ ] **Step 2: Add the Cleanup and Refine provider/model pickers**

Immediately after the OpenRouter key field added in Step 1:

```html
<div class="field">
  <label for="provider-cleanup">Cleanup provider</label>
  <select id="provider-cleanup">
    <option value="anthropic">Anthropic</option>
    <option value="openai">OpenAI</option>
    <option value="openrouter">OpenRouter</option>
  </select>
  <div id="model-row-cleanup" hidden>
    <select id="model-cleanup">
      <option value="openrouter/auto">Auto (let OpenRouter choose)</option>
      <option value="meta-llama/llama-3.3-70b-instruct:free">Llama 3.3 70B (free)</option>
      <option value="deepseek/deepseek-chat-v3.1:free">DeepSeek Chat v3.1 (free)</option>
      <option value="google/gemini-2.0-flash-001">Gemini 2.0 Flash</option>
      <option value="custom">Custom…</option>
    </select>
    <input id="model-custom-cleanup" type="text" autocomplete="off" placeholder="e.g. mistralai/mistral-small" hidden />
  </div>
</div>
<div class="field">
  <label for="provider-refine">Refine provider</label>
  <select id="provider-refine">
    <option value="openai">OpenAI</option>
    <option value="anthropic">Anthropic</option>
    <option value="openrouter">OpenRouter</option>
  </select>
  <div id="model-row-refine" hidden>
    <select id="model-refine">
      <option value="openrouter/auto">Auto (let OpenRouter choose)</option>
      <option value="meta-llama/llama-3.3-70b-instruct:free">Llama 3.3 70B (free)</option>
      <option value="deepseek/deepseek-chat-v3.1:free">DeepSeek Chat v3.1 (free)</option>
      <option value="google/gemini-2.0-flash-001">Gemini 2.0 Flash</option>
      <option value="custom">Custom…</option>
    </select>
    <input id="model-custom-refine" type="text" autocomplete="off" placeholder="e.g. mistralai/mistral-small" hidden />
  </div>
</div>
```

- [ ] **Step 3: Update the sheet's explanatory note**

Replace the existing `<p class="sheet-note">` (currently `index.html:146-151`) with:

```html
<p class="sheet-note">
  Voice Note records audio and transcribes it with gpt&#8209;4o&#8209;transcribe (OpenAI). Cleanup
  and Refine can each independently use OpenAI, Anthropic, or OpenRouter (including free/low-cost
  models) — pick per step above. Everything runs on your own API keys — nothing is stored except
  in your browser.
</p>
```

- [ ] **Step 4: Add matching CSS for `<select>`**

In `src/styles.css`, immediately after the `.field input` rules (around line 448):

```css
.field select {
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-neutral-700);
  background: var(--color-neutral-900);
  color: var(--color-text);
  font: 400 13px/1.4 var(--font-body);
  margin-bottom: 12px;
}
.field select:focus-visible { border-color: var(--color-accent); outline: none; }
```

- [ ] **Step 5: Manually verify markup renders**

Run: `npm run dev`, open the app in a browser, tap Settings.
Expected: OpenRouter key field, Cleanup provider dropdown, Refine provider dropdown all visible; both model rows are hidden by default (no `onchange` wiring yet, so this is just confirming the markup/CSS renders without layout breakage — the model row will not yet show/hide on selection until Task 6).

- [ ] **Step 6: Commit**

```bash
git add index.html src/styles.css
git commit -m "feat: add OpenRouter key field and provider/model pickers to Settings UI"
```

---

### Task 6: `app.js` — wire provider/model resolution and Settings UI behavior

**Files:**
- Modify: `src/app.js`

**Interfaces:**
- Consumes: all functions from Task 4 (`settings.js`), the updated `cleanup()` signature from Task 2, the updated `generateRefinementChips`/`applyRefinement` signatures from Task 3, and the DOM ids from Task 5.

- [ ] **Step 1: Add imports and default-model lookup**

In `src/app.js`, extend the `settings.js` import block (currently lines 7-11):

```js
import {
  getOpenAIKey, setOpenAIKey, hasOpenAIKey,
  getAnthropicKey, setAnthropicKey, hasAnthropicKey,
  getOpenRouterKey, setOpenRouterKey, hasOpenRouterKey,
  getCleanupProvider, setCleanupProvider, getCleanupModel, setCleanupModel,
  getRefineProvider, setRefineProvider, getRefineModel, setRefineModel,
  getNoiseSuppressionEnabled, setNoiseSuppressionEnabled,
} from './settings.js';
```

Add near the top of the file (after the existing top-level `let`/`const` declarations, e.g. after line 32):

```js
// Model used when a step's provider is switched to 'openai'/'anthropic' directly
// (as opposed to 'openrouter', where the model comes from settings).
const DEFAULT_MODEL = { openai: 'gpt-4o', anthropic: 'claude-sonnet-5' };

function hasKeyFor(provider) {
  if (provider === 'openai') return hasOpenAIKey();
  if (provider === 'anthropic') return hasAnthropicKey();
  return hasOpenRouterKey();
}

function keyFor(provider) {
  if (provider === 'openai') return getOpenAIKey();
  if (provider === 'anthropic') return getAnthropicKey();
  return getOpenRouterKey();
}

function resolveStep(provider, model) {
  return {
    provider,
    model: provider === 'openrouter' ? model : DEFAULT_MODEL[provider],
    apiKey: keyFor(provider),
  };
}
```

- [ ] **Step 2: Update `runCleanup()` and the two `refine.js` call sites**

Replace line 188 (inside `runCleanup()`):

```js
const text = await cleanup(
  restoreLoanwords(state.rawTranscript),
  state.language,
  resolveStep(getCleanupProvider(), getCleanupModel())
);
```

Replace the `generateRefinementChips` call (currently lines 344-348):

```js
refineChips = await generateRefinementChips(
  $('result-text').value,
  state.language ?? 'en',
  resolveStep(getRefineProvider(), getRefineModel())
);
```

Replace the `applyRefinement` call (currently lines 365-370):

```js
const refined = await applyRefinement(
  $('result-text').value,
  state.language ?? 'en',
  chip.instruction,
  resolveStep(getRefineProvider(), getRefineModel())
);
```

- [ ] **Step 3: Add the OpenRouter key save handler**

After the existing `btn-save-key-anthropic` handler (currently ending at line 407):

```js
$('btn-save-key-openrouter').onclick = () => {
  setOpenRouterKey($('api-key-openrouter').value);
  const saved = hasOpenRouterKey();
  $('api-key-openrouter').value = '';
  render();
  $('key-status-openrouter').textContent = saved ? 'Key saved ✓' : 'Key cleared';
};
```

- [ ] **Step 4: Wire the provider/model selects**

Immediately after the handler added in Step 3:

```js
function wireProviderPicker(step, { providerSelect, providerGetter, providerSetter, modelRow, modelSelect, modelGetter, modelSetter, customInput }) {
  const savedProvider = providerGetter();
  providerSelect.value = savedProvider;
  modelRow.hidden = savedProvider !== 'openrouter';

  const savedModel = modelGetter();
  const isCurated = Array.from(modelSelect.options).some((o) => o.value === savedModel);
  modelSelect.value = isCurated ? savedModel : 'custom';
  customInput.hidden = modelSelect.value !== 'custom';
  customInput.value = isCurated ? '' : savedModel;

  providerSelect.onchange = () => {
    providerSetter(providerSelect.value);
    modelRow.hidden = providerSelect.value !== 'openrouter';
  };

  modelSelect.onchange = () => {
    customInput.hidden = modelSelect.value !== 'custom';
    if (modelSelect.value !== 'custom') modelSetter(modelSelect.value);
  };

  customInput.oninput = () => {
    if (modelSelect.value === 'custom' && customInput.value.trim()) {
      modelSetter(customInput.value.trim());
    }
  };
}

wireProviderPicker('cleanup', {
  providerSelect: $('provider-cleanup'),
  providerGetter: getCleanupProvider,
  providerSetter: setCleanupProvider,
  modelRow: $('model-row-cleanup'),
  modelSelect: $('model-cleanup'),
  modelGetter: getCleanupModel,
  modelSetter: setCleanupModel,
  customInput: $('model-custom-cleanup'),
});

wireProviderPicker('refine', {
  providerSelect: $('provider-refine'),
  providerGetter: getRefineProvider,
  providerSetter: setRefineProvider,
  modelRow: $('model-row-refine'),
  modelSelect: $('model-refine'),
  modelGetter: getRefineModel,
  modelSetter: setRefineModel,
  customInput: $('model-custom-refine'),
});
```

- [ ] **Step 5: Show the OpenRouter key status on render**

In `render()`, extend the block at lines 85-91:

```js
$('key-status-openai').textContent = hasOpenAIKey() ? 'Key saved ✓' : '';
$('key-status-anthropic').textContent = hasAnthropicKey() ? 'Key saved ✓' : '';
$('key-status-openrouter').textContent = hasOpenRouterKey() ? 'Key saved ✓' : '';
```

- [ ] **Step 6: Manually verify in the browser**

Run: `npm run dev`, open the app.

1. Settings → set an OpenAI key, record a short note, confirm transcription still works (unaffected by this change).
2. In Settings, leave Cleanup provider at its default (Anthropic) with an Anthropic key saved — confirm cleanup still runs exactly as before.
3. Switch Cleanup provider to OpenRouter, save an OpenRouter key, pick "Auto" — confirm cleanup runs via OpenRouter (check the Network tab for a request to `openrouter.ai`) and produces a cleaned transcript.
4. Switch Cleanup provider to OpenRouter, pick a specific curated model (e.g. the Llama free model) — confirm the request body's `model` field matches.
5. Switch Cleanup provider to OpenRouter, pick "Custom…", type an arbitrary model ID — confirm it's used and persists after closing/reopening Settings.
6. Repeat steps 3-5 for the Refine provider (open the refine panel on a result, confirm chips generate and apply through OpenRouter).
7. Remove the OpenRouter key while a step is set to OpenRouter — confirm that step's action reports an error (via the existing `CleanupError`/`RefineError` → inline status text path) rather than crashing.
8. Reload the page — confirm all four settings (both providers, both models) persisted via `localStorage`.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: all tests PASS (Tasks 1-4's suites plus every pre-existing test untouched by this plan).

- [ ] **Step 8: Commit**

```bash
git add src/app.js
git commit -m "feat: wire per-step provider/model selection into app.js"
```

---

## Self-Review Notes

- **Spec coverage:** `llmClient.js` (Task 1) ✓, `cleanup.js`/`refine.js` refactor (Tasks 2-3) ✓, `settings.js` additions (Task 4) ✓, Settings UI incl. curated models + Auto + Custom (Task 5) ✓, `app.js` wiring incl. gating/error surfacing (Task 6) ✓, transcription left untouched ✓ (no task modifies `transcribe.js`).
- **Type consistency:** `{provider, model, apiKey}` is the exact shape threaded through `cleanup()`, `generateRefinementChips()`, `applyRefinement()`, and `resolveStep()` — verified consistent across Tasks 2, 3, and 6.
- **No placeholders:** every step has literal code; manual verification steps (Task 5 Step 5, Task 6 Step 6) are explicit numbered checks, not "test appropriately" placeholders, matching the app's existing lack of DOM-level automated tests.
