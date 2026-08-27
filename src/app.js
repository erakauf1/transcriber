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
