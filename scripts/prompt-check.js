// Semi-manual prompt check: runs every fixture through the real cleanup API
// and prints raw vs cleaned for human review. Not pass/fail — eyeball it.
// Usage: OPENAI_API_KEY=sk-... npm run prompt-check
import { readFileSync } from 'node:fs';
import { cleanup } from '../src/cleanup.js';
import { detectLanguage } from '../src/language.js';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('Set OPENAI_API_KEY first: OPENAI_API_KEY=sk-... npm run prompt-check');
  process.exit(1);
}

const fixtures = JSON.parse(
  readFileSync(new URL('../fixtures/transcripts.json', import.meta.url), 'utf8')
);

for (const { name, text } of fixtures) {
  const language = detectLanguage(text);
  console.log(`\n=== ${name} [${language}] ===`);
  console.log(`--- raw ---\n${text}`);
  try {
    const cleaned = await cleanup(text, language, apiKey);
    console.log(`--- cleaned ---\n${cleaned}`);
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
  }
}
