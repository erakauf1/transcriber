# Voice Note Transcriber Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PWA hosted on Netlify that records a voice note (≤5 min), transcribes it via OpenAI, cleans it up with an LLM while preserving the spoken language, and copies the result to the clipboard.

**Architecture:** Static single-page app, no backend. A pure-function state machine (`state.js`) drives one screen through `idle → recording → transcribing → cleaning → result`. Browser calls OpenAI directly; the API key lives in localStorage. Each pipeline stage keeps its output so any failed stage is retryable without re-recording.

**Tech Stack:** Vanilla JS (ES modules, no framework), Vite (build/dev), Vitest + jsdom (tests), Netlify (hosting). No runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-voice-note-transcriber-design.md`

## Global Constraints

- Transcription model: `gpt-4o-transcribe`. Cleanup model: `gpt-4o`. Each defined as one exported constant.
- **Never** send a `language` parameter to the transcription API — auto-detect preserves code-switched words.
- Language for the cleanup prompt comes from client-side script detection (`language.js`), never from the LLM.
- Cleanup prompt must forbid translation/transliteration and require output-only (no preamble).
- The audio blob is released **only after transcription succeeds** (`TRANSCRIBE_OK` sets `audioBlob: null`). No note content is ever persisted; only the API key goes to localStorage (key name: `openai_api_key`).
- All text containers rendering transcripts use `dir="auto"` (Hebrew RTL / English LTR).
- Copy happens only inside the user's tap gesture (iOS Safari requirement).
- No runtime npm dependencies. devDependencies only: `vite`, `vitest`, `jsdom`.
- Node ≥ 20 (built-in `fetch` used by node scripts).

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.js`, `netlify.toml`, `.gitignore`, `index.html` (stub), `src/styles.css` (stub)

**Interfaces:**
- Produces: working `npm run dev`, `npm run build`, `npm test` commands; Netlify config publishing `dist/`.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "transcriber",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "icons": "node scripts/make-icons.js",
    "prompt-check": "node scripts/prompt-check.js"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "vitest": "^3.0.0",
    "jsdom": "^25.0.0"
  }
}
```

- [ ] **Step 2: Create vite.config.js**

```js
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'jsdom',
  },
});
```

- [ ] **Step 3: Create netlify.toml**

```toml
[build]
  command = "npm run build"
  publish = "dist"
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
.netlify/
```

- [ ] **Step 5: Create stub index.html** (replaced in Task 10)

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Voice Note</title>
  <link rel="stylesheet" href="/src/styles.css" />
</head>
<body>
  <main id="app"><p>Voice Note — scaffold</p></main>
</body>
</html>
```

Create `src/styles.css` containing only: `/* styles arrive in Task 10 */`

- [ ] **Step 6: Install and verify**

Run: `npm install && npm run build && npm test`
Expected: build succeeds producing `dist/`; vitest reports "no test files found" and exits 0 (if it exits non-zero on no tests, add `"test": "vitest run --passWithNoTests"`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold vite project with netlify config"
```

---

### Task 2: Spike page — verify mic-in-PWA and OpenAI CORS on the real iPhone

**Files:**
- Create: `public/spike.html`

**Interfaces:**
- Produces: a deployed page proving the two architecture-gating assumptions. **If either check fails, STOP and consult the user — the fallback is a Netlify Function proxy (spec §Day-one spikes).**

- [ ] **Step 1: Create public/spike.html** (self-contained, no modules — Vite copies `public/` verbatim)

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <title>Spike checks</title>
  <style>
    body { font-family: -apple-system, sans-serif; padding: 1rem; }
    button { display: block; width: 100%; padding: 1rem; margin: 0.5rem 0; font-size: 1.1rem; }
    pre { background: #eee; padding: 0.5rem; white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>
  <h1>Spike checks</h1>
  <p>Standalone (home-screen) mode: <b id="standalone"></b></p>
  <button id="mic">1. Test microphone (records 2s)</button>
  <button id="cors">2. Test OpenAI CORS (asks for API key)</button>
  <pre id="out"></pre>
  <script>
    const out = (msg) => { document.getElementById('out').textContent += msg + '\n'; };
    document.getElementById('standalone').textContent = window.navigator.standalone ? 'YES' : 'no (open from home screen icon)';

    document.getElementById('mic').onclick = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const rec = new MediaRecorder(stream);
        const chunks = [];
        rec.ondataavailable = (e) => chunks.push(e.data);
        rec.onstop = () => {
          const blob = new Blob(chunks, { type: rec.mimeType });
          stream.getTracks().forEach((t) => t.stop());
          out(`MIC OK — mimeType=${rec.mimeType || '(default)'} size=${blob.size} bytes`);
        };
        rec.start();
        out('Recording 2 seconds…');
        setTimeout(() => rec.stop(), 2000);
      } catch (err) {
        out(`MIC FAILED — ${err.name}: ${err.message}`);
      }
    };

    document.getElementById('cors').onclick = async () => {
      const key = prompt('Paste OpenAI API key (used once, not stored):');
      if (!key) return;
      try {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: 'Bearer ' + key.trim() },
        });
        out(res.ok ? 'CORS OK — status 200' : `CORS reachable but status ${res.status} (bad key?)`);
      } catch (err) {
        out(`CORS FAILED — ${err.message}`);
      }
    };
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify locally**

Run: `npm run build && ls dist/spike.html`
Expected: file exists. Then `npm run dev`, open `http://localhost:5173/spike.html`, click button 1 — on desktop the mic check should succeed (grant permission).

- [ ] **Step 3: Commit**

```bash
git add public/spike.html
git commit -m "feat: add spike page for mic and CORS verification"
```

- [ ] **Step 4: Deploy to Netlify — USER ACTION REQUIRED**

Ask the user to deploy (they already use Netlify). Either:
- CLI: `npm run build && npx netlify-cli@latest deploy --prod --dir dist` (interactive login + site creation on first run), or
- Netlify UI: push repo to their git host and connect it (netlify.toml supplies build settings).

- [ ] **Step 5: USER CHECKPOINT — verify on iPhone**

Ask the user to, on their iPhone: open the site in Safari → Share → Add to Home Screen → open **from the icon** → confirm "Standalone: YES" → run check 1 (mic) and check 2 (CORS with their real key). Both must print OK.
**Do not proceed past this checkpoint without user confirmation. If either fails, stop and revisit the architecture (Netlify Function fallback).**

---

### Task 3: Language detection (`language.js`)

**Files:**
- Create: `src/language.js`
- Test: `tests/language.test.js`

**Interfaces:**
- Produces: `detectLanguage(text: string) → 'he' | 'en'` — pure function, dominant script wins, ties/no-letters → `'en'`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { detectLanguage } from '../src/language.js';

describe('detectLanguage', () => {
  it('detects Hebrew text', () => {
    expect(detectLanguage('שלום, מה קורה? רציתי להגיד לך משהו חשוב')).toBe('he');
  });

  it('detects English text', () => {
    expect(detectLanguage('Hey, I wanted to tell you something important')).toBe('en');
  });

  it('mixed text with Hebrew majority stays Hebrew', () => {
    expect(detectLanguage('אני צריך לעשות deploy למחר ואחרי זה לשלוח follow-up')).toBe('he');
  });

  it('mixed text with English majority stays English', () => {
    expect(detectLanguage('I told Yossi שלום and then we discussed the whole deployment plan')).toBe('en');
  });

  it('empty string defaults to English', () => {
    expect(detectLanguage('')).toBe('en');
  });

  it('digits and punctuation only default to English', () => {
    expect(detectLanguage('123 456!')).toBe('en');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/language.test.js`
Expected: FAIL — cannot resolve `../src/language.js`

- [ ] **Step 3: Write the implementation**

```js
// Detects the dominant script of a transcript. Deterministic — never asks the LLM.
const HEBREW_RE = /[\u0590-\u05FF]/g;
const LATIN_RE = /[A-Za-z]/g;

export function detectLanguage(text) {
  const hebrew = (text.match(HEBREW_RE) || []).length;
  const latin = (text.match(LATIN_RE) || []).length;
  return hebrew > latin ? 'he' : 'en';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/language.test.js`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add src/language.js tests/language.test.js
git commit -m "feat: add script-based language detection"
```

---

### Task 4: Settings / API key storage (`settings.js`)

**Files:**
- Create: `src/settings.js`
- Test: `tests/settings.test.js`

**Interfaces:**
- Produces: `getApiKey() → string|null`, `setApiKey(key: string) → void`, `hasApiKey() → boolean`. localStorage key: `openai_api_key`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { getApiKey, setApiKey, hasApiKey } from '../src/settings.js';

describe('settings', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when no key stored', () => {
    expect(getApiKey()).toBeNull();
    expect(hasApiKey()).toBe(false);
  });

  it('stores and retrieves a key, trimmed', () => {
    setApiKey('  sk-test-123  ');
    expect(getApiKey()).toBe('sk-test-123');
    expect(hasApiKey()).toBe(true);
    expect(localStorage.getItem('openai_api_key')).toBe('sk-test-123');
  });

  it('setting an empty/whitespace key clears storage', () => {
    setApiKey('sk-test-123');
    setApiKey('   ');
    expect(getApiKey()).toBeNull();
    expect(localStorage.getItem('openai_api_key')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings.test.js`
Expected: FAIL — cannot resolve `../src/settings.js`

- [ ] **Step 3: Write the implementation**

```js
const STORAGE_KEY = 'openai_api_key';

export function getApiKey() {
  const value = (localStorage.getItem(STORAGE_KEY) || '').trim();
  return value || null;
}

export function setApiKey(key) {
  const value = (key || '').trim();
  if (value) localStorage.setItem(STORAGE_KEY, value);
  else localStorage.removeItem(STORAGE_KEY);
}

export function hasApiKey() {
  return getApiKey() !== null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/settings.test.js`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/settings.js tests/settings.test.js
git commit -m "feat: add API key storage"
```

---

### Task 5: State machine (`state.js`)

**Files:**
- Create: `src/state.js`
- Test: `tests/state.test.js`

**Interfaces:**
- Produces: `initialState` object and pure `reduce(state, event) → state`.
- State shape: `{ phase: 'idle'|'recording'|'transcribing'|'cleaning'|'result'|'interrupted', audioBlob, rawTranscript, language, cleanedText, error }`.
- Events: `RECORD_START`, `RECORD_STOP{blob}`, `RECORD_INTERRUPTED{blob}`, `INTERRUPTED_TRANSCRIBE`, `TRANSCRIBE_OK{text, language}`, `TRANSCRIBE_FAIL{message}`, `TRANSCRIBE_RETRY`, `CLEANUP_OK{text}`, `CLEANUP_FAIL{message}`, `CLEANUP_RETRY`, `RESET`.
- Key invariant consumed by later tasks: `TRANSCRIBE_OK` clears `audioBlob` (spec: release audio only after transcription succeeds); `CLEANUP_FAIL` still moves to `result` with `cleanedText: null` so the UI shows the raw transcript.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { initialState, reduce } from '../src/state.js';

const blob = { size: 1234 }; // stand-in; reducer never inspects the blob

describe('reduce', () => {
  it('starts recording from a clean slate', () => {
    const dirty = { ...initialState, rawTranscript: 'old', error: 'old' };
    const s = reduce(dirty, { type: 'RECORD_START' });
    expect(s).toEqual({ ...initialState, phase: 'recording' });
  });

  it('stop → transcribing with blob kept', () => {
    const s = reduce({ ...initialState, phase: 'recording' }, { type: 'RECORD_STOP', blob });
    expect(s.phase).toBe('transcribing');
    expect(s.audioBlob).toBe(blob);
  });

  it('TRANSCRIBE_OK releases the blob and moves to cleaning', () => {
    const before = { ...initialState, phase: 'transcribing', audioBlob: blob };
    const s = reduce(before, { type: 'TRANSCRIBE_OK', text: 'שלום', language: 'he' });
    expect(s.phase).toBe('cleaning');
    expect(s.rawTranscript).toBe('שלום');
    expect(s.language).toBe('he');
    expect(s.audioBlob).toBeNull(); // spec: release only after transcription succeeds
  });

  it('TRANSCRIBE_FAIL keeps phase and blob for retry', () => {
    const before = { ...initialState, phase: 'transcribing', audioBlob: blob };
    const s = reduce(before, { type: 'TRANSCRIBE_FAIL', message: 'boom' });
    expect(s.phase).toBe('transcribing');
    expect(s.audioBlob).toBe(blob);
    expect(s.error).toBe('boom');
  });

  it('TRANSCRIBE_RETRY clears the error', () => {
    const before = { ...initialState, phase: 'transcribing', audioBlob: blob, error: 'boom' };
    expect(reduce(before, { type: 'TRANSCRIBE_RETRY' }).error).toBeNull();
  });

  it('CLEANUP_OK reaches result', () => {
    const before = { ...initialState, phase: 'cleaning', rawTranscript: 'raw', language: 'he' };
    const s = reduce(before, { type: 'CLEANUP_OK', text: 'clean' });
    expect(s.phase).toBe('result');
    expect(s.cleanedText).toBe('clean');
    expect(s.error).toBeNull();
  });

  it('CLEANUP_FAIL still reaches result, with raw transcript and error', () => {
    const before = { ...initialState, phase: 'cleaning', rawTranscript: 'raw', language: 'he' };
    const s = reduce(before, { type: 'CLEANUP_FAIL', message: 'boom' });
    expect(s.phase).toBe('result');
    expect(s.cleanedText).toBeNull();
    expect(s.rawTranscript).toBe('raw');
    expect(s.error).toBe('boom');
  });

  it('CLEANUP_RETRY returns to cleaning and clears error', () => {
    const before = { ...initialState, phase: 'result', rawTranscript: 'raw', error: 'boom' };
    const s = reduce(before, { type: 'CLEANUP_RETRY' });
    expect(s.phase).toBe('cleaning');
    expect(s.error).toBeNull();
  });

  it('interruption flow: keep partial blob, user chooses transcribe', () => {
    const rec = { ...initialState, phase: 'recording' };
    const interrupted = reduce(rec, { type: 'RECORD_INTERRUPTED', blob });
    expect(interrupted.phase).toBe('interrupted');
    expect(interrupted.audioBlob).toBe(blob);
    const s = reduce(interrupted, { type: 'INTERRUPTED_TRANSCRIBE' });
    expect(s.phase).toBe('transcribing');
    expect(s.audioBlob).toBe(blob);
  });

  it('RESET returns to initial state', () => {
    const s = reduce({ ...initialState, phase: 'result', cleanedText: 'x' }, { type: 'RESET' });
    expect(s).toEqual(initialState);
  });

  it('unknown event is a no-op', () => {
    const s = reduce(initialState, { type: 'NOPE' });
    expect(s).toEqual(initialState);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/state.test.js`
Expected: FAIL — cannot resolve `../src/state.js`

- [ ] **Step 3: Write the implementation**

```js
export const initialState = {
  phase: 'idle', // idle | recording | transcribing | cleaning | result | interrupted
  audioBlob: null,
  rawTranscript: null,
  language: null,
  cleanedText: null,
  error: null,
};

export function reduce(state, event) {
  switch (event.type) {
    case 'RECORD_START':
      return { ...initialState, phase: 'recording' };
    case 'RECORD_STOP':
      return { ...state, phase: 'transcribing', audioBlob: event.blob, error: null };
    case 'RECORD_INTERRUPTED':
      return { ...state, phase: 'interrupted', audioBlob: event.blob };
    case 'INTERRUPTED_TRANSCRIBE':
      return { ...state, phase: 'transcribing', error: null };
    case 'TRANSCRIBE_OK':
      // Release the audio only now — a failed transcription must stay retryable.
      return { ...state, phase: 'cleaning', rawTranscript: event.text, language: event.language, audioBlob: null, error: null };
    case 'TRANSCRIBE_FAIL':
      return { ...state, error: event.message };
    case 'TRANSCRIBE_RETRY':
      return { ...state, error: null };
    case 'CLEANUP_OK':
      return { ...state, phase: 'result', cleanedText: event.text, error: null };
    case 'CLEANUP_FAIL':
      // Still show the result screen — the raw transcript is the fallback output.
      return { ...state, phase: 'result', cleanedText: null, error: event.message };
    case 'CLEANUP_RETRY':
      return { ...state, phase: 'cleaning', error: null };
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/state.test.js`
Expected: 11 passed

- [ ] **Step 5: Commit**

```bash
git add src/state.js tests/state.test.js
git commit -m "feat: add pipeline state machine"
```

---

### Task 6: Transcription client (`transcribe.js`)

**Files:**
- Create: `src/transcribe.js`
- Test: `tests/transcribe.test.js`

**Interfaces:**
- Produces: `async transcribe(blob: Blob, apiKey: string) → string` (trimmed transcript), `TranscriptionError`, `TRANSCRIBE_MODEL = 'gpt-4o-transcribe'`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { transcribe, TranscriptionError, TRANSCRIBE_MODEL } from '../src/transcribe.js';

afterEach(() => vi.unstubAllGlobals());

const okResponse = (json) => ({ ok: true, json: async () => json });

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/transcribe.test.js`
Expected: FAIL — cannot resolve `../src/transcribe.js`

- [ ] **Step 3: Write the implementation**

```js
export const TRANSCRIBE_MODEL = 'gpt-4o-transcribe';

export class TranscriptionError extends Error {}

export async function transcribe(blob, apiKey) {
  const form = new FormData();
  const ext = (blob.type || '').includes('mp4') ? 'm4a' : 'webm';
  form.append('file', blob, `note.${ext}`);
  form.append('model', TRANSCRIBE_MODEL);
  // Deliberately no `language` param: auto-detect keeps code-switched words in their
  // original script instead of forcing everything into one language.

  let res;
  try {
    res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (err) {
    throw new TranscriptionError(`Network error: ${err.message}`);
  }
  if (!res.ok) throw new TranscriptionError(`Transcription failed (HTTP ${res.status})`);

  const data = await res.json();
  const text = (data.text || '').trim();
  if (!text) throw new TranscriptionError('Transcription returned empty text');
  return text;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/transcribe.test.js`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/transcribe.js tests/transcribe.test.js
git commit -m "feat: add OpenAI transcription client"
```

---

### Task 7: Cleanup client and prompt (`cleanup.js`)

**Files:**
- Create: `src/cleanup.js`
- Test: `tests/cleanup.test.js`

**Interfaces:**
- Consumes: language code `'he'|'en'` from Task 3.
- Produces: `buildSystemPrompt(language) → string`, `async cleanup(text, language, apiKey) → string`, `CleanupError`, `CLEANUP_MODEL = 'gpt-4o'`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cleanup.test.js`
Expected: FAIL — cannot resolve `../src/cleanup.js`

- [ ] **Step 3: Write the implementation** (prompt wording is the spec's §Cleanup prompt, verbatim in structure)

```js
export const CLEANUP_MODEL = 'gpt-4o';

export class CleanupError extends Error {}

const LANGUAGE_NAMES = { he: 'Hebrew', en: 'English' };

export function buildSystemPrompt(language) {
  const lang = LANGUAGE_NAMES[language] || 'English';
  return [
    `You clean up voice-note transcripts so they can be sent as chat messages.`,
    `The message is in ${lang}. Your entire output must be in ${lang}.`,
    `If the transcript contains embedded words in another language, keep them exactly as spoken, in their original script. Never translate or transliterate anything.`,
    ``,
    `Do:`,
    `- Remove filler words (um, uh, like, אמם, אה, כאילו), false starts, and repeated words`,
    `- Fix grammar and punctuation`,
    `- Merge rambling fragments into complete sentences`,
    `- If the speaker circles back to an earlier topic, fold that remark into where it belongs`,
    `- Drop pure detours that are not part of the message (e.g. "wait, someone's at the door")`,
    `- Add paragraph breaks in longer messages`,
    ``,
    `Don't:`,
    `- Don't translate anything`,
    `- Don't change slang or personal tone into formal writing`,
    `- Don't add content, greetings, or sign-offs that were not spoken`,
    `- Don't summarize — keep the same message, just tighter`,
    ``,
    `Output only the cleaned message. No preamble, no quotes, no explanations.`,
  ].join('\n');
}

export async function cleanup(text, language, apiKey) {
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CLEANUP_MODEL,
        messages: [
          { role: 'system', content: buildSystemPrompt(language) },
          { role: 'user', content: text },
        ],
      }),
    });
  } catch (err) {
    throw new CleanupError(`Network error: ${err.message}`);
  }
  if (!res.ok) throw new CleanupError(`Cleanup failed (HTTP ${res.status})`);

  const data = await res.json();
  const out = data.choices?.[0]?.message?.content?.trim();
  if (!out) throw new CleanupError('Cleanup returned empty output');
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cleanup.test.js`
Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
git add src/cleanup.js tests/cleanup.test.js
git commit -m "feat: add LLM cleanup client with language-locked prompt"
```

---

### Task 8: Clipboard helper (`clipboard.js`)

**Files:**
- Create: `src/clipboard.js`
- Test: `tests/clipboard.test.js`

**Interfaces:**
- Produces: `async copyText(text) → boolean` (true on success; never throws). Must be called from within a tap handler (iOS gesture requirement — enforced by callers, documented here).

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyText } from '../src/clipboard.js';

afterEach(() => vi.unstubAllGlobals());

describe('copyText', () => {
  it('returns true when clipboard write succeeds', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('hello')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('returns false when clipboard write rejects', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    expect(await copyText('hello')).toBe(false);
  });

  it('returns false when clipboard API is missing', async () => {
    vi.stubGlobal('navigator', {});
    expect(await copyText('hello')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/clipboard.test.js`
Expected: FAIL — cannot resolve `../src/clipboard.js`

- [ ] **Step 3: Write the implementation**

```js
// iOS Safari only allows clipboard writes inside a user gesture —
// callers must invoke this directly from a tap handler.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/clipboard.test.js`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/clipboard.js tests/clipboard.test.js
git commit -m "feat: add clipboard helper"
```

---

### Task 9: Recorder (`recorder.js`)

**Files:**
- Create: `src/recorder.js`

**Interfaces:**
- Produces: `MAX_DURATION_MS = 300000` and `createRecorder({ onTick, onLevel, onAutoStop }) → { start(): Promise<void>, stop(): Promise<Blob|null>, isRecording(): boolean }`.
- `start()` rejects with the `getUserMedia` error (e.g. `NotAllowedError`) — caller handles messaging.
- `stop()` resolves the recorded Blob; resolves whatever chunks exist even if the MediaRecorder was already killed by iOS backgrounding; resolves `null` only if nothing was captured. Safe to call twice (second call resolves `null`).
- `onAutoStop(blob)` fires when the 5:00 cap is hit. `onTick(elapsedMs)` every 250 ms. `onLevel(0..1)` per animation frame.

No unit tests: this module is a thin wrapper over `getUserMedia`/`MediaRecorder`/`AudioContext`, none of which exist in jsdom — mocking all three would test the mocks. It is exercised by the manual smoke test in Task 10 and the device checklist in Task 12.

- [ ] **Step 1: Write the implementation**

```js
export const MAX_DURATION_MS = 5 * 60 * 1000;

export function createRecorder({ onTick, onLevel, onAutoStop } = {}) {
  let mediaRecorder = null;
  let chunks = [];
  let stream = null;
  let startedAt = 0;
  let tickInterval = null;
  let levelRaf = null;
  let audioCtx = null;

  function pickMimeType() {
    // iOS Safari records AAC in an MP4 container; webm is the Chrome/Firefox path.
    const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  }

  async function start() {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    const mimeType = pickMimeType();
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    // 1s timeslice so partial audio survives iOS killing the recorder in the background.
    mediaRecorder.start(1000);
    startedAt = Date.now();

    tickInterval = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      onTick?.(elapsed);
      if (elapsed >= MAX_DURATION_MS) {
        stop().then((blob) => { if (blob) onAutoStop?.(blob); });
      }
    }, 250);

    if (onLevel) startLevelMeter();
  }

  function startLevelMeter() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      onLevel(peak);
      levelRaf = requestAnimationFrame(loop);
    };
    levelRaf = requestAnimationFrame(loop);
  }

  function teardown() {
    clearInterval(tickInterval);
    if (levelRaf) cancelAnimationFrame(levelRaf);
    audioCtx?.close();
    stream?.getTracks().forEach((t) => t.stop());
    mediaRecorder = null;
    stream = null;
    audioCtx = null;
  }

  function drainChunks(type) {
    const blob = chunks.length ? new Blob(chunks, { type }) : null;
    chunks = [];
    return blob;
  }

  function stop() {
    return new Promise((resolve) => {
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        // Already stopped (double-stop, or iOS killed it in the background):
        // return whatever the 1s timeslices managed to capture.
        const blob = drainChunks(chunks[0]?.type || 'audio/mp4');
        teardown();
        resolve(blob);
        return;
      }
      const type = mediaRecorder.mimeType || 'audio/mp4';
      mediaRecorder.onstop = () => {
        const blob = drainChunks(type);
        teardown();
        resolve(blob);
      };
      mediaRecorder.stop();
    });
  }

  function isRecording() {
    return !!mediaRecorder && mediaRecorder.state === 'recording';
  }

  return { start, stop, isRecording };
}
```

- [ ] **Step 2: Verify the full suite still passes and the module parses**

Run: `npm test && npm run build`
Expected: all existing tests pass; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/recorder.js
git commit -m "feat: add MediaRecorder wrapper with 5min cap and level meter"
```

---

### Task 10: UI and wiring (`index.html`, `styles.css`, `app.js`)

**Files:**
- Modify: `index.html` (replace stub)
- Modify: `src/styles.css` (replace stub)
- Create: `src/app.js`

**Interfaces:**
- Consumes: everything from Tasks 3–9 with the exact signatures listed in their Interfaces blocks.

- [ ] **Step 1: Replace index.html**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="theme-color" content="#4f46e5" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/icons/icon-180.png" />
  <title>Voice Note</title>
  <link rel="stylesheet" href="/src/styles.css" />
</head>
<body>
  <main id="app">
    <section id="screen-idle" hidden>
      <button id="btn-record" class="big-btn">🎤 Record</button>
      <p id="idle-hint"></p>
    </section>

    <section id="screen-recording" hidden>
      <div id="level-meter"><div id="level-bar"></div></div>
      <div id="timer">0:00</div>
      <button id="btn-stop" class="big-btn stop">■ Stop</button>
    </section>

    <section id="screen-busy" hidden>
      <div class="spinner"></div>
      <p id="busy-label"></p>
      <div id="busy-error" hidden>
        <p id="busy-error-msg" class="error"></p>
        <button id="btn-retry-transcribe">Retry transcription</button>
        <button id="btn-cancel" class="secondary">Cancel</button>
      </div>
    </section>

    <section id="screen-interrupted" hidden>
      <p>Recording was interrupted (the app went to the background).</p>
      <button id="btn-use-partial">Transcribe what was captured</button>
      <button id="btn-discard" class="secondary">Discard</button>
    </section>

    <section id="screen-result" hidden>
      <div id="cleanup-error" hidden>
        <p class="error">Cleanup failed — showing the raw transcript.</p>
        <button id="btn-retry-cleanup">Retry cleanup</button>
      </div>
      <textarea id="result-text" dir="auto" rows="10"></textarea>
      <button id="btn-copy" class="big-btn">Copy</button>
      <p id="copy-feedback" hidden></p>
      <details id="raw-details">
        <summary>Raw transcript</summary>
        <p id="raw-text" dir="auto"></p>
      </details>
      <button id="btn-new" class="secondary">New recording</button>
    </section>

    <details id="settings">
      <summary>⚙️ Settings</summary>
      <label for="api-key">OpenAI API key</label>
      <input id="api-key" type="password" autocomplete="off" placeholder="sk-..." />
      <button id="btn-save-key">Save</button>
      <p id="key-status"></p>
    </details>
  </main>
  <script type="module" src="/src/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Replace src/styles.css**

```css
* { box-sizing: border-box; margin: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #111827;
  color: #f9fafb;
  min-height: 100vh;
  padding: max(1rem, env(safe-area-inset-top)) 1rem max(1rem, env(safe-area-inset-bottom));
}

#app { max-width: 480px; margin: 0 auto; display: flex; flex-direction: column; gap: 1rem; }
section { display: flex; flex-direction: column; gap: 1rem; align-items: stretch; padding-top: 2rem; }
section[hidden] { display: none; }

.big-btn {
  font-size: 1.5rem;
  padding: 1.25rem;
  border: none;
  border-radius: 1rem;
  background: #4f46e5;
  color: white;
  cursor: pointer;
}
.big-btn:disabled { opacity: 0.4; }
.big-btn.stop { background: #dc2626; }

button.secondary, #busy-error button, #screen-interrupted button, #settings button {
  font-size: 1rem;
  padding: 0.75rem;
  border: 1px solid #4b5563;
  border-radius: 0.75rem;
  background: #1f2937;
  color: #f9fafb;
  cursor: pointer;
}
#btn-retry-transcribe, #btn-retry-cleanup, #btn-use-partial { background: #4f46e5; border: none; }

#timer { font-size: 3rem; text-align: center; font-variant-numeric: tabular-nums; }

#level-meter { height: 8px; background: #1f2937; border-radius: 4px; overflow: hidden; }
#level-bar { height: 100%; width: 0%; background: #22c55e; transition: width 80ms linear; }

.spinner {
  width: 2.5rem; height: 2.5rem;
  border: 4px solid #1f2937; border-top-color: #4f46e5;
  border-radius: 50%;
  margin: 0 auto;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

#busy-label { text-align: center; color: #9ca3af; }
.error { color: #f87171; }

#result-text {
  width: 100%;
  font-size: 1.1rem;
  padding: 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid #4b5563;
  background: #1f2937;
  color: #f9fafb;
  resize: vertical;
}

#copy-feedback { text-align: center; color: #22c55e; }
#raw-details { color: #9ca3af; }
#raw-details p { margin-top: 0.5rem; white-space: pre-wrap; }

#settings { margin-top: auto; padding-top: 2rem; color: #9ca3af; }
#settings label { display: block; margin: 0.75rem 0 0.25rem; }
#settings input {
  width: 100%;
  padding: 0.6rem;
  border-radius: 0.5rem;
  border: 1px solid #4b5563;
  background: #1f2937;
  color: #f9fafb;
  margin-bottom: 0.5rem;
}
#idle-hint, #key-status { text-align: center; color: #9ca3af; }
```

- [ ] **Step 3: Create src/app.js**

```js
import { createRecorder } from './recorder.js';
import { transcribe } from './transcribe.js';
import { cleanup } from './cleanup.js';
import { detectLanguage } from './language.js';
import { copyText } from './clipboard.js';
import { getApiKey, setApiKey, hasApiKey } from './settings.js';
import { initialState, reduce } from './state.js';

let state = initialState;
let recorder = null;

const $ = (id) => document.getElementById(id);

function dispatch(event) {
  state = reduce(state, event);
  render();
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function render() {
  $('screen-idle').hidden = state.phase !== 'idle';
  $('screen-recording').hidden = state.phase !== 'recording';
  $('screen-busy').hidden = state.phase !== 'transcribing' && state.phase !== 'cleaning';
  $('screen-interrupted').hidden = state.phase !== 'interrupted';
  $('screen-result').hidden = state.phase !== 'result';
  $('settings').hidden = state.phase !== 'idle';

  $('btn-record').disabled = !hasApiKey();
  $('idle-hint').textContent = hasApiKey()
    ? 'Up to 5 minutes'
    : 'Add your OpenAI API key in Settings first';

  if (state.phase === 'transcribing' || state.phase === 'cleaning') {
    $('busy-label').textContent = state.phase === 'transcribing' ? 'Transcribing…' : 'Cleaning up…';
    $('busy-error').hidden = !state.error;
    $('busy-error-msg').textContent = state.error || '';
  }

  if (state.phase === 'result') {
    const cleanupFailed = !state.cleanedText;
    $('cleanup-error').hidden = !cleanupFailed;
    $('result-text').value = state.cleanedText ?? state.rawTranscript ?? '';
    $('raw-text').textContent = state.rawTranscript ?? '';
    $('raw-details').hidden = cleanupFailed; // raw already shown as the main text
  }
}

async function runTranscription() {
  try {
    const text = await transcribe(state.audioBlob, getApiKey());
    dispatch({ type: 'TRANSCRIBE_OK', text, language: detectLanguage(text) });
    runCleanup();
  } catch (err) {
    dispatch({ type: 'TRANSCRIBE_FAIL', message: err.message });
  }
}

async function runCleanup() {
  try {
    const text = await cleanup(state.rawTranscript, state.language, getApiKey());
    dispatch({ type: 'CLEANUP_OK', text });
  } catch (err) {
    dispatch({ type: 'CLEANUP_FAIL', message: err.message });
  }
}

$('btn-record').onclick = async () => {
  recorder = createRecorder({
    onTick: (ms) => { $('timer').textContent = fmt(ms); },
    onLevel: (v) => { $('level-bar').style.width = `${Math.min(100, v * 140)}%`; },
    onAutoStop: (blob) => {
      dispatch({ type: 'RECORD_STOP', blob });
      runTranscription();
    },
  });
  try {
    await recorder.start();
    dispatch({ type: 'RECORD_START' });
  } catch (err) {
    alert(
      err.name === 'NotAllowedError'
        ? 'Microphone access denied. Enable it in iOS Settings → Apps → Safari → Microphone, then try again.'
        : `Could not start recording: ${err.message}`
    );
  }
};

$('btn-stop').onclick = async () => {
  const blob = await recorder.stop();
  if (blob) {
    dispatch({ type: 'RECORD_STOP', blob });
    runTranscription();
  } else {
    dispatch({ type: 'RESET' }); // auto-stop already handled it, or nothing captured
  }
};

// iOS suspends the page (and may kill the MediaRecorder) when backgrounded mid-recording.
// On return, salvage what the 1s timeslices captured and let the user decide.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && state.phase === 'recording' && recorder) {
    const blob = await recorder.stop();
    if (blob && blob.size > 0) dispatch({ type: 'RECORD_INTERRUPTED', blob });
    else dispatch({ type: 'RESET' });
  }
});

$('btn-use-partial').onclick = () => {
  dispatch({ type: 'INTERRUPTED_TRANSCRIBE' });
  runTranscription();
};
$('btn-discard').onclick = () => dispatch({ type: 'RESET' });

$('btn-retry-transcribe').onclick = () => {
  dispatch({ type: 'TRANSCRIBE_RETRY' });
  runTranscription();
};
$('btn-cancel').onclick = () => dispatch({ type: 'RESET' });
$('btn-retry-cleanup').onclick = () => {
  dispatch({ type: 'CLEANUP_RETRY' });
  runCleanup();
};

$('btn-copy').onclick = async () => {
  const ok = await copyText($('result-text').value);
  const fb = $('copy-feedback');
  fb.textContent = ok ? 'Copied ✓ — paste it into your chat' : 'Copy failed — long-press the text and copy manually';
  fb.hidden = false;
  setTimeout(() => { fb.hidden = true; }, 2500);
};

$('btn-new').onclick = () => dispatch({ type: 'RESET' });

$('btn-save-key').onclick = () => {
  setApiKey($('api-key').value);
  $('key-status').textContent = hasApiKey() ? 'Key saved ✓' : 'Key cleared';
  $('api-key').value = '';
  render();
};

render();
```

- [ ] **Step 4: Manual smoke test in dev server**

Run: `npm run dev`, open `http://localhost:5173/`.
Verify: idle screen shows with Record disabled + hint; save a dummy key `sk-dummy` in Settings → Record enables; click Record, allow mic → recording screen with running timer and moving level bar; click Stop → busy screen appears, then "Retry transcription" appears after the API rejects the dummy key (this **proves the retry path**); click Cancel → back to idle. (The manifest/icon 404s in console are expected until Task 11.)

- [ ] **Step 5: Run full suite and build**

Run: `npm test && npm run build`
Expected: all tests pass, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add index.html src/styles.css src/app.js
git commit -m "feat: add UI and pipeline wiring"
```

---

### Task 11: PWA assets — icons and manifest

**Files:**
- Create: `scripts/make-icons.js`, `public/manifest.webmanifest`
- Test: `tests/icons.test.js`
- Generated: `public/icons/icon-180.png`, `public/icons/icon-192.png`, `public/icons/icon-512.png`

**Interfaces:**
- Produces: `makePng(size: number) → Buffer` exported from the script (valid PNG, indigo background, white mic glyph); running the script writes the three icon files.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { makePng } from '../scripts/make-icons.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('makePng', () => {
  it('produces a valid PNG with the requested dimensions', () => {
    const buf = makePng(192);
    expect(buf.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    // IHDR: width at byte 16, height at byte 20 (big-endian)
    expect(buf.readUInt32BE(16)).toBe(192);
    expect(buf.readUInt32BE(20)).toBe(192);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/icons.test.js`
Expected: FAIL — cannot resolve `../scripts/make-icons.js`

- [ ] **Step 3: Write scripts/make-icons.js** (no dependencies — raw PNG encoding via node zlib)

```js
// Generates solid-background mic icons as PNGs with no image dependencies.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BG = [0x4f, 0x46, 0xe5]; // indigo #4f46e5
const FG = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Distance from point (px,py) to vertical segment x=cx, y in [y1,y2]
function distToVSeg(px, py, cx, y1, y2) {
  const cy = Math.max(y1, Math.min(y2, py));
  return Math.hypot(px - cx, py - cy);
}

function isForeground(x, y, size) {
  const cx = size / 2;
  // Mic head: vertical capsule
  if (distToVSeg(x, y, cx, size * 0.28, size * 0.46) < size * 0.13) return true;
  // Stem
  if (distToVSeg(x, y, cx, size * 0.60, size * 0.72) < size * 0.035) return true;
  // Base bar
  if (Math.abs(y - size * 0.75) < size * 0.025 && Math.abs(x - cx) < size * 0.13) return true;
  return false;
}

export function makePng(size) {
  // Raw image data: each scanline is a filter byte (0) + RGB pixels
  const raw = Buffer.alloc(size * (1 + size * 3));
  let off = 0;
  for (let y = 0; y < size; y++) {
    raw[off++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = isForeground(x, y, size) ? FG : BG;
      raw[off++] = r; raw[off++] = g; raw[off++] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor RGB
  // bytes 10-12: compression, filter, interlace = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function main() {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
  mkdirSync(outDir, { recursive: true });
  for (const size of [180, 192, 512]) {
    writeFileSync(join(outDir, `icon-${size}.png`), makePng(size));
    console.log(`wrote icon-${size}.png`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test, then generate the icons**

Run: `npx vitest run tests/icons.test.js && npm run icons`
Expected: test passes; three "wrote icon-*.png" lines. Open one icon (`open public/icons/icon-512.png`) and eyeball: indigo square with a white mic shape.

- [ ] **Step 5: Create public/manifest.webmanifest**

```json
{
  "name": "Voice Note",
  "short_name": "VoiceNote",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#111827",
  "theme_color": "#4f46e5",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 6: Verify build includes assets**

Run: `npm run build && ls dist/manifest.webmanifest dist/icons/`
Expected: manifest plus the three PNGs are in `dist/`.

- [ ] **Step 7: Commit**

```bash
git add scripts/make-icons.js tests/icons.test.js public/manifest.webmanifest public/icons/
git commit -m "feat: add PWA manifest and generated icons"
```

---

### Task 12: Prompt fixture harness + final deploy and device checklist

**Files:**
- Create: `fixtures/transcripts.json`, `scripts/prompt-check.js`

**Interfaces:**
- Consumes: `cleanup(text, language, apiKey)` and `detectLanguage(text)`.
- Produces: `npm run prompt-check` (needs `OPENAI_API_KEY` env var) printing raw vs cleaned for every fixture — the semi-manual eyeball check that runs after any prompt change.

- [ ] **Step 1: Create fixtures/transcripts.json**

```json
[
  {
    "name": "hebrew-fillers",
    "text": "אה שלום מה קורה אז אממ רציתי להגיד לך ש... שאני כאילו חשבתי על זה ואני חושב שכדאי שניפגש מחר כאילו אם זה מסתדר לך אה כן מחר בערב"
  },
  {
    "name": "hebrew-with-english-terms",
    "text": "תקשיב אני צריך לעשות deploy למערכת מחר בבוקר אז אממ תשלח לי בבקשה את ה-credentials ואת הלינק ל-repository כאילו לפני עשר אם אפשר"
  },
  {
    "name": "hebrew-rambling-with-detour",
    "text": "אז לגבי החופשה חשבתי שנטוס ביום שלישי רגע מישהו בדלת... אוקיי חזרתי אז כן יום שלישי ואה שכחתי להגיד המלון שראיתי נראה מעולה אז חשבתי שנזמין אותו והטיסה של הבוקר"
  },
  {
    "name": "english-fillers",
    "text": "hey um so I was thinking like maybe we should uh push the meeting to Thursday because um I have this thing on Wednesday that I like totally forgot about so yeah Thursday would be great"
  },
  {
    "name": "english-with-hebrew-word",
    "text": "so listen I talked to the landlord and he said the ארנונה is included in the rent which is actually a pretty good deal I think we should take it"
  },
  {
    "name": "english-rambling-repeats",
    "text": "okay so the the plan is we meet at seven no wait actually let's make it seven thirty because because traffic is crazy at seven and then we go straight to the restaurant I booked it already by the way"
  }
]
```

- [ ] **Step 2: Create scripts/prompt-check.js**

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

const fixtures = JSON.parse(
  readFileSync(new URL('../fixtures/transcripts.json', import.meta.url), 'utf8')
);

for (const { name, text } of fixtures) {
  const language = detectLanguage(text);
  console.log(`\n=== ${name} [${language}] ===`);
  console.log(`--- raw ---\n${text}`);
  try {
    const cleaned = await cleanup(text, language, apiKey);
    console.log(`--- cleaned ---\n${cleaned}`);
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
  }
}
```

- [ ] **Step 3: Run the harness — USER ACTION (needs their real key)**

Run: `OPENAI_API_KEY=<key> npm run prompt-check`
Review each pair with the user against the spec's Do/Don't lists. Red flags: Hebrew output for `english-with-hebrew-word` (should stay English), `deploy`/`credentials`/`repository` translated into Hebrew, ארנונה transliterated, added greetings, or summaries instead of the full message. If cleanup overreaches or underreaches, adjust `buildSystemPrompt` wording (tests in Task 7 pin the required phrases — keep them passing) and re-run.

- [ ] **Step 4: Full verification**

Run: `npm test && npm run build`
Expected: everything passes.

- [ ] **Step 5: Commit**

```bash
git add fixtures/transcripts.json scripts/prompt-check.js
git commit -m "feat: add prompt fixture harness"
```

- [ ] **Step 6: Deploy to production — USER ACTION**

Same as Task 2 Step 4 (`npx netlify-cli deploy --prod --dir dist` after `npm run build`, or git push if Netlify is connected to the repo).

- [ ] **Step 7: USER CHECKPOINT — real-device end-to-end**

Walk the user through, on their iPhone (home-screen icon, standalone):
1. Settings → paste real API key → Save.
2. Record a ~30s Hebrew note with embedded English words → Stop → verify Hebrew output with English words intact, RTL rendering correct.
3. Tap Copy → paste into WhatsApp → reads naturally.
4. Record an English note → verify English output.
5. Airplane-mode a recording's Stop (transcription fails) → verify Retry appears, disable airplane mode, Retry succeeds — the note survives.
6. Start recording, switch to another app, come back → interrupted screen offers partial transcription.
7. Confirm the old `/spike.html` still being deployed is acceptable or delete `public/spike.html` in a follow-up commit.

---

## Verification checklist (whole plan)

- `npm test` — all unit tests green (language, settings, state, transcribe, cleanup, clipboard, icons).
- `npm run build` — clean production build.
- Spike checkpoint (Task 2) passed on the real device **before** the UI work landed.
- Prompt harness reviewed with the user (Task 12).
- Real-device E2E checklist (Task 12 Step 7) fully walked through.
