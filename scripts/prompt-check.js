// Semi-manual prompt check: runs every fixture through the real cleanup API
// and prints raw vs cleaned for human review. Not pass/fail — eyeball it.
// Usage: ANTHROPIC_API_KEY=sk-ant-... npm run prompt-check
//    or: OPENROUTER_API_KEY=sk-or-... PROVIDER=openrouter MODEL=openrouter/auto npm run prompt-check
//    or: OPENAI_API_KEY=sk-... PROVIDER=openai npm run prompt-check
// Add CORRECTIONS=fixtures/corrections.json to run learned fixes around cleanup
// (pre-pass, prompt section, post-pass) as the app does.
import { readFileSync } from 'node:fs';
import { loadConfigFromEnv, runPipeline } from './pipeline.js';

const config = loadConfigFromEnv('prompt-check');
const fixtures = JSON.parse(readFileSync(new URL('../fixtures/transcripts.json', import.meta.url), 'utf8'));

console.log(`Provider: ${config.provider}, Model: ${config.model}${config.rules.length ? `, Corrections: ${config.rules.length}` : ''}`);

for (const { name, text } of fixtures) {
  try {
    const { language, corrected, withTerms, cleaned } = await runPipeline(text, config);
    console.log(`\n=== ${name} [${language}] ===`);
    console.log(`--- raw ---\n${text}`);
    if (corrected !== text) console.log(`--- corrections ---\n${corrected}`);
    if (withTerms !== corrected) console.log(`--- english terms ---\n${withTerms}`);
    console.log(`--- cleaned ---\n${cleaned}`);
  } catch (err) {
    console.log(`\n=== ${name} ===\n--- raw ---\n${text}\nERROR: ${err.message}`);
  }
}
