import { createRecorder } from './recorder.js';
import { transcribe } from './transcribe.js';
import { cleanup } from './cleanup.js';
import { detectLanguage } from './language.js';
import { restoreEnglishTerms } from './englishTerms.js';
import { copyText } from './clipboard.js';
import {
  getOpenAIKey, setOpenAIKey, hasOpenAIKey,
  getAnthropicKey, setAnthropicKey, hasAnthropicKey,
  getOpenRouterKey, setOpenRouterKey, hasOpenRouterKey,
  getCleanupProvider, setCleanupProvider, getCleanupModel, setCleanupModel,
  getCleanupAnthropicModel, setCleanupAnthropicModel,
  getRefineAnthropicModel, setRefineAnthropicModel,
  getRefineProvider, setRefineProvider, getRefineModel, setRefineModel,
  getNoiseSuppressionEnabled, setNoiseSuppressionEnabled,
  getLearningEnabled, setLearningEnabled,
  getLearningGlossaryEnabled, setLearningGlossaryEnabled,
  getLearningNoticeShown, setLearningNoticeShown,
} from './settings.js';
import { createVAD } from './vad.js';
import { checkNoiseSuppressionSupport } from './audio-pipeline.js';
import { initialState, reduce } from './state.js';
import { generateRefinementChips, applyRefinement } from './refine.js';
import { modelLabel, formatCost } from './pricing.js';
import {
  extractCandidates, mergeCandidates, safeApply, ruleKey, candidateKey, relevantRules, vocabularyTerms,
} from './corrections.js';
import { correctionsStore, RuleConflictError, StoreResetRequired, MAX_EXPORT_BYTES } from './correctionsStore.js';

let state = initialState;
let recorder = null;
let vad = null;
// Settings is a UI overlay, not a phase — it can sit over any screen, so it
// stays out of the state machine.
let settingsOpen = false;
// One-shot latch so the auto-copy confirmation fires when the result arrives,
// not on every later re-render of the same result.
let autoCopyAnnounced = false;

// Refine-panel overlay state (not in reducer — purely UI, layered over result).
let refineOpen = false;
let refineChips = null;   // null = not yet fetched; Array = fetched (may be empty on error)
let refineLoading = false;
let refineApplying = false;
let refineError = null;

// The text last written into #result-text. render() writes the textarea only
// when the source text changes, so no unrelated re-render can wipe an edit.
let lastShownText = null;

// Learned fixes (see docs/superpowers/specs/2026-10-21-learned-corrections-design.md §5).
// Candidates and dismissals live only while a result is on screen and are never
// stored. noteRules is the live rule list (capture filters, chips); notePassRules is
// the snapshot both correction passes of this note use, so a note never gains rules
// mid-way — two sets that are each valid could chain into each other.
let learnCandidates = [];
let dismissedKeys = new Set();
let noteRules = [];
let notePassRules = [];
let appliedRules = new Map(); // ruleKey → { rule, seen: Map<matchedText, writtenText> }
let chipNodes = new Map();    // candidateKey → chip element currently in #learn-chips
let chipsChangedAt = 0;
let appliedShown = '';
let learnAvailable = true;
let learnStatusTimer = null;
let learnNoticePending = false;
let recordedMs = 0; // length of the note being processed; no glossary under 2 s (echo risk)

const fixes = () => correctionsStore();
const learnActive = () => getLearningEnabled() && learnAvailable;

// Estimated LLM spend for the note on screen, per step: { usd, tokens, unknown, model }.
// Reset per recording; a cleanup retry or extra refine adds to it.
let noteCost = { cleanup: null, refine: null };

function trackUsage(step) {
  return (u) => {
    const prev = noteCost[step] ?? { usd: 0, tokens: 0, unknown: false };
    noteCost[step] = {
      usd: prev.usd + (u.costUsd ?? 0),
      tokens: prev.tokens + u.inputTokens + u.outputTokens,
      unknown: prev.unknown || u.costUsd == null,
      model: u.model,
    };
  };
}

function costText() {
  const { cleanup: c, refine: r } = noteCost;
  if (!c && !r) return '';
  const steps = [c, r].filter(Boolean);
  if (steps.some((s) => s.unknown)) {
    const tokens = steps.reduce((n, s) => n + s.tokens, 0).toLocaleString();
    return `Est. cost: unavailable for ${modelLabel(steps.find((s) => s.unknown).model)} (${tokens} tokens)`;
  }
  if (!r) return `Est. cost ≈ ${formatCost(c.usd)} · ${modelLabel(c.model)}`;
  if (!c) return `Est. cost ≈ ${formatCost(r.usd)} · refine`;
  return `Est. cost ≈ ${formatCost(c.usd + r.usd)} · cleanup ${formatCost(c.usd)} + refine ${formatCost(r.usd)}`;
}

const $ = (id) => document.getElementById(id);

// Model used when a step's provider is switched to 'openai'/'anthropic' directly
// (as opposed to 'openrouter', where the model comes from settings).
const DEFAULT_MODEL = { openai: 'gpt-4o', anthropic: 'claude-sonnet-5' };

function keyFor(provider) {
  if (provider === 'openai') return getOpenAIKey();
  if (provider === 'anthropic') return getAnthropicKey();
  return getOpenRouterKey();
}

function hasKeyFor(provider) {
  if (provider === 'openai') return hasOpenAIKey();
  if (provider === 'anthropic') return hasAnthropicKey();
  return hasOpenRouterKey();
}

function resolveStep(provider, model, anthropicModel = DEFAULT_MODEL.anthropic) {
  return {
    provider,
    model: provider === 'openrouter' ? model
      : provider === 'anthropic' ? anthropicModel
      : DEFAULT_MODEL[provider],
    apiKey: keyFor(provider),
  };
}

function dispatch(event) {
  state = reduce(state, event);
  render();
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// The recording waveform: 18 bars whose resting heights are re-rolled per
// recording, each running the same keyframe on a staggered delay.
const WAVE_BARS = 18;
function buildWave() {
  const host = $('wave-bars');
  host.replaceChildren(
    ...Array.from({ length: WAVE_BARS }, (_, i) => {
      const bar = document.createElement('i');
      bar.style.height = `${20 + Math.random() * 80}px`;
      bar.style.animationDelay = `${(i * 0.065).toFixed(3)}s`;
      return bar;
    })
  );
  host.style.setProperty('--amp', '1');
}

function render() {
  // Reset refine overlay state whenever we leave the result screen, so it
  // starts fresh on the next result (new recording or retry).
  if (state.phase !== 'result') {
    refineOpen = false;
    refineChips = null;
    refineLoading = false;
    refineApplying = false;
    refineError = null;
    lastShownText = null;
    learnCandidates = [];
    dismissedKeys = new Set();
    hideLearnStatus();
  }

  $('screen-idle').hidden = state.phase !== 'idle';
  $('screen-recording').hidden = state.phase !== 'recording';
  $('screen-busy').hidden = state.phase !== 'transcribing' && state.phase !== 'cleaning';
  $('screen-interrupted').hidden = state.phase !== 'interrupted';
  $('screen-result').hidden = state.phase !== 'result';
  $('settings').hidden = !settingsOpen;
  $('btn-settings').hidden = settingsOpen; // the sheet's own Done button replaces it

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
    $('key-status-openrouter').textContent = hasOpenRouterKey() ? 'Key saved ✓' : '';
  }

  if (state.phase === 'transcribing' || state.phase === 'cleaning') {
    // One "Processing" screen covers both legs of the pipeline, as designed.
    $('busy-label').textContent = 'Transcribing & cleaning up your voice note…';
    $('busy-error').hidden = !state.error;
    $('busy-error-msg').textContent = state.error || '';
    $('busy-spinner').hidden = !!state.error;
    $('busy-label').hidden = !!state.error;
  }

  if (state.phase === 'result') {
    const cleanupFailed = !state.cleanedText;
    $('cleanup-error').hidden = !cleanupFailed;
    $('cleaned-badge').hidden = cleanupFailed;
    const shown = state.cleanedText ?? state.rawTranscript ?? '';
    if (shown !== lastShownText) { $('result-text').value = shown; lastShownText = shown; }
    $('raw-text').textContent = state.rawTranscript ?? '';
    const cost = costText();
    $('cost-line').hidden = !cost;
    $('cost-line').textContent = cost;
    $('raw-details').hidden = cleanupFailed; // raw already shown as the main text
    if (learnNoticePending) {
      learnNoticePending = false;
      showLearnStatus([getLearningGlossaryEnabled()
        ? 'Learned fixes are now sent with your notes to your transcription and cleanup providers — turn off in Settings'
        : 'Learned fixes are now sent with your notes to your cleanup provider — turn off in Settings']);
    }
    renderLearnChips();
    renderLearnApplied();
    if (state.autoCopied && !autoCopyAnnounced) {
      autoCopyAnnounced = true;
      showCopied('Copied ✓ — paste it into your chat');
    }

    // Refine panel — only available when cleanup succeeded.
    const canRefine = !cleanupFailed;
    const refineHasKey = hasKeyFor(getRefineProvider());
    const btnRefine = $('btn-refine');
    btnRefine.hidden = !canRefine;
    btnRefine.disabled = canRefine && !refineHasKey;
    btnRefine.classList.toggle('active', refineOpen);
    $('refine-key-hint').hidden = !canRefine || refineHasKey;

    $('refine-panel').hidden = !(canRefine && refineHasKey && refineOpen);

    if (canRefine && refineOpen) {
      const busy = refineLoading || refineApplying;
      const loadingEl = $('refine-loading');
      loadingEl.hidden = !busy;
      if (busy) {
        $('refine-loading-label').textContent = refineApplying ? 'Refining…' : 'Generating options…';
      }

      const hasChips = Array.isArray(refineChips) && refineChips.length > 0;
      const chipsEl = $('refine-chips');
      chipsEl.hidden = !hasChips || busy;
      if (hasChips && !busy) {
        chipsEl.replaceChildren(
          ...refineChips.map((chip) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'refine-chip';
            btn.textContent = chip.label;
            btn.onclick = () => handleChipClick(chip);
            return btn;
          })
        );
      }

      const errorEl = $('refine-error');
      errorEl.hidden = !refineError;
      if (refineError) errorEl.textContent = refineError;

      $('result-text').disabled = refineApplying;
    } else {
      $('result-text').disabled = false;
    }
  } else {
    autoCopyAnnounced = false;
  }
}

// Swaps the Copy button's label for its confirmation, then swaps it back.
let copyFeedbackTimer = null;
function showCopied(message) {
  const fb = $('copy-feedback');
  fb.textContent = message;
  fb.hidden = false;
  $('copy-label').hidden = true;
  $('copy-error').hidden = true;
  if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
  copyFeedbackTimer = setTimeout(() => {
    fb.hidden = true;
    $('copy-label').hidden = false;
  }, 2500);
}

// Rules for the note about to be transcribed. Storage that is slow or broken
// never holds up the pipeline: after 1.5 s the note simply goes without them.
async function loadRulesForNote() {
  const timeout = new Promise((resolve) => setTimeout(resolve, 1500, null));
  const loaded = await Promise.race([fixes().loadState().catch(() => null), timeout]);
  if (!loaded) return [];
  if (loaded.unavailable || loaded.unsupported) learnAvailable = false;
  return loaded.rules;
}

// Said once, the first time learned data actually leaves the device.
function announceLearnedData() {
  if (getLearningNoticeShown()) return;
  setLearningNoticeShown(true);
  learnNoticePending = true;
}

function noteHit(rule, matched, written) {
  const key = ruleKey(rule);
  const entry = appliedRules.get(key) ?? { rule, seen: new Map() };
  entry.seen.set(matched, written);
  appliedRules.set(key, entry);
}

async function runTranscription() {
  noteCost = { cleanup: null, refine: null };
  appliedRules = new Map();
  appliedShown = '';
  const loaded = learnActive() ? await loadRulesForNote() : [];
  notePassRules = loaded;
  noteRules = loaded;
  try {
    const vocabulary = getLearningGlossaryEnabled() && recordedMs >= 2000 ? vocabularyTerms(loaded) : [];
    if (vocabulary.length) announceLearnedData();
    const heard = await transcribe(state.audioBlob, getOpenAIKey(), { vocabulary });
    // Re-checked after the await: Learning may have been switched off meanwhile.
    const rules = learnActive() ? loaded : [];
    // The pre-pass runs here, not in runCleanup, so the cleanup fallback, Retry
    // cleanup and restoreEnglishTerms all start from the corrected text.
    const hits = new Map();
    const text = safeApply(heard, rules, (rule, matched, written) => {
      hits.set(ruleKey(rule), rule);
      noteHit(rule, matched, written);
    });
    if (hits.size) fixes().recordHits([...hits.values()]);
    dispatch({ type: 'TRANSCRIBE_OK', text, language: detectLanguage(text) });
    runCleanup(rules);
  } catch (err) {
    dispatch({ type: 'TRANSCRIBE_FAIL', message: err.message });
  }
}

async function runCleanup(rules = notePassRules) {
  try {
    const step = { ...resolveStep(getCleanupProvider(), getCleanupModel(), getCleanupAnthropicModel()), onUsage: trackUsage('cleanup') };
    // English terms written in Hebrew letters are restored in a guarded step of
    // their own, before cleanup sees the text — see englishTerms.js.
    const withTerms = await restoreEnglishTerms(state.rawTranscript, state.language, step);
    // Only the rules this note actually touches reach the cleanup provider, and
    // none once Learning is off (it may have been switched off mid-note).
    const active = learnActive() ? rules : [];
    const corrections = relevantRules(withTerms, active);
    if (corrections.length) announceLearnedData();
    const cleaned = await cleanup(withTerms, state.language, { ...step, corrections });
    // The post-pass stops the model from bringing a fixed error back. Its hits are
    // shown but not counted: the pre-pass already counted the same occurrence.
    const text = safeApply(cleaned, active, noteHit);
    const autoCopied = await copyText(text);
    dispatch({ type: 'CLEANUP_OK', text, autoCopied });
  } catch (err) {
    // On cleanup failure the raw transcript is the fallback — auto-copy that instead.
    const autoCopied = await copyText(state.rawTranscript ?? '');
    dispatch({ type: 'CLEANUP_FAIL', message: err.message, autoCopied });
  }
}

$('btn-record').onclick = async () => {
  // Reentrancy guard: getUserMedia() latency leaves a window where the idle
  // screen (and this button) is still visible before RECORD_START flips the
  // phase and render() hides it. Without this check a double-tap here would
  // call createRecorder() a second time and overwrite the module-level
  // `recorder`, orphaning the first one's live mic stream, AudioContext/rAF
  // loop, and tick interval — unreachable forever, and its own 5:00 auto-stop
  // would later fire a stale dispatch onto whatever screen the user is on.
  // `recorder` is set synchronously below, before the first `await`, so a
  // second click landing while this one is still in flight sees it non-null
  // and bails before touching createRecorder() again.
  if (recorder) return;
  $('btn-record').disabled = true;
  $('timer').textContent = '0:00';
  recordedMs = 0;
  buildWave();
  recorder = createRecorder({
    noiseSuppression: getNoiseSuppressionEnabled(),
    onTick: (ms) => { $('timer').textContent = fmt(ms); recordedMs = ms; },
    // The bars keep their designed animation; the live level scales the whole
    // set, floored at .35 so a quiet moment still reads as "listening".
    onLevel: (v) => {
      $('wave-bars').style.setProperty('--amp', String(Math.min(1, Math.max(0.35, v * 1.4))));
    },
    onAutoStop: (blob) => {
      // This recorder instance's life is over either way (recorder.js has
      // already torn it down internally) — clear the module-level reference
      // so the reentrancy guard above doesn't block the *next* Record tap.
      vad?.stop();
      vad = null;
      recorder = null;
      // Idempotency guard: this can race a manual Stop that resolved first
      // (both calls share recorder.js's single in-flight stop() promise).
      // Only the path that finds phase still 'recording' proceeds — dispatch
      // is synchronous, so whichever settles first wins and the other no-ops.
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
    recorder = null;
    render(); // restore the idle screen's button state (still gated on hasOpenAIKey())
    alert(
      err.name === 'NotAllowedError'
        ? 'Microphone access denied. Enable it in iOS Settings → Apps → Safari → Microphone, then try again.'
        : `Could not start recording: ${err.message}`
    );
  }
};

$('btn-stop').onclick = async () => {
  // A prior tap (or auto-stop/visibilitychange) may have already nulled this
  // out — bail rather than dereferencing a stopped/gone recorder.
  if (!recorder) return;
  vad?.stop();
  vad = null;
  const blob = await recorder.stop();
  // This recorder instance's life is over either way — clear the reference
  // so the reentrancy guard on btn-record doesn't block the *next* tap.
  recorder = null;
  // Idempotency guard: a double-tap of Stop, or a manual Stop racing the
  // 5:00 auto-stop or a visibilitychange interruption, all resolve the same
  // shared recorder.js stop() promise. Only proceed if nothing else has
  // already moved the phase off 'recording'.
  if (state.phase !== 'recording') return;
  if (blob) {
    dispatch({ type: 'RECORD_STOP', blob });
    runTranscription();
  } else {
    alert('Nothing was recorded.');
    dispatch({ type: 'RESET' }); // nothing was captured
  }
};

// iOS suspends the page (and may kill the MediaRecorder) when backgrounded mid-recording.
// On return, salvage what the 1s timeslices captured and let the user decide.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && state.phase === 'recording' && recorder) {
    vad?.stop();
    vad = null;
    const blob = await recorder.stop();
    // This recorder instance's life is over either way — clear the reference
    // so the reentrancy guard on btn-record doesn't block the *next* tap.
    recorder = null;
    // Idempotency guard: a manual Stop (or auto-stop) may have already won
    // the race on the shared stop() promise and moved the phase along.
    if (state.phase !== 'recording') return;
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
  // Leaving the result screen clears candidates, so any found here would vanish unseen.
  commitEdits({ learn: false });
  dispatch({ type: 'CLEANUP_RETRY' });
  runCleanup();
};

// Brings state in line with the textarea, so Refine, Retry cleanup and later
// renders work from what the user actually sees.
function commitEdits({ learn = true } = {}) {
  const current = $('result-text').value;
  const baseline = state.cleanedText ?? state.rawTranscript ?? '';
  if (current === baseline || !current.trim()) return;
  if (learn && learnActive()) {
    // After the commit the baseline equals the textarea, so the next commit
    // only sees new edits and nothing is offered twice.
    try {
      learnCandidates = mergeCandidates(extractCandidates(baseline, current, { rules: noteRules }), learnCandidates, dismissedKeys);
    } catch {
      // Learning is optional; it must never stand between the user and their edit.
    }
  }
  lastShownText = current; // so the render below doesn't touch the textarea
  dispatch({ type: 'EDIT_COMMIT', text: current });
}

$('result-text').addEventListener('change', () => commitEdits());

$('btn-copy').onclick = async () => {
  // copyText must start synchronously inside the tap (iOS clipboard rule).
  const copied = copyText($('result-text').value);
  commitEdits();
  const ok = await copied;
  if (ok) showCopied('Copied ✓');
  else $('copy-error').hidden = false;
};

$('btn-whatsapp').onclick = () => {
  const text = $('result-text').value;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  commitEdits();
};

$('btn-refine').onclick = async () => {
  if (refineApplying) return;
  commitEdits();
  refineOpen = !refineOpen;
  render();

  // Fetch chips the first time the panel opens (or if it had no chips yet).
  if (refineOpen && !refineChips && !refineLoading) {
    refineLoading = true;
    refineError = null;
    render();
    try {
      refineChips = await generateRefinementChips(
        $('result-text').value,
        state.language ?? 'en',
        { ...resolveStep(getRefineProvider(), getRefineModel(), getRefineAnthropicModel()), onUsage: trackUsage('refine') }
      );
    } catch (err) {
      refineError = err.message;
      refineChips = null;
    } finally {
      refineLoading = false;
    }
    render();
  }
};

async function handleChipClick(chip) {
  if (refineApplying) return;
  commitEdits();
  refineApplying = true;
  refineError = null;
  render();
  try {
    const refined = await applyRefinement(
      $('result-text').value,
      state.language ?? 'en',
      chip.instruction,
      { ...resolveStep(getRefineProvider(), getRefineModel(), getRefineAnthropicModel()), onUsage: trackUsage('refine') }
    );
    // Close the panel and reset chips so next open generates fresh options for the new text.
    refineOpen = false;
    refineChips = null;
    refineApplying = false;
    // Dispatch keeps cleanedText in sync so render() doesn't overwrite the textarea.
    dispatch({ type: 'REFINE_OK', text: refined });
  } catch (err) {
    refineApplying = false;
    refineError = err.message;
    render();
  }
}

// ── learned fixes ───────────────────────────────────────────────────────────
// Learned strings reach the DOM only as text nodes: never as markup.

function bdi(text) {
  const el = document.createElement('bdi');
  el.textContent = text;
  return el;
}

function smallButton(label, ariaLabel, onClick, className = 'learn-chip-x') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
  btn.onclick = onClick;
  return btn;
}

// A chip that just appeared under the user's finger must not take the tap meant
// for whatever was there a moment ago.
const chipTapTooSoon = () => performance.now() - chipsChangedAt < 400;

function buildLearnChip(candidate) {
  const wrap = document.createElement('span');
  wrap.className = 'learn-chip';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'refine-chip';
  save.append('Always fix: ', bdi(candidate.from), ' → ', bdi(candidate.to));
  save.onclick = () => { if (!chipTapTooSoon()) saveLearnedFix(candidate); };
  const dismiss = smallButton('×', "Don't offer this", () => {
    if (chipTapTooSoon()) return;
    dismissedKeys.add(candidateKey(candidate));
    learnCandidates = learnCandidates.filter((c) => candidateKey(c) !== candidateKey(candidate));
    render();
  });
  wrap.append(save, dismiss);
  return wrap;
}

// Updated by key: chips still shown keep their nodes and their place, and new ones
// are appended, so a re-render never moves or recreates the chip being tapped.
function renderLearnChips() {
  const host = $('learn-chips');
  const shown = learnActive() ? learnCandidates.slice(0, 3) : [];
  const keys = shown.map(candidateKey);
  host.hidden = !shown.length;
  if (keys.length === chipNodes.size && keys.every((k) => chipNodes.has(k))) return;
  for (const [key, el] of chipNodes) {
    if (!keys.includes(key)) { el.remove(); chipNodes.delete(key); }
  }
  shown.forEach((c, i) => {
    if (chipNodes.has(keys[i])) return;
    const el = buildLearnChip(c);
    chipNodes.set(keys[i], el);
    host.append(el);
  });
  chipsChangedAt = performance.now();
}

function hideLearnStatus() {
  clearTimeout(learnStatusTimer);
  $('learn-status').hidden = true;
  $('learn-status').replaceChildren();
}

function showLearnStatus(parts, { timeoutMs = 0 } = {}) {
  clearTimeout(learnStatusTimer);
  const el = $('learn-status');
  el.replaceChildren(...parts);
  el.hidden = false;
  if (timeoutMs) learnStatusTimer = setTimeout(hideLearnStatus, timeoutMs);
}

async function saveLearnedFix(candidate, { confirmReset = false } = {}) {
  commitEdits();
  try {
    const { rules, evicted, replaced } = await fixes().saveRule(candidate, { confirmReset });
    // Live list only: this note's passes keep their snapshot.
    noteRules = rules;
    learnCandidates = learnCandidates.filter((c) => c.group !== candidate.group);
    const parts = ['Saved — future notes will use ‘', bdi(candidate.to), '’'];
    if (evicted) parts.push(' (removed ‘', bdi(evicted.from), ' → ', bdi(evicted.to), '’ to make room)');
    parts.push(smallButton('Undo', null, () => undoSave(candidate, replaced), 'learn-inline'));
    showLearnStatus(parts, { timeoutMs: 5000 });
  } catch (err) {
    if (err instanceof StoreResetRequired) {
      if (confirm("Learned fixes on this device can't be read. Start a new list? The unreadable one will be deleted.")) {
        await saveLearnedFix(candidate, { confirmReset: true });
        return;
      }
    } else if (err instanceof RuleConflictError) {
      const { conflict } = err;
      showLearnStatus([
        err.message,
        smallButton(`Delete ‘${conflict.from} → ${conflict.to}’ and save`, null, async () => {
          await deleteFix(conflict);
          await saveLearnedFix(candidate);
        }, 'learn-inline'),
      ]);
    } else {
      showLearnStatus(['Could not save this fix: ', err.message]);
    }
  }
  render();
  if (settingsOpen) refreshFixesList();
}

async function undoSave(candidate, replaced) {
  hideLearnStatus();
  try {
    noteRules = replaced
      ? (await fixes().saveRule(replaced)).rules
      : await fixes().deleteRule(candidate);
  } catch {
    showLearnStatus(['Could not undo — delete the fix in Settings.']);
  }
  render();
}

async function deleteFix(rule) {
  try {
    await fixes().deleteRule(rule);
  } catch {
    showLearnStatus(['Could not delete this fix.']);
    return;
  }
  const gone = (r) => ruleKey(r) === ruleKey(rule);
  noteRules = noteRules.filter((r) => !gone(r));
  // Removing a rule from the snapshot is always safe: any subset of a valid set
  // is valid. So Retry cleanup won't re-apply a rule the user just deleted.
  notePassRules = notePassRules.filter((r) => !gone(r));
  appliedRules.delete(ruleKey(rule));
  render();
}

// What fired on this note, as it appeared in the text, so a wrong rule is never
// invisible. Deleting one doesn't undo this note's replacement; the user edits it.
function renderLearnApplied() {
  const el = $('learn-applied');
  const entries = [...appliedRules.values()];
  const signature = entries.map((e) => `${ruleKey(e.rule)}=${[...e.seen].join()}`).join('\n');
  el.hidden = !entries.length;
  if (signature === appliedShown) return;
  appliedShown = signature;
  const parts = ['Learned fixes applied: '];
  entries.forEach(({ rule, seen }, i) => {
    if (i) parts.push('; ');
    [...seen].forEach(([matched, written], j) => parts.push(j ? ', ' : '', bdi(matched), ' → ', bdi(written)));
    parts.push(smallButton('×', `Delete fix ${rule.from} → ${rule.to}`, () => deleteFix(rule)));
  });
  el.replaceChildren(...parts);
}

// Taps on a chip must not blur the textarea: no change event and no re-render
// between press and click, so an edit made after the chips appeared survives.
// The refine chips get the same treatment: the blur's change event re-renders,
// and a chip rebuilt between press and release would swallow the tap.
for (const type of ['pointerdown', 'mousedown']) {
  $('learn-chips').addEventListener(type, (e) => e.preventDefault());
  $('refine-chips').addEventListener(type, (e) => e.preventDefault());
}

let fixesShown = [];

function fixesStatusText(s) {
  if (s.unavailable) return 'Learned fixes need browser storage, which is blocked here.';
  if (s.unsupported) return 'Learned fixes were saved by a newer version of the app. Reload to update, or use Clear all to start over. Nothing will be changed until then.';
  if (s.unreadable) return 'Learned fixes on this device could not be read. Import a backup to restore them, or save a new fix to start a fresh list.';
  if (s.dropped) return `${s.dropped} stored fixes were invalid and were ignored.`;
  return '';
}

function renderFixesList(s) {
  learnAvailable = !s.unavailable && !s.unsupported;
  fixesShown = [...s.rules].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt) || b.count - a.count);
  $('fixes-list').replaceChildren(...fixesShown.map((rule) => {
    const row = document.createElement('li');
    row.className = 'fixes-row';
    const count = document.createElement('span');
    count.className = 'fixes-count';
    count.textContent = `×${rule.count}`;
    row.append(bdi(rule.from), ' → ', bdi(rule.to), count,
      smallButton('×', `Delete fix ${rule.from} → ${rule.to}`, async () => { await deleteFix(rule); refreshFixesList(); }));
    return row;
  }));
  const status = fixesStatusText(s);
  $('fixes-status').hidden = !status;
  $('fixes-status').textContent = status;
  $('fixes-empty').hidden = fixesShown.length > 0 || !!status;
  // Clear all stays available for an unsupported or unreadable store: the record
  // version sits outside the ciphertext, so a corrupted one would otherwise lock
  // the store for good.
  $('btn-fixes-clear').disabled = s.unavailable || (!fixesShown.length && !s.unsupported && !s.unreadable);
}

async function refreshFixesList() {
  $('fixes-status').hidden = false;
  $('fixes-status').textContent = 'Loading…';
  $('fixes-empty').hidden = true;
  renderFixesList(await fixes().loadState());
}

$('btn-fixes-clear').onclick = async () => {
  const n = fixesShown.length;
  if (!confirm(n ? `Delete all ${n} learned fixes? This can't be undone.` : "Delete all learned fixes? This can't be undone.")) return;
  try {
    await fixes().clearAll();
    noteRules = [];
    notePassRules = [];
  } catch (err) {
    $('fixes-status').hidden = false;
    $('fixes-status').textContent = err.code === 'blocked'
      ? 'Close other Voice Note tabs and try again.'
      : 'Could not clear learned fixes.';
    return;
  }
  render();
  refreshFixesList();
};

const learningToggle = $('learning-toggle');
learningToggle.checked = getLearningEnabled();
learningToggle.onchange = async () => {
  setLearningEnabled(learningToggle.checked);
  if (!learningToggle.checked) {
    // The kill switch: no capture, no chips, and no post-pass on a later Retry.
    learnCandidates = [];
    noteRules = [];
    notePassRules = [];
  } else if (state.phase === 'result') {
    noteRules = await loadRulesForNote();
  }
  render();
};

const glossaryToggle = $('glossary-toggle');
glossaryToggle.checked = getLearningGlossaryEnabled();
glossaryToggle.onchange = () => setLearningGlossaryEnabled(glossaryToggle.checked);

// Export / Import. Both always go through a passphrase: the file travels.
let passAction = null;   // 'export' | 'import'
let importFile = null;
let exportFile = null;

function transferStatus(...parts) {
  const el = $('fixes-transfer-status');
  el.replaceChildren(...parts);
  el.hidden = !parts.length;
}

function openPassRow(action) {
  passAction = action;
  exportFile = null;
  $('fixes-pass-row').hidden = false;
  $('fixes-pass').value = '';
  $('fixes-pass-confirm').value = '';
  $('fixes-pass').autocomplete = action === 'export' ? 'new-password' : 'current-password';
  $('fixes-pass-confirm').hidden = action !== 'export';
  $('btn-fixes-pass-go').hidden = false;
  $('btn-fixes-share').hidden = true;
  transferStatus();
  $('fixes-pass').focus();
}

function closePassRow() {
  passAction = null;
  importFile = null;
  exportFile = null;
  $('fixes-pass').value = '';
  $('fixes-pass-confirm').value = '';
  $('fixes-pass-row').hidden = true;
}

$('btn-fixes-export').onclick = () => openPassRow('export');
$('btn-fixes-import').onclick = () => $('fixes-import-file').click();
$('btn-fixes-pass-cancel').onclick = () => { closePassRow(); transferStatus(); };

$('fixes-import-file').onchange = () => {
  const input = $('fixes-import-file');
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > MAX_EXPORT_BYTES) {
    transferStatus('Not a valid learned-fixes file, or wrong passphrase');
    return;
  }
  openPassRow('import');
  importFile = file;
};

async function runImport(file, passphrase, { confirmReset = false } = {}) {
  try {
    const { added, skipped } = await fixes().importFixes(file, passphrase, { confirmReset });
    closePassRow();
    // Listed so the user can review what came in, and delete any of it.
    const parts = [added.length ? `Imported ${added.length} fixes: ` : 'No new fixes to import.'];
    added.forEach((r, i) => parts.push(i ? ', ' : '', bdi(r.from), ' → ', bdi(r.to)));
    if (skipped.length) parts.push(` (${skipped.length} skipped: they conflict with fixes you already have, or the list is full)`);
    transferStatus(...parts);
    refreshFixesList();
  } catch (err) {
    if (err instanceof StoreResetRequired) {
      if (confirm("Learned fixes on this device can't be read. Replace them with the imported ones? The unreadable list will be deleted.")) {
        await runImport(file, passphrase, { confirmReset: true });
      } else {
        closePassRow();
        transferStatus();
      }
      return;
    }
    closePassRow();
    transferStatus(err.message);
  }
}

$('btn-fixes-pass-go').onclick = async () => {
  const passphrase = $('fixes-pass').value;
  if (passAction === 'export') {
    if (passphrase.length < 10) { transferStatus('Use a passphrase of at least 10 characters.'); return; }
    if (passphrase !== $('fixes-pass-confirm').value) { transferStatus("The passphrases don't match."); return; }
    $('fixes-pass').value = '';
    $('fixes-pass-confirm').value = '';
    transferStatus('Encrypting…');
    try {
      exportFile = await fixes().exportFixes(passphrase);
    } catch (err) {
      closePassRow();
      transferStatus(err.message);
      return;
    }
    // PBKDF2 takes about a second, after which navigator.share may have lost the
    // tap's user activation — so sharing gets a tap of its own.
    $('btn-fixes-pass-go').hidden = true;
    $('btn-fixes-share').hidden = false;
    transferStatus('Ready. Keep the passphrase: the file cannot be opened without it.');
  } else if (passAction === 'import' && importFile) {
    $('fixes-pass').value = '';
    transferStatus('Decrypting…');
    await runImport(importFile, passphrase);
  }
};

$('btn-fixes-share').onclick = async () => {
  const file = exportFile;
  if (!file) return;
  closePassRow();
  transferStatus();
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] }).catch(() => {});
    return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

// Another tab (or this one) changed the stored fixes.
fixes().onChange(async () => {
  const s = await fixes().loadState();
  noteRules = learnActive() ? s.rules : [];
  const live = new Map(s.rules.map((r) => [ruleKey(r), r.to]));
  // Removals reach this note's snapshot, additions never do. A failed load
  // empties it, which only turns the post-pass off: the safe direction.
  notePassRules = notePassRules.filter((r) => live.get(ruleKey(r)) === r.to);
  if (settingsOpen) renderFixesList(s);
  render();
});

$('btn-new').onclick = () => dispatch({ type: 'RESET' });

const setSettingsOpen = (open) => {
  settingsOpen = open;
  render();
  if (open) refreshFixesList();
};
$('btn-settings').onclick = () => setSettingsOpen(true);
$('btn-settings-done').onclick = () => setSettingsOpen(false);

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

$('btn-save-key-openrouter').onclick = () => {
  setOpenRouterKey($('api-key-openrouter').value);
  const saved = hasOpenRouterKey();
  $('api-key-openrouter').value = '';
  render();
  $('key-status-openrouter').textContent = saved ? 'Key saved ✓' : 'Key cleared';
};

function wireProviderPicker({ providerSelect, providerGetter, providerSetter, modelRow, modelSelect, modelGetter, modelSetter, customInput, anthropic }) {
  const savedProvider = providerGetter();
  providerSelect.value = savedProvider;
  modelRow.hidden = savedProvider !== 'openrouter';

  if (anthropic) {
    anthropic.row.hidden = savedProvider !== 'anthropic';
    anthropic.select.value = anthropic.getter();
    // A stored ID no longer in the list falls back to the first option, and
    // the fallback is persisted so requests don't keep sending the stale ID.
    if (!anthropic.select.value) {
      anthropic.select.selectedIndex = 0;
      anthropic.setter(anthropic.select.value);
    }
    anthropic.select.onchange = () => anthropic.setter(anthropic.select.value);
  }

  const savedModel = modelGetter();
  const isCurated = Array.from(modelSelect.options).some((o) => o.value === savedModel);
  modelSelect.value = isCurated ? savedModel : 'custom';
  customInput.hidden = modelSelect.value !== 'custom';
  customInput.value = isCurated ? '' : savedModel;

  providerSelect.onchange = () => {
    providerSetter(providerSelect.value);
    modelRow.hidden = providerSelect.value !== 'openrouter';
    if (anthropic) anthropic.row.hidden = providerSelect.value !== 'anthropic';
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

wireProviderPicker({
  providerSelect: $('provider-cleanup'),
  providerGetter: getCleanupProvider,
  providerSetter: setCleanupProvider,
  modelRow: $('model-row-cleanup'),
  modelSelect: $('model-cleanup'),
  modelGetter: getCleanupModel,
  modelSetter: setCleanupModel,
  customInput: $('model-custom-cleanup'),
  anthropic: {
    row: $('anthropic-model-row-cleanup'),
    select: $('anthropic-model-cleanup'),
    getter: getCleanupAnthropicModel,
    setter: setCleanupAnthropicModel,
  },
});

wireProviderPicker({
  providerSelect: $('provider-refine'),
  providerGetter: getRefineProvider,
  providerSetter: setRefineProvider,
  modelRow: $('model-row-refine'),
  modelSelect: $('model-refine'),
  modelGetter: getRefineModel,
  modelSetter: setRefineModel,
  customInput: $('model-custom-refine'),
  anthropic: {
    row: $('anthropic-model-row-refine'),
    select: $('anthropic-model-refine'),
    getter: getRefineAnthropicModel,
    setter: setRefineAnthropicModel,
  },
});

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

render();
