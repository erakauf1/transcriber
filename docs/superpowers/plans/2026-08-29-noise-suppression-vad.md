# Noise Suppression & VAD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate RNNoise-based noise suppression and amplitude-based voice activity detection into the recording pipeline to improve transcription accuracy in noisy environments.

**Architecture:** A new `audio-pipeline.js` module owns the Web Audio graph: mic source → optional RnnoiseWorkletNode → MediaStreamDestination + AnalyserNode. The recorder delegates AudioContext management to the pipeline and feeds the clean MediaStream to MediaRecorder. A lightweight `vad.js` reads the post-suppression AnalyserNode to detect speech/silence and drive the wave-bar visual indicator.

**Tech Stack:** `@sapphi-red/web-noise-suppressor` (RNNoise via AudioWorklet + WASM), vanilla JS, Vite, Vitest with jsdom

## Global Constraints

- iOS Safari 14.5+ is the primary target — no WASM SIMD, AudioWorklet required
- Zero runtime dependencies besides `@sapphi-red/web-noise-suppressor`
- Recording must never fail because of the suppressor — always fall back to passthrough
- Tests run under vitest with jsdom; tests go in `tests/` directory
- Existing test patterns: import from vitest, `beforeEach(() => localStorage.clear())` for storage tests

---

### Task 1: Install dependency and verify Vite resolves it

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing
- Produces: `@sapphi-red/web-noise-suppressor` available as an import for all later tasks

- [ ] **Step 1: Install the package**

```bash
npm install @sapphi-red/web-noise-suppressor
```

- [ ] **Step 2: Verify Vite resolves the imports**

Create a temporary smoke check — add these lines to the top of `src/app.js`, then run `npm run build`:

```js
// TEMP — remove after verifying Vite resolves these imports
import { RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise?url';
console.log('suppressor imports OK', RnnoiseWorkletNode, rnnoiseWasmUrl);
```

```bash
npm run build
```

Expected: build succeeds without errors. The `?url` import should resolve to a hashed asset path.

- [ ] **Step 3: Remove temporary import and commit**

Remove the three temporary lines from `src/app.js`.

```bash
git add package.json package-lock.json
git commit -m "chore: add @sapphi-red/web-noise-suppressor dependency"
```

---

### Task 2: Settings — noise suppression toggle persistence

**Files:**
- Modify: `src/settings.js`
- Test: `tests/settings.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `getNoiseSuppressionEnabled() → boolean`, `setNoiseSuppressionEnabled(bool) → void` — used by Task 5 (app.js) and Task 6 (settings UI)

- [ ] **Step 1: Write failing tests**

Add to `tests/settings.test.js`:

```js
import { getNoiseSuppressionEnabled, setNoiseSuppressionEnabled } from '../src/settings.js';

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

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/settings.test.js
```

Expected: FAIL — `getNoiseSuppressionEnabled` is not exported.

- [ ] **Step 3: Implement in settings.js**

Add to the bottom of `src/settings.js`:

```js
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/settings.test.js
```

Expected: all settings tests pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/settings.js tests/settings.test.js
git commit -m "feat: add noise suppression toggle persistence"
```

---

### Task 3: VAD module

**Files:**
- Create: `src/vad.js`
- Create: `tests/vad.test.js`

**Interfaces:**
- Consumes: an `AnalyserNode` instance (provided by Task 4's pipeline)
- Produces: `createVAD(analyser, { onSpeechStart, onSpeechEnd, threshold?, silenceMs? }) → { start, stop, isSpeaking }` — used by Task 5 (app.js)

- [ ] **Step 1: Write failing tests**

Create `tests/vad.test.js`. The VAD uses `requestAnimationFrame` and `AnalyserNode` — mock both:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createVAD } from '../src/vad.js';

function makeMockAnalyser(peakSequence) {
  let callIndex = 0;
  return {
    fftSize: 256,
    frequencyBinCount: 128,
    getByteTimeDomainData(arr) {
      const peak = peakSequence[Math.min(callIndex++, peakSequence.length - 1)];
      // 128 = silence center; peak of 0.1 means value 128 + 0.1*128 = 140.8
      arr.fill(128);
      arr[0] = Math.round(128 + peak * 128);
    },
  };
}

describe('vad', () => {
  let rafCallbacks;
  let rafId;

  beforeEach(() => {
    rafCallbacks = [];
    rafId = 0;
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      rafCallbacks.push(cb);
      return ++rafId;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function flush(n = 1) {
    for (let i = 0; i < n; i++) {
      const cbs = rafCallbacks.splice(0);
      cbs.forEach((cb) => cb());
    }
  }

  it('fires onSpeechStart after 2 consecutive frames above threshold', () => {
    const onSpeechStart = vi.fn();
    const onSpeechEnd = vi.fn();
    const analyser = makeMockAnalyser([0.0, 0.1, 0.1, 0.1]);

    const vad = createVAD(analyser, { onSpeechStart, onSpeechEnd, threshold: 0.05 });
    vad.start();

    flush(1); // peak 0.0 — below threshold
    expect(onSpeechStart).not.toHaveBeenCalled();

    flush(1); // peak 0.1 — above, count=1
    expect(onSpeechStart).not.toHaveBeenCalled();

    flush(1); // peak 0.1 — above, count=2 → fire
    expect(onSpeechStart).toHaveBeenCalledOnce();

    flush(1); // peak 0.1 — still above, should not fire again
    expect(onSpeechStart).toHaveBeenCalledOnce();
  });

  it('fires onSpeechEnd after silenceMs of silence', () => {
    const onSpeechStart = vi.fn();
    const onSpeechEnd = vi.fn();
    // Start with speech, then go silent
    const analyser = makeMockAnalyser([0.1, 0.1, 0.0, 0.0, 0.0, 0.0]);

    const vad = createVAD(analyser, {
      onSpeechStart,
      onSpeechEnd,
      threshold: 0.05,
      silenceMs: 100,
    });
    vad.start();

    flush(2); // two frames above → speech starts
    expect(onSpeechStart).toHaveBeenCalledOnce();

    // Simulate time passing during silence frames
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000) // frame 3: silence begins
      .mockReturnValueOnce(1050) // frame 4: 50ms in
      .mockReturnValueOnce(1101); // frame 5: 101ms in → fire

    flush(3);
    expect(onSpeechEnd).toHaveBeenCalledOnce();
  });

  it('isSpeaking reflects current state', () => {
    const analyser = makeMockAnalyser([0.1, 0.1, 0.1]);
    const vad = createVAD(analyser, {
      onSpeechStart: vi.fn(),
      onSpeechEnd: vi.fn(),
      threshold: 0.05,
    });
    vad.start();

    expect(vad.isSpeaking()).toBe(false);
    flush(2);
    expect(vad.isSpeaking()).toBe(true);
  });

  it('stop cancels the rAF loop', () => {
    const analyser = makeMockAnalyser([0.1]);
    const vad = createVAD(analyser, {
      onSpeechStart: vi.fn(),
      onSpeechEnd: vi.fn(),
    });
    vad.start();
    vad.stop();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/vad.test.js
```

Expected: FAIL — `createVAD` is not exported / module not found.

- [ ] **Step 3: Implement vad.js**

Create `src/vad.js`:

```js
export function createVAD(analyser, { onSpeechStart, onSpeechEnd, threshold = 0.05, silenceMs = 800 } = {}) {
  const data = new Uint8Array(analyser.frequencyBinCount);
  let rafId = null;
  let speaking = false;
  let aboveCount = 0;
  let silenceSince = null;

  function getPeak() {
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
    return peak;
  }

  function loop() {
    const peak = getPeak();

    if (peak >= threshold) {
      silenceSince = null;
      aboveCount++;
      if (!speaking && aboveCount >= 2) {
        speaking = true;
        onSpeechStart?.();
      }
    } else {
      aboveCount = 0;
      if (speaking) {
        if (silenceSince === null) {
          silenceSince = Date.now();
        } else if (Date.now() - silenceSince >= silenceMs) {
          speaking = false;
          silenceSince = null;
          onSpeechEnd?.();
        }
      }
    }

    rafId = requestAnimationFrame(loop);
  }

  return {
    start() { rafId = requestAnimationFrame(loop); },
    stop() { if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; } },
    isSpeaking() { return speaking; },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/vad.test.js
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/vad.js tests/vad.test.js
git commit -m "feat: add amplitude-based VAD module"
```

---

### Task 4: Audio pipeline module

**Files:**
- Create: `src/audio-pipeline.js`
- Create: `tests/audio-pipeline.test.js`

**Interfaces:**
- Consumes: `@sapphi-red/web-noise-suppressor` (Task 1)
- Produces: `createPipeline(stream, { noiseSuppression }) → Promise<{ cleanStream, analyser, destroy }>` and `checkNoiseSuppressionSupport() → Promise<boolean>` — used by Task 5 (recorder.js refactor)

- [ ] **Step 1: Write failing tests**

Create `tests/audio-pipeline.test.js`. AudioContext and AudioWorklet don't exist in jsdom, so we test the module's branching logic with mocks:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPipeline, checkNoiseSuppressionSupport } from '../src/audio-pipeline.js';

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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/audio-pipeline.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement audio-pipeline.js**

Create `src/audio-pipeline.js`:

```js
import { RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoise/worklet?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise?url';

let workletLoaded = false;

async function loadWorklet(audioCtx) {
  if (workletLoaded) return;
  await audioCtx.audioWorklet.addModule(rnnoiseWorkletUrl);
  workletLoaded = true;
}

export async function createPipeline(stream, { noiseSuppression = true } = {}) {
  const audioCtx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(stream);
  const destination = audioCtx.createMediaStreamDestination();
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;

  let lastNode = source;

  if (noiseSuppression) {
    try {
      await loadWorklet(audioCtx);
      const suppressor = new RnnoiseWorkletNode(audioCtx, { wasmUrl: rnnoiseWasmUrl });
      source.connect(suppressor);
      lastNode = suppressor;
    } catch (err) {
      console.warn('Noise suppression unavailable, falling back to passthrough:', err);
      workletLoaded = false;
    }
  }

  lastNode.connect(destination);
  lastNode.connect(analyser);

  return {
    cleanStream: destination.stream,
    analyser,
    destroy() {
      audioCtx.close();
    },
  };
}

export async function checkNoiseSuppressionSupport() {
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) return false;
  try {
    const ctx = new Ctor();
    const supported = !!ctx.audioWorklet;
    ctx.close();
    return supported;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/audio-pipeline.test.js
```

Expected: all tests pass. Note: the import of `@sapphi-red/web-noise-suppressor` at the top of the module may cause issues in the test environment since the worklet/WASM URLs are Vite-specific. If tests fail due to import resolution, add a `vi.mock` at the top of the test file:

```js
vi.mock('@sapphi-red/web-noise-suppressor', () => ({
  RnnoiseWorkletNode: vi.fn(),
}));
vi.mock('@sapphi-red/web-noise-suppressor/rnnoise/worklet?url', () => ({ default: 'mock-worklet-url' }));
vi.mock('@sapphi-red/web-noise-suppressor/rnnoise?url', () => ({ default: 'mock-wasm-url' }));
```

- [ ] **Step 5: Commit**

```bash
git add src/audio-pipeline.js tests/audio-pipeline.test.js
git commit -m "feat: add audio pipeline with RNNoise noise suppression"
```

---

### Task 5: Refactor recorder to use the audio pipeline

**Files:**
- Modify: `src/recorder.js`
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `createPipeline` from `src/audio-pipeline.js` (Task 4), `createVAD` from `src/vad.js` (Task 3), `getNoiseSuppressionEnabled` from `src/settings.js` (Task 2)
- Produces: `createRecorder({ onTick, onLevel, onAutoStop, noiseSuppression }) → { start, stop, isRecording, getAnalyser }` — recorder now exposes `getAnalyser()` for VAD

- [ ] **Step 1: Refactor recorder.js to use createPipeline**

Replace the `start()` and `startLevelMeter()` functions and update `teardown()` in `src/recorder.js`:

```js
import { createPipeline } from './audio-pipeline.js';

export const MAX_DURATION_MS = 5 * 60 * 1000;

export function createRecorder({ onTick, onLevel, onAutoStop, noiseSuppression = true } = {}) {
  let mediaRecorder = null;
  let chunks = [];
  let stream = null;
  let startedAt = 0;
  let tickInterval = null;
  let levelRaf = null;
  let pipeline = null;
  let pendingStop = null;

  function pickMimeType() {
    const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  }

  async function start() {
    if (mediaRecorder) {
      throw new Error('Recorder already started');
    }
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    pipeline = await createPipeline(stream, { noiseSuppression });

    chunks = [];
    const mimeType = pickMimeType();
    mediaRecorder = new MediaRecorder(pipeline.cleanStream, mimeType ? { mimeType } : undefined);
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mediaRecorder.start(1000);
    startedAt = Date.now();

    tickInterval = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      onTick?.(elapsed);
      if (elapsed >= MAX_DURATION_MS) {
        clearInterval(tickInterval);
        stop().then((blob) => { if (blob) onAutoStop?.(blob); });
      }
    }, 250);

    if (onLevel) startLevelMeter();
  }

  function startLevelMeter() {
    const analyser = pipeline.analyser;
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
    pipeline?.destroy();
    stream?.getTracks().forEach((t) => t.stop());
    mediaRecorder = null;
    stream = null;
    pipeline = null;
  }

  function drainChunks(type) {
    const blob = chunks.length ? new Blob(chunks, { type }) : null;
    chunks = [];
    return blob;
  }

  function stop() {
    if (pendingStop) return pendingStop;

    pendingStop = new Promise((resolve) => {
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
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
    }).finally(() => {
      pendingStop = null;
    });

    return pendingStop;
  }

  function isRecording() {
    return !!mediaRecorder && mediaRecorder.state === 'recording';
  }

  function getAnalyser() {
    return pipeline?.analyser ?? null;
  }

  return { start, stop, isRecording, getAnalyser };
}
```

- [ ] **Step 2: Update app.js to pass noiseSuppression and wire up VAD**

In `src/app.js`, add the imports and update the recorder creation and recording flow:

Add imports at the top:
```js
import { getNoiseSuppressionEnabled } from './settings.js';
import { createVAD } from './vad.js';
```

Add a module-level VAD variable:
```js
let vad = null;
```

Update `$('btn-record').onclick` — change the `createRecorder` call to pass `noiseSuppression`, and start VAD after recording begins:

```js
recorder = createRecorder({
  noiseSuppression: getNoiseSuppressionEnabled(),
  onTick: (ms) => { $('timer').textContent = fmt(ms); },
  onLevel: (v) => {
    $('wave-bars').style.setProperty('--amp', String(Math.min(1, Math.max(0.35, v * 1.4))));
  },
  onAutoStop: (blob) => {
    vad?.stop();
    vad = null;
    recorder = null;
    if (state.phase !== 'recording') return;
    dispatch({ type: 'RECORD_STOP', blob });
    runTranscription();
  },
});
try {
  await recorder.start();
  dispatch({ type: 'RECORD_START' });
  // Start VAD after recording is live
  const analyser = recorder.getAnalyser();
  if (analyser) {
    vad = createVAD(analyser, {
      onSpeechStart: () => {
        $('wave-bars').classList.remove('vad-silent');
      },
      onSpeechEnd: () => {
        $('wave-bars').classList.add('vad-silent');
      },
    });
    vad.start();
  }
} catch (err) {
  // ... existing error handling unchanged ...
}
```

Update `$('btn-stop').onclick` — add VAD cleanup before the existing logic:

```js
$('btn-stop').onclick = async () => {
  if (!recorder) return;
  vad?.stop();
  vad = null;
  const blob = await recorder.stop();
  recorder = null;
  if (state.phase !== 'recording') return;
  if (blob) {
    dispatch({ type: 'RECORD_STOP', blob });
    runTranscription();
  } else {
    alert('Nothing was recorded.');
    dispatch({ type: 'RESET' });
  }
};
```

Update the `visibilitychange` handler — add VAD cleanup:

```js
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && state.phase === 'recording' && recorder) {
    vad?.stop();
    vad = null;
    const blob = await recorder.stop();
    recorder = null;
    if (state.phase !== 'recording') return;
    if (blob && blob.size > 0) dispatch({ type: 'RECORD_INTERRUPTED', blob });
    else dispatch({ type: 'RESET' });
  }
});
```

- [ ] **Step 3: Run existing tests to check for regressions**

```bash
npx vitest run
```

Expected: all existing tests pass. The recorder changes don't break state, settings, or other modules.

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
```

Open in browser. Record a voice note. Verify:
- Recording starts and produces audio
- Wave bars respond to voice level
- Transcription still works end-to-end
- No console errors

- [ ] **Step 5: Commit**

```bash
git add src/recorder.js src/app.js
git commit -m "feat: wire recorder through audio pipeline with noise suppression and VAD"
```

---

### Task 6: Settings UI — noise suppression toggle

**Files:**
- Modify: `index.html`
- Modify: `src/styles.css`
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `getNoiseSuppressionEnabled`, `setNoiseSuppressionEnabled` from `src/settings.js` (Task 2), `checkNoiseSuppressionSupport` from `src/audio-pipeline.js` (Task 4)
- Produces: visible toggle in Settings sheet; `vad-silent` CSS class on wave-bars

- [ ] **Step 1: Add toggle HTML to Settings sheet**

In `index.html`, inside the `.sheet-body` div, after the `.field` div (API key section), add:

```html
<div class="field">
  <label for="ns-toggle">Noise suppression</label>
  <div class="toggle-row">
    <input id="ns-toggle" type="checkbox" role="switch" />
    <span id="ns-label" class="hint-tight">Reduces background noise for cleaner transcriptions</span>
  </div>
</div>
```

- [ ] **Step 2: Add toggle and VAD-silent CSS**

In `src/styles.css`, after the `.field input:focus-visible` rule, add:

```css
.toggle-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.toggle-row span {
  margin: 0;
  font: 400 13px/1.4 var(--font-body);
  color: var(--color-neutral-500);
}

input[role="switch"] {
  appearance: none;
  -webkit-appearance: none;
  width: 44px;
  height: 26px;
  flex: none;
  border-radius: 13px;
  border: 1px solid var(--color-neutral-700);
  background: var(--color-neutral-800);
  position: relative;
  cursor: pointer;
  transition: background .2s ease, border-color .2s ease;
}
input[role="switch"]::before {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--color-neutral-400);
  transition: transform .2s ease, background .2s ease;
}
input[role="switch"]:checked {
  background: var(--color-accent-700);
  border-color: var(--color-accent);
}
input[role="switch"]:checked::before {
  transform: translateX(18px);
  background: var(--color-text);
}
input[role="switch"]:disabled {
  opacity: .4;
  cursor: not-allowed;
}
input[role="switch"]:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

Add the VAD-silent class after the `.wave-bars i` rule:

```css
.wave-bars.vad-silent {
  --amp: 0.15;
}
```

- [ ] **Step 3: Wire toggle behavior in app.js**

Add import at the top of `src/app.js` (if not already added in Task 5):

```js
import { checkNoiseSuppressionSupport } from './audio-pipeline.js';
```

Add initialization at the bottom of `src/app.js`, before the final `render()` call:

```js
// Noise suppression toggle
(async () => {
  const supported = await checkNoiseSuppressionSupport();
  const toggle = $('ns-toggle');
  const label = $('ns-label');

  if (!supported) {
    toggle.disabled = true;
    toggle.checked = false;
    label.textContent = 'Not supported on this browser';
    return;
  }

  toggle.checked = getNoiseSuppressionEnabled();
  toggle.onchange = () => {
    setNoiseSuppressionEnabled(toggle.checked);
  };
})();
```

Add `setNoiseSuppressionEnabled` to the existing settings import:

```js
import { getApiKey, setApiKey, hasApiKey, getNoiseSuppressionEnabled, setNoiseSuppressionEnabled } from './settings.js';
```

- [ ] **Step 4: Manual test the toggle**

```bash
npm run dev
```

Open in browser:
1. Open Settings — toggle should appear below API key, default ON
2. Toggle OFF → reload → toggle should be OFF (persisted)
3. Toggle ON → record → audio should be noticeably cleaner in a noisy environment
4. Wave bars should shrink during silence and expand during speech

- [ ] **Step 5: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add index.html src/styles.css src/app.js
git commit -m "feat: add noise suppression toggle in Settings and VAD visual indicator"
```

---

### Task 7: End-to-end verification and cleanup

**Files:**
- Possibly modify: any file from previous tasks if issues found

**Interfaces:**
- Consumes: all prior tasks
- Produces: verified working feature

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 2: Production build check**

```bash
npm run build
```

Expected: build succeeds. Check that the WASM and worklet assets appear in the `dist/assets/` output.

- [ ] **Step 3: Manual iOS Safari test**

Deploy to Netlify (or use `npm run preview`) and test on an iOS device:
1. Open the PWA
2. Open Settings — noise suppression toggle should be ON
3. Record a voice note in a quiet environment — should work as before
4. Record in a noisy environment (e.g. next to a fan or with background music) — compare transcription quality with toggle ON vs OFF
5. Wave bars should visually respond to speech vs silence
6. Verify no console errors

- [ ] **Step 4: Commit any fixes**

If any issues were found and fixed:

```bash
git add -A
git commit -m "fix: address issues found during end-to-end testing"
```
