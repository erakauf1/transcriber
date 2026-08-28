export const CLEANUP_MODEL = 'gpt-4o';

export class CleanupError extends Error {}

const LANGUAGE_NAMES = { he: 'Hebrew', en: 'English' };

export function buildSystemPrompt(language) {
  const lang = LANGUAGE_NAMES[language] || 'English';
  return [
    `You clean up voice-note transcripts so they can be sent as chat messages.`,
    `The message is in ${lang}. Your entire output must be in ${lang}.`,
    `If the transcript contains embedded words in another language, keep them exactly as spoken, in their original script. Never translate or transliterate anything.`,
    `The speech-to-text step sometimes transliterates a foreign term into the local script (for example writing the English word "deploy" as \u05d3\u05d9\u05e4\u05dc\u05d5\u05d9, or "follow-up" as \u05e4\u05d5\u05dc\u05d5\u05d0\u05e4). When a word is clearly a transliterated foreign term, restore it to its original spelling and script. Apply this only to loanwords and technical or business terms that the speaker would have said in the other language. Never do it to names of people or places, and never to an ordinary word of the message's own language. If you are not confident, leave the word exactly as it is.`,
    ``,
    `Do:`,
    `- Remove filler words (um, uh, like, אמם, אה, כאילו), false starts, and repeated words`,
    `- Fix grammar and punctuation`,
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
        temperature: 0.3,
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
