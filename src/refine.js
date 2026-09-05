import { callChatModel } from './llmClient.js';

export class RefineError extends Error {}

const LANGUAGE_NAMES = { he: 'Hebrew', en: 'English' };

export async function generateRefinementChips(text, language, { provider, model, apiKey }) {
  const lang = LANGUAGE_NAMES[language] || 'English';

  let content;
  try {
    content = await callChatModel({
      provider,
      model,
      apiKey,
      temperature: 0.7,
      jsonMode: true,
      timeoutMs: 30000,
      maxTokens: 1024,
      systemPrompt: [
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
      messages: [{ role: 'user', content: text }],
    });
  } catch (err) {
    throw new RefineError(err.message.replace(/^Request failed/, 'Could not generate suggestions').replace(/^Empty response/, 'No suggestions returned'));
  }

  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new RefineError('Could not parse suggestions'); }

  const arr = Array.isArray(parsed) ? parsed : (parsed.chips || parsed.options || null);
  if (!Array.isArray(arr) || arr.length === 0) throw new RefineError('No valid suggestions returned');

  return arr
    .slice(0, 4)
    .filter((c) => c && c.label && c.instruction)
    .map(({ label, instruction }) => ({ label: String(label).trim(), instruction: String(instruction).trim() }));
}

export async function applyRefinement(text, language, instruction, { provider, model, apiKey }) {
  const lang = LANGUAGE_NAMES[language] || 'English';

  try {
    return await callChatModel({
      provider,
      model,
      apiKey,
      temperature: 0,
      timeoutMs: 60000,
      maxTokens: 4096,
      systemPrompt: [
        `You refine voice-note messages by applying a specific transformation.`,
        `The message is in ${lang}. Never translate anything — preserve the language throughout.`,
        `Keep the personal tone and meaning unless the instruction explicitly asks to change it.`,
        `Output only the refined message. No preamble, no quotes, no explanations.`,
      ].join('\n'),
      messages: [{ role: 'user', content: `${instruction}:\n\n${text}` }],
    });
  } catch (err) {
    throw new RefineError(err.message.replace(/^Request failed/, 'Refinement failed').replace(/^Empty response/, 'Refinement returned empty output'));
  }
}
