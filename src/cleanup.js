export const CLEANUP_MODEL = 'claude-sonnet-5';

export class CleanupError extends Error {}

const LANGUAGE_NAMES = { he: 'Hebrew', en: 'English' };

export function buildSystemPrompt(language) {
  const lang = LANGUAGE_NAMES[language] || 'English';
  return [
    `You clean up voice-note transcripts so they can be sent as chat messages.`,
    `The message is in ${lang}. Your entire output must be in ${lang}.`,
    `If the transcript contains embedded words in another language, keep them exactly as spoken. Never translate anything.`,
    `Some words may already be written in Latin letters inside the message. Leave them exactly as they are — do not convert them to the local script, and do not respell them.`,
    // Deliberately absent: any instruction to rewrite words that "look transliterated".
    // That mandate was measured to make the model occasionally rewrite a malformed
    // place name into a different real city. Transliteration is now undone
    // deterministically in src/loanwords.js, before this prompt ever sees the text.
    `Never change a name of a person or place — not its script, not its spelling, and never to a different name, even if it looks misspelled or reads awkwardly in context. A wrong name is worse than an awkward one. Leave ordinary words of the message's own language exactly as they are.`,
    ``,
    `Do:`,
    `- Remove filler words (um, uh, like, אמם, אה, כאילו), false starts, and repeated words`,
    `- Fix grammar and punctuation. Pay close attention to prepositions, definite articles, and date and number expressions — speech-to-text output is most often malformed there`,
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

// Fixed few-shot examples, one pair per language, shown to the model before the real
// transcript. They demonstrate the exact do-this/never-that tension the rules above
// describe: fix disfluent grammar aggressively, but never touch a name even when it
// looks odd. Anchoring with a worked example is more reliable than stating the rules
// as prohibitions alone — this is the direct response to the known רעננה→הרצליה
// name-substitution bug (see the comment in buildSystemPrompt above).
const FEW_SHOT_EXAMPLES = {
  he: [
    { role: 'user', content: 'אה אז אני חושב ש- שנצטרך לדחות את זה, את הפגישה, ליום שלישי כי, כי יש לי משהו' },
    { role: 'assistant', content: 'אני חושב שנצטרך לדחות את הפגישה ליום שלישי כי יש לי משהו.' },
    { role: 'user', content: 'אני עדיין ברעננה, אה, ניפגש שם בשמונה' },
    { role: 'assistant', content: 'אני עדיין ברעננה, ניפגש שם בשמונה.' },
  ],
  en: [
    { role: 'user', content: 'so um I think we should, we should probably push the meeting to, to Tuesday because I have this thing' },
    { role: 'assistant', content: 'I think we should push the meeting to Tuesday because I have this thing.' },
    { role: 'user', content: "I'm still in Raanana, let's meet there at eight" },
    { role: 'assistant', content: "I'm still in Raanana, let's meet there at eight." },
  ],
};

function buildFewShotMessages(language) {
  return FEW_SHOT_EXAMPLES[language] || FEW_SHOT_EXAMPLES.en;
}

export async function cleanup(text, language, apiKey) {
  if (!apiKey) throw new CleanupError('No Anthropic API key configured');

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CLEANUP_MODEL,
        max_tokens: 4096,
        // Zero, not merely low: sampling randomness was measured to make the model
        // occasionally "repair" a malformed place name into a different real city
        // (רעננה -> הרצליה). Determinism is what a faithful-cleanup task wants.
        temperature: 0,
        system: buildSystemPrompt(language),
        messages: [...buildFewShotMessages(language), { role: 'user', content: text }],
      }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (err) {
    throw new CleanupError(`Network error: ${err.message}`);
  }
  if (!res.ok) throw new CleanupError(`Cleanup failed (HTTP ${res.status})`);

  const data = await res.json();
  const out = data.content?.[0]?.text?.trim();
  if (!out) throw new CleanupError('Cleanup returned empty output');
  return out;
}
