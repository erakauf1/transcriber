import { createRecorder } from './recorder.js';
import { transcribe } from './transcribe.js';
import { cleanup } from './cleanup.js';
import { detectLanguage } from './language.js';
import { restoreLoanwords } from './loanwords.js';
import { copyText } from './clipboard.js';
import { getApiKey, setApiKey, hasApiKey } from './settings.js';
import { initialState, reduce } from './state.js';

let state = initialState;
let recorder = null;
// Settings is a UI overlay, not a phase — it can sit over any screen, so it
// stays out of the state machine.
let settingsOpen = false;
// One-shot latch so the auto-copy confirmation fires when the result arrives,
// not on every later re-render of the same result.
let autoCopyAnnounced = false;

const $ = (id) => document.getElementById(id);

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
  $('screen-idle').hidden = state.phase !== 'idle';
  $('screen-recording').hidden = state.phase !== 'recording';
  $('screen-busy').hidden = state.phase !== 'transcribing' && state.phase !== 'cleaning';
  $('screen-interrupted').hidden = state.phase !== 'interrupted';
  $('screen-result').hidden = state.phase !== 'result';
  $('settings').hidden = !settingsOpen;
  $('btn-settings').hidden = settingsOpen; // the sheet's own Done button replaces it

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
    $('result-text').value = state.cleanedText ?? state.rawTranscript ?? '';
    $('raw-text').textContent = state.rawTranscript ?? '';
    $('raw-details').hidden = cleanupFailed; // raw already shown as the main text
    if (state.autoCopied && !autoCopyAnnounced) {
      autoCopyAnnounced = true;
      showCopied('Copied ✓ — paste it into your chat');
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
    // Undo transliterated work terms in code before the LLM sees the text — see loanwords.js.
    const text = await cleanup(restoreLoanwords(state.rawTranscript), state.language, getApiKey());
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
  buildWave();
  recorder = createRecorder({
    onTick: (ms) => { $('timer').textContent = fmt(ms); },
    // The bars keep their designed animation; the live level scales the whole
    // set, floored at .35 so a quiet moment still reads as "listening".
    onLevel: (v) => {
      $('wave-bars').style.setProperty('--amp', String(Math.min(1, Math.max(0.35, v * 1.4))));
    },
    onAutoStop: (blob) => {
      // This recorder instance's life is over either way (recorder.js has
      // already torn it down internally) — clear the module-level reference
      // so the reentrancy guard above doesn't block the *next* Record tap.
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
  } catch (err) {
    recorder = null;
    render(); // restore the idle screen's button state (still gated on hasApiKey())
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
  dispatch({ type: 'CLEANUP_RETRY' });
  runCleanup();
};

$('btn-copy').onclick = async () => {
  const ok = await copyText($('result-text').value);
  if (ok) showCopied('Copied ✓');
  else $('copy-error').hidden = false;
};

$('btn-whatsapp').onclick = () => {
  const text = $('result-text').value;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
};

$('btn-new').onclick = () => dispatch({ type: 'RESET' });

const setSettingsOpen = (open) => { settingsOpen = open; render(); };
$('btn-settings').onclick = () => setSettingsOpen(true);
$('btn-settings-done').onclick = () => setSettingsOpen(false);

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

render();
