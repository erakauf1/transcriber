// Detects the dominant script of a transcript. Deterministic — never asks the LLM.
const HEBREW_RE = /[\u0590-\u05FF]/g;
const LATIN_RE = /[A-Za-z]/g;

export function detectLanguage(text) {
  const hebrew = (text.match(HEBREW_RE) || []).length;
  const latin = (text.match(LATIN_RE) || []).length;
  return hebrew > latin ? 'he' : 'en';
}
