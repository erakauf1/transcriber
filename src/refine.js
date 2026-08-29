export const REFINE_MODEL = 'gpt-4o';

export class RefineError extends Error {}

const LANGUAGE_NAMES = { he: 'Hebrew', en: 'English' };

// Calls GPT-4o to suggest 3–4 refinement options specific to the given text.
// Returns [{label, instruction}] where label is shown on the chip and
// instruction is the prompt used to apply that refinement.
export async function generateRefinementChips(text, language, apiKey) {
  const lang = LANGUAGE_NAMES[language] || 'English';

  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: REFINE_MODEL,
        temperature: 0.7,
        messages: [
          {
            role: 'system',
            content: [
              `You suggest specific, useful one-tap refinement actions for a cleaned-up voice note message.`,
              `The message is in ${lang}. Suggest 3–4 short actions that would genuinely improve THIS specific message.`,
              `Return a JSON object in this exact shape: {"chips": [{"label": "...", "instruction": "..."}, ...]}`,
              `Rules:`,
              `- "label" is 2–4 words max, written in ${lang} (so the user sees it in their language)`,
              `- "instruction" is always in English — it is the prompt used to transform the message`,
              `- Options must be specific to this content, not generic filler`,
              `- Do not suggest formatting already present in the message (e.g. don't suggest bullet points if they're already there)`,
              `- Examples of good labels: "Make shorter", "More formal", "Add details", "Softer tone", "Clearer request"`,
            ].join('\n'),
          },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new RefineError(`Network error: ${err.message}`);
  }
  if (!res.ok) throw new RefineError(`Could not generate suggestions (HTTP ${res.status})`);

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new RefineError('No suggestions returned');

  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new RefineError('Could not parse suggestions'); }

  const arr = Array.isArray(parsed) ? parsed : (parsed.chips || parsed.options || null);
  if (!Array.isArray(arr) || arr.length === 0) throw new RefineError('No valid suggestions returned');

  return arr
    .slice(0, 4)
    .filter((c) => c && c.label && c.instruction)
    .map(({ label, instruction }) => ({ label: String(label).trim(), instruction: String(instruction).trim() }));
}

// Applies the given refinement instruction to text, returning the refined version.
export async function applyRefinement(text, language, instruction, apiKey) {
  const lang = LANGUAGE_NAMES[language] || 'English';

  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: REFINE_MODEL,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: [
              `You refine voice-note messages by applying a specific transformation.`,
              `The message is in ${lang}. Never translate anything — preserve the language throughout.`,
              `Keep the personal tone and meaning unless the instruction explicitly asks to change it.`,
              `Output only the refined message. No preamble, no quotes, no explanations.`,
            ].join('\n'),
          },
          { role: 'user', content: `${instruction}:\n\n${text}` },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    throw new RefineError(`Network error: ${err.message}`);
  }
  if (!res.ok) throw new RefineError(`Refinement failed (HTTP ${res.status})`);

  const data = await res.json();
  const out = data.choices?.[0]?.message?.content?.trim();
  if (!out) throw new RefineError('Refinement returned empty output');
  return out;
}
