import { withRetry } from './retry.js';
import { classifyOpenAIError, isNetworkError, readErrorBody } from './api-errors.js';

export const TRANSCRIBE_MODEL = 'gpt-4o-transcribe';

export class TranscriptionError extends Error {}

// Speakers mix languages; each language must stay in its own script.
const SCRIPT_HINT =
  'This recording may mix languages. Write every word in its original script: ' +
  'keep English words such as deploy, follow-up, meeting, standup, and sprint in Latin letters, ' +
  'and keep Hebrew words in Hebrew letters. Do not transliterate between scripts.';

// A single transient 429 or network blip used to discard the whole recording — the user
// would have to re-record from scratch. withRetry backs off and tries again a few times
// before giving up; only a terminal error (bad key, malformed request, ...) or exhausting
// every attempt surfaces to the caller, same as before this layer existed.
export async function transcribe(blob, apiKey) {
  const form = new FormData();
  const ext = (blob.type || '').includes('mp4') ? 'm4a' : 'webm';
  form.append('file', blob, `note.${ext}`);
  form.append('model', TRANSCRIBE_MODEL);
  // Deliberately no `language` param: auto-detect keeps code-switched words in their
  // original script instead of forcing everything into one language.
  // The prompt is a style hint, not an instruction the model must obey — it reduces
  // transliteration (deploy → דיפלוי) but cleanup.js restores whatever slips through.
  form.append('prompt', SCRIPT_HINT);

  return withRetry(() => attemptTranscribe(form, apiKey), {
    isRetryable: (err) => err instanceof TranscriptionError && err.retryable === true,
  });
}

async function attemptTranscribe(form, apiKey) {
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(120000),
    });
  } catch (err) {
    const wrapped = new TranscriptionError(`Network error: ${err.message}`);
    wrapped.retryable = isNetworkError(err);
    throw wrapped;
  }
  if (!res.ok) {
    const body = await readErrorBody(res);
    const err = new TranscriptionError(`Transcription failed (HTTP ${res.status})`);
    err.status = res.status;
    err.retryable = classifyOpenAIError(res.status, body);
    throw err;
  }

  const data = await res.json();
  const text = (data.text || '').trim();
  // Empty output is a semantic failure, not a transient one — retrying the same audio
  // against the same model will produce the same empty result. Leave `retryable` unset
  // (falsy) so withRetry doesn't burn attempts on it.
  if (!text) throw new TranscriptionError('Transcription returned empty text');
  return text;
}
