# Transcript Cleanup: Switch to Anthropic Claude Sonnet 5

## Problem

The cleanup step (`src/cleanup.js`) turns a raw voice-note transcript into a
clean chat message, using OpenAI's `gpt-4o` with a single non-streaming
chat-completions call at `temperature: 0`. In practice this leaves two
persistent problems, especially on Hebrew transcripts (the app's primary
language):

- Leftover disfluencies and grammar issues survive cleanup more often than
  desired.
- Names and places are sometimes altered even though the prompt explicitly
  forbids it (a known prior failure mode: a malformed Hebrew place name was
  "corrected" to a different real city).

These two requirements are in tension — the model needs to be aggressive
about fixing ordinary text while being extremely conservative about a
specific class of tokens (names). That's fundamentally an
instruction-following problem, not a raw-fluency one.

`gpt-4o` still works via the OpenAI API (only pulled from the ChatGPT
consumer UI in Feb 2026), so this is a quality-driven change, not a forced
migration.

## Decision

Move the cleanup call from OpenAI Chat Completions to Anthropic's Messages
API, using `claude-sonnet-5`, and strengthen the prompt with few-shot
examples targeting both failure modes directly. Sonnet 5 (not Opus 5) is
the right cost/quality point for a bounded, well-specified transformation
task like this — Opus's extra capability targets open-ended reasoning,
which cleanup doesn't need. If Sonnet 5 output quality proves insufficient
after real use, upgrading `CLEANUP_MODEL` to `claude-opus-5` is a one-line
change (same request shape).

Transcription (`src/transcribe.js`, `gpt-4o-transcribe`) is unaffected —
Claude has no audio transcription, so it stays on OpenAI.

## Design

### 1. Two API keys

Claude cleanup and OpenAI transcription now need separate keys. `src/settings.js`
splits the current single generic key pair into two explicit pairs:

- `getOpenAIKey()` / `setOpenAIKey()` / `hasOpenAIKey()` — storage key
  `openai_api_key` (unchanged), used by `transcribe.js`.
- `getAnthropicKey()` / `setAnthropicKey()` / `hasAnthropicKey()` — storage
  key `anthropic_api_key` (new), used by `cleanup.js`.

`index.html` gets a second labeled input for the Anthropic key (placeholder
`sk-ant-...`), alongside the existing OpenAI key input. The help text
(currently lines 121-124) is updated to describe both providers.

### 2. Key requirement stays asymmetric

Recording remains gated on `hasOpenAIKey()` only, since transcription is
mandatory. A missing Anthropic key is not a hard blocker: `runCleanup()` in
`app.js` skips the cleanup call and falls back to the raw transcript — the
same fallback path that already runs today whenever `CleanupError` is
thrown. No new failure mode is introduced; a missing key is just another
trigger for the existing fallback.

### 3. `cleanup.js`: Anthropic Messages API

- `CLEANUP_MODEL = 'claude-sonnet-5'`.
- `POST https://api.anthropic.com/v1/messages` with headers `x-api-key`
  and `anthropic-version` (replacing `Authorization: Bearer`).
- Body: `model`, `max_tokens` (required by Anthropic; set to a generous
  fixed value, e.g. 4096 — cleanup only ever shrinks text, and transcripts
  are short-to-medium), `system: buildSystemPrompt(language)`,
  `temperature: 0` (unchanged rationale: determinism avoids the model
  "repairing" a malformed name into a different real one), and a `messages`
  array (see below).
- Response parsing: `data.content[0].text` (Anthropic's shape) instead of
  `data.choices[0].message.content`.
- `CleanupError` wrapping stays for network errors, non-OK HTTP responses,
  and empty output, adapted to read Anthropic's error body shape where it
  differs.
- The 120-second `AbortSignal.timeout` is unchanged.

### 4. Few-shot examples

The `messages` array gains two fixed example turns before the real user
message, each a `{role: 'user', content: ...}` / `{role: 'assistant',
content: ...}` pair:

1. A messy, disfluency-heavy sentence → its aggressively cleaned version,
   demonstrating the "Do" list in action.
2. A transcript containing a malformed-looking but real name → the same
   text with the name left untouched, demonstrating the "Don't touch
   names" rule under pressure.

These are hardcoded in `cleanup.js` (not sourced from
`fixtures/transcripts.json`, which remains a manual eyeball-review set for
`npm run prompt-check` and is unchanged in format). Showing the model a
worked example of the exact tension it needs to resolve is expected to be
more reliable than stating the rule as a prohibition alone, which is the
current approach.

### 5. Tests and tooling

- `tests/cleanup.test.js`: request/response assertions rewritten for the
  Anthropic shape (URL, `x-api-key`/`anthropic-version` headers, body
  fields including `max_tokens` and the few-shot `messages` entries,
  `content[0].text` parsing). Error-path tests updated to Anthropic's error
  body shape.
- `tests/settings.test.js`: existing OpenAI-key assertions kept, new cases
  added for the Anthropic key functions.
- `tests/transcribe.test.js`: unchanged (still OpenAI).
- `scripts/prompt-check.js`: reads `ANTHROPIC_API_KEY` instead of
  `OPENAI_API_KEY`; usage comment updated to match.

## Out of scope

- Chunking or multi-pass cleanup — transcripts are short-to-medium
  (a paragraph or two) and fit comfortably in one call.
- Making the model configurable via env var or settings UI — kept as a
  hardcoded constant, consistent with the existing pattern.
- Any change to the transcription provider or model.
- Migrating/prompting users about their existing stored OpenAI key; it
  continues to work unchanged for transcription.

## Testing

- Existing unit tests updated as described above; `npm test` must pass.
- `npm run prompt-check` (manual eyeball review against
  `fixtures/transcripts.json`) re-run against the new model/prompt as a
  sanity check before considering this done, with particular attention to
  the two known failure modes (disfluency cleanup, name preservation).
