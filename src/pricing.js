// List prices in USD per million tokens, used to estimate what a note cost.
// These are estimates: providers change prices, so update this table when they do.
// OpenRouter reports the actual cost in its response, so it needs no entry here.
const MODELS = {
  'claude-sonnet-5': { label: 'Claude Sonnet 5', input: 2, output: 10 },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', input: 2, output: 10 },
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5', input: 0.1, output: 0.5 },
  'claude-opus-5-5': { label: 'Claude Opus 5.5', input: 4, output: 20 },
  'gpt-4o': { label: 'GPT-4o', input: 2.5, output: 10 },
};

export function modelLabel(model) {
  return MODELS[model]?.label ?? model;
}

// Returns USD, or null when the price is unknown. A cost reported by the
// provider (OpenRouter) wins over the table.
export function estimateCost({ model, inputTokens, outputTokens, reportedCost }) {
  if (typeof reportedCost === 'number') return reportedCost;
  const price = MODELS[model];
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1e6;
}

export function formatCost(usd) {
  if (usd === 0) return '$0';
  if (usd < 0.0001) return '< $0.0001';
  return `$${usd.toFixed(usd < 0.01 ? 4 : 3)}`;
}
