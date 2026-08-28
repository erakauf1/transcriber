export const TRANSCRIBE_MODEL = 'gpt-4o-transcribe';

export class TranscriptionError extends Error {}

// Speakers mix languages; each language must stay in its own script.
const SCRIPT_HINT =
  'This recording may mix languages. Write every word in its original script: ' +
  'keep English words such as deploy, follow-up, meeting, standup, and sprint in Latin letters, ' +
  'and keep Hebrew words in Hebrew letters. Do not transliterate between scripts.';

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

  let res;
  try {
    res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(120000),
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
