import { callChatModel } from './llmClient.js';

// Restores English terms that speech-to-text wrote in Hebrew letters
// ("ויפי אינג'ינירינג" -> "VP engineering"), judged by the model from context.
//
// Why this is a separate step and not a rule in the cleanup prompt: a cleanup
// prompt with a mandate to rewrite words that "look transliterated" was measured
// to occasionally rewrite a place name into a different real city
// (רעננה -> הרצליה). Here the model never rewrites the message. It only proposes
// Hebrew -> English pairs, and code applies a pair only when its replacement is
// in Latin letters, so a Hebrew name can never turn into another Hebrew name.

// Hebrew glues prefix letters (ב ל ה ו כ מ ש) onto a following word, up to two of
// them. They are kept in Hebrew: "לסטייג'ינג" -> "לstaging", "מהבקנד" -> "מהbackend".
const PREFIXES = 'בלהוכמש';

// A Hebrew letter on either side means we are inside a longer word (באג vs באגרטל).
const HEB = '֐-׿';

// What a replacement may contain: Latin letters, digits, and the punctuation that
// appears in English terms (R&D, follow-up, CI/CD, Node.js). No Hebrew, ever.
const LATIN_TERM = /^[A-Za-z0-9](?:[A-Za-z0-9 .&'/+-]*[A-Za-z0-9.+])?$/;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SYSTEM_PROMPT = [
  `You read a Hebrew voice-note transcript. The speech-to-text step sometimes writes English words that the speaker said in English using Hebrew letters — job titles, tech and business terms, acronyms.`,
  `Find those words and give their English spelling, judging from the context of the whole message.`,
  ``,
  `Include only terms an Israeli would naturally type in English in a work chat — e.g. VP, CTO, engineering, product, deploy, staging, sprint, backend, dashboard, follow-up.`,
  `Do not include:`,
  `- Names of people, places, companies, or products — leave every name in Hebrew, even a foreign one`,
  `- Loanwords that are normally written in Hebrew letters (טלפון, מחשב, אינטרנט, מייל, אוטו)`,
  `- Ordinary Hebrew words, even if they could also be read as a transliteration`,
  `When unsure, leave the word out.`,
  ``,
  `Return a JSON object in this exact shape: {"terms": [{"he": "...", "en": "..."}]}`,
  `- "he" is the word or phrase exactly as it appears in the transcript, without attached Hebrew prefix letters (ב ל ה ו כ מ ש): for "לסטייג'ינג" give "סטייג'ינג"`,
  `- A multi-word term goes in one entry: {"he": "ויפי סיילס", "en": "VP sales"}`,
  `- "en" is written only in Latin letters, lowercase except acronyms and proper capitalization (VP, CTO, QA, API)`,
  `- If there are none, return {"terms": []}`,
].join('\n');

export async function findEnglishTerms(text, { provider, model, apiKey, onUsage }) {
  const content = await callChatModel({
    provider,
    model,
    apiKey,
    onUsage,
    temperature: 0,
    jsonMode: true,
    maxTokens: 1024,
    timeoutMs: 30000,
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: text }],
  });
  // Anthropic has no JSON mode, so tolerate a fenced or prefaced reply.
  const json = content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
  const terms = JSON.parse(json).terms;
  return Array.isArray(terms) ? terms : [];
}

/**
 * Applies model-proposed {he, en} pairs to the text. A pair is dropped unless its
 * "en" is Latin-only and its "he" is Hebrew — that is the guard against name
 * substitution. Hebrew prefix letters are preserved; matches inside longer words are not.
 */
export function applyEnglishTerms(text, terms) {
  const valid = terms
    .filter((t) => t && typeof t.he === 'string' && typeof t.en === 'string')
    .map((t) => ({ he: t.he.trim(), en: t.en.trim() }))
    .filter((t) => new RegExp(`[${HEB}]`).test(t.he) && LATIN_TERM.test(t.en))
    // Longest first, so a phrase wins over a single word it contains.
    .sort((a, b) => b.he.length - a.he.length);

  return valid.reduce((out, { he, en }) => {
    const pattern = new RegExp(`(^|[^${HEB}])([${PREFIXES}]{0,2})${escape(he)}(?![${HEB}])`, 'g');
    return out.replace(pattern, (_m, before, prefix) => before + prefix + en);
  }, text);
}

/**
 * Model-assisted restoration of English terms. Never fails the pipeline: on any
 * error the text comes back unchanged and cleanup proceeds as before.
 */
export async function restoreEnglishTerms(text, language, opts) {
  if (language !== 'he' || !opts.apiKey) return text;
  try {
    return applyEnglishTerms(text, await findEnglishTerms(text, opts));
  } catch {
    return text;
  }
}
