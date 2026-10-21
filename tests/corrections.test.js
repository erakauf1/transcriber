import { describe, it, expect } from 'vitest';
import {
  tokenize, normalizeRuleString, ruleLanguage, ruleKey, candidateKey, isLearnableRule,
  capitalizeFor, applyCorrections, safeApply, checkRuleSet, diffTokens, extractCandidates,
  mergeCandidates, validateDocument, relevantRules, vocabularyTerms, MAX_DIFF_CELLS,
} from '../src/corrections.js';
import { oracleCheck } from './helpers/ruleSetOracle.js';
import { randomRuleSets, randomText, rng } from './helpers/ruleGen.js';

const R = (from, to) => ({ from, to, language: ruleLanguage(from) });
const apply = (text, ...rules) => applyCorrections(text, rules);
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
    ['newline', 'Jon\nSmith'], ['mixed-script word', 'שלוםabc'], ['four words', 'aa bb cc dd'],
    ['over 64 chars', 'a'.repeat(65)], ['double space', 'Jon  Smith'], ['comma', 'Jon,Smith'],
    ['not a string', 42],
  ])('rejects %s', (_label, s) => expect(normalizeRuleString(s)).toBeNull());

  it('accepts up to three words', () => expect(normalizeRuleString('בן גוריון')).toBe('בן גוריון'));
});

describe('ruleLanguage / keys', () => {
  it('is he when from has a Hebrew letter', () => {
    expect(ruleLanguage("ג'ירה")).toBe('he');
    expect(ruleLanguage('jira')).toBe('en');
  });

  it('keys rules on language and from, candidates also on to', () => {
    expect(ruleKey(R('jira', 'Jira'))).toBe('en\u0000jira');
    expect(candidateKey(R('jira', 'Jira'))).toBe('en\u0000jira\u0000Jira');
  });
});

describe('isLearnableRule', () => {
  it.each([
    ['digits', R('ab5', 'abc')], ['Cyrillic', R('Jоhn', 'John')], ['U+034F', R('Jo͏hn', 'John')],
    ['variation selector', R('John', 'John️')], ['<', R('a<b', 'abc')], ['newline', R('Jon\nX', 'John')],
    ['over 64 chars', R('a'.repeat(65), 'b')], ['2-letter from', R('דן', 'רן')],
    ['wrong language', { from: 'jira', to: 'Jira', language: 'he' }], ['from === to', R('Jira', 'Jira')],
    ['prefix-only', R('רעננה', 'ברעננה')], ['stopword', R('then', 'than')],
    ['3+ letter stopword under a prefix', R('ואני', 'ואנו')], ['self-conflict', R('Dan', 'Dan Cohen')],
  ])('rejects %s', (_label, rule) => expect(isLearnableRule(rule)).toBe(false));

  it.each([['כהן', 'כהנא'], ['ברק', 'ברג'], ['בעל', 'בעלה'], ['כלא', 'כלאי'], ['jira', 'Jira'], ['דני כהן', 'דני כהנא']])(
    'accepts %s → %s (two-letter stopwords are not checked under a prefix)',
    (from, to) => expect(isLearnableRule(R(from, to))).toBe(true));
});

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
    expect(apply('ok\nNodejs', R('nodejs', 'node.js'))).toBe('ok\nNode.js');
    expect(apply('so Nodejs', R('nodejs', 'node.js'))).toBe('so Nodejs');
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
    expect(apply('בJira', R('ב Jira', 'ב JIRA'))).toBe('בJira');
  });

  it('prefers the longest from', () => {
    expect(apply('New York City', R('New York', 'NY'), R('New York City', 'NYC'))).toBe('NYC');
  });

  it('leaves @-glued tokens alone', () => {
    expect(apply('dan@x.com @dan dan', R('dan', 'Dan'))).toBe('dan@x.com @dan Dan');
  });

  it('reports one hit per change and none for identical writes', () => {
    const hits = [];
    applyCorrections('Jira and jira', [R('jira', 'Jira')], { onHit: (r, m, w) => hits.push([m, w]) });
    expect(hits).toEqual([['jira', 'Jira']]);
  });

  it("replaces בג'ירה with בJira, as applyEnglishTerms would", () => {
    expect(apply("בג'ירה", R("ג'ירה", 'Jira'))).toBe('בJira');
  });
});

describe('safeApply', () => {
  it('returns its input on any throw', () => {
    const evil = [{ get from() { throw new Error('x'); }, to: 'y', language: 'en' }];
    expect(safeApply('hello', evil, () => {})).toBe('hello');
  });
});

describe('checkRuleSet', () => {
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

  it.each(COUNTEREXAMPLES)('rejects counterexample %#', (...rules) => {
    const r = checkRuleSet(rules);
    expect(r.ok).toBe(false);
    expect(oracleCheck(rules).ok).toBe(false);
    // The cross-rule pair is what fails, not a self-conflict of one rule.
    if (rules.length === 2) {
      expect(r.conflicts).toContainEqual([rules[0], rules[1]]);
      expect(checkRuleSet([rules[1]]).ok).toBe(true);
      expect(checkRuleSet([rules[0]]).ok).toBe(true);
    } else {
      expect(r.conflicts).toContainEqual([rules[0], rules[0]]);
    }
  });

  it('accepts the jira → Jira self-map', () => expect(checkRuleSet([R('jira', 'Jira')]).ok).toBe(true));

  it('is not stricter than the matcher: שרן → שרון with רון → רונן', () => {
    expect(checkRuleSet([R('שרן', 'שרון'), R('רון', 'רונן')]).ok).toBe(true);
  });

  it('lets name-context siblings pass their own self-check', () => {
    expect(checkRuleSet([R('דני כהן', 'דני כהנא')]).ok).toBe(true);
    expect(checkRuleSet([R('כהן הגיע', 'כהנא הגיע')]).ok).toBe(true);
  });

  it('returns all conflicting pairs in one pass, deduplicated across output forms', () => {
    const r = checkRuleSet([R('New', 'York'), R('York City', 'NYC'), R('Dan', 'Dan Cohen')]);
    expect(r.conflicts).toHaveLength(2);
  });

  it('never accepts a set the enumerated definition rejects, and agrees with it', () => {
    for (const rules of randomRuleSets({ seed: 1, count: 400, size: 3 })) {
      expect(checkRuleSet(rules).ok, JSON.stringify(rules)).toBe(oracleCheck(rules).ok);
    }
  });

  it('validates 200 rules in well under 50 ms', () => {
    const rules = Array.from({ length: 200 }, (_, i) => {
      const w = (n) => String.fromCharCode(...[...n.toString(26).padStart(3, 'a')].map((c) => 97 + parseInt(c, 26)));
      return R(`q${w(i)}x`, `Q${w(i)}y`);
    });
    checkRuleSet(rules);
    const t = performance.now();
    expect(checkRuleSet(rules).ok).toBe(true);
    expect(performance.now() - t).toBeLessThan(50);
  });
});

describe('idempotence', () => {
  it('apply(apply(s)) === apply(s) for random valid rule sets', () => {
    const next = rng(7);
    for (const rules of randomRuleSets({ seed: 3, count: 300, size: 5, valid: true })) {
      for (let i = 0; i < 10; i++) {
        const s = randomText(next, rules);
        const once = applyCorrections(s, rules);
        expect(applyCorrections(once, rules), JSON.stringify({ rules, s })).toBe(once);
      }
    }
  });
});

describe('diffTokens', () => {
  it('finds two far-apart fixes in a long note', () => {
    const filler = Array.from({ length: 850 }, (_, i) => `w${i % 50}`).join(' ');
    const before = `שלום כהן ${filler} תודה כהן`;
    const after = `שלום כהנא ${filler} תודה כהנא`;
    const hunks = diffTokens(tokenize(before), tokenize(after));
    expect(hunks.map((h) => [h.from.map((t) => t.text), h.to.map((t) => t.text)])).toEqual([
      [['כהן'], ['כהנא']], [['כהן'], ['כהנא']],
    ]);
  });

  it('gives up above the cell cap', () => {
    const n = Math.ceil(Math.sqrt(MAX_DIFF_CELLS)) + 2;
    const a = tokenize(Array.from({ length: n }, (_, i) => `a${i}`).join(' ') + ' x');
    const b = tokenize('y ' + Array.from({ length: n }, (_, i) => `b${i}`).join(' '));
    expect(diffTokens(a, b)).toBeNull();
    expect(extractCandidates(a.map((t) => t.text).join(' '), b.map((t) => t.text).join(' '))).toEqual([]);
  });
});

describe('extractCandidates', () => {
  // Most rows have an unchanged neighbour, so filter 9 also offers a sibling;
  // the table compares the primary candidate of each group.
  const cand = (before, after, rules = []) => {
    const seen = new Set();
    return extractCandidates(before, after, { rules })
      .filter(({ group }) => !seen.has(group) && seen.add(group))
      .map(({ from, to }) => `${from} → ${to}`);
  };

  it.each([
    ['ה-jira עובד', 'ה-Jira עובד', ['jira → Jira']],
    ['המנכל אמר', 'המנכ”ל אמר', ['מנכל → מנכ"ל']],
    ['נסעתי לנתב"ג היום', 'נסעתי לבן גוריון היום', ['נתב"ג → בן גוריון']],
    ['דיברתי עם ברג', 'דיברתי עם ברק', ['ברג → ברק']],
    ['ראיתי את מיכל', 'ראיתי את מיכאל', ['מיכל → מיכאל']],
    ["פתחתי בג'ירה", 'פתחתי ב-Jira', ["ג'ירה → Jira"]],
    ["פתחתי בג'ירה", 'פתחתי בJira', ["ג'ירה → Jira"]],
    ['מושה הגיע', 'משה הגיע', ['מושה → משה']],
    ['הילנה באה', 'אילנה באה', ['הילנה → אילנה']],
    ['כרן באה', 'קרן באה', ['כרן → קרן']],
    ['כרמלה באה', 'קרמלה באה', ['כרמלה → קרמלה']],
    ['נסעתי ברענה', 'נסעתי לרעננה', ['רענה → רעננה']],
    ['נסעתי ברענה', 'נסעתי רעננה', ['רענה → רעננה']],
    ['נסעתי רענה', 'נסעתי ברעננה', ['רענה → רעננה']],
    ['ביקי באה', 'ויקי באה', []],
    ['נסעתי ברענה', 'נסעתי לרענה', []],
    ['נפגשנו ב-7', 'נפגשנו ב-19', []],
    ['זה 2.5 שעות', 'זה 4.5 שעות', []],
    ['נסעתי רעננה', 'נסעתי ברעננה', []],
    ['the plan. jira is fine', 'the plan. Jira is fine', []],
    ['and then we go', 'and than we go', []],
    ['דיברתי עם כהן', 'דיברתי עם כהנא', ['כהן → כהנא']],
    ["Jon's car", "John's car", ['Jon → John']],
    ['hello there', 'hello there friend', []],
    ['hello, there', 'hello. there', []],
  ])('%s ⇒ %s', (before, after, expected) => expect(cand(before, after)).toEqual(expected));

  it('applies a learned בג\'ירה rule as בJira', () => {
    const [c] = extractCandidates("פתחתי בג'ירה", 'פתחתי ב-Jira');
    expect(applyCorrections("ראיתי בג'ירה", [c])).toBe('ראיתי בJira');
  });

  it('later turns להילנה into לאילנה with the whole-form rule', () => {
    expect(apply('להילנה', R('הילנה', 'אילנה'))).toBe('לאילנה');
    expect(apply('לכרן', R('כרן', 'קרן'))).toBe('לכרן');
  });

  it('offers the name-context sibling in the same group', () => {
    const found = extractCandidates('דני כהן הגיע', 'דני כהנא הגיע');
    expect(found.map(({ from, to }) => `${from} → ${to}`)).toEqual(['כהן → כהנא', 'דני כהן → דני כהנא']);
    expect(new Set(found.map((c) => c.group)).size).toBe(1);
  });

  it.each([
    ['a stopword', 'דיברתי עם כהן', 'דיברתי עם כהנא'],
    ['a 1-letter word', 'x כהן', 'x כהנא'],
    ['punctuation', 'דני, כהן', 'דני, כהנא'],
    ['a lone prefix token', 'לjira', 'לJira'],
  ])('offers no sibling next to %s', (_label, before, after) => {
    expect(extractCandidates(before, after)).toHaveLength(1);
  });

  it('drops a hunk whose from is still unfixed elsewhere in the note', () => {
    expect(extractCandidates('כהן ועוד כהן', 'כהנא ועוד כהן')).toEqual([]);
  });

  it('drops a rule that already exists, keeps a same-from replacement', () => {
    expect(extractCandidates('ה-jira', 'ה-Jira', { rules: [R('jira', 'Jira')] })).toEqual([]);
    expect(extractCandidates('ה-jira', 'ה-Jira', { rules: [R('jira', 'JIRA')] })).toHaveLength(1);
  });
});

describe('mergeCandidates', () => {
  it('keeps pending order, appends new ones, dedupes and drops dismissed', () => {
    const a = R('aaa', 'bbb'), b = R('ccc', 'ddd'), c = R('eee', 'fff');
    const out = mergeCandidates([c, a, b], [b, a], new Set([candidateKey(a)]));
    expect(out).toEqual([b, c]);
  });
});

describe('validateDocument', () => {
  const rule = (from, to, extra = {}) => ({ ...R(from, to), count: 1, createdAt: '2026-10-21', lastUsedAt: '2026-10-21', ...extra });
  const doc = (...rules) => ({ v: 1, rules, examples: [] });

  it('accepts a valid import and copies its values', () => {
    const input = doc(rule('jira', 'Jira'));
    const r = validateDocument(input, { mode: 'import' });
    expect(r.ok).toBe(true);
    expect(r.doc.rules[0]).toEqual(input.rules[0]);
    expect(r.doc.rules[0]).not.toBe(input.rules[0]);
  });

  it.each([
    ['500 → 5000', doc({ ...rule('jira', 'Jira'), from: '500', to: '5000', language: 'en' })],
    ['a one-letter from', doc(rule('j', 'J'))],
    ['__proto__', JSON.parse('{"v":1,"rules":[],"examples":[],"__proto__":{"x":1}}')],
    ['an extra rule key', doc(rule('jira', 'Jira', { note: 'x' }))],
    ['non-empty examples', { v: 1, rules: [], examples: [{}] }],
    ['v: 2', { v: 2, rules: [], examples: [] }],
    ['a fractional count', doc(rule('jira', 'Jira', { count: 1.5 }))],
    ['a negative count', doc(rule('jira', 'Jira', { count: -1 }))],
    ['a bad date', doc(rule('jira', 'Jira', { createdAt: '21/10/2026' }))],
    ['a conflicting set', doc(rule('New', 'York'), rule('York City', 'NYC'))],
  ])('import rejects %s', (_label, input) => expect(validateDocument(input, { mode: 'import' }).ok).toBe(false));

  it('stored mode drops bad rules and reports them', () => {
    const r = validateDocument(doc(rule('jira', 'Jira'), rule('j', 'J'), { from: 'x' }), { mode: 'stored' });
    expect(r.ok).toBe(true);
    expect(r.doc.rules.map((x) => x.from)).toEqual(['jira']);
    expect(r.dropped).toBe(2);
  });

  it('stored mode resolves conflicts deterministically by count, then lastUsedAt, then key', () => {
    const a = rule('New', 'York', { count: 3 }), b = rule('York City', 'NYC', { count: 5 });
    expect(validateDocument(doc(a, b), { mode: 'stored' }).doc.rules.map((x) => x.from)).toEqual(['York City']);
    const c = rule('New', 'York', { count: 5, lastUsedAt: '2026-10-22' });
    expect(validateDocument(doc(b, c), { mode: 'stored' }).doc.rules.map((x) => x.from)).toEqual(['New']);
    const d = rule('New', 'York', { count: 5 });
    const r1 = validateDocument(doc(b, d), { mode: 'stored' }).doc.rules;
    const r2 = validateDocument(doc(d, b), { mode: 'stored' }).doc.rules;
    expect(r1).toEqual(r2);
    expect(checkRuleSet(r1).ok).toBe(true);
  });

  it('stored mode reports newer versions and unknown keys as unsupported', () => {
    expect(validateDocument({ v: 2, rules: [], examples: [] }, { mode: 'stored' }).unsupported).toBe(true);
    expect(validateDocument({ v: 1, rules: [], examples: [], extra: 1 }, { mode: 'stored' }).unsupported).toBe(true);
    expect(validateDocument({ v: 1, rules: 'x', examples: [] }, { mode: 'stored' })).toEqual({ ok: false });
  });
});

describe('relevantRules / vocabularyTerms', () => {
  const rule = (from, to, count, lastUsedAt = '2026-10-21') => ({ ...R(from, to), count, createdAt: '2026-10-01', lastUsedAt });

  it('returns rules whose from or to appears, most used first, capped', () => {
    const rules = [rule('jira', 'Jira', 1), rule('כהן', 'כהנא', 5), rule('ann', 'Anna', 9)];
    expect(relevantRules('open jira, ask כהנא', rules).map((r) => r.from)).toEqual(['כהן', 'jira']);
    expect(relevantRules('open jira, ask כהנא', rules, 1).map((r) => r.from)).toEqual(['כהן']);
  });

  it('keeps count ≥ 2, 1–2 token tos, no stopwords, within both caps', () => {
    const rules = [rule('jira', 'Jira', 1), rule('כהן', 'כהנא', 5), rule('נתב"ג', 'בן גוריון', 3),
      rule('ann', 'Anna', 2, '2026-10-01'), rule('aaa bbb', 'aaa bbb ccc', 9)];
    expect(vocabularyTerms(rules)).toEqual(['כהנא', 'בן גוריון', 'Anna']);
    expect(vocabularyTerms(rules, { maxTerms: 2 })).toEqual(['כהנא', 'בן גוריון']);
    expect(vocabularyTerms(rules, { maxChars: 15 })).toEqual(['כהנא', 'בן גוריון']);
  });
});
