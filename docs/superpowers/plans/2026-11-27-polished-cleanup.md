# Polished Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the light-touch cleanup prompt with a polished-rewrite prompt taught by the user's own examples, and add an eval harness that measures model output against expected text.

**Architecture:** First build an eval harness (pure check functions, a shared pipeline module used by both `prompt-check` and a new `cleanup-eval` script, and a fixture of input/expected/checks). Record a baseline on the current prompt. Then rewrite the system prompt and few-shot pairs in `src/cleanup.js`, regenerate `fixtures/prompts.json`, and copy the prompt into `Cleanup.swift` so the iOS parity tests pass. Finally re-run the eval and compare.

**Tech Stack:** Node ES modules, Vitest 3 (jsdom default; `// @vitest-environment node` for fs-using tests), Swift 6 + Swift Testing for the iOS package.

**Spec:** `docs/superpowers/specs/2026-11-27-polished-cleanup-design.md`

## Global Constraints

- Branch: `feat/polished-cleanup` (based on `main`). Never push without the user asking.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Code comments: sparing. Only non-obvious *why*. No doc comments unless the file already uses them.
- Model output is never asserted in unit tests. Only deterministic code is unit-tested.
- Any step that calls a real model API costs the user money: **ask the user before running it**, and use their key from the environment (`ANTHROPIC_API_KEY`, or `PROVIDER`/`MODEL` plus the matching key variable). Never print or commit a key.
- The JS prompt and the Swift prompt must stay byte-identical; `fixtures/prompts.json` is the contract (`npm run prompts` regenerates it).
- Swift tests need Xcode: `cd ios/TranscriberCore && swift test`. If `swift test` fails with "plugin for module 'TestingMacros' not found", Xcode is not selected; tell the user instead of working around it.
- Fixture names are anonymized. Do not reintroduce real names (the originals were removed on purpose).

## Execution notes

- Tasks 5 and 8 need the user's approval and their API key. Run them in the main session, never in a subagent.
- Task 7 needs Xcode for `swift test`.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `scripts/cleanup-checks.js` | create | Pure check functions: `runChecks(output, checks)`, `CHECK_NAMES` |
| `tests/cleanup-checks.test.js` | create | Unit tests for every check |
| `fixtures/cleanup-examples.json` | modify | Add `role`, `checks`, `note`; add 2 regression cases |
| `tests/cleanup-examples-fixture.test.js` | create | Fixture is well-formed; few-shot entries appear verbatim in `src/cleanup.js` (second test added in Task 6) |
| `scripts/pipeline.js` | create | `loadConfigFromEnv(scriptName)`, `runPipeline(text, opts)`: the app's cleanup pipeline for scripts |
| `tests/pipeline.test.js` | create | Pipeline order with stubbed fetch |
| `scripts/prompt-check.js` | modify | Use `pipeline.js` |
| `scripts/cleanup-eval.js` | create | Side-by-side report + checks, exit code |
| `package.json`, `README.md` | modify | `cleanup-eval` script and docs |
| `docs/superpowers/evals/` | create | Baseline and after outputs |
| `src/cleanup.js` | modify | New system prompt and few-shot pairs; export `buildFewShotMessages` |
| `tests/cleanup.test.js` | modify | Rule tests follow the new prompt |
| `fixtures/prompts.json` | regenerate | `npm run prompts` |
| `ios/TranscriberCore/Sources/TranscriberCore/Cleanup.swift` | modify | Same prompt and few-shots as JS |

---

### Task 1: Check functions

**Files:**
- Create: `scripts/cleanup-checks.js`
- Test: `tests/cleanup-checks.test.js`

**Interfaces:**
- Produces: `export const CHECK_NAMES` (array of strings) and `export function runChecks(output: string, checks: object): Array<{ name: string, ok: boolean, detail: string }>`. One result per assertion (each `mustInclude` string is its own result). Throws `Error` on an unknown check key.

- [ ] **Step 1: Write the failing test**

`tests/cleanup-checks.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { runChecks, CHECK_NAMES } from '../scripts/cleanup-checks.js';

const one = (output, checks) => {
  const results = runChecks(output, checks);
  expect(results).toHaveLength(1);
  return results[0];
};

describe('runChecks', () => {
  it('lists the supported checks', () => {
    expect(CHECK_NAMES).toEqual(['endsWithPeriod', 'mustInclude', 'mustExclude', 'hasNumberedList', 'noLeadingOpener']);
  });

  it('endsWithPeriod accepts . ! ? and ignores trailing whitespace', () => {
    expect(one('שלום.', { endsWithPeriod: true }).ok).toBe(true);
    expect(one('really?\n', { endsWithPeriod: true }).ok).toBe(true);
    expect(one('great!  ', { endsWithPeriod: true }).ok).toBe(true);
  });

  it('endsWithPeriod fails without final punctuation and shows the ending', () => {
    const r = one('אני בעד', { endsWithPeriod: true });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('אני בעד');
  });

  it('mustInclude yields one result per string', () => {
    const results = runChecks('סיכום שיחה עם לימור מנגה', { mustInclude: ['לימור', 'ABB'] });
    expect(results.map((r) => [r.name, r.ok])).toEqual([['mustInclude "לימור"', true], ['mustInclude "ABB"', false]]);
  });

  it('mustExclude fails when the string appears', () => {
    expect(one('שיחה עם לימוד', { mustExclude: ['לימוד'] }).ok).toBe(false);
    expect(one('שיחה עם לימור', { mustExclude: ['לימוד'] }).ok).toBe(true);
  });

  it('hasNumberedList needs lines starting with 1. and 2.', () => {
    expect(one('שני דברים:\n1. קטלוג.\n2. פרטי קשר.', { hasNumberedList: true }).ok).toBe(true);
    expect(one('שני דברים: 1. קטלוג. 2. פרטי קשר.', { hasNumberedList: true }).ok).toBe(false);
    expect(one('• קטלוג\n• פרטי קשר', { hasNumberedList: true }).ok).toBe(false);
  });

  it('noLeadingOpener fails when the output starts with an opener', () => {
    expect(one('שמע, זה היה פרק מצוין.', { noLeadingOpener: ['שמע'] }).ok).toBe(false);
    expect(one('  שמע זה', { noLeadingOpener: ['שמע'] }).ok).toBe(false);
    expect(one('זה היה פרק מצוין. שמע, באמת.', { noLeadingOpener: ['שמע'] }).ok).toBe(true);
  });

  it('a false boolean check is skipped', () => {
    expect(runChecks('x', { endsWithPeriod: false })).toEqual([]);
  });

  it('throws on an unknown check so a typo in the fixture is not silently ignored', () => {
    expect(() => runChecks('x', { endWithPeriod: true })).toThrow(/Unknown check "endWithPeriod"/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cleanup-checks.test.js`
Expected: FAIL, cannot resolve `../scripts/cleanup-checks.js`.

- [ ] **Step 3: Implement**

`scripts/cleanup-checks.js`:

```js
const tail = (s) => JSON.stringify(s.trimEnd().slice(-20));

const CHECKS = {
  endsWithPeriod: (out, on) => (on ? [{
    name: 'endsWithPeriod',
    ok: /[.!?]$/.test(out.trimEnd()),
    detail: `ends with ${tail(out)}`,
  }] : []),
  mustInclude: (out, strings) => strings.map((s) => ({
    name: `mustInclude ${JSON.stringify(s)}`, ok: out.includes(s), detail: '',
  })),
  mustExclude: (out, strings) => strings.map((s) => ({
    name: `mustExclude ${JSON.stringify(s)}`, ok: !out.includes(s), detail: '',
  })),
  hasNumberedList: (out, on) => (on ? [{
    name: 'hasNumberedList',
    ok: /^\s*1\.\s/m.test(out) && /^\s*2\.\s/m.test(out),
    detail: '',
  }] : []),
  noLeadingOpener: (out, openers) => {
    const start = out.trimStart();
    const hit = openers.find((o) => start.startsWith(o));
    return [{ name: `noLeadingOpener ${JSON.stringify(openers)}`, ok: !hit, detail: hit ? `starts with ${JSON.stringify(hit)}` : '' }];
  },
};

export const CHECK_NAMES = Object.keys(CHECKS);

export function runChecks(output, checks) {
  return Object.entries(checks).flatMap(([key, arg]) => {
    if (!CHECKS[key]) throw new Error(`Unknown check "${key}"`);
    return CHECKS[key](output, arg);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/cleanup-checks.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/cleanup-checks.js tests/cleanup-checks.test.js
git commit -m "test: deterministic checks for cleanup eval output

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Eval fixture with roles, checks and regression cases

**Files:**
- Modify: `fixtures/cleanup-examples.json` (full replacement below)
- Test: `tests/cleanup-examples-fixture.test.js`

**Interfaces:**
- Consumes: `CHECK_NAMES`, `runChecks` from Task 1.
- Produces: fixture entries `{ name, language: 'he'|'en', role: 'few-shot'|'eval', input, expected, checks, note? }`. Task 4 reads `role === 'eval'` entries; Task 6 asserts every `role === 'few-shot'` entry appears verbatim in the cleanup few-shot messages.

- [ ] **Step 1: Write the failing test**

`tests/cleanup-examples-fixture.test.js`:

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CHECK_NAMES, runChecks } from '../scripts/cleanup-checks.js';

const examples = JSON.parse(readFileSync(new URL('../fixtures/cleanup-examples.json', import.meta.url), 'utf8'));

describe('fixtures/cleanup-examples.json', () => {
  it('has unique names and the required fields', () => {
    expect(new Set(examples.map((e) => e.name)).size).toBe(examples.length);
    for (const e of examples) {
      expect(['he', 'en']).toContain(e.language);
      expect(['few-shot', 'eval']).toContain(e.role);
      expect(typeof e.input).toBe('string');
      expect(typeof e.expected).toBe('string');
      expect(typeof e.checks).toBe('object');
    }
  });

  it('gives every eval example at least one known check', () => {
    for (const e of examples.filter((x) => x.role === 'eval')) {
      expect(Object.keys(e.checks).length, e.name).toBeGreaterThan(0);
      for (const key of Object.keys(e.checks)) expect(CHECK_NAMES, `${e.name}: ${key}`).toContain(key);
    }
  });

  it("passes every eval example's checks on its own expected text", () => {
    for (const e of examples.filter((x) => x.role === 'eval')) {
      const failed = runChecks(e.expected, e.checks).filter((r) => !r.ok);
      expect(failed, e.name).toEqual([]);
    }
  });
});
```

The third test matters: if a check fails on the user's own expected text, the check is wrong, not the model.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cleanup-examples-fixture.test.js`
Expected: FAIL, `role` is undefined.

- [ ] **Step 3: Replace the fixture**

Write `fixtures/cleanup-examples.json` with exactly this content (inputs and expected texts of the first five entries are unchanged from the committed file; only `role`, `checks` and `note` are new, plus the last two entries):

```json
[
  {
    "name": "he-legal-steps",
    "language": "he",
    "role": "eval",
    "note": "User example 1. Paragraph layout, written register.",
    "checks": { "endsWithPeriod": true, "mustInclude": ["מיכל", "גלבוע"] },
    "input": "אוקיי, טוב הייתה לי שיחה עכשיו עם מיכל שהסבירה לי בעצם את השלבים כי לא יכולתי להצטרף ל, לא הצלחתי להצטרף לשיחה שהייתה שבוע שעבר. בכל מקרה, ככל שאני מבין השלב הראשון הוא ייצוג של עורך דין. השלב הראשון הוא ייצוג משותף של עורך דין מול גלבוע לטובת השגת סכום פיצוי ראוי יותר מההצעה שניתנה. ככל שהמצב ככה, אני בעד",
    "expected": "אוקיי, הייתה לי עכשיו שיחה עם מיכל, שהסבירה לי את השלבים בתהליך, מכיוון שלא הצלחתי להצטרף לשיחה שהתקיימה בשבוע שעבר.\n\nבכל מקרה, ככל שאני מבין, השלב הראשון הוא ייצוג משפטי משותף מול גלבוע, במטרה להשיג סכום פיצוי ראוי יותר מההצעה שקיבלנו.\n\nאם זה אכן המצב, אני בעד."
  },
  {
    "name": "he-charging-stations",
    "language": "he",
    "role": "eval",
    "note": "User example 2. A misheard name (לימוד) that appears correctly later (לימור); numbered list with a lead-in.",
    "checks": { "endsWithPeriod": true, "hasNumberedList": true, "mustInclude": ["לימור", "נגה", "ABB"], "mustExclude": ["לימוד"] },
    "input": "סיכום שיחה עם לימוד מנגה. אז נגה מספקים רק את עמדת הטעינה. הם לא מתעסקים בניהול ובגבייה. עמדת הטעינה שהם מציעים זה נקרא עמדת טעינה מנוהלת. מנוהלת גם מבחינת בקרת עומסים וגם מבחינת גבייה. הסוג שהיא קראה לה זה ABB. ברגע שהם, במידה והם, החברה, במידה ואנחנו בוחרים את חברת נגה, אז הם מתקינים את העמדות ובעצם אנחנו כבניין רשאים לחבור לאיזה ספק שאנחנו רוצים, לפי התנאים שאותו ספק נותן. לימור אמרה שיש לה כמה ספקים שונים שאפשר להתחבר אליהם בעצם עם העמדה החכמה שלהם. מה שסיכמתי עם לימור זה קודם כל שהיא תשלח לי את העמדה, בעצם את קטלוג, את ההסבר על העמדה שהם מציעים להתקין. ושתיים, את מספר אנשי קשר מספקים שונים שאנחנו בעצם עתידית נוכל להתחבר אליהם כדי להבין, כדי שנוכל לעשות שיחה קצרה עם אותם ספקים ולהבין בעצם מה המסגרת השירות שאנחנו נקבל או נוכל לקבל מאותם ספקים",
    "expected": "סיכום שיחה עם לימור מנגה בנושא עמדות טעינה:\n\nנגה מספקת ומתקינה את עמדות הטעינה בלבד, ואינה עוסקת בניהול השוטף או בגבייה.\n\nהעמדה שהם מציעים היא עמדת טעינה חכמה של ABB, התומכת בניהול ובקרת עומסים ובמערכות גבייה.\n\nבמידה שנבחר בנגה, הם יתקינו את העמדות, ואנחנו כבניין נהיה חופשיים לבחור ספק לניהול ולגבייה, בהתאם לתנאים שכל ספק מציע.\n\nלימור ציינה שיש מספר ספקים שאפשר להתחבר אליהם באמצעות העמדות שלהם.\n\nסיכמתי עם לימור שהיא תשלח לי שני דברים:\n1. קטלוג ומפרט טכני של עמדת הטעינה שהם מציעים להתקין.\n2. פרטי קשר של מספר ספקים לניהול ולגבייה, כדי שנוכל לשוחח איתם, להבין אילו שירותים הם מציעים, מה התנאים שלהם ומה העלויות.\n\nכך נוכל לבחון בנפרד את בחירת עמדות הטעינה ואת בחירת ספק הניהול והגבייה."
  },
  {
    "name": "he-stock-showroom",
    "language": "he",
    "role": "few-shot",
    "note": "User example 3. Pronoun fix from context (איתה → איתו), paragraph layout.",
    "checks": {},
    "input": "דיברתי איתה עכשיו, הוא בדק ואמר שאין במלאי, אמר שזה בדרך, כלומר יהיה כפי שאני מבין ממנו באזור תחילת ינואר. לגבי התצוגה, אז רשום שזה נמצא במחסן 155. כלומר שלפני שאנחנו כן או לא שווה שנסתכל עליו ונבין. אז כרגע הוא רשם את ההזמנה, עוד לא עשה את ההזמנה בפועל, ואנחנו נסתכל בגבעת חיים ונחזור אליו איך אנחנו רוצים לסגור את זה",
    "expected": "דיברתי איתו עכשיו. הוא בדק ואמר שאין כרגע במלאי, אבל המוצר בדרך וצפוי להגיע, לפי מה שהבנתי, בתחילת ינואר.\n\nלגבי התצוגה, רשום שהמוצר נמצא במחסן 155, אז לפני שנחליט אם להזמין או לא, שווה שנראה אותו ונתרשם.\n\nכרגע הוא רק רשם את פרטי ההזמנה, אבל עדיין לא ביצע אותה בפועל. אנחנו נסתכל עליו בגבעת חיים ונחזור אליו עם החלטה איך להתקדם."
  },
  {
    "name": "he-car-order-update",
    "language": "he",
    "role": "few-shot",
    "note": "User example 4. One sentence per line in blocks, greeting and sign-off kept, hedge dropped.",
    "checks": {},
    "input": "בוקר טוב, רק רציתי לעדכן אתכם שאבא ואימא אתמול הזמינו את האוטו, הם חתמו על ההזמנה והתקשרנו אתמול בערב לעשות את העברת הבנקאית לאופק רכב, הנציג של קיה. אז בטח היום יתקשרו לאבא שיאשר את העברה כי זו העברה גדולה. ואז אם אני זוכר נכון, כמו שאמרו לו, זה 21 יום עד שהוא מקבל את האוטו. הסברתי להם בדיוק מה לעשות, לאבא ואימא בדיוק מה לעשות. שברגע שיאשרו את העברה אז לבקש מהבנק שישלח להם את אישור העברה, כי אז הם צריכים לשלוח את זה לאיש מכירות בצירוף מספר ההזמנה. רק מעדכן אתכם, יום טוב.",
    "expected": "בוקר טוב,\nרק עדכון קצר.\n\nאבא ואמא הזמינו את האוטו אתמול.\nהם חתמו על ההזמנה, ובערב ביצענו העברה בנקאית לאופק רכב, הנציג של קיה.\n\nהיום כנראה יתקשרו לאבא מהבנק לאישור ההעברה כי מדובר בסכום גבוה.\nלפי מה שנאמר לו, מרגע האישור מדובר בכ־21 יום עד קבלת הרכב.\n\nהסברתי להם בדיוק מה לעשות.\nאחרי אישור ההעברה לבקש מהבנק אישור העברה רשמי.\nאת האישור צריך לשלוח לאיש המכירות יחד עם מספר ההזמנה.\n\nזהו, רק מעדכן.\nיום טוב."
  },
  {
    "name": "he-podcast-dollar",
    "language": "he",
    "role": "eval",
    "note": "User example 5. Attention-getter dropped, spoken 'slash' turned into text.",
    "checks": { "endsWithPeriod": true, "noLeadingOpener": ["שמע"], "mustInclude": ["טראמפ"], "mustExclude": ["slash"] },
    "input": "שמע, זה היה פרק מצוין של הפודקאסט הזה. ממש שיעור במטבעות slash מאקרו כלכלה. כן, הסביר טוב מאוד. אהבתי. אהבתי את ההסבר, בהחלט הנגישו את הנושא. יש גם את העניין כמובן של החוב האמריקאי, פחות דיברו עליו, אבל זה כבר תוצר של זה, לכן אחת הסיבות הנוספות, זה אחת הסיבות הנוספות שטראמפ חי בשלום עם הדולר הנמוך.",
    "expected": "זה היה פרק מצוין של הפודקאסט.\nממש שיעור במטבעות ובמאקרו כלכלה.\nההסברים היו ברורים ונגישים.\nמאוד אהבתי את הדרך שבה פישטו את הנושא.\n\nהנושא של החוב האמריקאי כמעט לא עלה.\nאבל הוא תוצר ישיר של כל מה שדיברו עליו.\nוזו גם אחת הסיבות שטראמפ חי בשלום עם דולר חלש."
  },
  {
    "name": "he-unsupported-name",
    "language": "he",
    "role": "eval",
    "note": "Regression case written for the spec, not a user example. A correctly spelled but uncommon real place must stay as spoken and never turn into a better-known one (the רעננה→הרצליה class of bug).",
    "checks": { "endsWithPeriod": true, "mustInclude": ["גן יאשיה", "20:00"] },
    "input": "אה אני עדיין בגן יאשיה, כאילו, אז ניפגש שם בשמונה בערב",
    "expected": "אני עדיין בגן יאשיה, אז ניפגש שם ב-20:00."
  },
  {
    "name": "he-time-of-day",
    "language": "he",
    "role": "eval",
    "note": "Regression case written for the spec, not a user example. Afternoon time in words becomes 24-hour digits.",
    "checks": { "endsWithPeriod": true, "mustInclude": ["16:45"] },
    "input": "אז מחרתיים אחר הצהריים יש לנו פגישה ברבע לחמש, אה, תביא בבקשה את המחשב",
    "expected": "מחרתיים יש לנו פגישה ב-16:45, תביא בבקשה את המחשב."
  }
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/cleanup-examples-fixture.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add fixtures/cleanup-examples.json tests/cleanup-examples-fixture.test.js
git commit -m "test: cleanup examples get roles, checks and two regression cases

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shared pipeline module for scripts

**Files:**
- Create: `scripts/pipeline.js`
- Modify: `scripts/prompt-check.js` (whole file below)
- Test: `tests/pipeline.test.js`

**Interfaces:**
- Consumes: `cleanup` (`src/cleanup.js`), `restoreEnglishTerms` (`src/englishTerms.js`, returns text unchanged unless `language === 'he'` and a key is set; never throws), `applyCorrections(text, rules)`, `relevantRules(text, rules)`, `validateDocument(doc, { mode: 'import' })` (`src/corrections.js`), `detectLanguage(text)` (`src/language.js`).
- Produces:
  - `export function loadConfigFromEnv(scriptName: string): { provider, model, apiKey, rules }`. Prints an error and calls `process.exit(1)` on a bad environment, exactly as `prompt-check.js` does today.
  - `export async function runPipeline(text: string, { provider, model, apiKey, rules = [], language = detectLanguage(text) }): Promise<{ language, corrected, withTerms, cleaned }>`.

- [ ] **Step 1: Write the failing test**

`tests/pipeline.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runPipeline } from '../scripts/pipeline.js';

afterEach(() => vi.unstubAllGlobals());

const reply = (text) => ({ ok: true, json: async () => ({ content: [{ type: 'text', text }] }) });
const opts = { provider: 'anthropic', model: 'claude-sonnet-5', apiKey: 'k' };

describe('runPipeline', () => {
  it('runs English terms before cleanup on Hebrew text and returns each stage', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply('{"terms":[{"he":"דיפלוי","en":"deploy"}]}'))
      .mockResolvedValueOnce(reply('צריך לעשות deploy מחר.'));
    vi.stubGlobal('fetch', fetchMock);

    const out = await runPipeline('צריך לעשות דיפלוי מחר', opts);

    expect(out.language).toBe('he');
    expect(out.withTerms).toBe('צריך לעשות deploy מחר');
    expect(out.cleaned).toBe('צריך לעשות deploy מחר.');
    const cleanupBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(cleanupBody.messages.at(-1).content).toBe('צריך לעשות deploy מחר');
  });

  it('applies learned corrections before and after cleanup', async () => {
    // English text skips the English-terms call, so the only fetch is cleanup.
    // The model "reverts" the fix; the post-pass must re-apply it.
    const rules = [{ from: 'Jon', to: 'John', language: 'en' }];
    const fetchMock = vi.fn().mockResolvedValueOnce(reply('I met Jon today.'));
    vi.stubGlobal('fetch', fetchMock);

    const out = await runPipeline('i met Jon today', { ...opts, rules, language: 'en' });

    expect(out.corrected).toBe('i met John today');
    expect(out.cleaned).toBe('I met John today.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the language it is given instead of detecting one', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply('Clean.'));
    vi.stubGlobal('fetch', fetchMock);

    const out = await runPipeline('שלום', { ...opts, language: 'en' });

    expect(out.language).toBe('en');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/pipeline.test.js`
Expected: FAIL, cannot resolve `../scripts/pipeline.js`.

- [ ] **Step 3: Implement `scripts/pipeline.js`**

```js
import { readFileSync } from 'node:fs';
import { cleanup } from '../src/cleanup.js';
import { restoreEnglishTerms } from '../src/englishTerms.js';
import { detectLanguage } from '../src/language.js';
import { validateDocument, applyCorrections, relevantRules } from '../src/corrections.js';

const DEFAULT_MODEL = { openai: 'gpt-4o', anthropic: 'claude-sonnet-5' };
const KEY_ENV_VAR = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', openrouter: 'OPENROUTER_API_KEY' };

export function loadConfigFromEnv(scriptName) {
  const provider = process.env.PROVIDER || 'anthropic';
  if (!(provider in KEY_ENV_VAR)) {
    console.error(`Unknown PROVIDER "${provider}" — must be one of: ${Object.keys(KEY_ENV_VAR).join(', ')}`);
    process.exit(1);
  }
  const apiKey = process.env[KEY_ENV_VAR[provider]];
  if (!apiKey) {
    console.error(`Set ${KEY_ENV_VAR[provider]} first: ${KEY_ENV_VAR[provider]}=... npm run ${scriptName}`);
    process.exit(1);
  }
  const model = process.env.MODEL || DEFAULT_MODEL[provider];
  if (!model) {
    console.error(`Set MODEL for provider "${provider}", e.g. MODEL=openrouter/auto`);
    process.exit(1);
  }
  let rules = [];
  if (process.env.CORRECTIONS) {
    const checked = validateDocument(JSON.parse(readFileSync(process.env.CORRECTIONS, 'utf8')), { mode: 'import' });
    if (!checked.ok) {
      console.error(`${process.env.CORRECTIONS} is not a valid learned-fixes document (each rule must pass isLearnableRule, and the set checkRuleSet)`);
      process.exit(1);
    }
    rules = checked.doc.rules;
  }
  return { provider, model, apiKey, rules };
}

// Mirrors the order in src/app.js, so a script sees what the app would send.
export async function runPipeline(text, { provider, model, apiKey, rules = [], language = detectLanguage(text) }) {
  const step = { provider, model, apiKey };
  const corrected = applyCorrections(text, rules);
  const withTerms = await restoreEnglishTerms(corrected, language, step);
  const corrections = relevantRules(withTerms, rules);
  const cleaned = applyCorrections(await cleanup(withTerms, language, { ...step, corrections }), rules);
  return { language, corrected, withTerms, cleaned };
}
```

Before relying on the "mirrors `src/app.js`" comment, open `src/app.js`, find where `restoreEnglishTerms` and `cleanup` are called, and confirm the order (corrections → English terms → cleanup with `relevantRules` → corrections). If it differs, follow `app.js` and adjust the test.

- [ ] **Step 4: Rewrite `scripts/prompt-check.js` on top of it**

```js
// Semi-manual prompt check: runs every fixture through the real cleanup API
// and prints raw vs cleaned for human review. Not pass/fail — eyeball it.
// Usage: ANTHROPIC_API_KEY=sk-ant-... npm run prompt-check
//    or: OPENROUTER_API_KEY=sk-or-... PROVIDER=openrouter MODEL=openrouter/auto npm run prompt-check
//    or: OPENAI_API_KEY=sk-... PROVIDER=openai npm run prompt-check
// Add CORRECTIONS=fixtures/corrections.json to run learned fixes around cleanup
// (pre-pass, prompt section, post-pass) as the app does.
import { readFileSync } from 'node:fs';
import { loadConfigFromEnv, runPipeline } from './pipeline.js';

const config = loadConfigFromEnv('prompt-check');
const fixtures = JSON.parse(readFileSync(new URL('../fixtures/transcripts.json', import.meta.url), 'utf8'));

console.log(`Provider: ${config.provider}, Model: ${config.model}${config.rules.length ? `, Corrections: ${config.rules.length}` : ''}`);

for (const { name, text } of fixtures) {
  try {
    const { language, corrected, withTerms, cleaned } = await runPipeline(text, config);
    console.log(`\n=== ${name} [${language}] ===`);
    console.log(`--- raw ---\n${text}`);
    if (corrected !== text) console.log(`--- corrections ---\n${corrected}`);
    if (withTerms !== corrected) console.log(`--- english terms ---\n${withTerms}`);
    console.log(`--- cleaned ---\n${cleaned}`);
  } catch (err) {
    console.log(`\n=== ${name} ===\n--- raw ---\n${text}\nERROR: ${err.message}`);
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/pipeline.test.js && env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u OPENROUTER_API_KEY -u PROVIDER node scripts/prompt-check.js; echo "exit $?"`
Expected: pipeline tests PASS (3), then `Set ANTHROPIC_API_KEY first: ANTHROPIC_API_KEY=... npm run prompt-check` and `exit 1`. The `env -u` keeps an exported key from triggering a paid API call.

- [ ] **Step 6: Commit**

```bash
git add scripts/pipeline.js scripts/prompt-check.js tests/pipeline.test.js
git commit -m "refactor: share the cleanup pipeline between prompt scripts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `cleanup-eval` script

**Files:**
- Create: `scripts/cleanup-eval.js`
- Modify: `package.json` (`scripts`), `README.md:42-43`

**Interfaces:**
- Consumes: `loadConfigFromEnv`, `runPipeline` (Task 3); `runChecks` (Task 1); fixture entries with `role === 'eval'` (Task 2).
- Produces: `npm run cleanup-eval`. Env: same as `prompt-check`, plus `RUNS` (default 1). Exit code 0 only if every check passed in every run.

This script only talks to the network, so it has no unit test; its parts (checks, pipeline) are tested in Tasks 1 and 3.

- [ ] **Step 1: Write `scripts/cleanup-eval.js`**

```js
// Runs the held-out examples in fixtures/cleanup-examples.json through the real
// cleanup pipeline and prints input / expected / actual with per-example checks.
// Usage: ANTHROPIC_API_KEY=sk-ant-... RUNS=2 npm run cleanup-eval
import { readFileSync } from 'node:fs';
import { loadConfigFromEnv, runPipeline } from './pipeline.js';
import { runChecks } from './cleanup-checks.js';

const config = loadConfigFromEnv('cleanup-eval');
const runs = Number(process.env.RUNS || 1);
const examples = JSON.parse(readFileSync(new URL('../fixtures/cleanup-examples.json', import.meta.url), 'utf8'))
  .filter((e) => e.role === 'eval');

console.log(`Provider: ${config.provider}, Model: ${config.model}, Runs: ${runs}, Examples: ${examples.length}`);

let failures = 0;
const summary = [];

for (let run = 1; run <= runs; run++) {
  for (const ex of examples) {
    console.log(`\n=== ${ex.name} [${ex.language}] run ${run}/${runs} ===`);
    console.log(`--- input ---\n${ex.input}`);
    console.log(`--- expected ---\n${ex.expected}`);
    try {
      const { withTerms, cleaned } = await runPipeline(ex.input, { ...config, language: ex.language });
      // A check can fail because the English-terms pass rewrote a word, not because of cleanup.
      if (withTerms !== ex.input) console.log(`--- after english terms ---\n${withTerms}`);
      console.log(`--- actual ---\n${cleaned}`);
      const results = runChecks(cleaned, ex.checks);
      for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
      const passed = results.filter((r) => r.ok).length;
      failures += results.length - passed;
      summary.push(`${passed === results.length ? '✓' : '✗'} ${ex.name} run ${run}: ${passed}/${results.length}`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      failures++;
      summary.push(`✗ ${ex.name} run ${run}: ERROR`);
    }
  }
}

console.log(`\n=== summary ===\n${summary.join('\n')}`);
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, after `"prompt-check"`, add:

```json
    "cleanup-eval": "node scripts/cleanup-eval.js",
```

- [ ] **Step 3: Document it in `README.md`**

After the two `prompt-check` lines (README.md:42-43), add:

```
ANTHROPIC_API_KEY=... RUNS=2 npm run cleanup-eval                               # cleanup vs expected, with checks
```

- [ ] **Step 4: Smoke-test without a key**

Run: `env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u OPENROUTER_API_KEY -u PROVIDER npm run -s cleanup-eval; echo "exit $?"`
Expected: `Set ANTHROPIC_API_KEY first: ANTHROPIC_API_KEY=... npm run cleanup-eval` and `exit 1`.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/cleanup-eval.js package.json README.md
git commit -m "feat: cleanup-eval script compares cleanup output with expected examples

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Baseline on the current prompt

**Files:**
- Create: `docs/superpowers/evals/2026-11-27-baseline-eval.txt`, `docs/superpowers/evals/2026-11-27-baseline-transcripts.txt`

**Interfaces:**
- Consumes: `npm run cleanup-eval`, `npm run prompt-check`. The prompt in `src/cleanup.js` must still be the original one (no changes from Task 6 yet).

- [ ] **Step 1: Ask the user for approval and the key**

This calls the real API (about 5 eval examples + 6 transcripts, two model calls each for Hebrew). Ask the user to approve the cost and to make the key available, e.g. by running the commands themselves or exporting `ANTHROPIC_API_KEY` in the shell that runs them. Do not continue until they agree.

- [ ] **Step 2: Run the baseline**

```bash
mkdir -p docs/superpowers/evals
npm run -s cleanup-eval 2>&1 | tee docs/superpowers/evals/2026-11-27-baseline-eval.txt
npm run -s prompt-check 2>&1 | tee docs/superpowers/evals/2026-11-27-baseline-transcripts.txt
```

The eval is expected to report failures (for example `endsWithPeriod`, since the current prompt forbids a final period). That is the point of a baseline.

**Regression-case rule:** `he-unsupported-name` and `he-time-of-day` exist to catch regressions, so every check *other than* `endsWithPeriod` must pass on the baseline. If one fails, the case is not guarding existing behavior: tell the user, then rewrite or drop it (fixture and its test) and commit that before Task 6.

- [ ] **Step 3: Check that no key leaked into the files**

Run: `grep -n -E 'sk-(ant|or)-|sk-[A-Za-z0-9]{20}' docs/superpowers/evals/ || echo clean`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/evals/
git commit -m "docs: baseline cleanup eval on the current prompt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Polished prompt and few-shots (web)

**Files:**
- Modify: `src/cleanup.js` (`buildSystemPrompt`, `FEW_SHOT_EXAMPLES`, export `buildFewShotMessages`)
- Modify: `tests/cleanup.test.js`
- Modify: `tests/cleanup-examples-fixture.test.js` (add the few-shot parity test)
- Regenerate: `fixtures/prompts.json`
- Modify: `docs/superpowers/specs/2026-11-27-polished-cleanup-design.md` (English few-shot count)

**Interfaces:**
- Consumes: fixture entries with `role === 'few-shot'` (Task 2).
- Produces: `export function buildFewShotMessages(language)` from `src/cleanup.js`; the exact prompt strings Task 7 copies into Swift.

- [ ] **Step 1: Update the rule tests in `tests/cleanup.test.js`**

Replace the two tests `'protects names of people and places from script changes'` and `'forbids substituting a different name (guards against hallucinated corrections)'` with:

```js
  it('keeps names as spoken, allowing only a form found in the same message', () => {
    const p = buildSystemPrompt('he');
    expect(p).toContain('Keep names of people and places exactly as spoken');
    expect(p).toContain('when the same message spells a name differently elsewhere');
  });

  it('forbids changing a name to one not in the message (guards against hallucinated corrections)', () => {
    const p = buildSystemPrompt('he');
    expect(p).toContain('Never change a name to one that does not appear in the message');
    expect(p).toContain('A wrong name is worse than an awkward one');
  });

  it('asks for punctuation at the end of the message', () => {
    const p = buildSystemPrompt('he');
    expect(p).toContain('End every sentence with punctuation, including the last one');
    expect(p).not.toContain("Don't add a period");
  });

  it('allows contextual additions but forbids inventing numbers, dates, times, amounts or names', () => {
    const p = buildSystemPrompt('he');
    expect(p).toContain('a small detail the context makes obvious');
    expect(p).toContain("Don't add numbers, dates, times, amounts, names of people, places or companies");
  });
```

In `'uses English few-shot examples for English transcripts'`, replace the ASCII regex line (the English few-shots now use the "• " bullet) with a no-Hebrew check:

```js
    expect(fewShot.every((m) => !/[֐-׿]/.test(m.content))).toBe(true);
```

- [ ] **Step 2: Add the few-shot parity test**

Append to `tests/cleanup-examples-fixture.test.js` (inside the `describe`), and add `import { buildFewShotMessages } from '../src/cleanup.js';` at the top:

```js
  it('has every few-shot example in the cleanup few-shot messages, verbatim', () => {
    for (const e of examples.filter((x) => x.role === 'few-shot')) {
      const messages = buildFewShotMessages(e.language);
      const i = messages.findIndex((m) => m.role === 'user' && m.content === e.input);
      expect(i, e.name).toBeGreaterThanOrEqual(0);
      expect(messages[i + 1], e.name).toEqual({ role: 'assistant', content: e.expected });
    }
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/cleanup.test.js tests/cleanup-examples-fixture.test.js`
Expected: FAIL: the four new rule tests, and the parity test (`buildFewShotMessages` is not exported).

- [ ] **Step 4: Replace `buildSystemPrompt` in `src/cleanup.js`**

Keep `correctionsSection` and everything above it unchanged. Replace the body of `buildSystemPrompt` with:

```js
export function buildSystemPrompt(language, { corrections = [] } = {}) {
  const lang = LANGUAGE_NAMES[language] || 'English';
  return [
    `You turn voice-note transcripts into clear, well-written messages, ready to send.`,
    `Rewrite freely for clarity and flow, in the speaker's own voice and person. A clear written register is fine. Keep every fact, number, date, name and decision the speaker gave.`,
    `The message is in ${lang}. Your entire output must be in ${lang}.`,
    `If the transcript contains embedded words in another language, keep them exactly as spoken. Never translate anything.`,
    `Some words may already be written in Latin letters inside the message. Leave them exactly as they are — do not convert them to the local script, and do not respell them.`,
    // Deliberately absent: any instruction to rewrite words that "look transliterated".
    // That mandate was measured to make the model occasionally rewrite a malformed
    // place name into a different real city. Transliteration is now undone
    // in src/englishTerms.js, a guarded step that runs before this prompt sees the text.
    `Keep names of people and places exactly as spoken. The one exception: when the same message spells a name differently elsewhere and it is clearly the same person or place, use the form that appears elsewhere. Never change a name to one that does not appear in the message, even if it looks misspelled. A wrong name is worse than an awkward one.`,
    `If a word is clearly not a real word in the message's language and a very similar real word exists, correct it. A real word that is wrong in context (a mishearing, a wrong gender or pronoun) may be corrected only when the message itself shows what was meant.`,
    ``,
    `Do:`,
    `- Remove filler words (um, uh, like, אמם, אה, כאילו), false starts, and repeated words`,
    `- Fix grammar and punctuation. Pay close attention to prepositions, definite articles, and date and number expressions — speech-to-text output is most often malformed there`,
    `- Fix pronoun and gender agreement when the message makes clear who is meant (e.g. איתה → איתו when the next sentence says הוא בדק)`,
    `- Spoken punctuation words become punctuation: "slash" → "ו" or "/", "נקודה" / "פסיק" said as punctuation → the mark`,
    `- Merge rambling fragments into complete sentences`,
    `- If the speaker circles back to an earlier topic, fold that remark into where it belongs`,
    `- Drop pure detours that are not part of the message (e.g. "wait, someone's at the door")`,
    `- Drop openers that only call for attention (שמע, תקשיב, so listen, look). Keep greetings and sign-offs the speaker actually said (בוקר טוב, יום טוב, thanks)`,
    `- You may add what makes the message clearer and clearly follows from what the speaker said: a short heading naming the topic, a connecting phrase, a small detail the context makes obvious, or a closing line stating the purpose of what was said`,
    `- Verbal hedges about memory or wording (אם אני זוכר נכון, I think I remember) may be dropped when the fact itself stays`,
    `- Format spoken times and measurements as digits — "שבע וחצי" → "7:30", "תשעים סנטימטר" → "90 ס"מ"`,
    `- Write times of day on a 24-hour clock whenever the part of day is known — from words like אחר הצהריים / בערב / בלילה / PM, or from context (an afternoon meeting, "after work", a time later the same afternoon): "שש וחצי אחר הצהריים" → "18:30", "eight in the evening" → "20:00". For a time from 13:00 on, drop the now-redundant part-of-day word (keep בבוקר / AM with a morning time, where the digits alone don't say it). If the part of day truly cannot be told, keep the time as spoken`,
    `- Use standard abbreviations where a native speaker would in a typed message — נתב"ג for בן גוריון (the airport), מחו"ל for חוץ לארץ, ס"מ for סנטימטר, etc.`,
    `- When the speaker lists items, tasks, or options, format as a list — use "• " for unordered items, "1. / 2. / …" for items the speaker numbers or orders (ראשית/שנית, first/second, שאלה ראשונה/שנייה)`,
    `- If a list has a lead-in phrase (e.g. "we need to:", "שני דברים:"), keep it on its own line followed by the list items`,
    `- Layout: for a short update made of separate facts, put one sentence per line and group related lines into blocks separated by a blank line. For explanation or reasoning, use short paragraphs. Always put a blank line between distinct topics. Don't leave a dense block`,
    `- End every sentence with punctuation, including the last one`,
    ``,
    `Don't:`,
    `- Don't translate anything`,
    `- Don't add numbers, dates, times, amounts, names of people, places or companies, or greetings and sign-offs the speaker did not give`,
    `- Don't drop information. Shorter wording is fine; a shorter message that loses a detail is not`,
    ``,
    ...correctionsSection(corrections),
    `Output only the cleaned message. No preamble, no quotes, no explanations.`,
  ].join('\n');
}
```

- [ ] **Step 5: Replace `FEW_SHOT_EXAMPLES` and export the builder**

Replace the comment above `FEW_SHOT_EXAMPLES`, the constant itself and `buildFewShotMessages` with the block below. The Hebrew pairs 3 and 4 must match `fixtures/cleanup-examples.json` (`he-stock-showroom`, `he-car-order-update`) character for character; the parity test from Step 2 enforces it. Use `'\n'` escapes inside single-quoted strings.

```js
// Fixed few-shot pairs shown before the real transcript. The רעננה / Raanana pair
// anchors the name rule with a name nothing in the message contradicts (the
// רעננה→הרצליה bug). The two long Hebrew pairs are the user's own examples
// (fixtures/cleanup-examples.json, role "few-shot"); the rest of that file is
// held out for npm run cleanup-eval, so don't move eval examples in here.
const FEW_SHOT_EXAMPLES = {
  he: [
    { role: 'user', content: 'אני עדיין ברעננה, אה, ניפגש שם בשמונה' },
    { role: 'assistant', content: 'אני עדיין ברעננה, ניפגש שם בשמונה.' },
    { role: 'user', content: 'אז מחר אחר הצהריים יש לי פגישה בארבע וחצי, אה, ואם זה נגמר עד שש אני מגיע אלייך' },
    { role: 'assistant', content: 'מחר יש לי פגישה ב-16:30, ואם זה נגמר עד 18:00 אני מגיע אלייך.' },
    { role: 'user', content: 'דיברתי איתה עכשיו, הוא בדק ואמר שאין במלאי, אמר שזה בדרך, כלומר יהיה כפי שאני מבין ממנו באזור תחילת ינואר. לגבי התצוגה, אז רשום שזה נמצא במחסן 155. כלומר שלפני שאנחנו כן או לא שווה שנסתכל עליו ונבין. אז כרגע הוא רשם את ההזמנה, עוד לא עשה את ההזמנה בפועל, ואנחנו נסתכל בגבעת חיים ונחזור אליו איך אנחנו רוצים לסגור את זה' },
    { role: 'assistant', content: 'דיברתי איתו עכשיו. הוא בדק ואמר שאין כרגע במלאי, אבל המוצר בדרך וצפוי להגיע, לפי מה שהבנתי, בתחילת ינואר.\n\nלגבי התצוגה, רשום שהמוצר נמצא במחסן 155, אז לפני שנחליט אם להזמין או לא, שווה שנראה אותו ונתרשם.\n\nכרגע הוא רק רשם את פרטי ההזמנה, אבל עדיין לא ביצע אותה בפועל. אנחנו נסתכל עליו בגבעת חיים ונחזור אליו עם החלטה איך להתקדם.' },
    { role: 'user', content: 'בוקר טוב, רק רציתי לעדכן אתכם שאבא ואימא אתמול הזמינו את האוטו, הם חתמו על ההזמנה והתקשרנו אתמול בערב לעשות את העברת הבנקאית לאופק רכב, הנציג של קיה. אז בטח היום יתקשרו לאבא שיאשר את העברה כי זו העברה גדולה. ואז אם אני זוכר נכון, כמו שאמרו לו, זה 21 יום עד שהוא מקבל את האוטו. הסברתי להם בדיוק מה לעשות, לאבא ואימא בדיוק מה לעשות. שברגע שיאשרו את העברה אז לבקש מהבנק שישלח להם את אישור העברה, כי אז הם צריכים לשלוח את זה לאיש מכירות בצירוף מספר ההזמנה. רק מעדכן אתכם, יום טוב.' },
    { role: 'assistant', content: 'בוקר טוב,\nרק עדכון קצר.\n\nאבא ואמא הזמינו את האוטו אתמול.\nהם חתמו על ההזמנה, ובערב ביצענו העברה בנקאית לאופק רכב, הנציג של קיה.\n\nהיום כנראה יתקשרו לאבא מהבנק לאישור ההעברה כי מדובר בסכום גבוה.\nלפי מה שנאמר לו, מרגע האישור מדובר בכ־21 יום עד קבלת הרכב.\n\nהסברתי להם בדיוק מה לעשות.\nאחרי אישור ההעברה לבקש מהבנק אישור העברה רשמי.\nאת האישור צריך לשלוח לאיש המכירות יחד עם מספר ההזמנה.\n\nזהו, רק מעדכן.\nיום טוב.' },
  ],
  en: [
    { role: 'user', content: "I'm still in Raanana, let's meet there at eight" },
    { role: 'assistant', content: "I'm still in Raanana, let's meet there at eight." },
    { role: 'user', content: 'so the dinner is at, uh, eight in the evening, and drinks before that around six thirty' },
    { role: 'assistant', content: 'The dinner is at 20:00, and drinks before that around 18:30.' },
    { role: 'user', content: "hey morning so um just wanted to update you guys that the the plumber came yesterday he fixed the leak and uh he said if I remember right that the part costs like three hundred shekels and he'll send the invoice today so yeah have a good day" },
    { role: 'assistant', content: "Morning,\nJust a quick update.\n\nThe plumber came yesterday and fixed the leak.\nHe said the part costs 300 shekels.\nHe'll send the invoice today.\n\nHave a good day." },
    { role: 'user', content: "so listen for the trip we need to like book the hotel, uh, renew Dana's passport and and also figure out who's taking the dog" },
    { role: 'assistant', content: "For the trip we need to:\n• Book the hotel.\n• Renew Dana's passport.\n• Figure out who's taking the dog." },
  ],
};

export function buildFewShotMessages(language) {
  return FEW_SHOT_EXAMPLES[language] || FEW_SHOT_EXAMPLES.en;
}
```

- [ ] **Step 6: Run the cleanup tests**

Run: `npx vitest run tests/cleanup.test.js tests/cleanup-examples-fixture.test.js`
Expected: PASS. If the parity test fails, diff the failing pair against the fixture; the fixture is the source of truth.

- [ ] **Step 7: Regenerate the prompt snapshot and run everything**

```bash
npm run prompts
npm test
```

Expected: all tests pass, and `git diff --stat fixtures/prompts.json` shows only the `cleanup` sections changed (`refineChips`, `refineApply`, `englishTerms` untouched). Check with `git diff fixtures/prompts.json | grep -c refine` → `0`.

- [ ] **Step 8: Fix the spec's English few-shot count**

In `docs/superpowers/specs/2026-11-27-polished-cleanup-design.md`, section 2, replace "English: three new pairs written in the same style (a short update with one sentence per line, a list with a lead-in, and the Raanana name pair with a period)." with "English: four pairs in the same style: the Raanana name pair and the 24-hour dinner pair (both now ending with a period), plus two new ones (a short update with one sentence per line, and a list with a lead-in)."

- [ ] **Step 9: Commit**

```bash
git add src/cleanup.js tests/cleanup.test.js tests/cleanup-examples-fixture.test.js fixtures/prompts.json docs/superpowers/specs/2026-11-27-polished-cleanup-design.md
git commit -m "feat: cleanup rewrites notes into polished messages, taught by the user's examples

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: iOS prompt parity

**Files:**
- Modify: `ios/TranscriberCore/Sources/TranscriberCore/Cleanup.swift` (`systemPrompt`, `fewShotHe`, `fewShotEn`)
- Test: `ios/TranscriberCore/Tests/TranscriberCoreTests/PromptParityTests.swift` (unchanged; it compares against `fixtures/prompts.json`)

**Interfaces:**
- Consumes: the exact strings from Task 6 (`fixtures/prompts.json` `cleanup.he` / `cleanup.en`).

- [ ] **Step 1: Run the parity test to verify it fails**

Run: `cd ios/TranscriberCore && swift test --filter PromptParityTests`
Expected: FAIL in `cleanup(lang:)` for both languages (system prompt and messages differ). The refine and English-terms tests still pass.

- [ ] **Step 2: Replace `systemPrompt` in `Cleanup.swift`**

Swift uses raw strings `#"..."#`. Two rules when copying from JS:
- `${lang}` becomes `\#(lang)`.
- In raw strings, a newline inside a string is written `\#n`, not `\n` (a plain `\n` would be a literal backslash and n). This matters for the few-shot replies in Step 3.

```swift
    public static func systemPrompt(_ language: Language) -> String {
        let lang = language.displayName
        return [
            #"You turn voice-note transcripts into clear, well-written messages, ready to send."#,
            #"Rewrite freely for clarity and flow, in the speaker's own voice and person. A clear written register is fine. Keep every fact, number, date, name and decision the speaker gave."#,
            #"The message is in \#(lang). Your entire output must be in \#(lang)."#,
            #"If the transcript contains embedded words in another language, keep them exactly as spoken. Never translate anything."#,
            #"Some words may already be written in Latin letters inside the message. Leave them exactly as they are — do not convert them to the local script, and do not respell them."#,
            #"Keep names of people and places exactly as spoken. The one exception: when the same message spells a name differently elsewhere and it is clearly the same person or place, use the form that appears elsewhere. Never change a name to one that does not appear in the message, even if it looks misspelled. A wrong name is worse than an awkward one."#,
            #"If a word is clearly not a real word in the message's language and a very similar real word exists, correct it. A real word that is wrong in context (a mishearing, a wrong gender or pronoun) may be corrected only when the message itself shows what was meant."#,
            "",
            #"Do:"#,
            #"- Remove filler words (um, uh, like, אמם, אה, כאילו), false starts, and repeated words"#,
            #"- Fix grammar and punctuation. Pay close attention to prepositions, definite articles, and date and number expressions — speech-to-text output is most often malformed there"#,
            #"- Fix pronoun and gender agreement when the message makes clear who is meant (e.g. איתה → איתו when the next sentence says הוא בדק)"#,
            #"- Spoken punctuation words become punctuation: "slash" → "ו" or "/", "נקודה" / "פסיק" said as punctuation → the mark"#,
            #"- Merge rambling fragments into complete sentences"#,
            #"- If the speaker circles back to an earlier topic, fold that remark into where it belongs"#,
            #"- Drop pure detours that are not part of the message (e.g. "wait, someone's at the door")"#,
            #"- Drop openers that only call for attention (שמע, תקשיב, so listen, look). Keep greetings and sign-offs the speaker actually said (בוקר טוב, יום טוב, thanks)"#,
            #"- You may add what makes the message clearer and clearly follows from what the speaker said: a short heading naming the topic, a connecting phrase, a small detail the context makes obvious, or a closing line stating the purpose of what was said"#,
            #"- Verbal hedges about memory or wording (אם אני זוכר נכון, I think I remember) may be dropped when the fact itself stays"#,
            #"- Format spoken times and measurements as digits — "שבע וחצי" → "7:30", "תשעים סנטימטר" → "90 ס"מ""#,
            #"- Write times of day on a 24-hour clock whenever the part of day is known — from words like אחר הצהריים / בערב / בלילה / PM, or from context (an afternoon meeting, "after work", a time later the same afternoon): "שש וחצי אחר הצהריים" → "18:30", "eight in the evening" → "20:00". For a time from 13:00 on, drop the now-redundant part-of-day word (keep בבוקר / AM with a morning time, where the digits alone don't say it). If the part of day truly cannot be told, keep the time as spoken"#,
            #"- Use standard abbreviations where a native speaker would in a typed message — נתב"ג for בן גוריון (the airport), מחו"ל for חוץ לארץ, ס"מ for סנטימטר, etc."#,
            #"- When the speaker lists items, tasks, or options, format as a list — use "• " for unordered items, "1. / 2. / …" for items the speaker numbers or orders (ראשית/שנית, first/second, שאלה ראשונה/שנייה)"#,
            #"- If a list has a lead-in phrase (e.g. "we need to:", "שני דברים:"), keep it on its own line followed by the list items"#,
            #"- Layout: for a short update made of separate facts, put one sentence per line and group related lines into blocks separated by a blank line. For explanation or reasoning, use short paragraphs. Always put a blank line between distinct topics. Don't leave a dense block"#,
            #"- End every sentence with punctuation, including the last one"#,
            "",
            #"Don't:"#,
            #"- Don't translate anything"#,
            #"- Don't add numbers, dates, times, amounts, names of people, places or companies, or greetings and sign-offs the speaker did not give"#,
            #"- Don't drop information. Shorter wording is fine; a shorter message that loses a detail is not"#,
            "",
            #"Output only the cleaned message. No preamble, no quotes, no explanations."#,
        ].joined(separator: "\n")
    }
```

- [ ] **Step 3: Replace `fewShotHe` and `fewShotEn`**

```swift
    static let fewShotHe: [ChatMessage] = [
        .init(role: "user", content: #"אני עדיין ברעננה, אה, ניפגש שם בשמונה"#),
        .init(role: "assistant", content: #"אני עדיין ברעננה, ניפגש שם בשמונה."#),
        .init(role: "user", content: #"אז מחר אחר הצהריים יש לי פגישה בארבע וחצי, אה, ואם זה נגמר עד שש אני מגיע אלייך"#),
        .init(role: "assistant", content: #"מחר יש לי פגישה ב-16:30, ואם זה נגמר עד 18:00 אני מגיע אלייך."#),
        .init(role: "user", content: #"דיברתי איתה עכשיו, הוא בדק ואמר שאין במלאי, אמר שזה בדרך, כלומר יהיה כפי שאני מבין ממנו באזור תחילת ינואר. לגבי התצוגה, אז רשום שזה נמצא במחסן 155. כלומר שלפני שאנחנו כן או לא שווה שנסתכל עליו ונבין. אז כרגע הוא רשם את ההזמנה, עוד לא עשה את ההזמנה בפועל, ואנחנו נסתכל בגבעת חיים ונחזור אליו איך אנחנו רוצים לסגור את זה"#),
        .init(role: "assistant", content: #"דיברתי איתו עכשיו. הוא בדק ואמר שאין כרגע במלאי, אבל המוצר בדרך וצפוי להגיע, לפי מה שהבנתי, בתחילת ינואר.\#n\#nלגבי התצוגה, רשום שהמוצר נמצא במחסן 155, אז לפני שנחליט אם להזמין או לא, שווה שנראה אותו ונתרשם.\#n\#nכרגע הוא רק רשם את פרטי ההזמנה, אבל עדיין לא ביצע אותה בפועל. אנחנו נסתכל עליו בגבעת חיים ונחזור אליו עם החלטה איך להתקדם."#),
        .init(role: "user", content: #"בוקר טוב, רק רציתי לעדכן אתכם שאבא ואימא אתמול הזמינו את האוטו, הם חתמו על ההזמנה והתקשרנו אתמול בערב לעשות את העברת הבנקאית לאופק רכב, הנציג של קיה. אז בטח היום יתקשרו לאבא שיאשר את העברה כי זו העברה גדולה. ואז אם אני זוכר נכון, כמו שאמרו לו, זה 21 יום עד שהוא מקבל את האוטו. הסברתי להם בדיוק מה לעשות, לאבא ואימא בדיוק מה לעשות. שברגע שיאשרו את העברה אז לבקש מהבנק שישלח להם את אישור העברה, כי אז הם צריכים לשלוח את זה לאיש מכירות בצירוף מספר ההזמנה. רק מעדכן אתכם, יום טוב."#),
        .init(role: "assistant", content: #"בוקר טוב,\#nרק עדכון קצר.\#n\#nאבא ואמא הזמינו את האוטו אתמול.\#nהם חתמו על ההזמנה, ובערב ביצענו העברה בנקאית לאופק רכב, הנציג של קיה.\#n\#nהיום כנראה יתקשרו לאבא מהבנק לאישור ההעברה כי מדובר בסכום גבוה.\#nלפי מה שנאמר לו, מרגע האישור מדובר בכ־21 יום עד קבלת הרכב.\#n\#nהסברתי להם בדיוק מה לעשות.\#nאחרי אישור ההעברה לבקש מהבנק אישור העברה רשמי.\#nאת האישור צריך לשלוח לאיש המכירות יחד עם מספר ההזמנה.\#n\#nזהו, רק מעדכן.\#nיום טוב."#),
    ]

    static let fewShotEn: [ChatMessage] = [
        .init(role: "user", content: #"I'm still in Raanana, let's meet there at eight"#),
        .init(role: "assistant", content: #"I'm still in Raanana, let's meet there at eight."#),
        .init(role: "user", content: #"so the dinner is at, uh, eight in the evening, and drinks before that around six thirty"#),
        .init(role: "assistant", content: #"The dinner is at 20:00, and drinks before that around 18:30."#),
        .init(role: "user", content: #"hey morning so um just wanted to update you guys that the the plumber came yesterday he fixed the leak and uh he said if I remember right that the part costs like three hundred shekels and he'll send the invoice today so yeah have a good day"#),
        .init(role: "assistant", content: #"Morning,\#nJust a quick update.\#n\#nThe plumber came yesterday and fixed the leak.\#nHe said the part costs 300 shekels.\#nHe'll send the invoice today.\#n\#nHave a good day."#),
        .init(role: "user", content: #"so listen for the trip we need to like book the hotel, uh, renew Dana's passport and and also figure out who's taking the dog"#),
        .init(role: "assistant", content: #"For the trip we need to:\#n• Book the hotel.\#n• Renew Dana's passport.\#n• Figure out who's taking the dog."#),
    ]
```

- [ ] **Step 4: Run the Swift tests**

Run: `cd ios/TranscriberCore && swift test`
Expected: all tests pass, including `PromptParityTests`. If `cleanup(lang:)` still fails, print both sides in a scratch test or compare `fixtures/prompts.json` against the Swift strings line by line; the usual culprits are `\n` instead of `\#n`, and a straight `'` vs the typographic `’`.

- [ ] **Step 5: Commit**

```bash
git add ios/TranscriberCore/Sources/TranscriberCore/Cleanup.swift
git commit -m "feat(ios): polished cleanup prompt, in parity with the web app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: After-run and review with the user

**Files:**
- Create: `docs/superpowers/evals/2026-11-27-after-eval.txt`, `docs/superpowers/evals/2026-11-27-after-transcripts.txt`

**Interfaces:**
- Consumes: everything above; the baseline from Task 5.

- [ ] **Step 1: Ask the user for approval** (same as Task 5 Step 1; `RUNS=2` doubles the eval cost).

- [ ] **Step 2: Run**

```bash
RUNS=2 npm run -s cleanup-eval 2>&1 | tee docs/superpowers/evals/2026-11-27-after-eval.txt
npm run -s prompt-check 2>&1 | tee docs/superpowers/evals/2026-11-27-after-transcripts.txt
grep -n -E 'sk-(ant|or)-|sk-[A-Za-z0-9]{20}' docs/superpowers/evals/ || echo clean
```

- [ ] **Step 3: Compare and report**

- Summary lines of baseline vs after eval (`grep -A20 '=== summary' docs/superpowers/evals/*-eval.txt`).
- Done-when from the spec: every check passes on `he-legal-steps`, `he-charging-stations`, `he-podcast-dollar`, `he-unsupported-name`, `he-time-of-day` in both runs.
- Read the English transcripts in the after file next to the baseline (no checks cover English): flag any invented detail, any translated word, a name changed, or a lost fact.
- For each eval example, list what the output adds beyond the input (headings, details, a closing line) and flag anything that is a new number, date, time, amount or name. No automatic check covers invented details.
- Show the user the side-by-side for each eval example and ask whether the style matches what they want. If a check fails, report it with the output; do not loosen a check to make it pass without the user agreeing.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/evals/
git commit -m "docs: cleanup eval after the polished prompt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
