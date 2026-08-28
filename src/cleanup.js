export const CLEANUP_MODEL = 'gpt-4o';

export class CleanupError extends Error {}

const LANGUAGE_NAMES = { he: 'Hebrew', en: 'English' };

export function buildSystemPrompt(language) {
  const lang = LANGUAGE_NAMES[language] || 'English';
  return [
    `You clean up voice-note transcripts so they can be sent as chat messages.`,
    `The message is in ${lang}. Your entire output must be in ${lang}.`,
    `If the transcript contains embedded words in another language, keep them exactly as spoken. Never translate anything.`,
    `The speech-to-text step often transliterates foreign terms into the local script \u2014 writing "deploy" as \u05d3\u05d9\u05e4\u05dc\u05d5\u05d9, "staging" as \u05e1\u05d8\u05d9\u05d9\u05d2'\u05d9\u05e0\u05d2, or "release" as \u05e8\u05dc\u05d9\u05e1. Undo this: write every English-origin technical, business, or work term in Latin script, correctly spelled \u2014 for example backend, frontend, staging, deploy, release, sprint, standup, bug, dashboard, scope, follow-up, blocker, minor, API, QA. Be consistent: never leave one such term in Hebrew letters while another appears in Latin.`,
    `Never change a name of a person or place \u2014 not its script, not its spelling, and never to a different name, even if it looks misspelled or reads awkwardly in context. A wrong name is worse than an awkward one. Leave ordinary words of the message's own language exactly as they are.`,
    ``,
    `Do:`,
    `- Remove filler words (um, uh, like, אמם, אה, כאילו), false starts, and repeated words`,
    `- Fix grammar and punctuation. Pay close attention to prepositions, definite articles, and date and number expressions \u2014 speech-to-text output is most often malformed there`,
    `- Merge rambling fragments into complete sentences`,
    `- If the speaker circles back to an earlier topic, fold that remark into where it belongs`,
    `- Drop pure detours that are not part of the message (e.g. "wait, someone's at the door")`,
    `- Add paragraph breaks in longer messages`,
    ``,
    `Don't:`,
    `- Don't translate anything`,
    `- Don't change slang or personal tone into formal writing`,
    `- Don't add content, greetings, or sign-offs that were not spoken`,
    `- Don't summarize — keep the same message, just tighter`,
    ``,
    `Output only the cleaned message. No preamble, no quotes, no explanations.`,
  ].join('\n');
}

export async function cleanup(text, language, apiKey) {
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CLEANUP_MODEL,
        // Zero, not merely low: sampling randomness was measured to make the model
        // occasionally "repair" a malformed place name into a different real city
        // (רעננה -> הרצליה). Determinism is what a faithful-cleanup task wants.
        temperature: 0,
        messages: [
          { role: 'system', content: buildSystemPrompt(language) },
          { role: 'user', content: text },
        ],
      }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (err) {
    throw new CleanupError(`Network error: ${err.message}`);
  }
  if (!res.ok) throw new CleanupError(`Cleanup failed (HTTP ${res.status})`);

  const data = await res.json();
  const out = data.choices?.[0]?.message?.content?.trim();
  if (!out) throw new CleanupError('Cleanup returned empty output');
  return out;
}
