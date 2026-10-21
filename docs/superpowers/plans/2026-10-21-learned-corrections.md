# Learned Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-10-21-learned-corrections-design.md`](../specs/2026-10-21-learned-corrections-design.md). The spec is normative. Where this plan sketches an algorithm more briefly than the spec, follow the spec, and cite its section (§n, Tn) in the commit message.

**Goal:** Stop losing hand edits on the result screen (Phase 0). Turn repeated hand fixes into user-confirmed, code-applied rules stored encrypted on the device (Phase 1). Then send those rules to transcription and cleanup as hints, with passphrase-encrypted Export/Import (Phase 2).

**Architecture:** Four new modules, each pure or adapter-injected so it can be unit-tested without a browser:

| Module | Role | Depends on |
|---|---|---|
| `src/hebrew.js` | `PREFIXES`, `HEB`, `fold`, `stripPrefixes` | — |
| `src/corrections.js` | tokenizer, diff, candidate filters, matcher, rule-set invariant, document validation. Pure: no storage, DOM or network | `hebrew.js` |
| `src/secureStore.js` | one AES-GCM-encrypted JSON value per slot in IndexedDB; passphrase envelope | WebCrypto, IndexedDB (both injectable) |
| `src/correctionsStore.js` | the rule document: load/save/delete/hits/clear/export/import, a write queue, cross-tab notices | `secureStore.js`, `corrections.js` |

`app.js` wires them into the result screen (commit points, chips, applied hint), the pipeline (pre-pass and post-pass through `safeApply`) and Settings (toggle, list, Clear all, Export/Import).

**Tech Stack:** Vanilla JS (ES modules), Vitest (jsdom by default, `// @vitest-environment node` for crypto tests), WebCrypto, IndexedDB, `BroadcastChannel`. **No new dependencies** (runtime or dev).

## Global Constraints

These come from the spec's Security section and apply to every task. Reviewers should block a PR that breaks one.

- **No markup from data.** Learned strings reach the DOM only through `textContent` / `createElement` (T1). No `innerHTML`, `insertAdjacentHTML` or `outerHTML` anywhere in the diff.
- **Nothing is evaluated.** No `eval`, `Function`, dynamic `import()`, and **no `RegExp` built from rule strings** (T7). Import is `JSON.parse` plus an exact-key validator.
- **No logging of learned data or passphrases.** No new `console.*` calls that include rules, notes or passphrases. Error messages name what failed, never the data.
- **CSP unchanged.** `netlify.toml` is not touched. No new hosts, no `'unsafe-eval'`, no WASM.
- **Never fail the pipeline.** Both correction passes go through `safeApply`. Loading rules for a note is raced against 1.5 s and never throws.
- **Kill switch.** With Learning off: no capture, no chips, no pre/post-pass, no glossary, no prompt section. Request bodies are byte-identical to the pre-feature app.
- **Existing tests stay green and unchanged.** In particular `tests/cleanup.test.js` line 94 (`buildSystemPrompt('he')` byte equality) and `tests/transcribe.test.js`.
- **Code style.** Match the surrounding code: comments only where a non-obvious constraint needs explaining (see `englishTerms.js` header, `app.js` reentrancy comments).
- **Commit messages** follow the repo's `feat:` / `fix:` / `docs:` / `test:` prefixes.

## Before you start

- [ ] `npm ci`. A fresh checkout has no `node_modules`, and `npm test` fails with `vitest: not found` until you do.
- [ ] `npm test`: all existing suites pass. Record the count; every task must leave it at least that high.

## Delivery: three PRs, one per phase

Each phase ships on its own and leaves the app consistent (spec "Phasing").

| PR | Tasks | Ships |
|---|---|---|
| **A: Phase 0** | 1–2 | Edits are never lost; Refine uses edited text; Retry cleanup uses the edited raw text |
| **B: Phase 1** | 3–13 | Capture, confirm chips, code-applied rules, encrypted store, Settings list |
| **C: Phase 2** | 14–20 | Glossary + echo guard, prompt section, notice, Export/Import, prompt-check fixture |

Run the full suite and the PR's manual checks before opening each PR.

## Open questions for reviewers

The spec leaves these open, or a literal reading conflicts with another section. The plan picks the option marked **(plan)**. Please confirm or overrule on the plan PR before Task 3 starts.

1. **`count` granularity (§3, §5).** "1 on save, plus 1 per pre-pass hit", but `app.js` passes `recordHits` a list of *rules*, one per rule that fired. **(plan)** +1 per rule per note, however many occurrences. Then `count ≥ 2` in `vocabularyTerms` means "fired on at least one later note", which the spec intends.
2. **Cross-tab lost updates (§3).** The write queue serialises writes within one tab. Two tabs writing at the same moment can still read-modify-write over each other. **(plan)** Wrap each read-modify-write in `navigator.locks.request('transcriber-corrections', …)` when `navigator.locks` exists, falling back to the in-tab queue. Small, no dependency, closes the gap; adds one test.
3. **Possessive key with multi-token rules (§1 Matcher, step 2).** **(plan)** The `'s`-stripped key matches only *single-token* `from`s. With a multi-token `from` the `'s` sits between tokens and can never satisfy "only whitespace in between".
4. **Gap between tokens of a multi-token `from`.** **(plan)** It must be one or more whitespace characters. An empty gap (post-split pieces such as `ב` + `Jira`) is not "whitespace in between", so `רון ב` never matches `רון בJira`.
5. **Filter 7 and the self-map.** **(plan)** "`from` still matches in the edited text" means `applyCorrections(after, [rule]) !== after`. A sentence-start `Jira` in the edited text must not block learning `jira → Jira`, because that match writes identical text.
6. **Test-only exports for the oracle.** The enumerated `checkRuleSet` oracle needs the matcher's own per-token key test. **(plan)** `corrections.js` exports `__scanner = { buildIndex, tokenMatchesFirst, tokenMatchesLater }` and documents it as test-only. The alternative, duplicating the predicate in the test, defeats the oracle.
7. **Spec nit, filter 3.** The Testing section lists `ברענה → לרענה` as "dropped (from stem < 4)". The from stem `רענה` has 4 letters; the hunk is dropped because stripping leaves `from === to`. **(plan)** Assert that it is dropped, and name the right reason in the test.
8. **`STOPWORDS` contents (§1 filter 6).** The spec gives a size (~40 + ~40) and examples, not a list. Task 4 proposes the list. Please review it, especially the Hebrew half.
9. **WebKit `CryptoKey` wrapping (T2)** is unverified. Nothing in Phase 1 relies on it, but the README and the `.sheet-note` must not claim it. **(plan)** Task 13's README wording says "stored encrypted on this device" and nothing about backups.

---

# PR A: Phase 0, stop losing edits

### Task 1: `EDIT_COMMIT` in the reducer

**Files:**
- Modify: `src/state.js`
- Test: `tests/state.test.js`

**Interfaces:**
- Produces: event `{ type: 'EDIT_COMMIT', text }`. In phase `result` with non-blank `text`, it writes `cleanedText` if that is non-null, else `rawTranscript`. Otherwise it returns `state` unchanged (same object).

- [ ] **Step 1: Write the failing tests** (append to `tests/state.test.js`)

```js
describe('EDIT_COMMIT', () => {
  const result = { ...initialState, phase: 'result', rawTranscript: 'raw', cleanedText: 'clean', autoCopied: true, error: null };

  it('updates cleanedText when cleanup succeeded', () => {
    const s = reduce(result, { type: 'EDIT_COMMIT', text: 'clean, fixed' });
    expect(s.cleanedText).toBe('clean, fixed');
    expect(s.rawTranscript).toBe('raw');
  });

  it('updates rawTranscript when cleanup failed, so Retry cleanup uses the edit', () => {
    const failed = { ...result, cleanedText: null, error: 'boom' };
    const s = reduce(failed, { type: 'EDIT_COMMIT', text: 'raw, fixed' });
    expect(s.rawTranscript).toBe('raw, fixed');
    expect(s.cleanedText).toBeNull();
    expect(s.error).toBe('boom');
  });

  it('ignores whitespace-only text', () => {
    expect(reduce(result, { type: 'EDIT_COMMIT', text: '  \n ' })).toBe(result);
  });

  it('ignores phases other than result', () => {
    const cleaning = { ...result, phase: 'cleaning' };
    expect(reduce(cleaning, { type: 'EDIT_COMMIT', text: 'x' })).toBe(cleaning);
  });

  it('leaves autoCopied and error alone', () => {
    const s = reduce(result, { type: 'EDIT_COMMIT', text: 'y' });
    expect(s.autoCopied).toBe(true);
    expect(s.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/state.test.js`

- [ ] **Step 3: Implement** (in `reduce`, after `REFINE_OK`)

```js
    case 'EDIT_COMMIT':
      if (state.phase !== 'result' || !event.text.trim()) return state;
      // After a failed cleanup the textarea shows the raw transcript, so that is
      // the field being edited — and Retry cleanup must start from the fix.
      return state.cleanedText !== null
        ? { ...state, cleanedText: event.text }
        : { ...state, rawTranscript: event.text };
```

- [ ] **Step 4: Run, expect PASS.** Then `npm test`.
- [ ] **Step 5: Commit** `feat: add EDIT_COMMIT so hand edits reach state`

### Task 2: Render guard and commit points in `app.js`

**Files:**
- Modify: `src/app.js`

No DOM-level automated tests exist for `app.js` (see the OpenRouter plan's self-review), so this task ends in manual checks.

- [ ] **Step 1: Render guard.** Add next to the refine overlay state (line ~38):

```js
// The text last written into #result-text. render() writes the textarea only
// when the source text changes, so no unrelated re-render can wipe an edit.
let lastShownText = null;
```

In `render()`'s `state.phase !== 'result'` block (lines 126–132) add `lastShownText = null;`. Replace line 169 with:

```js
    const shown = state.cleanedText ?? state.rawTranscript ?? '';
    if (shown !== lastShownText) { $('result-text').value = shown; lastShownText = shown; }
```

- [ ] **Step 2: Commit helper** (above the `btn-copy` handler):

```js
// Brings state in line with the textarea, so Refine, Retry cleanup and later
// renders work from what the user actually sees.
function commitEdits() {
  const current = $('result-text').value;
  const baseline = state.cleanedText ?? state.rawTranscript ?? '';
  if (current === baseline || !current.trim()) return;
  lastShownText = current;
  dispatch({ type: 'EDIT_COMMIT', text: current });
}
```

- [ ] **Step 3: Commit points** (spec §5 table, without the `learn` branch):

```js
$('btn-copy').onclick = async () => {
  // copyText must start synchronously inside the tap (iOS clipboard rule).
  const p = copyText($('result-text').value);
  commitEdits();
  const ok = await p;
  if (ok) showCopied('Copied ✓');
  else $('copy-error').hidden = false;
};

$('btn-whatsapp').onclick = () => {
  const text = $('result-text').value;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  commitEdits();
};

$('result-text').addEventListener('change', () => commitEdits());
```

- `btn-refine`: call `commitEdits()` as the first statement after the `refineApplying` guard (before `refineOpen = !refineOpen`).
- `handleChipClick`: call `commitEdits()` after the `refineApplying` guard and before `refineApplying = true` / `render()`.
- `btn-retry-cleanup`: call `commitEdits()` before `dispatch({ type: 'CLEANUP_RETRY' })`.
- `btn-new`: unchanged.

- [ ] **Step 4: `npm test`** — all PASS (no unit test touches `app.js`).
- [ ] **Step 5: Manual checks** (`npm run dev`, desktop Chrome and iOS Safari via the Netlify deploy preview):
  1. Edit the result, tap Refine: the edit stays, and the chips are generated for the edited text (Network tab: request body has the edit).
  2. Edit, open Refine, tap a chip: the refinement starts from the edited text.
  3. Edit, open and close Settings: the edit stays.
  4. Force a cleanup failure (bad cleanup key), edit the raw text, Retry cleanup: cleanup runs on the edited text.
  5. Clear the textarea completely and tap Copy: no "Cleanup failed" notice appears.
  6. Copy still auto-copies on iOS (the first tap works).
- [ ] **Step 6: Commit** `fix: keep hand edits on the result screen across re-renders`

**→ Open PR A.**

---

# PR B: Phase 1, capture, confirm, apply, store

### Task 3: `src/hebrew.js`, and `englishTerms.js` imports it

**Files:**
- Create: `src/hebrew.js`
- Modify: `src/englishTerms.js` (delete lines 13–18, import instead)
- Test: `tests/hebrew.test.js`

**Interfaces:**
- Produces: `PREFIXES = 'בלהוכמש'`, `HEB = '֐-׿'` (moved verbatim), `fold(text)`, `stripPrefixes(word)`.

- [ ] **Step 1: Failing tests**

```js
import { describe, it, expect } from 'vitest';
import { fold, stripPrefixes, PREFIXES } from '../src/hebrew.js';

describe('fold', () => {
  it('maps the six smart-punctuation and geresh/gershayim characters', () => {
    expect(fold('’‘׳')).toBe("'''");
    expect(fold('“”„״')).toBe('""""');
  });
  it('preserves length, so token offsets stay valid in the original text', () => {
    const s = 'מנכ”ל ג׳ירה it’s';
    expect(fold(s)).toHaveLength(s.length);
    expect(fold(s)).toBe('מנכ"ל ג\'ירה it\'s');
  });
});

describe('stripPrefixes', () => {
  it('returns the word and up to two leading prefix letters removed', () => {
    expect(stripPrefixes('ברעננה')).toEqual(['ברעננה', 'רעננה']);
    expect(stripPrefixes('ומהבית')).toEqual(['ומהבית', 'מהבית', 'הבית']);
  });
  it('never returns an empty stem', () => {
    expect(stripPrefixes('ב')).toEqual(['ב']);
    expect(stripPrefixes('בה')).toEqual(['בה', 'ה']);
  });
  it('leaves Latin words alone', () => {
    expect(stripPrefixes('jira')).toEqual(['jira']);
  });
  it('exports the prefix letters', () => expect(PREFIXES).toBe('בלהוכמש'));
});
```

- [ ] **Step 2: FAIL.** `npx vitest run tests/hebrew.test.js`
- [ ] **Step 3: Implement**

```js
// Hebrew glues prefix letters (ב ל ה ו כ מ ש) onto a following word, up to two of them.
export const PREFIXES = 'בלהוכמש';

// A Hebrew letter on either side means we are inside a longer word (באג vs באגרטל).
export const HEB = '֐-׿';

const FOLD = { '’': "'", '‘': "'", '׳': "'", '“': '"', '”': '"', '„': '"', '״': '"' };

// One character in, one character out: offsets into the folded text are
// offsets into the original.
export function fold(text) {
  return text.replace(/[’‘׳“”„״]/g, (c) => FOLD[c]);
}

export function stripPrefixes(word) {
  const out = [word];
  for (let n = 1; n <= 2; n++) {
    if (word.length > n && PREFIXES.includes(word[n - 1])) out.push(word.slice(n));
    else break;
  }
  return out;
}
```

In `englishTerms.js`, replace lines 13–18 with `import { PREFIXES, HEB } from './hebrew.js';` and move the two explanatory comments into `hebrew.js` as above. `escape` and `LATIN_TERM` stay.

- [ ] **Step 4: PASS** — `npx vitest run tests/hebrew.test.js tests/englishTerms.test.js` (the englishTerms suite proves no behaviour change).
- [ ] **Step 5: Commit** `refactor: move Hebrew prefix helpers into hebrew.js`

### Task 4: `corrections.js` part 1: normalisation, language, stopwords, tokenizer

**Files:**
- Create: `src/corrections.js`
- Test: `tests/corrections.test.js`

**Interfaces:**
- Produces: the constants from spec §1; `normalizeRuleString(s) → string | null`; `ruleLanguage(from) → 'he' | 'en'`; `ruleKey(r)`; `tokenize(text) → Token[]`, where `Token = { text, folded, start, end, word, prefix }`; `STOPWORDS` (a `Set`, exported for tests).

- [ ] **Step 1: Failing tests**

```js
import { describe, it, expect } from 'vitest';
import { tokenize, normalizeRuleString, ruleLanguage, ruleKey } from '../src/corrections.js';

const words = (s) => tokenize(s).filter((t) => t.word).map((t) => t.text);
const all = (s) => tokenize(s).map((t) => t.text);

describe('tokenize', () => {
  it('keeps joined words whole', () => {
    expect(words("ג'ירה מנכ\"ל מנכ”ל בית־ספר follow-up Node.js")).toEqual(
      ["ג'ירה", 'מנכ"ל', 'מנכ”ל', 'בית־ספר', 'follow-up', 'Node.js']);
  });
  it('reports original text, folded text and offsets', () => {
    const [t] = tokenize('  מנכ”ל');
    expect(t).toMatchObject({ text: 'מנכ”ל', folded: 'מנכ"ל', start: 2, end: 7, word: true, prefix: false });
  });
  it('post-splits Hebrew prefixes glued to Latin or digits', () => {
    expect(all('ה-jira')).toEqual(['ה', '-', 'jira']);
    expect(all('לjira')).toEqual(['ל', 'jira']);
    expect(all('מהbackend')).toEqual(['מה', 'backend']);
    expect(all('ב-7')).toEqual(['ב', '-', '7']);
    expect(tokenize('ה-jira')[0].prefix).toBe(true);
    expect(tokenize('ה-jira')[2].prefix).toBe(false);
  });
  it('does not split a Hebrew word that only starts with prefix letters', () => {
    expect(all('שלום-7')).toEqual(['שלום-7']);
    expect(all('בית')).toEqual(['בית']);
  });
  it('makes punctuation single tokens and whitespace no tokens', () => {
    expect(all('hi,  there!\n')).toEqual(['hi', ',', 'there', '!']);
  });
  it('keeps jira.company.com and Dan-Cohen as one token', () => {
    expect(words('jira.company.com Dan-Cohen')).toEqual(['jira.company.com', 'Dan-Cohen']);
  });
});

describe('normalizeRuleString', () => {
  it('folds, applies NFC and trims', () => {
    expect(normalizeRuleString('  מנכ”ל ')).toBe('מנכ"ל');
  });
  it.each([
    ['digits', 'Jon5'], ['Cyrillic о in Jоhn', 'Jоhn'], ['U+034F', 'Jo͏hn'],
    ['variation selector', 'John️'], ['leading mark', 'ָשלום'], ['<', 'a<b'],
    ['newline', 'Jon\nSmith'], ['mixed-script word', 'שלוםabc'], ['four tokens', 'a b c d'],
    ['over 64 chars', 'a'.repeat(65)], ['double space', 'Jon  Smith'], ['comma', 'Jon,Smith'],
  ])('rejects %s', (_label, s) => expect(normalizeRuleString(s)).toBeNull());
  it('accepts up to three words', () => expect(normalizeRuleString('בן גוריון')).toBe('בן גוריון'));
});

describe('ruleLanguage / ruleKey', () => {
  it('is he when from has a Hebrew letter', () => {
    expect(ruleLanguage("ג'ירה")).toBe('he');
    expect(ruleLanguage('jira')).toBe('en');
  });
  it('keys on language and from', () => {
    expect(ruleKey({ language: 'en', from: 'jira', to: 'Jira' })).toBe('en\u0000jira');
  });
});
```

- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement**

```js
import { PREFIXES, fold, stripPrefixes } from './hebrew.js';

export const MAX_RULES = 200, MAX_RULE_TOKENS = 3, MAX_RULE_CHARS = 64;
export const MAX_PROMPT_RULES = 30, MAX_VOCAB_TERMS = 20, MAX_VOCAB_CHARS = 200;
export const MAX_DIFF_CELLS = 1_000_000;

export const ruleKey = (r) => `${r.language}\u0000${r.from}`;

const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['".&/+\-־][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/u;
const TOKEN = new RegExp(`${WORD.source}|\\S`, 'gu');
// 1–2 prefix letters, an optional hyphen or maqaf, then Latin or a digit: "ה-jira", "מהbackend".
const POST_SPLIT = new RegExp(`^([${PREFIXES}]{1,2})([-־]?)(?=[\\p{Script=Latin}\\p{N}])`, 'u');

export function tokenize(text) {
  const folded = fold(text);
  const out = [];
  const push = (start, end, word, prefix) =>
    out.push({ text: text.slice(start, end), folded: folded.slice(start, end), start, end, word, prefix });
  for (const m of folded.matchAll(TOKEN)) {
    const start = m.index, end = start + m[0].length;
    if (!/^[\p{L}\p{N}]/u.test(m[0])) { push(start, end, false, false); continue; }
    const split = POST_SPLIT.exec(m[0]);
    if (!split) { push(start, end, true, false); continue; }
    const p = split[1].length, h = split[2].length;
    push(start, start + p, true, true);
    if (h) push(start + p, start + p + h, false, false);
    push(start + p + h, end, true, false);
  }
  return out;
}
```

`normalizeRuleString`: `fold` → `.normalize('NFC')` → `.trim()`; then return `null` unless all four conditions of spec §1 hold. Use the spec's regex verbatim with the `u` flag, `/\p{Default_Ignorable_Code_Point}/u` for the ignorable check, a per-word `/^[\p{Script=Hebrew}'"־\-.&/+]+$/u` vs `/^[\p{Script=Latin}'"\-.&/+]+$/u` script check (words split on `' '`, and each word must contain a letter of its script), `length ≤ MAX_RULE_CHARS`, and `split(' ').length ≤ MAX_RULE_TOKENS`.

`ruleLanguage(from)`: `/[א-ת]/.test(from) ? 'he' : 'en'`.

`STOPWORDS` (proposal; see open question 8), as a `Set`:

```
he: של את על זה זו זאת אם כי גם לא כן אבל או עם אני אתה את הוא היא אנחנו אתם הם הן
    יש אין מה מי איך למה כל רק עוד כבר אז פה שם היה היו להיות אחרי לפני כמו בין אל
en: the a an and or but to of in on at for with from by is are was were be been being
    it its this that these those i you he she we they not no yes so as if then than there
    here about into
```

- [ ] **Step 4: PASS.**
- [ ] **Step 5: Commit** `feat: add rule-string normalisation and the shared tokenizer`

### Task 5: `corrections.js` part 2: the matcher

**Interfaces:**
- Produces: `capitalizeFor(to)`, `applyCorrections(text, rules, { onHit })`, `safeApply(text, rules, onHit)`, and (test-only) `__scanner = { buildIndex, tokenMatchesFirst, tokenMatchesLater }`.
- `buildIndex(rules) → { first: Map<foldedKey, Entry[]>, later: Set<folded> }`, where `Entry = { rule, tokens: string[] /* folded from tokens */, sentenceOnly: boolean }` and each `Entry[]` is sorted by `tokens.length` descending.
- `tokenMatchesFirst(index, token, sentenceStart) → Entry[]` lists the entries whose first token this token's keys hit, with the ≥ 4-letter rule and `sentenceOnly` already applied. Each returned entry also carries `{ prefixLen, suffixLen }` for the splice.
- `tokenMatchesLater(index, token) → boolean`.

`applyCorrections` and the invariant checker (Task 6) both call these, so they cannot drift (spec §1 "defined in terms of the matcher itself").

- [ ] **Step 1: Failing tests** (spec Testing → Matcher, `@` boundary, `safeApply`)

```js
import { applyCorrections, safeApply, capitalizeFor } from '../src/corrections.js';

const R = (from, to) => ({ from, to, language: /[א-ת]/.test(from) ? 'he' : 'en' });
const apply = (text, ...rules) => applyCorrections(text, rules);

describe('applyCorrections', () => {
  it('never matches inside a longer token', () => {
    expect(apply("ג'דן", R('דן', 'רן'))).toBe("ג'דן");
    expect(apply('jira.company.com', R('jira', 'Jira'))).toBe('jira.company.com');
    expect(apply('Dan-Cohen', R('Dan', 'Danny'))).toBe('Dan-Cohen');
    expect(apply('באגרטל', R('באג', 'bug'))).toBe('באגרטל');
  });
  it('takes a prefix only for a from of 4+ Hebrew letters', () => {
    expect(apply('לאור באור מאור', R('אור', 'אורי'))).toBe('לאור באור מאור');
    expect(apply('אור', R('אור', 'אורי'))).toBe('אורי');
    expect(apply('וברענה', R('רענה', 'רעננה'))).toBe('וברעננה');
  });
  it('capitalises at sentence start without breaking camel case', () => {
    expect(apply('jira. jira', R('jira', 'Jira'))).toBe('Jira. Jira');
    expect(apply('Iphone is here. iphone', R('iphone', 'iPhone'))).toBe('iPhone is here. iPhone');
    expect(capitalizeFor('iPhone')).toBe('iPhone');
    expect(capitalizeFor('node.js')).toBe('Node.js');
  });
  it("keeps 's and folds smart quotes", () => {
    expect(apply('Jon’s car', R('Jon', 'John'))).toBe('John’s car');
    expect(apply('ג׳ירה', R("ג'ירה", 'Jira'))).toBe('Jira');
  });
  it('matches multi-token froms across whitespace only', () => {
    expect(apply('דני כהן', R('דני כהן', 'דני כהנא'))).toBe('דני כהנא');
    expect(apply('דני, כהן', R('דני כהן', 'דני כהנא'))).toBe('דני, כהן');
  });
  it('leaves @-glued tokens alone', () => {
    expect(apply('dan@x.com @dan dan', R('dan', 'Dan'))).toBe('dan@x.com @dan Dan');
  });
  it('reports one hit per change and none for identical writes', () => {
    const hits = [];
    applyCorrections('Jira and jira', [R('jira', 'Jira')], { onHit: (r, m, w) => hits.push([m, w]) });
    expect(hits).toEqual([['jira', 'Jira']]);
  });
  it('replaces בג\'ירה with בJira, as applyEnglishTerms would', () => {
    expect(apply("בג'ירה", R("ג'ירה", 'Jira'))).toBe('בJira');
  });
});

describe('safeApply', () => {
  it('returns its input on any throw', () => {
    const evil = [{ get from() { throw new Error('x'); }, to: 'y', language: 'en' }];
    expect(safeApply('hello', evil, () => {})).toBe('hello');
  });
});
```

- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement** following spec §1 "Matcher" steps 1–3. Notes:
  - **Index.** The key is the folded first token. For an all-lowercase Latin `from` (`from === from.toLowerCase()` and its first letter is cased), add a second entry under `capitalizeFor(firstToken)` with `sentenceOnly: true`.
  - **Keys per token**, in order: the token's folded text; for a Hebrew token, `stripPrefixes(folded).slice(1)` (prefix length 1 and 2), usable only by entries whose `from` has ≥ 4 Hebrew letters; for a Latin token ending in `'s`, the token without `'s`, usable only by single-token entries (open question 3).
  - **Sentence start** for token `i`: `i === 0`, or token `i-1` is one of `. ! ? …`, or the text between tokens `i-1` and `i` contains `\n`.
  - **Multi-token:** token `i+k` must be a word whose `folded` equals `entry.tokens[k]`, and the gap `text.slice(tokens[i+k-1].end, tokens[i+k].start)` must match `/^\s+$/` (open question 4).
  - **`@` guard:** skip if `text[first.start - 1] === '@'` or `text[last.end] === '@'`.
  - **Splice:** `written = prefixAsWritten + (sentenceOnly ? capitalizeFor(to) : to) + suffixAsWritten`. `matched = text.slice(first.start, last.end)`. Call `onHit` only if `written !== matched`. Move the cursor to `last.end` and continue scanning from the next token.
  - `capitalizeFor(to)`: return `to` unchanged if `/\p{Lu}/u.test(to.slice(1))`, else uppercase the first character.
  - `safeApply = (text, rules, onHit) => { try { return applyCorrections(text, rules, { onHit }); } catch { return text; } }`
- [ ] **Step 4: PASS.**
- [ ] **Step 5: Commit** `feat: add the token-level corrections matcher`

### Task 6: `corrections.js` part 3: `checkRuleSet` (oracle first, then analytic)

**Files:**
- Create: `tests/helpers/ruleSetOracle.js` (test-only, never imported by `src/`)
- Modify: `src/corrections.js`, `tests/corrections.test.js`

**Interfaces:**
- Produces: `checkRuleSet(rules) → { ok: true } | { ok: false, conflicts: [[a, b], …] }`, returning every conflicting pair in one pass. A pair `[a, b]` means "`a.to` can feed `b.from`". `b === a` only for a self-conflict.

- [ ] **Step 1: Write the oracle.** This is the enumerated definition from spec §1 "Idempotence invariant", built on `__scanner`:
  - For each rule `R` and each output form `p + c(R.to) + s` (`p ∈ {'', each 1–2 letter combination of PREFIXES, each with '', '-' or '־'}`, `c ∈ {id, capitalizeFor}`, `s ∈ {'', "'s"}`), tokenize the form.
  - For each word token `k` (sentence start on and off for `k === 0`): every entry from `tokenMatchesFirst` is a conflict `[R, entry.rule]`, **except** when `entry.rule === R`, the entry's `from` spans the whole form, and the splice would write identical text (the self-map exception). Every later-token hit (`tokenMatchesLater`) is a conflict with the rules owning that later token.
- [ ] **Step 2: Failing tests**

```js
import { checkRuleSet } from '../src/corrections.js';
import { oracleCheck } from './helpers/ruleSetOracle.js';

const COUNTEREXAMPLES = [
  [R('New', 'York'), R('York City', 'NYC')],
  [R("ג'ירה", 'Jira'), R('Jira board', 'Jira Board')],
  [R('דן', 'רן'), R('ורן', 'וירן')],
  [R('שמש', 'שאן'), R('בית שאן', 'בית-שאן')],
  [R('Dan', 'Dan Cohen')],
  [R('nodejs', 'node.js'), R('Node.js', 'NodeJS')],
  [R('jira', 'Jira'), R('Jira board', 'Jira-Board')],
  [R('jira', "ג'ירה"), R("ה-ג'ירה", 'הגירה')],
  [R("ג'ירה", 'Jira'), R('רון ב', 'רונן ב')],
];

describe('checkRuleSet', () => {
  it.each(COUNTEREXAMPLES)('rejects counterexample %#', (...rules) => {
    expect(checkRuleSet(rules).ok).toBe(false);
    expect(oracleCheck(rules).ok).toBe(false);
  });
  it('accepts the jira → Jira self-map', () => expect(checkRuleSet([R('jira', 'Jira')]).ok).toBe(true));
  it('is not stricter than the matcher: שרן → שרון with רון → רונן', () => {
    expect(checkRuleSet([R('שרן', 'שרון'), R('רון', 'רונן')]).ok).toBe(true);
  });
  it('returns all conflicting pairs in one pass', () => {
    const r = checkRuleSet([R('New', 'York'), R('York City', 'NYC'), R('Dan', 'Dan Cohen')]);
    expect(r.conflicts).toHaveLength(2);
  });
  it('never accepts a set the enumerated definition rejects (oracle property)', () => {
    for (const rules of randomRuleSets({ seed: 1, count: 500 })) {
      if (!oracleCheck(rules).ok) expect(checkRuleSet(rules).ok).toBe(false);
    }
  });
  it('validates 200 rules in well under 50 ms', () => {
    const rules = randomRuleSets({ seed: 2, count: 1, size: 200, valid: true })[0];
    const t = performance.now(); checkRuleSet(rules);
    expect(performance.now() - t).toBeLessThan(50);
  });
});
```

`randomRuleSets` lives in `tests/helpers/ruleGen.js`, driven by a seeded PRNG (mulberry32, inline, no dependency). Its generator covers the cases the spec's Testing section lists: lone-prefix `from` tokens, hyphen and maqaf prefixes, Latin `from` with Hebrew `to` (matched in its `'s` form), lowercase Latin `from`s, and sentence start on and off. It filters candidates through `normalizeRuleString`, so every generated rule is well-formed.

- [ ] **Step 3: FAIL.**
- [ ] **Step 4: Implement the analytic check** (spec §1 "Implementation: analytic"). Index every `from` token once (first tokens and capitalised entries, later tokens, `stripPrefixes` stems, `p+h+X` tokens keyed by `X`, and a lone-prefix-token flag). Then, for each rule's `to`, perform the four constant-time lookups:
  1. **Empty `p`:** run the tokens of `c(T) + s` through `tokenMatchesFirst` / `tokenMatchesLater` with sentence start on and off (4 forms for Latin `T`, 1 for Hebrew), applying the self-map exception.
  2. **Hyphenated `p` before a Hebrew `T₀`:** conflict iff some `from` token indexed as `p + h + X` has `X === T₀`.
  3. **Glued `p` before a Hebrew `T₀`:** conflict iff (first) some first token `F` has `T₀ ∈ stripPrefixes(F)`, or a ≥ 4-letter `from` stem is in `stripPrefixes(T₀)`; or (later) some later token `L ≠ T₀` has `T₀ ∈ stripPrefixes(L)`.
  4. **Any `p` before a Latin or digit `T₀`:** conflict iff the lone-prefix flag is set.

  When the analytic result and the oracle disagree, fix the analytic side toward the stricter answer (spec).
- [ ] **Step 5: PASS**, including the property and performance tests. Run the property test with `count: 5000` once locally before committing.
- [ ] **Step 6: Commit** `feat: add the rule-set idempotence check with an enumerated oracle`

### Task 7: `corrections.js` part 4: `isLearnableRule`, diff, candidates

**Interfaces:**
- Produces: `isLearnableRule(rule)`, `diffTokens(beforeTokens, afterTokens) → [{ from: Token[], to: Token[] }]`, `extractCandidates(before, after, { rules }) → [{ from, to, language, group }]`, `mergeCandidates(found, pending, dismissed)`.

- [ ] **Step 1: Failing tests.** Translate every bullet of the spec's Testing → "Filters", "`isLearnableRule`" and "Diff" lists into one `it` each. A table-driven helper keeps it short:

Most rows have an unchanged neighbour word, so filter 9 also offers a two-word sibling. The table compares only the **primary** candidate of each group, and the sibling rules get their own tests.

```js
const primary = (before, after, rules = []) => {
  const seen = new Set();
  return extractCandidates(before, after, { rules })
    .filter(({ group }) => !seen.has(group) && seen.add(group))
    .map(({ from, to }) => `${from} → ${to}`);
};
const cand = primary;

it.each([
  ['ה-jira עובד', 'ה-Jira עובד', ['jira → Jira']],
  ['המנכל אמר', 'המנכ”ל אמר', ['מנכל → מנכ"ל']],
  ['נסעתי לנתב"ג היום', 'נסעתי לבן גוריון היום', ['נתב"ג → בן גוריון']],
  ['דיברתי עם ברג', 'דיברתי עם ברק', ['ברג → ברק']],
  ['ראיתי את מיכל', 'ראיתי את מיכאל', ['מיכל → מיכאל']],
  ["פתחתי בג'ירה", 'פתחתי ב-Jira', ["ג'ירה → Jira"]],
  ["פתחתי בג'ירה", 'פתחתי בJira', ["ג'ירה → Jira"]],
  ['מושה הגיע', 'משה הגיע', ['מושה → משה']],          // shared מ, stem ושה < 4 → whole
  ['הילנה באה', 'אילנה באה', ['הילנה → אילנה']],
  ['כרן באה', 'קרן באה', ['כרן → קרן']],
  ['כרמלה באה', 'קרמלה באה', ['כרמלה → קרמלה']],
  ['נסעתי ברענה', 'נסעתי לרעננה', ['רענה → רעננה']],
  ['נסעתי ברענה', 'נסעתי רעננה', ['רענה → רעננה']],
  ['נסעתי רענה', 'נסעתי ברעננה', ['רענה → רעננה']],
  ['ביקי באה', 'ויקי באה', []],                    // from === to after stripping
  ['נסעתי ברענה', 'נסעתי לרענה', []],               // from === to after stripping (open question 7)
  ['נפגשנו ב-7', 'נפגשנו ב-19', []],
  ['זה 2.5 שעות', 'זה 4.5 שעות', []],
  ['נסעתי רעננה', 'נסעתי ברעננה', []],              // prefix-only
  ['the plan. jira is fine', 'the plan. Jira is fine', []], // sentence-start case
  ['של הבית', 'את הבית', []],                       // stopword
  ["Jon's car", "John's car", ['Jon → John']],
])('%s ⇒ %s', (before, after, expected) => expect(cand(before, after)).toEqual(expected));

it('offers the name-context sibling in the same group', () => {
  const all = extractCandidates('דני כהן הגיע', 'דני כהנא הגיע', { rules: [] });
  expect(all.map(({ from, to }) => `${from} → ${to}`)).toEqual(['כהן → כהנא', 'דני כהן → דני כהנא']);
  expect(new Set(all.map((c) => c.group)).size).toBe(1);
});
```

Siblings are offered only for hunks that pass filters 0–8. A dropped hunk such as ביקי → ויקי offers no sibling either.

Also add:
- the no-sibling cases (neighbour is a stopword, a 1-letter word, a lone prefix token, or separated by punctuation);
- two far-apart fixes in a generated 850-token note are both caught;
- a diff over `MAX_DIFF_CELLS` returns `[]`;
- `mergeCandidates` appends new candidates after pending ones, dedupes, and drops dismissed keys;
- the `isLearnableRule` rejection list from the spec;
- `extractCandidates(…, { rules: [R('jira', 'Jira')] })` drops a `jira → Jira` candidate (filter 8).

- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement.**
  - **`diffTokens`:** trim the common prefix and suffix (compare `folded`). If `m * n > MAX_DIFF_CELLS`, return `null`, and the caller returns `[]`. Fill a `Uint16Array((m + 1) * (n + 1))` LCS table and backtrack into maximal unequal runs.
  - **`extractCandidates`:** run filters 0–9 in spec order, each as a small named function (`detachPrefix`, `trimEdges`, `hasDigits`, `resolvePrefixes`, `stripPossessive`, `isSentenceStartCaseChange`, gate, `stillMatches`, `alreadyKnown`, `siblingFor`), so each filter maps to one spec bullet.
  - **`resolvePrefixes`**, the subtle one: build each side's *candidate prefixes*. That is the detached prefix if there is one, else its leading 2-letter and 1-letter `PREFIXES` runs.
    - **Shared:** take the longest prefix common to both sides whose removal leaves a from stem of ≥ 4 Hebrew letters. If there is none, keep the full forms.
    - **Otherwise (differing or one-sided):** use only the first-letter candidates. Strip them only if the stems then begin with the same letter. In that case a from stem of < 4 letters, or `from === to`, drops the hunk. If the stems begin differently, keep the full forms.
    - **Prefix-only:** test it first, on the full forms with the detached prefixes glued back.
  - **`group`:** the `ruleKey` of the one-token candidate, shared by its sibling.
  - **`isLearnableRule`:** implement exactly the list in spec §1 filter 6. It calls `checkRuleSet([rule])` and must not be called *from* `checkRuleSet`, to avoid recursion.
- [ ] **Step 4: PASS.**
- [ ] **Step 5: Commit** `feat: extract learnable correction candidates from hand edits`

### Task 8: `corrections.js` part 5: `validateDocument`, `relevantRules`, `vocabularyTerms`, property test

**Interfaces:**
- Produces: `validateDocument(obj, { mode: 'import' | 'stored' }) → { ok, doc, dropped }`, `relevantRules(text, rules, max)`, `vocabularyTerms(rules, { maxTerms, maxChars })`.

- [ ] **Step 1: Failing tests.**
  - **`import` mode** rejects `500 → 5000`, a one-letter `from`, a `__proto__` key, an extra key on a rule or the document, non-empty `examples`, `v: 2`, a `count` of 1.5 or −1, and a bad date.
  - **`stored` mode** drops bad rules, reports `dropped`, and resolves conflicts with the deterministic walk (equal counts tie-break by `lastUsedAt`, then `ruleKey`; the result is always conflict-free). It reports `unsupported` for `v: 2` or unknown top-level keys.
  - `relevantRules` caps at `max` and orders by `count`, then `lastUsedAt`.
  - `vocabularyTerms` keeps only `count ≥ 2` and 1–2-token `to`s, skips stopwords, and enforces both caps.
  - **The idempotence property test** (spec Testing → "Property test"): for random valid rule sets, `apply(apply(s)) === apply(s)`. Bias the rule generator to lowercase Latin `from`s, and the text generator to sentence-initial placements and cross-script `to`s after glued prefixes.
- [ ] **Step 2: FAIL.** **Step 3: Implement.** Validated values are copied into fresh objects built field by field. Use `Object.keys(x)` for exact-key comparison; never use `in` or `Object.assign`.
- [ ] **Step 4: PASS.** **Step 5: Commit** `feat: validate learned-fixes documents and select rules per note`

### Task 9: `src/secureStore.js` (at rest) and the memory backend

**Files:**
- Create: `src/secureStore.js`, `tests/helpers/memoryBackend.js`
- Test: `tests/secureStore.test.js` (`// @vitest-environment node`)

**Interfaces:**
- **Backend contract** (implemented by `indexedDbBackend` and `memoryBackend`):

```js
{
  read(name)            // → Promise<any | undefined>; rejects if the value can't be deserialised
  add(name, value)      // → Promise<void>; rejects with an Error whose .name is 'ConstraintError' if present
  put(name, value)      // → Promise<void>
  destroy({ onBlocked }) // closes this connection, deletes the database; onBlocked() if another
                        //   connection holds it; resolves when the delete completes
  onVersionChange(cb)   // another connection is deleting/upgrading: close and drop caches
  onDeleted(cb)         // a delete this backend started has completed (incl. after 'blocked')
}
```

- **Store:** `openSecureStore(slot, { backend, subtle, randomBytes })` returns `{ get, set, clear, onDeferredClear }`, matching spec §2 plus `onDeferredClear(cb)`, which forwards `backend.onDeleted` so `correctionsStore` can post `'changed'`.

- [ ] **Step 1: Failing tests** — every bullet under spec Testing → `secureStore.test.js`, using `memoryBackend()` and `webcrypto.subtle` from `node:crypto`.
  - The memory backend can be told to throw on reading `'key'` (simulating a lost WebKit master key).
  - A second `memoryBackend` handle on the same `Map` stands in for a second tab, so `destroy` from one triggers `onVersionChange` in the other.
  - It can be told to report "blocked" until released.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement.**
  - **AAD:** `transcriber:secureStore:<slot>:v1`.
  - **Record:** `{ v: 1, iv, ct }`.
  - **Key:** `generateKey(…, false, ['encrypt', 'decrypt'])`, stored via `add`; on `ConstraintError`, re-read it.
  - **`rev`:** `` `${slot}:${b64(iv)}:${ct.byteLength}` ``.
  - **Check `v` first:** a newer `v` → `'unsupported'`, checked before decrypting.
  - **Error mapping:** every decrypt, key or JSON failure → `SecureStoreError('unreadable')`. A missing `indexedDB` or `subtle` → `'unavailable'` on first use.
  - **`clear()`:** a 3 s timer started on `onBlocked` → `'blocked'`.
  - **After the first successful `set()`:** call `navigator.storage?.persist?.()` once.

  `indexedDbBackend(dbName)` is ~50 lines. It opens lazily with one `kv` object store, sets `db.onversionchange = () => { db.close(); db = null; cb(); }`, and wraps requests in promises. It is covered by the manual checks only (spec Testing).
- [ ] **Step 4: PASS.** **Step 5: Commit** `feat: add an encrypted IndexedDB store for one JSON value per slot`

### Task 10: `src/correctionsStore.js` (without export/import)

**Files:**
- Create: `src/correctionsStore.js`
- Test: `tests/correctionsStore.test.js` (`// @vitest-environment node`)

**Interfaces:** spec §3, minus `exportFixes` / `importFixes`.

- [ ] **Step 1: Failing tests** — every bullet under spec Testing → `correctionsStore.test.js` except import, plus:
  - `recordHits` on an empty or unreadable store writes nothing;
  - the reverse rule is removed on save;
  - eviction picks the oldest `lastUsedAt` (lowest `count` on ties);
  - if `navigator.locks` is stubbed, every read-modify-write runs inside `locks.request('transcriber-corrections', …)` (open question 2).
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement.**
  - **Write queue:** `let q = Promise.resolve(); const serial = (fn) => { const run = q.then(() => withLock(fn)); q = run.catch(() => {}); return run; };`
  - **No document cache.** Every operation calls `store.get()` and validates with `validateDocument(…, { mode: 'stored' })`. The verdict is cached in a one-entry `{ rev, result }` filled only after success.
  - **Change notices.** Every successful write calls `notify()`, which runs local callbacks and posts `'changed'` on `channel`. `channel.onmessage` runs local callbacks only and never reads `event.data`.
  - **Unreadable vs unsupported.** `saveRule` and `importFixes` on `unreadable` throw `StoreResetRequired` unless `confirmReset`. On `unsupported` they always refuse, `confirmReset` or not.
  - **`correctionsStore()`:** a lazily created singleton over `openSecureStore('corrections')`.
- [ ] **Step 4: PASS.** **Step 5: Commit** `feat: add the learned-fixes store with cross-tab change notices`

### Task 11: `settings.js` flags, `index.html` markup, `styles.css`

**Files:** Modify `src/settings.js`, `index.html`, `src/styles.css`. Test: `tests/settings.test.js`.

- [ ] **Step 1: Failing tests:** `getLearningEnabled()` defaults to `true`, and `getLearningNoticeShown()` defaults to `false`. Both round-trip and survive blocked storage (copy the existing noise-suppression tests).
- [ ] **Step 2: Implement** following `getNoiseSuppressionEnabled` (lines 115–132), with keys `learning_enabled` and `learning_notice_shown`.
- [ ] **Step 3: Markup.**
  - Insert the three result-screen elements from spec §9 directly after `<p id="copy-error">` (line 111).
  - Insert the Settings `.field` from spec §9 after the Noise suppression field (after line 205), **without** the Phase 2 Export/Import buttons and `#fixes-pass-row` (they come in Task 18).
  - Do not change `.sheet-note` yet (Task 17).
- [ ] **Step 4: Styles.**
  - `.learn-chip`: outline variant of `.refine-chip`, with a small × button.
  - `.fixes-list` / `.fixes-row`: delete button at `margin-inline-start: auto`.
  - `.fixes-actions`.
  - Use existing tokens only.
- [ ] **Step 5: PASS; commit** `feat: add learned-fixes settings flags and markup`

### Task 12: `app.js` wiring: capture, chips, passes, Settings

**Files:** Modify `src/app.js`.

- [ ] **Step 1: State and helpers.**
  - Add the module-level variables from spec §5 ("Module-level UI state"), except `recordedMs` (Phase 2), plus `let chipsChangedAt = 0;`.
  - Extend the `phase !== 'result'` reset block to clear everything except `noteRules` and `notePassRules`.
  - Add `learnActive()`, `loadRulesForNote()` (a 1.5 s `Promise.race`; it never throws; it sets `learnAvailable = false` on `unavailable` or `unsupported`) and `noteApplied(map, rule, matched, written)`.
- [ ] **Step 2: Capture.** Add the `learn` branch to `commitEdits` exactly as in spec §5. Retry cleanup now calls `commitEdits({ learn: false })`.
- [ ] **Step 3: Chips.** Add `renderLearnChips()`, called from `render()` in the result phase.
  - Shown keys = the first 3 of `learnCandidates`. If they equal `shownChipKeys`, return.
  - Otherwise reconcile **by key**: reuse existing nodes, `createElement` new ones, remove stale ones. Set `chipsChangedAt = performance.now()`.
  - On `#learn-chips`, add `pointerdown` and `mousedown` listeners that call `preventDefault()`.
  - **Chip click:** ignore it if `performance.now() - chipsChangedAt < 400`. Otherwise `commitEdits()`, then `await store.saveRule(…)`.
    - On success, update `noteRules`, remove the chip and its `group` siblings, and show `#learn-status` with Undo for 5 s.
    - On `RuleConflictError`, show its message and a "Delete ‘X → Y’ and save" button.
    - On `StoreResetRequired`, `confirm()` with the spec's text, then retry with `{ confirmReset: true }`.
  - **× button:** adds the key to `dismissedKeys` and re-renders.
- [ ] **Step 4: Applied hint.** `renderLearnApplied()` lists `appliedRules` as `matched → written`, each entry with a × (`deleteRule`). It is built only with `createElement` and `textContent`, using `<bdi>` for both sides.
- [ ] **Step 5: Pipeline.** Change `runTranscription` and `runCleanup` as in spec §5 "Pipeline", **without** `vocabulary` and `corrections` (Phase 2). `runCleanup(rules = notePassRules)`; the post-pass hits go through `onHit` but are not passed to `recordHits`.
- [ ] **Step 6: Settings.**
  - **`learning-toggle`:** `checked = getLearningEnabled()`. Its `onchange` persists the value; turning it off clears `learnCandidates`, `noteRules` and `notePassRules`; turning it on mid-note loads `noteRules`.
  - **`refreshFixesList()`:** called from `setSettingsOpen(true)`. It shows "Loading…", then the rows or `#fixes-empty`, plus the `#fixes-status` messages (Phase 1 wording).
  - **`store.onChange`:** replaces `noteRules`, intersects `notePassRules` (same key and same `to`; a failed load yields `[]`, which is intended), and refreshes the list if Settings is open.
  - **`btn-fixes-clear`:** `confirm()`, then `clearAll()`. On `'blocked'`, show "Close other Voice Note tabs and try again".
- [ ] **Step 7: `npm test`** — PASS.
- [ ] **Step 8: Manual checks** — the spec's Testing → "Manual checks" list, minus the Phase 2 items (Export/Import, glossary A/B). Run them on iOS Safari, the installed PWA and desktop Chrome, and record the results in PR B's description.
- [ ] **Step 9: Commit** `feat: learn confirmed hand fixes and apply them to later notes`

### Task 13: README (Phase 1)

- [ ] Add Architecture rows for `hebrew.js`, `corrections.js`, `correctionsStore.js` and `secureStore.js`.
- [ ] Correct the "No runtime dependencies" line (`@sapphi-red/web-noise-suppressor` is bundled).
- [ ] Add a "What it does" line.
- [ ] Add the Notes bullet: "Learned fixes, like API keys, are separate between Safari and the installed app."
- [ ] Commit `docs: document learned fixes`.

**→ Open PR B.**

---

# PR C: Phase 2, model hints and portability

### Task 14: Transcription glossary with echo guard

**Files:** Modify `src/transcribe.js`. Test: `tests/transcribe.test.js` (add tests; existing ones unchanged).

- [ ] **Step 1: Failing tests.**
  - `buildTranscriptionPrompt([])` returns exactly `SCRIPT_HINT`.
  - `buildTranscriptionPrompt(['דני', 'רעננה', 'Jira'])` returns `SCRIPT_HINT + ' דני, רעננה, Jira.'`, and the caps are re-applied.
  - The form's `prompt` field carries the glossary.
  - A transcript made only of glossary terms triggers exactly one retry without the vocabulary (two `fetch` calls, the second without the glossary).
  - So does a partial echo (two terms in prompt order separated only by punctuation or whitespace).
  - A normal transcript that mentions one term does not retry.
- [ ] **Step 2: Implement** `buildTranscriptionPrompt` and `transcribe(blob, apiKey, { vocabulary = [] } = {})`, keeping the old call shape. Refactor the existing fetch into `requestTranscript(blob, apiKey, prompt)` so the retry reuses it.
- [ ] **Step 3: PASS. Commit** `feat: send learned names to transcription as a glossary`

### Task 15: Cleanup prompt section

**Files:** Modify `src/cleanup.js`. Test: `tests/cleanup.test.js` (add tests only).

- [ ] **Step 1: Failing tests.**
  - `buildSystemPrompt('he', { corrections: [] }) === buildSystemPrompt('he')`.
  - With corrections: the markers, JSON-quoted lines, the name carve-out sentence, the cap of 30, placement immediately before "Output only the cleaned message", non-learnable rules filtered, and the section present in `body.system` when passed through `cleanup()`.
- [ ] **Step 2: Implement** per spec §7, building the section from an array of lines inserted before the final line.
- [ ] **Step 3: PASS. Commit** `feat: give cleanup the speaker's confirmed corrections`

### Task 16: Wire hints into the pipeline

**Files:** Modify `src/app.js`.

- [ ] Add `recordedMs`. Set it in `onTick` and reset it to 0 on `RECORD_START`. Pass `vocabulary: recordedMs >= 2000 ? vocabularyTerms(rules) : []` to `transcribe`, and `corrections: relevantRules(withTerms, rules)` to `cleanup`.
- [ ] **One-time notice.** The first time either list is non-empty and `!getLearningNoticeShown()`, show the spec §5 notice in `#learn-status` and set the flag.
- [ ] Manual: with Learning off, both request bodies carry no learned data (Network tab).
- [ ] Commit `feat: send relevant learned fixes with each note`

### Task 17: Passphrase envelope and store export/import

**Files:** Modify `src/secureStore.js`, `src/correctionsStore.js` and their tests.

- [ ] **Step 1: Failing tests** — the passphrase round trip, a wrong passphrase, iteration bounds (inject lower ones), the 600,000 default, and every T5 step:
  - a size over 256 KB is rejected unread;
  - bad JSON, extra envelope keys, a wrong `kdf`, bad base64 lengths;
  - iterations out of bounds are rejected before the KDF runs;
  - the merge rules (identical rule: higher `count` and later `lastUsedAt`; same-`from` conflict: local wins and the import is skipped; over `MAX_RULES`: lowest `count` skipped first);
  - `added` lists the new rules;
  - export refuses a file over 256 KB, and the file name is `voicenote-learned-fixes-YYYY-MM-DD.json`.
- [ ] **Step 2: Implement** `sealWithPassphrase` / `openWithPassphrase` per spec §2, and `exportFixes` / `importFixes` per §3 and T5. Every T5 failure throws one generic error, "Not a valid learned-fixes file, or wrong passphrase".
- [ ] **Step 3: PASS. Commit** `feat: add passphrase-encrypted export and import of learned fixes`

### Task 18: Export/Import UI, `.sheet-note`, Phase 2 wording

**Files:** Modify `index.html`, `src/app.js`, `src/styles.css`.

- [ ] Add the Export/Import buttons, `#fixes-import-file` and `#fixes-pass-row` from spec §9.
- [ ] Set `#fixes-pass`'s `autocomplete` per action: `new-password` for export, `current-password` for import.
- [ ] Export: 10+ characters, both fields must match, and both are cleared when sealing starts. `#btn-fixes-share` uses `navigator.share({ files })` when `canShare` allows, else `<a download>` with the object URL revoked in a `setTimeout`.
- [ ] Import: reject files over 256 KB before reading. The status line lists the added rules.
- [ ] Add the `.sheet-note` sentence from spec §9, and switch the *unreadable* message to its Phase 2 wording.
- [ ] Manual: export from the PWA, AirDrop/Files to Safari, import; a wrong passphrase fails with the generic message.
- [ ] Commit `feat: export and import learned fixes from Settings`

### Task 19: `prompt-check` with `CORRECTIONS`, fixture

**Files:** Modify `scripts/prompt-check.js`. Create `fixtures/corrections.json` (made-up, valid rules only; the repo is public).

- [ ] Load `CORRECTIONS` if set, and validate it with `validateDocument(doc, { mode: 'import' })`; exit 1 with the reason if it is invalid.
- [ ] The pipeline becomes pre-pass → `restoreEnglishTerms` → `cleanup(…, { corrections })` → post-pass. Print a `--- corrections ---` block when the pre-pass changed the text.
- [ ] Run `npm run prompt-check` with and without `CORRECTIONS`. Corrected names must survive cleanup, and the רעננה fixture must stay untouched. Paste the summary into PR C.
- [ ] Commit `feat: exercise learned fixes in prompt-check`

### Task 20: README (Phase 2) and the glossary A/B gate

- [ ] Extend the Notes bullet: "— move them with Settings → Learned fixes → Export / Import."
- [ ] **Ship gate (spec §6):** A/B on real audio with and without the glossary: two Hebrew notes, one English note (detection must not flip), and one near-silent clip. Record the results in PR C. **PR C does not merge until this is done.**
- [ ] Commit `docs: document learned-fixes export and import`

**→ Open PR C.**

---

## Self-Review Notes

- **Spec coverage.**

  | Spec section | Task(s) |
  |---|---|
  | §1 | 3–8 |
  | §2 | 9, 17 |
  | §3 | 10, 17 |
  | §4 | 1 |
  | §5 | 2, 12, 16, 18 |
  | §6 | 14, 20 |
  | §7 | 15 |
  | §8 | 3, 11 |
  | §9 | 11, 18 |
  | §10 | 13, 19, 20 |
  | Security (T1–T7) | Global Constraints, 9, 17 |
  | Testing | every task's Step 1, plus 12 and 18 (manual) |
  | Phasing | the PR split |

- **Test-first ordering of the hard part.** The invariant's oracle (Task 6, Step 1) is written before the analytic check, so the fast path is always measured against the normative definition.
- **Interfaces are consistent across tasks.** `Token`, the `Entry` returned by `__scanner`, the backend contract (Task 9) and the store API (Task 10) are each defined once and consumed unchanged later.
- **Deliberately not automated.** `indexedDbBackend` and the DOM wiring in `app.js`, matching the spec and the repo's existing practice. Both carry explicit manual checklists.
