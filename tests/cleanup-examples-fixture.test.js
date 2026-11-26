// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildFewShotMessages } from '../src/cleanup.js';
import { CHECK_NAMES, runChecks } from '../scripts/cleanup-checks.js';

const examples = JSON.parse(readFileSync(new URL('../fixtures/cleanup-examples.json', import.meta.url), 'utf8'));

describe('fixtures/cleanup-examples.json', () => {
  it('has unique names and the required fields', () => {
    expect(new Set(examples.map((e) => e.name)).size).toBe(examples.length);
    for (const e of examples) {
      expect(['he', 'en']).toContain(e.language);
      expect(['few-shot', 'eval']).toContain(e.role);
      expect(typeof e.input).toBe('string');
      expect(typeof e.expected).toBe('string');
      expect(typeof e.checks).toBe('object');
    }
  });

  it('gives every eval example at least one known check', () => {
    for (const e of examples.filter((x) => x.role === 'eval')) {
      expect(Object.keys(e.checks).length, e.name).toBeGreaterThan(0);
      for (const key of Object.keys(e.checks)) expect(CHECK_NAMES, `${e.name}: ${key}`).toContain(key);
    }
  });

  it("passes every eval example's checks on its own expected text", () => {
    for (const e of examples.filter((x) => x.role === 'eval')) {
      const failed = runChecks(e.expected, e.checks).filter((r) => !r.ok);
      expect(failed, e.name).toEqual([]);
    }
  });

  it('has every few-shot example in the cleanup few-shot messages, verbatim', () => {
    for (const e of examples.filter((x) => x.role === 'few-shot')) {
      const messages = buildFewShotMessages(e.language);
      const i = messages.findIndex((m) => m.role === 'user' && m.content === e.input);
      expect(i, e.name).toBeGreaterThanOrEqual(0);
      expect(messages[i + 1], e.name).toEqual({ role: 'assistant', content: e.expected });
    }
  });
});
