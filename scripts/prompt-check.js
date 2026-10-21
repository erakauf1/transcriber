// Semi-manual prompt check: runs every fixture through the real cleanup API
// and prints raw vs cleaned for human review. Not pass/fail — eyeball it.
// Usage: ANTHROPIC_API_KEY=sk-ant-... npm run prompt-check
//    or: OPENROUTER_API_KEY=sk-or-... PROVIDER=openrouter MODEL=openrouter/auto npm run prompt-check
//    or: OPENAI_API_KEY=sk-... PROVIDER=openai npm run prompt-check
// Add CORRECTIONS=fixtures/corrections.json to run learned fixes around cleanup
// (pre-pass, prompt section, post-pass) as the app does.
import { readFileSync } from 'node:fs';
import { cleanup } from '../src/cleanup.js';
import { restoreEnglishTerms } from '../src/englishTerms.js';
import { detectLanguage } from '../src/language.js';
import { validateDocument, applyCorrections, relevantRules } from '../src/corrections.js';

const DEFAULT_MODEL = { openai: 'gpt-4o', anthropic: 'claude-sonnet-5' };
const KEY_ENV_VAR = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', openrouter: 'OPENROUTER_API_KEY' };

const provider = process.env.PROVIDER || 'anthropic';
if (!(provider in KEY_ENV_VAR)) {
  console.error(`Unknown PROVIDER "${provider}" — must be one of: ${Object.keys(KEY_ENV_VAR).join(', ')}`);
  process.exit(1);
}

const apiKey = process.env[KEY_ENV_VAR[provider]];
if (!apiKey) {
  console.error(`Set ${KEY_ENV_VAR[provider]} first: ${KEY_ENV_VAR[provider]}=... npm run prompt-check`);
  process.exit(1);
}

const model = process.env.MODEL || DEFAULT_MODEL[provider];
if (!model) {
  console.error(`Set MODEL for provider "${provider}", e.g. MODEL=openrouter/auto`);
  process.exit(1);
}

let rules = [];
if (process.env.CORRECTIONS) {
  const checked = validateDocument(JSON.parse(readFileSync(process.env.CORRECTIONS, 'utf8')), { mode: 'import' });
  if (!checked.ok) {
    console.error(`${process.env.CORRECTIONS} is not a valid learned-fixes document (each rule must pass isLearnableRule, and the set checkRuleSet)`);
    process.exit(1);
  }
  rules = checked.doc.rules;
}

const fixtures = JSON.parse(
  readFileSync(new URL('../fixtures/transcripts.json', import.meta.url), 'utf8')
);

console.log(`Provider: ${provider}, Model: ${model}${rules.length ? `, Corrections: ${rules.length}` : ''}`);

for (const { name, text } of fixtures) {
  const language = detectLanguage(text);
  console.log(`\n=== ${name} [${language}] ===`);
  console.log(`--- raw ---\n${text}`);
  try {
    const corrected = applyCorrections(text, rules);
    if (corrected !== text) console.log(`--- corrections ---\n${corrected}`);
    const withTerms = await restoreEnglishTerms(corrected, language, { provider, model, apiKey });
    if (withTerms !== corrected) console.log(`--- english terms ---\n${withTerms}`);
    const corrections = relevantRules(withTerms, rules);
    const cleaned = applyCorrections(await cleanup(withTerms, language, { provider, model, apiKey, corrections }), rules);
    console.log(`--- cleaned ---\n${cleaned}`);
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
  }
}
