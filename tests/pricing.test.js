import { describe, it, expect } from 'vitest';
import { estimateCost, formatCost, modelLabel } from '../src/pricing.js';

describe('estimateCost', () => {
  it('prices input and output tokens per million', () => {
    // Opus 5.5: $4 in, $20 out per 1M tokens
    expect(estimateCost({ model: 'claude-opus-5-5', inputTokens: 1000, outputTokens: 500 }))
      .toBeCloseTo(0.004 + 0.01, 10);
  });

  it('prefers a cost the provider reported', () => {
    expect(estimateCost({ model: 'openrouter/auto', inputTokens: 1, outputTokens: 1, reportedCost: 0.0021 }))
      .toBe(0.0021);
  });

  it('returns null for an unknown model with no reported cost', () => {
    expect(estimateCost({ model: 'some/model', inputTokens: 10, outputTokens: 10 })).toBeNull();
  });
});

describe('formatCost', () => {
  it.each([
    [0, '$0'],
    [0.00004, '< $0.0001'],
    [0.0012345, '$0.0012'],
    [0.0456, '$0.046'],
  ])('formats %s as %s', (usd, text) => {
    expect(formatCost(usd)).toBe(text);
  });
});

describe('modelLabel', () => {
  it('names known models and falls back to the ID', () => {
    expect(modelLabel('claude-haiku-5-5')).toBe('Claude Haiku 5.5');
    expect(modelLabel('qwen/qwen3.7-flash')).toBe('qwen/qwen3.7-flash');
  });
});
