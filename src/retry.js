// Generic retry-with-backoff runner shared by transcribe.js (OpenAI) and cleanup.js
// (Anthropic). This module knows nothing about HTTP — callers classify their own
// errors as retryable/terminal (see api-errors.js) and pass that verdict in via
// `isRetryable`. Keeping the two concerns separate means the backoff math is unit
// tested once, here, instead of duplicated per provider.

export const DEFAULT_MAX_ATTEMPTS = 4; // 1 initial try + 3 retries
export const DEFAULT_BASE_DELAY_MS = 500;
export const DEFAULT_MAX_DELAY_MS = 8000;

// Full-jitter exponential backoff: the delay before retry attempt `attempt` (0-indexed —
// 0 is the wait before the *first* retry, i.e. after the initial call already failed once)
// is a random value in [0, min(maxDelayMs, baseDelayMs * 2^attempt)). This is the AWS
// "full jitter" formula — capping before applying jitter (rather than after) means
// maxDelayMs is a hard ceiling no matter how `random` comes out, and the jitter spreads
// out a thundering herd of clients that all failed on the same upstream blip at once.
export function backoffDelay(
  attempt,
  { baseDelayMs = DEFAULT_BASE_DELAY_MS, maxDelayMs = DEFAULT_MAX_DELAY_MS, random = Math.random } = {}
) {
  if (attempt < 0) throw new RangeError('attempt must be >= 0');
  const uncapped = baseDelayMs * 2 ** attempt;
  const capped = Math.min(uncapped, maxDelayMs);
  return Math.floor(random() * capped);
}

// Runs `attempt(n)` up to maxAttempts times (n is the 0-indexed attempt number). On
// failure, `isRetryable(err)` decides whether it's worth trying again; a non-retryable
// error — or running out of attempts — rethrows the original error untouched, so callers
// keep seeing their own error types (TranscriptionError, CleanupError, ...) rather than a
// wrapper. `onRetry` is an optional hook for observing retry-state transitions (used by
// tests and available for future telemetry/UI hookup).
export async function withRetry(attempt, {
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  isRetryable = () => true,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  random = Math.random,
  sleep = defaultSleep,
  onRetry,
} = {}) {
  for (let n = 0; n < maxAttempts; n++) {
    try {
      return await attempt(n);
    } catch (err) {
      const isLastAttempt = n === maxAttempts - 1;
      if (isLastAttempt || !isRetryable(err)) throw err;
      const delay = backoffDelay(n, { baseDelayMs, maxDelayMs, random });
      onRetry?.({ attempt: n, delay, error: err });
      await sleep(delay);
    }
  }
  // Unreachable: the loop above always either returns or throws.
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
