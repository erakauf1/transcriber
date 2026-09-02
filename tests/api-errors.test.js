import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  classifyOpenAIError,
  classifyAnthropicError,
  isNetworkError,
  readErrorBody,
} from '../src/api-errors.js';

// Read via a cwd-relative path rather than `new URL('./x', import.meta.url)` (the pattern
// scripts/prompt-check.js uses as a plain Node script) — Vite statically rewrites that
// exact pattern into a dev-server asset URL, which isn't a file: URL fs.readFileSync can
// use, and vitest's jsdom test environment applies the same transform to test files.
const openaiErrors = JSON.parse(readFileSync(resolve('fixtures/errors/openai-errors.json'), 'utf8'));
const anthropicErrors = JSON.parse(readFileSync(resolve('fixtures/errors/anthropic-errors.json'), 'utf8'));

describe('classifyOpenAIError (fixture-driven)', () => {
  openaiErrors.forEach(({ name, status, body, expectedRetryable, reason }) => {
    it(`${name}: retryable=${expectedRetryable} (${reason})`, () => {
      expect(classifyOpenAIError(status, body)).toBe(expectedRetryable);
    });
  });

  it('the fixture set exercises the 429-dual-meaning edge case explicitly', () => {
    const rateLimited = openaiErrors.find((f) => f.name === 'rate-limit-requests');
    const quotaExceeded = openaiErrors.find((f) => f.name === 'insufficient-quota');
    expect(rateLimited.status).toBe(quotaExceeded.status); // same status code...
    expect(rateLimited.expectedRetryable).toBe(true);
    expect(quotaExceeded.expectedRetryable).toBe(false); // ...opposite verdict
  });

  it('treats an unknown status as terminal by default (fail closed)', () => {
    expect(classifyOpenAIError(418, {})).toBe(false);
  });

  it('treats a missing/unparseable body as terminal for a non-retryable status', () => {
    expect(classifyOpenAIError(400, null)).toBe(false);
  });

  it('still retries a 429 with no body at all (defaults to plain rate limit)', () => {
    expect(classifyOpenAIError(429, null)).toBe(true);
  });
});

describe('classifyAnthropicError (fixture-driven)', () => {
  anthropicErrors.forEach(({ name, status, body, expectedRetryable, reason }) => {
    it(`${name}: retryable=${expectedRetryable} (${reason})`, () => {
      expect(classifyAnthropicError(status, body)).toBe(expectedRetryable);
    });
  });

  it('treats the overloaded_error status (529) as retryable', () => {
    const overloaded = anthropicErrors.find((f) => f.name === 'overloaded');
    expect(overloaded.status).toBe(529);
    expect(classifyAnthropicError(529, overloaded.body)).toBe(true);
  });

  it('treats an unknown status as terminal by default (fail closed)', () => {
    expect(classifyAnthropicError(418, {})).toBe(false);
  });
});

describe('isNetworkError', () => {
  it('classifies a TypeError (fetch connection failure) as a network error', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('classifies an AbortError (AbortSignal.timeout firing) as a network error', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    expect(isNetworkError(err)).toBe(true);
  });

  it('classifies a TimeoutError as a network error', () => {
    const err = new Error('timed out');
    err.name = 'TimeoutError';
    expect(isNetworkError(err)).toBe(true);
  });

  it('does not classify an arbitrary Error as a network error', () => {
    expect(isNetworkError(new Error('something else went wrong'))).toBe(false);
  });
});

describe('readErrorBody', () => {
  it('parses a JSON error body', async () => {
    const res = { json: async () => ({ error: { code: 'x' } }) };
    expect(await readErrorBody(res)).toEqual({ error: { code: 'x' } });
  });

  it('falls back to null when the body is not valid JSON', async () => {
    const res = { json: async () => { throw new SyntaxError('Unexpected token'); } };
    expect(await readErrorBody(res)).toBeNull();
  });

  it('falls back to null when the response has no json() method at all', async () => {
    // Matches how existing tests mock fetch: `{ ok: false, status: 401 }` with no json().
    const res = { ok: false, status: 401 };
    expect(await readErrorBody(res)).toBeNull();
  });
});
