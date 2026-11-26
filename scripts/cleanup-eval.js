// Runs the held-out examples in fixtures/cleanup-examples.json through the real
// cleanup pipeline and prints input / expected / actual with per-example checks.
// Usage: ANTHROPIC_API_KEY=sk-ant-... RUNS=2 npm run cleanup-eval
import { readFileSync } from 'node:fs';
import { loadConfigFromEnv, runPipeline } from './pipeline.js';
import { runChecks } from './cleanup-checks.js';

const config = loadConfigFromEnv('cleanup-eval');
const runs = Number(process.env.RUNS || 1);
const examples = JSON.parse(readFileSync(new URL('../fixtures/cleanup-examples.json', import.meta.url), 'utf8'))
  .filter((e) => e.role === 'eval');

console.log(`Provider: ${config.provider}, Model: ${config.model}, Runs: ${runs}, Examples: ${examples.length}`);

let failures = 0;
const summary = [];

for (let run = 1; run <= runs; run++) {
  for (const ex of examples) {
    console.log(`\n=== ${ex.name} [${ex.language}] run ${run}/${runs} ===`);
    console.log(`--- input ---\n${ex.input}`);
    console.log(`--- expected ---\n${ex.expected}`);
    try {
      const { withTerms, cleaned } = await runPipeline(ex.input, { ...config, language: ex.language });
      // A check can fail because the English-terms pass rewrote a word, not because of cleanup.
      if (withTerms !== ex.input) console.log(`--- after english terms ---\n${withTerms}`);
      console.log(`--- actual ---\n${cleaned}`);
      const results = runChecks(cleaned, ex.checks);
      for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
      const passed = results.filter((r) => r.ok).length;
      failures += results.length - passed;
      summary.push(`${passed === results.length ? '✓' : '✗'} ${ex.name} run ${run}: ${passed}/${results.length}`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      failures++;
      summary.push(`✗ ${ex.name} run ${run}: ERROR`);
    }
  }
}

console.log(`\n=== summary ===\n${summary.join('\n')}`);
process.exit(failures ? 1 : 0);
