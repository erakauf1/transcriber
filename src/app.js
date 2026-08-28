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
  $('settings').hidden = state.phase !== 'idle' && !state.error;

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
    $('busy-label').textContent = state.phase === 'transcribing' ? 'Transcribing…' : 'Cleaning up…';
    $('busy-error').hidden = !state.error;
    $('busy-error-msg').textContent = state.error || '';
    $('busy-spinner').hidden = !!state.error;
    $('busy-label').hidden = !!state.error;
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
    // Undo transliterated work terms in code before the LLM sees the text — see loanwords.js.
    const text = await cleanup(restoreLoanwords(state.rawTranscript), state.language, getApiKey());
    dispatch({ type: 'CLEANUP_OK', text });
  } catch (err) {
    dispatch({ type: 'CLEANUP_FAIL', message: err.message });
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
  recorder = createRecorder({
    onTick: (ms) => { $('timer').textContent = fmt(ms); },
    onLevel: (v) => { $('level-bar').style.width = `${Math.min(100, v * 140)}%`; },
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

let copyFeedbackTimer = null;
$('btn-copy').onclick = async () => {
  const ok = await copyText($('result-text').value);
  const fb = $('copy-feedback');
  fb.textContent = ok ? 'Copied ✓ — paste it into your chat' : 'Copy failed — long-press the text and copy manually';
  fb.hidden = false;
  if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
  copyFeedbackTimer = setTimeout(() => { fb.hidden = true; }, 2500);
};

$('btn-new').onclick = () => dispatch({ type: 'RESET' });

$('btn-save-key').onclick = () => {
  setApiKey($('api-key').value);
  $('key-status').textContent = hasApiKey() ? 'Key saved ✓' : 'Key cleared';
  $('api-key').value = '';
  render();
};

render();
