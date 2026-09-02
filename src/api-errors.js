// Classifies OpenAI and Anthropic API error responses as retryable (transient — worth
// backing off and trying again) or terminal (retrying can't possibly help). Shared by
// transcribe.js and cleanup.js so the policy lives in one place instead of being guessed
// at independently per call site. Fixtures for both providers' real error shapes live in
// fixtures/errors/ and are exercised by tests/api-errors.test.js.

// Statuses that are transient for *both* providers regardless of body shape: rate limits,
// upstream overload, and generic server-side failures. 529 is Anthropic-specific
// ("overloaded_error"); OpenAI never returns it, but it's harmless to include here since
// classification is always scoped to one provider's status+body pair.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504, 529]);

export function classifyOpenAIError(status, body) {
  // A 429 means two different things at OpenAI: "you're sending requests too fast"
  // (retry_after-style throttling — retryable) vs. "your account is out of credit"
  // (insufficient_quota — no amount of backoff fixes a billing problem, so treat it as
  // terminal even though the HTTP status alone looks identical to a transient rate limit).
  const code = body?.error?.code;
  if (status === 429 && code === 'insufficient_quota') return false;
  return RETRYABLE_STATUSES.has(status);
}

export function classifyAnthropicError(status, _body) {
  return RETRYABLE_STATUSES.has(status);
}

// Fetch throwing (rather than resolving with a non-ok response) means the request never
// reached the server at all: DNS failure, connection reset, or our own AbortSignal.timeout
// firing. All of these are inherently transient — there's no error body to classify, so
// this is a separate, cheaper check than the HTTP classifiers above.
export function isNetworkError(err) {
  return err instanceof TypeError || err?.name === 'AbortError' || err?.name === 'TimeoutError';
}

// Best-effort parse of a non-ok response's JSON body for classification purposes. Never
// throws — a response with no body, a non-JSON body, or a body-less test double (existing
// tests mock `{ ok: false, status }` with no `.json()` at all) all fall back to null, which
// every classifier above treats as "no special-case code, fall back to the status alone."
export async function readErrorBody(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
