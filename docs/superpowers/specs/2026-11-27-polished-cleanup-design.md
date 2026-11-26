# Polished Cleanup: Rewrite Voice Notes Into Well-Written Messages

## Problem

The cleanup step (`src/cleanup.js`, mirrored in
`ios/TranscriberCore/Sources/TranscriberCore/Cleanup.swift`) is built for a
light touch: "keep the same message, just tighter", no trailing period, no
formal register, no added words, never change a name. The user collected five
real Hebrew notes with the text they actually want to send
(`fixtures/cleanup-examples.json`). Names of people, companies and places
in them were swapped for made-up ones of the same kind (the few-shot pairs
ship in the public web bundle and the iOS app); the patterns under test, such
as a misheard name that appears correctly later, are preserved. In example 2
the misheard form is an ordinary word (לימוד for לימור), as in the original,
so the correction never merges two plausible people. Those expected
outputs are a polished rewrite, and they break the current rules on purpose:

| What the user expects | Current rule it breaks | Examples |
|---|---|---|
| Every message ends with a period | "Don't add a period at the end" | all 5 |
| Written register ("ואינה עוסקת", "במטרה להשיג", "ביצענו") | "Don't change slang or personal tone into formal writing" | 1, 2, 4 |
| Additions inferred from context: headings ("בנושא עמדות טעינה", "רק עדכון קצר"), details ("ומה העלויות", "מהבנק", "מרגע האישור", "רשמי") and a closing line that states the purpose ("כך נוכל לבחון בנפרד…") | "Don't add content … that was not spoken" | 2, 4 |
| A hedge dropped ("אם אני זוכר נכון") | "Don't summarize" | 4 |
| A misheard name fixed from the same message (לימוד → לימור) | "Never change a name" | 2 |
| Pronoun/gender agreement fixed (איתה → איתו, from "הוא בדק") | "never change one valid word to another" | 3 |
| Attention-getter dropped ("שמע,"), greeting and sign-off kept ("בוקר טוב", "יום טוב") | none | 4, 5 |
| Spoken punctuation turned into text ("slash" → "ו") | none | 5 |

There is also no way to measure the gap: `fixtures/transcripts.json` has
inputs only, and `npm run prompt-check` prints output for eyeballing with
nothing to compare it to.

## Decision

- **One style, polished rewrite.** No light/polished toggle. Light cleanup is
  replaced, not kept beside it.
- **Rules plus few-shot.** The system prompt is rewritten around the new style,
  and two of the user's examples (3 and 4) become few-shot pairs. Examples 1,
  2 and 5 are held out for evaluation, so the eval measures whether the style
  generalizes rather than whether the model copies.
- **Evaluation is a side-by-side report plus deterministic property checks.**
  No LLM judge. Model output is never asserted in unit tests.

## Design

### 1. System prompt (`src/cleanup.js` `buildSystemPrompt`)

Unchanged rules, kept verbatim:

- Output language locked to the message language; never translate.
- Words already in Latin letters are left exactly as they are.
- No mandate to rewrite words that "look transliterated" (the existing
  comment explaining why stays).
- "If a word is clearly not a real word … correct it" — but its tail "never
  change one valid word to another" is replaced (see Changed), because the
  pronoun fix and the rewrite both change valid words.
- Fix grammar and punctuation, with attention to prepositions, articles, dates
  and numbers.
- Remove fillers, false starts and repeated words; merge fragments; fold
  circled-back remarks into place; drop pure detours.
- Times and measurements as digits; 24-hour clock when the part of day is
  known (current wording).
- Standard abbreviations (נתב"ג, מחו"ל, ס"מ).
- List formatting with a lead-in line on its own line.
- The learned-corrections section and its position before the final
  instruction.
- "Output only the cleaned message. No preamble, no quotes, no explanations."

Changed:

- **Opening line.** From "You clean up voice-note transcripts so they can be
  sent as chat messages." to: "You turn voice-note transcripts into clear,
  well-written messages, ready to send." followed by: "Rewrite freely for
  clarity and flow, in the speaker's own voice and person. A clear written
  register is fine. Keep every fact, number, date, name and decision the
  speaker gave."
- **Names.** Replaces the "Never change a name" line with: "Keep names of
  people and places exactly as spoken. The one exception: when the same
  message spells a name differently elsewhere and it is clearly the same
  person or place, use the form that appears elsewhere. Never change a name to
  one that does not appear in the message, even if it looks misspelled. A
  wrong name is worse than an awkward one."
- **Additions.** Replaces "Don't add content, greetings, or sign-offs that
  were not spoken" with: "You may add what makes the message clearer and that
  clearly follows from what the speaker said: a short heading naming the
  topic, a connecting phrase, a small detail the context makes obvious, or a
  closing line stating the purpose of what was said. Never add numbers, dates,
  times, amounts, names of people, places or companies, or greetings and
  sign-offs the speaker did not give." The user chose this looser rule
  knowingly; the guard is the hard list of things that must never be
  invented, and the regression checks.
- **Ending.** Replaces "Don't add a period at the end" with: "End every
  sentence with punctuation, including the last one."
- **Summarize.** "Don't summarize — keep the same message, just tighter"
  becomes "Don't drop information. Shorter wording is fine; a shorter message
  that loses a detail is not. Verbal hedges about memory or wording ('אם אני
  זוכר נכון', 'I think I remember') may be dropped when the fact itself stays."
- **Formal tone.** "Don't change slang or personal tone into formal writing"
  is removed.
- **Misheard words.** "… but never change one valid word to another" becomes
  "… A real word that is wrong in context (a mishearing, a wrong gender or
  pronoun) may be corrected only when the message itself shows what was
  meant."

New "Do" items:

- "Fix pronoun and gender agreement when the message makes clear who is
  meant (e.g. איתה → איתו when the next sentence says הוא בדק)."
- "Spoken punctuation words become punctuation: 'slash' → 'ו' or '/',
  'נקודה' / 'פסיק' said as punctuation → the mark."
- "Drop openers that only call for attention (שמע, תקשיב, so listen, look).
  Keep greetings and sign-offs the speaker actually said (בוקר טוב, יום טוב,
  thanks)."
- Layout, replacing the three current line-break rules: "Layout: for a short
  update made of separate facts, put one sentence per line and group related
  lines into blocks separated by a blank line. For explanation or reasoning,
  use short paragraphs. Always put a blank line between distinct topics. Don't
  leave a dense block."

### 2. Few-shot examples (`FEW_SHOT_EXAMPLES`)

Hebrew, in this order:

1. The רעננה pair, unchanged except that it already ends with a period
   (anchors the name rule with a name that has no support in the message).
2. The 24-hour pair ("מחר אחר הצהריים יש לי פגישה בארבע וחצי…"), output
   gains a final period.
3. User example 3 (`he-stock-showroom`), input and expected verbatim.
4. User example 4 (`he-car-order-update`), input and expected verbatim.

The current "אה אז אני חושב ש- שנצטרך לדחות" and taxi/נתב"ג pairs are
dropped: the user examples cover fillers and repeated words, and the נתב"ג
abbreviation stays as a rule.

English: four pairs in the same style: the Raanana name pair and the 24-hour
dinner pair (both now ending with a period), plus two new ones (a short update
with one sentence per line, and a list with a lead-in). They are a stand-in until the user adds real English examples; the
spec does not claim they reflect the user's taste.

### 3. iOS parity

`Cleanup.swift` gets the same system prompt and few-shot text.
`npm run prompts` regenerates `fixtures/prompts.json`; the web test
`tests/prompts-fixture.test.js` and the Swift `PromptParityTests` both compare
against it, so both apps fail loudly if they drift.

### 4. Evaluation fixture (`fixtures/cleanup-examples.json`)

Each entry: `name`, `language`, `role` (`"few-shot"` or `"eval"`), `input`,
`expected`, `checks`, and an optional `note`. Checks are deterministic and
target what each example is about:

| Check | Meaning |
|---|---|
| `endsWithPeriod` | Last non-space character is `.`, `!` or `?` |
| `mustInclude: [..]` | Each string appears in the output |
| `mustExclude: [..]` | No string appears in the output |
| `hasNumberedList` | At least two lines start with `1.` and `2.` |
| `noLeadingOpener: [..]` | The output does not start with any of the given words |

Per example:

- `he-legal-steps` (eval): `endsWithPeriod`, `mustInclude: ["מיכל", "גלבוע"]`.
- `he-charging-stations` (eval): `endsWithPeriod`, `hasNumberedList`,
  `mustInclude: ["לימור", "נגה", "ABB"]`, `mustExclude: ["לימוד"]`.
- `he-stock-showroom` (few-shot): no checks run.
- `he-car-order-update` (few-shot): no checks run.
- `he-podcast-dollar` (eval): `endsWithPeriod`, `noLeadingOpener: ["שמע"]`,
  `mustInclude: ["טראמפ"]`, `mustExclude: ["slash"]`.

Two regression cases written for this spec (role `eval`, notes say so):

- `he-unsupported-name`: a short Hebrew note naming a correctly spelled but
  uncommon real place (גן יאשיה), with nothing in the message pointing to
  another name. `mustInclude` it exactly. Guards the רעננה→הרצליה class of
  bug (a real name swapped for a better-known one) under the looser name
  rule.
- `he-time-of-day`: an afternoon meeting time spoken in words.
  `mustInclude` the 24-hour form (e.g. `16:30`).

### 5. Eval script (`scripts/cleanup-eval.js`, `npm run cleanup-eval`)

- The pipeline in `scripts/prompt-check.js` (corrections → English terms →
  cleanup with relevant rules → corrections) moves into an exported
  `runPipeline(text, { provider, model, apiKey, rules, language })` in
  `scripts/pipeline.js` (language is detected when omitted), used by both
  scripts so they cannot drift.
- Same environment variables as `prompt-check` (`PROVIDER`, `MODEL`, the key
  variable, optional `CORRECTIONS`), plus `RUNS` (default 1).
- For each `eval` entry and each run, prints input, the text after the
  English-terms pass when it differs from the input, expected, actual, then one
  ✓/✗ line per check. Ends with a summary: checks passed / total per example.
  Exits non-zero if any check failed, so it can be used in a loop.
- Check logic lives in `scripts/cleanup-checks.js` as pure functions
  `(output, check) → { ok, detail }`.

### 6. Unit tests

- `tests/cleanup-checks.test.js` (new): each check type, passing and failing,
  including Hebrew text, trailing whitespace and the `!`/`?` endings.
- `tests/cleanup.test.js`, changed deliberately:
  - "forbids substituting a different name" becomes "allows a name change only
    to a form found in the same message" (asserts both the exception and
    "Never change a name to one that does not appear in the message").
  - New: "asks for punctuation at the end of the message".
  - New: "allows contextual additions but forbids inventing numbers, dates,
    times, amounts or names".
  - "uses English few-shot examples" and the Hebrew few-shot count assertions
    follow the new pairs.
  - All other existing guards (language lock, no translation, Latin words,
    no transliteration mandate, 24-hour clock, corrections section) stay.
- `tests/prompts-fixture.test.js` passes after `npm run prompts`.

### 7. Order of work and baseline

1. Build the eval harness (sections 4–5) and its unit tests first, with the
   prompt untouched.
2. Run `npm run cleanup-eval` on the current prompt and save the output to
   `docs/superpowers/evals/2026-11-27-baseline-eval.txt`, together with a
   `prompt-check` run over `fixtures/transcripts.json` saved to
   `docs/superpowers/evals/2026-11-27-baseline-transcripts.txt` (the only
   English coverage). A regression case whose checks other than
   `endsWithPeriod` fail on the baseline is not guarding a regression: rewrite
   or drop it before changing the prompt.
3. Change the prompt, few-shots and Swift copy (sections 1–3, 6).
4. Re-run both and compare against the baseline. English output from
   `transcripts.json` is reviewed by eye, since there are no English checks.

`englishTerms.js` runs before cleanup in this pipeline. It never touches
names (טראמפ, נגה, לימור are excluded by its prompt and its Latin-only
guard), so the name checks are safe. It may turn a loanword such as מאקרו
into Latin letters, so no check depends on loanword spelling.

## Out of scope

- Refine (`src/refine.js`): unchanged. Its chips will now act on polished
  text, which is fine.
- `englishTerms.js` and learned corrections: unchanged.
- A light/polished toggle or settings UI.
- An LLM judge.
- English user examples: the fixture accepts them whenever the user adds
  them.

## Done when

1. Unit tests, the prompt snapshot test and the Swift parity tests pass.
2. `RUNS=2 npm run cleanup-eval` (run only after the user approves the API
   cost) passes every check on examples 1, 2, 5 and both regression cases, on
   both runs.
3. The user has read the side-by-side output and accepts the style.
