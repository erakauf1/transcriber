import { normalizeRuleString, ruleLanguage, checkRuleSet, isLearnableRule } from '../../src/corrections.js';

// Seeded PRNG (mulberry32), so a failing case reproduces.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Small vocabularies make collisions between rules likely, which is the point.
const LATIN = ['jira', 'Jira', 'node', 'nodejs', 'node.js', 'Node.js', 'dan', 'Dan', 'york', 'New', 'York',
  'iphone', 'iPhone', 'board', 'Board', 'city', 'NYC', 'jon', 'John', 'ann', 'Anna'];
const HEBREW = ['רון', 'רונן', 'דני', 'דן', 'רן', 'שרון', 'רעננה', 'רענה', "ג'ירה", 'גירה', 'כהן', 'כהנא',
  'בית', 'שאן', 'מיכל', 'מיכאל', 'ב', 'ה', 'ל', 'בדני', 'לרון', "ה-ג'ירה", 'בית-שאן', 'אורי', 'אור'];
const ALL = [...LATIN, ...HEBREW];

export function randomRule(next, { lowerLatinBias = 0.3 } = {}) {
  const pick = (list) => list[Math.floor(next() * list.length)];
  const phrase = () => {
    const n = next() < 0.7 ? 1 : next() < 0.7 ? 2 : 3;
    return Array.from({ length: n }, () => pick(next() < lowerLatinBias ? LATIN.filter((w) => w === w.toLowerCase()) : ALL)).join(' ');
  };
  const from = normalizeRuleString(phrase()), to = normalizeRuleString(phrase());
  if (!from || !to || from === to) return null;
  return { from, to, language: ruleLanguage(from) };
}

// Random rule sets. With `valid`, rules are added greedily while the set passes
// checkRuleSet and every rule is learnable.
export function randomRuleSets({ seed, count, size = 4, valid = false }) {
  const next = rng(seed);
  const sets = [];
  while (sets.length < count) {
    const set = [];
    let tries = 0;
    while (set.length < size && tries++ < size * 200) {
      const r = randomRule(next);
      if (!r || set.some((s) => s.language === r.language && s.from === r.from)) continue;
      if (valid && (!isLearnableRule(r) || !checkRuleSet([...set, r]).ok)) continue;
      set.push(r);
    }
    if (set.length) sets.push(set);
  }
  return sets;
}

// Texts that put rule froms and tos next to each other, after glued prefixes,
// and at sentence starts.
export function randomText(next, rules) {
  const pick = (list) => list[Math.floor(next() * list.length)];
  const pieces = rules.flatMap((r) => [r.from, r.to]).concat(ALL);
  const seps = [' ', ' ', ', ', '. ', '\n', ' ב', ' ה-', ' ל', ' ו', "'s ", '! '];
  let s = next() < 0.5 ? '' : pick(['ב', 'ה-', 'ל']);
  const n = 2 + Math.floor(next() * 6);
  for (let i = 0; i < n; i++) s += (i ? pick(seps) : '') + pick(pieces);
  return s;
}
