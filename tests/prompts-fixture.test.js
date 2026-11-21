// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildPromptFixture } from '../scripts/dump-prompts.js';

describe('fixtures/prompts.json', () => {
  it('matches the prompts the app sends (run `npm run prompts` after changing a prompt)', async () => {
    const onDisk = JSON.parse(readFileSync(new URL('../fixtures/prompts.json', import.meta.url), 'utf8'));
    expect(await buildPromptFixture()).toEqual(onDisk);
  });
});
