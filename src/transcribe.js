import { fold } from './hebrew.js';
import { normalizeRuleString, MAX_VOCAB_TERMS, MAX_VOCAB_CHARS } from './corrections.js';

export const TRANSCRIBE_MODEL = 'gpt-4o-transcribe';

export class TranscriptionError extends Error {}

// Speakers mix languages; each language must stay in its own script.
const SCRIPT_HINT =
  'This recording may mix languages. Write every word in its original script: ' +
  'keep English words such as deploy, follow-up, meeting, standup, and sprint in Latin letters, ' +
  'and keep Hebrew words in Hebrew letters. Do not transliterate between scripts.';

// Learned spellings, capped again here for callers outside app.js. Whisper
// documents a 224-token prompt limit; gpt-4o-transcribe documents none, so the
// same budget is assumed.
function glossaryTerms(vocabulary) {
  const terms = [];
  let chars = 0;
  for (const term of vocabulary) {
    if (normalizeRuleString(term) !== term || terms.includes(term)) continue;
    const add = (terms.length ? 2 : 0) + term.length;
    if (terms.length >= MAX_VOCAB_TERMS || chars + add > MAX_VOCAB_CHARS) break;
    terms.push(term);
    chars += add;
  }
  return terms;
}

// A plain comma-separated list after the script hint, with no instruction
// wording: less likely to be echoed or to steer language detection.
export function buildTranscriptionPrompt(vocabulary = []) {
  const terms = glossaryTerms(vocabulary);
  return terms.length ? `${SCRIPT_HINT} ${terms.join(', ')}.` : SCRIPT_HINT;
}

const isFiller = (c) => /[\s\p{P}]/u.test(c);

// Whisper-family models can echo their prompt on silent or very short audio:
// the whole glossary, or a run of it glued onto real speech.
function looksEchoed(text, terms) {
  const t = fold(text).toLowerCase();
  const folded = terms.map((x) => fold(x).toLowerCase());
  let rest = t;
  for (const term of [...folded].sort((a, b) => b.length - a.length)) rest = rest.split(term).join(' ');
  if (!/[\p{L}\p{N}]/u.test(rest)) return true;
  for (let i = 0; i + 1 < folded.length; i++) {
    const [a, b] = [folded[i], folded[i + 1]];
    for (let at = t.indexOf(a); at >= 0; at = t.indexOf(a, at + 1)) {
      let j = at + a.length;
      while (j < t.length && isFiller(t[j])) j++;
      if (j > at + a.length && t.startsWith(b, j)) return true;
    }
  }
  return false;
}

export async function transcribe(blob, apiKey, { vocabulary = [] } = {}) {
  const terms = glossaryTerms(vocabulary);
  const prompt = buildTranscriptionPrompt(terms);
  const text = await requestTranscript(blob, apiKey, prompt);
  // One retry without the glossary, so a silent clip fails exactly as it does without it.
  if (terms.length && looksEchoed(text, terms)) return requestTranscript(blob, apiKey, SCRIPT_HINT);
  return text;
}

async function requestTranscript(blob, apiKey, prompt) {
  const form = new FormData();
  const ext = (blob.type || '').includes('mp4') ? 'm4a' : 'webm';
  form.append('file', blob, `note.${ext}`);
  form.append('model', TRANSCRIBE_MODEL);
  // Deliberately no `language` param: auto-detect keeps code-switched words in their
  // original script instead of forcing everything into one language.
  // The prompt is a style hint, not an instruction the model must obey — it reduces
  // transliteration (deploy → דיפלוי) but cleanup.js restores whatever slips through.
  form.append('prompt', prompt);

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
