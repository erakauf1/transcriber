export const CLEANUP_MODEL = 'gpt-4o';

export class CleanupError extends Error {}

const LANGUAGE_NAMES = { he: 'Hebrew', en: 'English' };

export function buildSystemPrompt(language) {
  const lang = LANGUAGE_NAMES[language] || 'English';
  return [
    `You clean up voice-note transcripts so they can be sent as chat messages.`,
    `The message is in ${lang}. Your entire output must be in ${lang}.`,
    `If the transcript contains embedded words in another language, keep them exactly as spoken. Never translate anything.`,
    `Some words may already be written in Latin letters inside the message. Leave them exactly as they are \u2014 do not convert them to the local script, and do not respell them.`,
    // Deliberately absent: any instruction to rewrite words that "look transliterated".
    // That mandate was measured to make the model occasionally rewrite a malformed
    // place name into a different real city. Transliteration is now undone
    // deterministically in src/loanwords.js, before this prompt ever sees the text.
    `Never change a name of a person or place \u2014 not its script, not its spelling, and never to a different name, even if it looks misspelled or reads awkwardly in context. A wrong name is worse than an awkward one. Leave ordinary words of the message's own language exactly as they are.`,
    ``,
    `Do:`,
    `- Remove filler words (um, uh, like, אמם, אה, כאילו), false starts, and repeated words`,
    `- Fix grammar and punctuation. Pay close attention to prepositions, definite articles, and date and number expressions \u2014 speech-to-text output is most often malformed there`,
    `- Merge rambling fragments into complete sentences`,
    `- If the speaker circles back to an earlier topic, fold that remark into where it belongs`,
    `- Drop pure detours that are not part of the message (e.g. "wait, someone's at the door")`,
    `- Add paragraph breaks (blank lines) between distinct topics or thoughts`,
    `- When the speaker lists items, steps, tasks, options, or action items, format them as a bulleted list using "• " (bullet + space) at the start of each item, one item per line`,
    `- If a list has a lead-in phrase (e.g. "we need to:" or "a few things:"), keep it on its own line followed by the bullets`,
    `- Use a single line break (not a blank line) to separate closely related but distinct statements within the same topic — e.g. a decision and its reason, a question and its context`,
    `- Don’t cram everything into one dense block — when in doubt, break into shorter lines rather than long paragraphs`,
    ``,
    `Don't:`,
    `- Don't translate anything`,
    `- Don't change slang or personal tone into formal writing`,
    `- Don't add content, greetings, or sign-offs that were not spoken`,
    `- Don't add a period at the end of the message — this is a chat message, not a formal document`,
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
