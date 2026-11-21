// The iOS app copies these prompts verbatim; this file is what it is checked against.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cleanup } from '../src/cleanup.js';
import { findEnglishTerms } from '../src/englishTerms.js';
import { generateRefinementChips, applyRefinement } from '../src/refine.js';

const TEXT = 'TEXT';
const INSTRUCTION = 'Make shorter';
const STEP = { provider: 'anthropic', model: 'claude-sonnet-5', apiKey: 'k' };
const REPLY = '{"chips":[{"label":"a","instruction":"b"}],"terms":[]}';

export async function buildPromptFixture() {
  const realFetch = globalThis.fetch;
  let body;
  globalThis.fetch = async (_url, opts) => {
    body = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: REPLY }] }) };
  };
  const capture = async (fn) => { await fn(); return { system: body.system, messages: body.messages }; };
  try {
    const out = { text: TEXT, instruction: INSTRUCTION, cleanup: {}, refineChips: {}, refineApply: {} };
    for (const lang of ['he', 'en']) {
      out.cleanup[lang] = await capture(() => cleanup(TEXT, lang, STEP));
      out.refineChips[lang] = await capture(() => generateRefinementChips(TEXT, lang, STEP));
      out.refineApply[lang] = await capture(() => applyRefinement(TEXT, lang, INSTRUCTION, STEP));
    }
    out.englishTerms = await capture(() => findEnglishTerms(TEXT, STEP));
    return out;
  } finally {
    globalThis.fetch = realFetch;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = await buildPromptFixture();
  writeFileSync(new URL('../fixtures/prompts.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
}
