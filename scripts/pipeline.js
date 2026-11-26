import { readFileSync } from 'node:fs';
import { cleanup } from '../src/cleanup.js';
import { restoreEnglishTerms } from '../src/englishTerms.js';
import { detectLanguage } from '../src/language.js';
import { validateDocument, applyCorrections, relevantRules } from '../src/corrections.js';

const DEFAULT_MODEL = { openai: 'gpt-4o', anthropic: 'claude-sonnet-5' };
const KEY_ENV_VAR = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', openrouter: 'OPENROUTER_API_KEY' };

export function loadConfigFromEnv(scriptName) {
  const provider = process.env.PROVIDER || 'anthropic';
  if (!(provider in KEY_ENV_VAR)) {
    console.error(`Unknown PROVIDER "${provider}" — must be one of: ${Object.keys(KEY_ENV_VAR).join(', ')}`);
    process.exit(1);
  }
  const apiKey = process.env[KEY_ENV_VAR[provider]];
  if (!apiKey) {
    console.error(`Set ${KEY_ENV_VAR[provider]} first: ${KEY_ENV_VAR[provider]}=... npm run ${scriptName}`);
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
  return { provider, model, apiKey, rules };
}

// Mirrors the order in src/app.js, so a script sees what the app would send.
export async function runPipeline(text, { provider, model, apiKey, rules = [], language = detectLanguage(text) }) {
  const step = { provider, model, apiKey };
  const corrected = applyCorrections(text, rules);
  const withTerms = await restoreEnglishTerms(corrected, language, step);
  const corrections = relevantRules(withTerms, rules);
  const cleaned = applyCorrections(await cleanup(withTerms, language, { ...step, corrections }), rules);
  return { language, corrected, withTerms, cleaned };
}
