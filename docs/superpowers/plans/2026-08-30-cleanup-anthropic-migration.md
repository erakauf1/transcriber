# Cleanup: Migrate to Anthropic Claude Sonnet 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move transcript cleanup from OpenAI `gpt-4o` Chat Completions to Anthropic `claude-sonnet-5` Messages API, with few-shot examples targeting the two known failure modes (leftover disfluencies, name/place corruption), while transcription and the `refine.js` chip feature stay on OpenAI.

**Architecture:** `src/settings.js` splits its single generic API-key store into two independent named stores (OpenAI, Anthropic), leaving its noise-suppression-toggle functions untouched. `src/cleanup.js` swaps its request/response handling from OpenAI's Chat Completions shape to Anthropic's Messages shape and gains a fixed few-shot preamble in the `messages` array, while keeping its existing `buildSystemPrompt` content (bullet-formatting and no-trailing-period rules included) unchanged. `index.html` gains a second key input; `src/app.js` wires both keys to their respective calls — including `refine.js`'s two OpenAI call sites, which move from the old shared `getApiKey()` to the new `getOpenAIKey()` — with a missing Anthropic key falling into the cleanup module's existing `CleanupError` fallback path (no new UI state).

**Tech Stack:** Vanilla JS (ES modules), Vitest, `fetch`, no framework.

**Note on base branch:** This plan was drafted against a stale local `main` and then corrected once the isolated worktree (correctly) branched from the real, much-further-along `origin/main` — which already includes `src/refine.js`, the noise-suppression/VAD audio pipeline, and cleanup-prompt formatting changes. All file contents, line numbers, and code blocks below are verified against that actual current codebase.

## Global Constraints

- `CLEANUP_MODEL = 'claude-sonnet-5'` (spec decision: cost/quality fit for a bounded transformation task; upgrading to `claude-opus-5` later is a one-line change if needed).
- `TRANSCRIBE_MODEL` (`gpt-4o-transcribe`) and `REFINE_MODEL` (`gpt-4o`) are untouched — Claude has no audio transcription, and the refinement-chip feature is out of scope for this migration.
- Anthropic Messages API: `POST https://api.anthropic.com/v1/messages`, headers `x-api-key` and `anthropic-version: 2023-06-01`, body requires `max_tokens` (use `4096` — cleanup only ever shrinks text and transcripts are short-to-medium).
- Recording stays gated on the OpenAI key only; the Anthropic key is optional. A missing Anthropic key must produce the same fallback as any other `CleanupError` (raw transcript, auto-copied) — no new error UI.
- `temperature: 0` is preserved (pinned rationale: nonzero temperature was measured to cause the model to "repair" a malformed name into a different real one).
- `buildSystemPrompt`'s existing content (language lock, name-preservation rules, bullet-list/paragraph formatting, no-trailing-period rule) is carried over verbatim — this migration changes the transport and adds few-shot examples, not the rules themselves.
- No env var or settings-UI control for the model — stays a hardcoded constant, matching the existing pattern.
- `fixtures/transcripts.json` format is unchanged; few-shot examples are hardcoded in `cleanup.js`, not sourced from fixtures.
- `src/settings.js`'s noise-suppression functions (`getNoiseSuppressionEnabled`, `setNoiseSuppressionEnabled`, storage key `noiseSuppressionEnabled`) and `tests/settings.test.js`'s `describe('noise suppression setting', ...)` block are unrelated to this migration and must be preserved unchanged.

---

### Task 1: Split settings.js into OpenAI/Anthropic key stores

**Files:**
- Modify: `src/settings.js` (full rewrite, currently 45 lines — key-store functions plus an unrelated noise-suppression toggle)
- Test: `tests/settings.test.js` (full rewrite, currently 47 lines — key-store tests plus an unrelated noise-suppression describe block)

**Interfaces:**
- Produces: `getOpenAIKey(): string|null`, `setOpenAIKey(key: string): void`, `hasOpenAIKey(): boolean`, `getAnthropicKey(): string|null`, `setAnthropicKey(key: string): void`, `hasAnthropicKey(): boolean` — all exported from `src/settings.js`. Storage keys: `'openai_api_key'` (unchanged) and `'anthropic_api_key'` (new). Also re-exports (unchanged) `getNoiseSuppressionEnabled(): boolean` and `setNoiseSuppressionEnabled(enabled: boolean): void`.
- Consumes: nothing (no dependency on other tasks).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `tests/settings.test.js` with:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getOpenAIKey, setOpenAIKey, hasOpenAIKey,
  getAnthropicKey, setAnthropicKey, hasAnthropicKey,
  getNoiseSuppressionEnabled, setNoiseSuppressionEnabled,
} from '../src/settings.js';

describe('OpenAI key storage', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when no key stored', () => {
    expect(getOpenAIKey()).toBeNull();
    expect(hasOpenAIKey()).toBe(false);
  });

  it('stores and retrieves a key, trimmed', () => {
    setOpenAIKey('  sk-test-123  ');
    expect(getOpenAIKey()).toBe('sk-test-123');
    expect(hasOpenAIKey()).toBe(true);
    expect(localStorage.getItem('openai_api_key')).toBe('sk-test-123');
  });

  it('setting an empty/whitespace key clears storage', () => {
    setOpenAIKey('sk-test-123');
    setOpenAIKey('   ');
    expect(getOpenAIKey()).toBeNull();
    expect(localStorage.getItem('openai_api_key')).toBeNull();
  });
});

describe('Anthropic key storage', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when no key stored', () => {
    expect(getAnthropicKey()).toBeNull();
    expect(hasAnthropicKey()).toBe(false);
  });

  it('stores and retrieves a key, trimmed', () => {
    setAnthropicKey('  sk-ant-test-123  ');
    expect(getAnthropicKey()).toBe('sk-ant-test-123');
    expect(hasAnthropicKey()).toBe(true);
    expect(localStorage.getItem('anthropic_api_key')).toBe('sk-ant-test-123');
  });

  it('setting an empty/whitespace key clears storage', () => {
    setAnthropicKey('sk-ant-test-123');
    setAnthropicKey('   ');
    expect(getAnthropicKey()).toBeNull();
    expect(localStorage.getItem('anthropic_api_key')).toBeNull();
  });

  it('is independent from the OpenAI key', () => {
    setOpenAIKey('sk-openai');
    expect(getAnthropicKey()).toBeNull();
    expect(hasAnthropicKey()).toBe(false);
  });
});

describe('noise suppression setting', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to true when nothing stored', () => {
    expect(getNoiseSuppressionEnabled()).toBe(true);
  });

  it('persists false', () => {
    setNoiseSuppressionEnabled(false);
    expect(getNoiseSuppressionEnabled()).toBe(false);
    expect(localStorage.getItem('noiseSuppressionEnabled')).toBe('false');
  });

  it('persists true', () => {
    setNoiseSuppressionEnabled(false);
    setNoiseSuppressionEnabled(true);
    expect(getNoiseSuppressionEnabled()).toBe(true);
    expect(localStorage.getItem('noiseSuppressionEnabled')).toBe('true');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/settings.test.js`
Expected: FAIL — `getOpenAIKey` (and the other new key-store names) are not exported from `src/settings.js`.

- [ ] **Step 3: Rewrite settings.js**

Replace the full contents of `src/settings.js` with:

```js
const OPENAI_STORAGE_KEY = 'openai_api_key';
const ANTHROPIC_STORAGE_KEY = 'anthropic_api_key';

function readKey(storageKey) {
  try {
    const value = (localStorage.getItem(storageKey) || '').trim();
    return value || null;
  } catch {
    // Storage blocked (e.g. Safari "Block All Cookies") — behave as if no key is saved.
    return null;
  }
}

function writeKey(storageKey, key) {
  try {
    const value = (key || '').trim();
    if (value) localStorage.setItem(storageKey, value);
    else localStorage.removeItem(storageKey);
  } catch {
    // Storage blocked — no-op.
  }
}

export function getOpenAIKey() {
  return readKey(OPENAI_STORAGE_KEY);
}
export function setOpenAIKey(key) {
  writeKey(OPENAI_STORAGE_KEY, key);
}
export function hasOpenAIKey() {
  return getOpenAIKey() !== null;
}

export function getAnthropicKey() {
  return readKey(ANTHROPIC_STORAGE_KEY);
}
export function setAnthropicKey(key) {
  writeKey(ANTHROPIC_STORAGE_KEY, key);
}
export function hasAnthropicKey() {
  return getAnthropicKey() !== null;
}

const NS_KEY = 'noiseSuppressionEnabled';

export function getNoiseSuppressionEnabled() {
  try {
    const val = localStorage.getItem(NS_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export function setNoiseSuppressionEnabled(enabled) {
  try {
    localStorage.setItem(NS_KEY, String(!!enabled));
  } catch {
    // Storage blocked — no-op.
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/settings.test.js`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/settings.js tests/settings.test.js
git commit -m "refactor: split settings into separate OpenAI and Anthropic key stores"
```

---

### Task 2: Migrate cleanup.js to the Anthropic Messages API with few-shot examples

**Files:**
- Modify: `src/cleanup.js` (full rewrite, currently 75 lines)
- Modify: `tests/cleanup.test.js` (`describe('cleanup', ...)` block only, lines 65-95 — `describe('buildSystemPrompt', ...)`, lines 8-63, is unchanged since `buildSystemPrompt`'s content is not changing)
- Modify: `scripts/prompt-check.js` (env var rename only)

**Interfaces:**
- Consumes: nothing from Task 1 (this task takes an `apiKey` parameter; Task 3 decides which store it's read from).
- Produces: `cleanup(text: string, language: string, apiKey: string|null): Promise<string>` (same signature as before — `apiKey` may now be `null`, which throws synchronously), `CLEANUP_MODEL = 'claude-sonnet-5'`, `CleanupError` (unchanged), `buildSystemPrompt(language: string): string` (unchanged content and signature).

- [ ] **Step 1: Write the failing tests**

Replace the `describe('cleanup', ...)` block in `tests/cleanup.test.js` (lines 65-95) with:

```js
describe('cleanup', () => {
  it('posts system + few-shot + user messages to the Anthropic Messages API and trims the reply', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ content: [{ text: '  נקי לגמרי  ' }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await cleanup('טקסט גולמי', 'he', 'sk-ant-test');

    expect(out).toBe('נקי לגמרי');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.headers['x-api-key']).toBe('sk-ant-test');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');

    const body = JSON.parse(opts.body);
    expect(body.model).toBe(CLEANUP_MODEL);
    expect(body.max_tokens).toBe(4096);
    // Pinned: nonzero temperature was measured to cause name substitution
    expect(body.temperature).toBe(0);
    expect(body.system).toBe(buildSystemPrompt('he'));

    // Few-shot examples precede the real message and alternate user/assistant
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'טקסט גולמי' });
    const fewShot = body.messages.slice(0, -1);
    expect(fewShot.length).toBeGreaterThan(0);
    fewShot.forEach((m, i) => {
      expect(m.role).toBe(i % 2 === 0 ? 'user' : 'assistant');
    });
  });

  it('uses English few-shot examples for English transcripts', async () => {
    const fetchMock = vi.fn(async () => okResponse({ content: [{ text: 'clean' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await cleanup('raw text', 'en', 'sk-ant-test');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const fewShot = body.messages.slice(0, -1);
    expect(fewShot.every((m) => /^[\x00-\x7F\s.,'-]*$/.test(m.content))).toBe(true);
  });

  it('throws CleanupError without calling fetch when no API key is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(cleanup('x', 'he', null)).rejects.toBeInstanceOf(CleanupError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws CleanupError on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(cleanup('x', 'he', 'sk-ant-test')).rejects.toBeInstanceOf(CleanupError);
  });

  it('throws CleanupError on empty completion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ content: [] })));
    await expect(cleanup('x', 'he', 'sk-ant-test')).rejects.toBeInstanceOf(CleanupError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/cleanup.test.js`
Expected: FAIL — current implementation posts to `api.openai.com`, uses `Authorization: Bearer`, and never checks for a null `apiKey`.

- [ ] **Step 3: Rewrite cleanup.js**

Replace the full contents of `src/cleanup.js` with:

```js
export const CLEANUP_MODEL = 'claude-sonnet-5';

export class CleanupError extends Error {}

const LANGUAGE_NAMES = { he: 'Hebrew', en: 'English' };

export function buildSystemPrompt(language) {
  const lang = LANGUAGE_NAMES[language] || 'English';
  return [
    `You clean up voice-note transcripts so they can be sent as chat messages.`,
    `The message is in ${lang}. Your entire output must be in ${lang}.`,
    `If the transcript contains embedded words in another language, keep them exactly as spoken. Never translate anything.`,
    `Some words may already be written in Latin letters inside the message. Leave them exactly as they are — do not convert them to the local script, and do not respell them.`,
    // Deliberately absent: any instruction to rewrite words that "look transliterated".
    // That mandate was measured to make the model occasionally rewrite a malformed
    // place name into a different real city. Transliteration is now undone
    // deterministically in src/loanwords.js, before this prompt ever sees the text.
    `Never change a name of a person or place — not its script, not its spelling, and never to a different name, even if it looks misspelled or reads awkwardly in context. A wrong name is worse than an awkward one. Leave ordinary words of the message's own language exactly as they are.`,
    ``,
    `Do:`,
    `- Remove filler words (um, uh, like, אמם, אה, כאילו), false starts, and repeated words`,
    `- Fix grammar and punctuation. Pay close attention to prepositions, definite articles, and date and number expressions — speech-to-text output is most often malformed there`,
    `- Merge rambling fragments into complete sentences`,
    `- If the speaker circles back to an earlier topic, fold that remark into where it belongs`,
    `- Drop pure detours that are not part of the message (e.g. "wait, someone's at the door")`,
    `- Add paragraph breaks (blank lines) between distinct topics or thoughts`,
    `- When the speaker lists items, steps, tasks, options, or action items, format them as a bulleted list using "• " (bullet + space) at the start of each item, one item per line`,
    `- If a list has a lead-in phrase (e.g. "we need to:" or "a few things:"), keep it on its own line followed by the bullets`,
    `- Use a single line break (not a blank line) to separate closely related but distinct statements within the same topic — e.g. a decision and its reason, a question and its context`,
    `- Don’t cram everything into one dense block — when in doubt, break into shorter lines rather than long paragraphs`,
    ``,
    `Don't:`,
    `- Don't translate anything`,
    `- Don't change slang or personal tone into formal writing`,
    `- Don't add content, greetings, or sign-offs that were not spoken`,
    `- Don't add a period at the end of the message — this is a chat message, not a formal document`,
    `- Don't summarize — keep the same message, just tighter`,
    ``,
    `Output only the cleaned message. No preamble, no quotes, no explanations.`,
  ].join('\n');
}

// Fixed few-shot examples, one pair per language, shown to the model before the real
// transcript. They demonstrate the exact do-this/never-that tension the rules above
// describe: fix disfluent grammar aggressively, but never touch a name even when it
// looks odd. Anchoring with a worked example is more reliable than stating the rules
// as prohibitions alone — this is the direct response to the known רעננה→הרצליה
// name-substitution bug (see the comment in buildSystemPrompt above).
const FEW_SHOT_EXAMPLES = {
  he: [
    { role: 'user', content: 'אה אז אני חושב ש- שנצטרך לדחות את זה, את הפגישה, ליום שלישי כי, כי יש לי משהו' },
    { role: 'assistant', content: 'אני חושב שנצטרך לדחות את הפגישה ליום שלישי כי יש לי משהו.' },
    { role: 'user', content: 'אני עדיין ברעננה, אה, ניפגש שם בשמונה' },
    { role: 'assistant', content: 'אני עדיין ברעננה, ניפגש שם בשמונה.' },
  ],
  en: [
    { role: 'user', content: 'so um I think we should, we should probably push the meeting to, to Tuesday because I have this thing' },
    { role: 'assistant', content: 'I think we should push the meeting to Tuesday because I have this thing.' },
    { role: 'user', content: "I'm still in Raanana, let's meet there at eight" },
    { role: 'assistant', content: "I'm still in Raanana, let's meet there at eight." },
  ],
};

function buildFewShotMessages(language) {
  return FEW_SHOT_EXAMPLES[language] || FEW_SHOT_EXAMPLES.en;
}

export async function cleanup(text, language, apiKey) {
  if (!apiKey) throw new CleanupError('No Anthropic API key configured');

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CLEANUP_MODEL,
        max_tokens: 4096,
        // Zero, not merely low: sampling randomness was measured to make the model
        // occasionally "repair" a malformed place name into a different real city
        // (רעננה -> הרצליה). Determinism is what a faithful-cleanup task wants.
        temperature: 0,
        system: buildSystemPrompt(language),
        messages: [...buildFewShotMessages(language), { role: 'user', content: text }],
      }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (err) {
    throw new CleanupError(`Network error: ${err.message}`);
  }
  if (!res.ok) throw new CleanupError(`Cleanup failed (HTTP ${res.status})`);

  const data = await res.json();
  const out = data.content?.[0]?.text?.trim();
  if (!out) throw new CleanupError('Cleanup returned empty output');
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/cleanup.test.js`
Expected: PASS (all `buildSystemPrompt` tests plus the 5 `cleanup` tests above)

- [ ] **Step 5: Update prompt-check.js's env var**

In `scripts/prompt-check.js`, replace:

```js
// Semi-manual prompt check: runs every fixture through the real cleanup API
// and prints raw vs cleaned for human review. Not pass/fail — eyeball it.
// Usage: OPENAI_API_KEY=sk-... npm run prompt-check
import { readFileSync } from 'node:fs';
import { cleanup } from '../src/cleanup.js';
import { detectLanguage } from '../src/language.js';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('Set OPENAI_API_KEY first: OPENAI_API_KEY=sk-... npm run prompt-check');
  process.exit(1);
}
```

with:

```js
// Semi-manual prompt check: runs every fixture through the real cleanup API
// and prints raw vs cleaned for human review. Not pass/fail — eyeball it.
// Usage: ANTHROPIC_API_KEY=sk-ant-... npm run prompt-check
import { readFileSync } from 'node:fs';
import { cleanup } from '../src/cleanup.js';
import { detectLanguage } from '../src/language.js';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Set ANTHROPIC_API_KEY first: ANTHROPIC_API_KEY=sk-ant-... npm run prompt-check');
  process.exit(1);
}
```

If the actual current file differs slightly in wording from the "replace" block above (it was last touched before this migration was scoped), match on the `const apiKey = process.env.OPENAI_API_KEY;` line and the two strings `OPENAI_API_KEY` / `OPENAI_API_KEY=sk-...` and update only those — the `for` loop over fixtures below is unchanged either way.

- [ ] **Step 6: Commit**

```bash
git add src/cleanup.js tests/cleanup.test.js scripts/prompt-check.js
git commit -m "feat: migrate cleanup to Anthropic Claude Sonnet 5 with few-shot examples"
```

---

### Task 3: Wire two-key Settings UI into app.js and index.html

**Files:**
- Modify: `index.html:127-143`
- Modify: `src/app.js` (import line 7; `render()` lines 77-86; `runTranscription()` line 172; `runCleanup()` line 183; `$('btn-refine').onclick` handler around line 342; `handleChipClick()` around line 364; save-key handler lines 385-394)

**Interfaces:**
- Consumes: `getOpenAIKey, setOpenAIKey, hasOpenAIKey, getAnthropicKey, setAnthropicKey, hasAnthropicKey` from `src/settings.js` (Task 1) — alongside the pre-existing `getNoiseSuppressionEnabled, setNoiseSuppressionEnabled`, which stay imported and untouched. `cleanup(text, language, apiKey)` from `src/cleanup.js` (Task 2), which now throws `CleanupError` when `apiKey` is `null` — `runCleanup()`'s existing `catch` block already handles that as the raw-transcript fallback, so no new branching is needed there.
- Produces: nothing consumed by other tasks — this is the last task.

No new automated tests: `app.js` has no existing test file (UI wiring is currently verified manually), so this task is verified by running the dev server and exercising Settings by hand, plus the full `npm test` suite to confirm Tasks 1-2 didn't regress.

- [ ] **Step 1: Update the Settings markup in index.html**

Replace lines 127-143 of `index.html`:

```html
        <div class="field">
          <label for="api-key">OpenAI API key</label>
          <input id="api-key" type="password" autocomplete="off" placeholder="sk-••••••••••••••" />
          <button id="btn-save-key" class="btn btn-primary btn-block" type="button">Save key</button>
          <p id="key-status" class="hint hint-tight"></p>
        </div>
        <div class="field">
          <label for="ns-toggle">Noise suppression</label>
          <div class="toggle-row">
            <input id="ns-toggle" type="checkbox" role="switch" />
            <span id="ns-label" class="hint-tight">Reduces background noise for cleaner transcriptions</span>
          </div>
        </div>
        <p class="sheet-note">
          Voice Note records audio, transcribes it with gpt&#8209;4o&#8209;transcribe, and cleans up
          filler words with GPT&#8209;4o. Everything runs on your own API key — nothing is stored.
        </p>
```

with:

```html
        <div class="field">
          <label for="api-key-openai">OpenAI API key</label>
          <input id="api-key-openai" type="password" autocomplete="off" placeholder="sk-••••••••••••••" />
          <button id="btn-save-key-openai" class="btn btn-primary btn-block" type="button">Save key</button>
          <p id="key-status-openai" class="hint hint-tight"></p>
        </div>
        <div class="field">
          <label for="api-key-anthropic">Anthropic API key</label>
          <input id="api-key-anthropic" type="password" autocomplete="off" placeholder="sk-ant-••••••••••••••" />
          <button id="btn-save-key-anthropic" class="btn btn-primary btn-block" type="button">Save key</button>
          <p id="key-status-anthropic" class="hint hint-tight"></p>
        </div>
        <div class="field">
          <label for="ns-toggle">Noise suppression</label>
          <div class="toggle-row">
            <input id="ns-toggle" type="checkbox" role="switch" />
            <span id="ns-label" class="hint-tight">Reduces background noise for cleaner transcriptions</span>
          </div>
        </div>
        <p class="sheet-note">
          Voice Note records audio and transcribes it with gpt&#8209;4o&#8209;transcribe (OpenAI), then
          cleans up filler words with Claude Sonnet 5 (Anthropic). Everything runs on your own API
          keys — nothing is stored except in your browser. The Anthropic key is optional: without
          it you'll get the raw transcript instead of a cleaned-up one.
        </p>
```

The `ns-toggle` field is repeated verbatim in both blocks above — it is not changing, only moving to sit after the two key fields instead of after one.

- [ ] **Step 2: Update the import and record-gating in app.js**

Replace line 7:

```js
import { getApiKey, setApiKey, hasApiKey, getNoiseSuppressionEnabled, setNoiseSuppressionEnabled } from './settings.js';
```

with:

```js
import {
  getOpenAIKey, setOpenAIKey, hasOpenAIKey,
  getAnthropicKey, setAnthropicKey, hasAnthropicKey,
  getNoiseSuppressionEnabled, setNoiseSuppressionEnabled,
} from './settings.js';
```

Replace lines 77-86:

```js
  $('btn-record').disabled = !hasApiKey();
  $('idle-hint').textContent = hasApiKey()
    ? 'Up to 5 minutes'
    : 'Add your OpenAI API key in Settings first';
  if (state.phase === 'idle') {
    // Reflects saved-key state on load and on every idle render. This also
    // overwrites the save handler's one-shot "Key cleared" message on the
    // very next render — acceptable, since hasApiKey() === false already
    // implies no key is saved.
    $('key-status').textContent = hasApiKey() ? 'Key saved ✓' : '';
  }
```

with:

```js
  $('btn-record').disabled = !hasOpenAIKey();
  $('idle-hint').textContent = hasOpenAIKey()
    ? 'Up to 5 minutes'
    : 'Add your OpenAI API key in Settings first';
  if (state.phase === 'idle') {
    // Reflects saved-key state on load and on every idle render. This also
    // overwrites the save handler's one-shot "Key cleared" message on the
    // very next render — acceptable, since hasOpenAIKey()/hasAnthropicKey()
    // === false already implies no key is saved.
    $('key-status-openai').textContent = hasOpenAIKey() ? 'Key saved ✓' : '';
    $('key-status-anthropic').textContent = hasAnthropicKey() ? 'Key saved ✓' : '';
  }
```

- [ ] **Step 3: Point transcription and cleanup at their own keys**

In `runTranscription()`, replace:

```js
    const text = await transcribe(state.audioBlob, getApiKey());
```

with:

```js
    const text = await transcribe(state.audioBlob, getOpenAIKey());
```

In `runCleanup()`, replace:

```js
    const text = await cleanup(restoreLoanwords(state.rawTranscript), state.language, getApiKey());
```

with:

```js
    const text = await cleanup(restoreLoanwords(state.rawTranscript), state.language, getAnthropicKey());
```

- [ ] **Step 4: Point the refine-chip feature at the OpenAI key**

`src/refine.js` (out of scope for this migration — see the spec's "Out of scope" section) stays on OpenAI, so its two call sites in `app.js` move from the removed `getApiKey()` to `getOpenAIKey()`.

In the `$('btn-refine').onclick` handler, replace:

```js
      refineChips = await generateRefinementChips(
        $('result-text').value,
        state.language ?? 'en',
        getApiKey()
      );
```

with:

```js
      refineChips = await generateRefinementChips(
        $('result-text').value,
        state.language ?? 'en',
        getOpenAIKey()
      );
```

In `handleChipClick()`, replace:

```js
    const refined = await applyRefinement(
      $('result-text').value,
      state.language ?? 'en',
      chip.instruction,
      getApiKey()
    );
```

with:

```js
    const refined = await applyRefinement(
      $('result-text').value,
      state.language ?? 'en',
      chip.instruction,
      getOpenAIKey()
    );
```

- [ ] **Step 5: Replace the single save-key handler with two independent ones**

Replace:

```js
$('btn-save-key').onclick = () => {
  setApiKey($('api-key').value);
  const saved = hasApiKey();
  $('api-key').value = '';
  // Close on a successful save — the sheet's only job is done. Clearing the
  // key keeps it open so the status line is actually readable.
  settingsOpen = !saved;
  render();
  $('key-status').textContent = saved ? 'Key saved ✓' : 'Key cleared';
};
```

with:

```js
$('btn-save-key-openai').onclick = () => {
  setOpenAIKey($('api-key-openai').value);
  const saved = hasOpenAIKey();
  $('api-key-openai').value = '';
  // Two independent key fields now share the sheet, so a single save no
  // longer implies "the sheet's job is done" — leave it open either way and
  // let the user tap Done themselves.
  render();
  $('key-status-openai').textContent = saved ? 'Key saved ✓' : 'Key cleared';
};

$('btn-save-key-anthropic').onclick = () => {
  setAnthropicKey($('api-key-anthropic').value);
  const saved = hasAnthropicKey();
  $('api-key-anthropic').value = '';
  render();
  $('key-status-anthropic').textContent = saved ? 'Key saved ✓' : 'Key cleared';
};
```

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites, including the Task 1/2 rewrites, with no regressions in `state.test.js`, `language.test.js`, `loanwords.test.js`, `transcribe.test.js`, `clipboard.test.js`, `icons.test.js`, `refine.test.js`, `audio-pipeline.test.js`, `vad.test.js`.

- [ ] **Step 7: Manually verify Settings in the dev server**

Run: `npm run dev`

In the opened browser: open Settings, confirm two labeled fields ("OpenAI API key", "Anthropic API key") each with their own Save button and status line, followed by the (unchanged) noise-suppression toggle. Save an OpenAI key alone, confirm "Key saved ✓" appears under that field only and the sheet stays open. Save an Anthropic key, confirm the same for its field. Reload the page, reopen Settings, confirm both show "Key saved ✓" (persisted). Clear one field (Save with it emptied) and confirm only that field's status flips to "Key cleared" while the other is unaffected.

Record a short note with only the OpenAI key set (clear the Anthropic key first) and confirm the result screen shows the raw transcript with the cleanup-failed state (same UI as any other cleanup failure today) rather than a crash.

- [ ] **Step 8: Commit**

```bash
git add index.html src/app.js
git commit -m "feat: wire separate OpenAI/Anthropic key fields into Settings UI"
```
