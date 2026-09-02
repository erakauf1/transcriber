import { describe, it, expect, vi } from 'vitest';
import { backoffDelay, withRetry, DEFAULT_MAX_ATTEMPTS } from '../src/retry.js';

describe('backoffDelay', () => {
  it('grows exponentially with the attempt number, before the cap', () => {
    // random() pinned to 1 (its supremum) isolates the exponential growth from jitter —
    // this asserts the *ceiling* of each attempt's range, not a random point inside it.
    const random = () => 1;
    expect(backoffDelay(0, { baseDelayMs: 100, maxDelayMs: 100_000, random })).toBe(100);
    expect(backoffDelay(1, { baseDelayMs: 100, maxDelayMs: 100_000, random })).toBe(200);
    expect(backoffDelay(2, { baseDelayMs: 100, maxDelayMs: 100_000, random })).toBe(400);
    expect(backoffDelay(3, { baseDelayMs: 100, maxDelayMs: 100_000, random })).toBe(800);
  });

  it('caps the delay so it never exceeds maxDelayMs, however large the attempt', () => {
    const random = () => 1; // supremum — the worst case for "did we cap before jittering?"
    expect(backoffDelay(10, { baseDelayMs: 500, maxDelayMs: 8000, random })).toBe(8000);
    expect(backoffDelay(30, { baseDelayMs: 500, maxDelayMs: 8000, random })).toBe(8000);
  });

  it('applies full jitter: delay scales with the random() draw, from 0 up to the cap', () => {
    const capped = { baseDelayMs: 1000, maxDelayMs: 1000 };
    expect(backoffDelay(0, { ...capped, random: () => 0 })).toBe(0);
    expect(backoffDelay(0, { ...capped, random: () => 0.5 })).toBe(500);
    expect(backoffDelay(0, { ...capped, random: () => 0.999 })).toBe(999);
  });

  it('jitter is bounded to [0, cap) for a range of attempts and random draws', () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      for (const r of [0, 0.1, 0.5, 0.9, 0.999999]) {
        const delay = backoffDelay(attempt, { baseDelayMs: 500, maxDelayMs: 8000, random: () => r });
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThan(8000);
      }
    }
  });

  it('rejects a negative attempt number', () => {
    expect(() => backoffDelay(-1)).toThrow(RangeError);
  });
});

describe('withRetry', () => {
  const sleep = vi.fn(async () => {}); // skip real delays; we assert on call count/args instead

  it('returns the first successful result without retrying', async () => {
    const attempt = vi.fn(async () => 'ok');
    const result = await withRetry(attempt, { sleep });
    expect(result).toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable failure and returns the eventual success', async () => {
    let calls = 0;
    const attempt = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error(`fail ${calls}`);
      return 'recovered';
    });
    const onRetry = vi.fn();

    const result = await withRetry(attempt, { sleep, onRetry, isRetryable: () => true });

    expect(result).toBe('recovered');
    expect(attempt).toHaveBeenCalledTimes(3);
    // Exactly 2 retry-state transitions: attempt 1 failed → retry, attempt 2 failed → retry.
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0].attempt).toBe(0);
    expect(onRetry.mock.calls[1][0].attempt).toBe(1);
  });

  it('does not retry a terminal (non-retryable) error, even on the first attempt', async () => {
    const err = new Error('bad request');
    const attempt = vi.fn(async () => { throw err; });

    await expect(withRetry(attempt, { sleep, isRetryable: () => false })).rejects.toBe(err);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts and rethrows the last error as-is', async () => {
    const errors = [new Error('e1'), new Error('e2'), new Error('e3')];
    let calls = 0;
    const attempt = vi.fn(async () => { throw errors[calls++]; });

    await expect(
      withRetry(attempt, { sleep, maxAttempts: 3, isRetryable: () => true })
    ).rejects.toBe(errors[2]);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('defaults to DEFAULT_MAX_ATTEMPTS when maxAttempts is not given', async () => {
    const attempt = vi.fn(async () => { throw new Error('always fails'); });
    await expect(withRetry(attempt, { sleep, isRetryable: () => true })).rejects.toThrow();
    expect(attempt).toHaveBeenCalledTimes(DEFAULT_MAX_ATTEMPTS);
  });

  it('waits backoffDelay(n) between attempts, passed through to sleep', async () => {
    const sleepSpy = vi.fn(async () => {});
    let calls = 0;
    const attempt = vi.fn(async () => {
      calls++;
      if (calls < 2) throw new Error('fail once');
      return 'ok';
    });

    await withRetry(attempt, { sleep: sleepSpy, isRetryable: () => true, random: () => 1, baseDelayMs: 100, maxDelayMs: 100_000 });

    expect(sleepSpy).toHaveBeenCalledTimes(1);
    expect(sleepSpy).toHaveBeenCalledWith(100); // backoffDelay(0, {baseDelayMs:100, random:()=>1}) === 100
  });
});
