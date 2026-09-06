# Cleanup & Refine: Selectable Provider (OpenAI / Anthropic / OpenRouter)

## Problem

`src/cleanup.js` is hardcoded to Anthropic (`claude-sonnet-5`) and
`src/refine.js` is hardcoded to OpenAI (`gpt-4o`). There is no way to route
either step through a different provider, and no way to use lower-cost or
free models. OpenRouter gives access to many models — including free-tier
and very cheap ones — through a single OpenAI-compatible API, which makes it
a good fit for these two steps.

Transcription (`src/transcribe.js`, OpenAI `gpt-4o-transcribe`) is out of
scope: OpenRouter has no audio-transcription endpoint, so transcription
stays hardcoded to OpenAI, unchanged.

## Decision

Add OpenRouter as a third selectable provider for Cleanup and Refine,
chosen **independently per step** (each keeps its own provider setting,
since they already default to different providers today). Introduce a
small shared request helper, `src/llmClient.js`, so the OpenAI-compatible
request/response shape (used by both OpenAI and OpenRouter) is written
once instead of duplicated, while Anthropic's distinct Messages API shape
is handled as its own branch in the same helper.

## Design

### 1. `src/llmClient.js` (new)

One function, used by both `cleanup.js` and `refine.js`:

```js
// Returns the assistant's reply as a string. `jsonMode` requests a raw JSON
// object back (used by generateRefinementChips); otherwise plain text.
async function callChatModel({
  provider,       // 'openai' | 'anthropic' | 'openrouter'
  model,
  apiKey,
  systemPrompt,
  messages,       // [{role: 'user'|'assistant', content}], real turn(s) last
  temperature,
  maxTokens,      // required for anthropic; ignored otherwise
  jsonMode = false,
  timeoutMs,
}) { ... }
```

Internally:
- `provider === 'anthropic'`: builds the existing Anthropic Messages API
  request (`x-api-key`, `anthropic-version`,
  `anthropic-dangerous-direct-browser-access`, `thinking: {type:
  'disabled'}`, `max_tokens`), parses `content[].find(text block)`, matching
  `cleanup.js`'s current behavior exactly.
- `provider === 'openai'` or `'openrouter'`: builds a Chat Completions
  request (`Authorization: Bearer`, `response_format: {type:
  'json_object'}` when `jsonMode`), parses
  `data.choices[0].message.content`, matching `refine.js`'s current
  behavior exactly. For `'openrouter'`, the endpoint is
  `https://openrouter.ai/api/v1/chat/completions` (otherwise identical to
  OpenAI's), plus two extra headers OpenRouter uses for attribution/
  rankings: `HTTP-Referer` and `X-Title` (both static strings identifying
  this app — no user data).
- A thrown network/HTTP/empty-output error is normalized to a plain
  `Error` with a descriptive message; `cleanup.js`/`refine.js` continue to
  wrap it in their own `CleanupError`/`RefineError` at the call site, so
  their public error types are unchanged.

`cleanup.js` and `refine.js` keep 100% of their existing prompt-building
logic (system prompts, few-shot examples, chip-parsing). They only change
how the request is sent: instead of building `fetch(...)` themselves, they
call `callChatModel({...})` with the provider/model/key passed in from the
caller (`app.js`), instead of hardcoding `'claude-sonnet-5'`/`'gpt-4o'` and
their respective endpoints internally. `CLEANUP_MODEL`/`REFINE_MODEL`
constants are removed from those two files — the model is now a parameter,
not a constant — resolved by `app.js` as described below.

### 2. `src/settings.js`: new storage

Following the exact existing pattern (`readKey`/`writeKey` helpers):

- `getOpenRouterKey()` / `setOpenRouterKey()` / `hasOpenRouterKey()` —
  storage key `openrouter_api_key`.
- `getCleanupProvider()` / `setCleanupProvider()` — storage key
  `cleanup_provider`, one of `'openai' | 'anthropic' | 'openrouter'`,
  default `'anthropic'` (today's behavior).
- `getRefineProvider()` / `setRefineProvider()` — storage key
  `refine_provider`, same three values, default `'openai'` (today's
  behavior).
- `getCleanupModel()` / `setCleanupModel()` — storage key `cleanup_model`,
  a free-form string, only read when `cleanup_provider === 'openrouter'`.
  Default `'openrouter/auto'`.
- `getRefineModel()` / `setRefineModel()` — storage key `refine_model`,
  same shape, default `'openrouter/auto'`.

Existing defaults mean a user who never opens the new settings sees no
behavior change: Cleanup still runs on Anthropic `claude-sonnet-5`, Refine
still runs on OpenAI `gpt-4o` — those two model strings become the
defaults resolved in `app.js` for the `'anthropic'`/`'openai'` provider
choices (see below), not stored in settings.

### 3. `index.html`: new UI

In `#settings .sheet-body`:

- A new `.field` block for the OpenRouter key, inserted after the
  Anthropic key block, matching the existing markup exactly
  (`api-key-openrouter` / `btn-save-key-openrouter` /
  `key-status-openrouter`, placeholder `sk-or-••••••••••••••`).
- Two new `.field` blocks, one for Cleanup and one for Refine, each
  containing:
  - A `<select>` with three `<option>`s: OpenAI / Anthropic / OpenRouter
    (ids `provider-cleanup`, `provider-refine`).
  - A model `<select>` shown only when that step's provider is OpenRouter
    (ids `model-cleanup`, `model-refine`), populated with:
    - `Auto (let OpenRouter choose)` → value `openrouter/auto`
    - a short curated list of free/cheap models (e.g. a Llama free-tier
      model, a DeepSeek free-tier model, a Gemini Flash model) — kept as a
      plain array in `app.js` so it's easy to hand-edit as OpenRouter's
      catalog changes
    - `Custom…` → reveals a plain text `<input>` (id `model-custom-cleanup`
      / `model-custom-refine`) for typing any OpenRouter model ID

### 4. `src/app.js`: wiring

- New imports from `settings.js` for all the getters/setters above.
- A `resolveProviderAndModel(step)` helper (or two small inline lookups)
  that, given `getCleanupProvider()`/`getRefineProvider()`, returns
  `{provider, model, apiKey}`:
  - `'openai'` → `{provider: 'openai', model: 'gpt-4o', apiKey:
    getOpenAIKey()}` (Refine's existing model; used for Cleanup too if a
    user switches Cleanup to OpenAI, since Cleanup has no prior OpenAI
    model of its own)
  - `'anthropic'` → `{provider: 'anthropic', model: 'claude-sonnet-5',
    apiKey: getAnthropicKey()}`
  - `'openrouter'` → `{provider: 'openrouter', model: getCleanupModel() /
    getRefineModel(), apiKey: getOpenRouterKey()}`
- `runCleanup()` (currently line 188) passes the resolved
  `{provider, model, apiKey}` into `cleanup(text, language, {provider,
  model, apiKey})` instead of just `getAnthropicKey()`.
- The two `refine.js` call sites (`generateRefinementChips`,
  `applyRefinement`) similarly pass the resolved trio instead of
  `getOpenAIKey()` alone.
- Settings-sheet wiring: three new `onclick` handlers for
  `btn-save-key-openrouter` (mirroring the existing two exactly), plus
  `onchange` handlers on the two provider `<select>`s (persist via
  `setCleanupProvider`/`setRefineProvider`, re-render to show/hide the
  model picker) and the two model `<select>`s (persist via
  `setCleanupModel`/`setRefineModel`; selecting "Custom…" persists the
  paired text input's value instead once it changes).
- Render-time key-status refresh (currently lines 85-91) gets a third
  `key-status-openrouter` line, same pattern.
- `btn-record`'s gating (`disabled = !hasOpenAIKey()`) is unchanged —
  transcription is unaffected by any of this.

### 5. Error handling & gating

- If a step's selected provider has no key saved, that step's action
  button is disabled with the same kind of hint text already used for the
  record button, computed from whichever `has*Key()` matches the step's
  current provider selection.
- API errors (bad key, rate limit, model unavailable, OpenRouter-specific
  errors) surface through the existing `CleanupError`/`RefineError` →
  inline status text path, unchanged from today's behavior for OpenAI/
  Anthropic failures.

## Out of scope

- Any change to transcription (`transcribe.js` stays hardcoded to OpenAI
  `gpt-4o-transcribe`).
- Auto-benchmarking or automatically recommending a model based on
  measured quality — `openrouter/auto` (OpenRouter's own per-request model
  router) is offered instead, at effectively no extra engineering cost.
- Keeping the curated OpenRouter model list up to date over time — it's a
  small hardcoded array meant to be hand-edited as needed, not fetched
  live from OpenRouter's `/models` API.
- A shared/global "one provider for everything" toggle — Cleanup and
  Refine are independently configurable by design (see Decision).
- Migrating existing users' stored keys or settings — defaults exactly
  reproduce current behavior, so no migration is needed.

## Testing

- No existing automated tests cover network calls in `cleanup.js`/
  `refine.js` in a way that would need new fixtures beyond updating call
  shape assertions (if any exist) to go through `llmClient.js`.
- Manual verification in the browser, for both Cleanup and Refine,
  against real API keys: OpenAI, Anthropic, OpenRouter with a specific
  curated model, and OpenRouter with `Auto`. Confirm output correctness
  and confirm the disabled/hint state when a selected provider's key is
  missing.
