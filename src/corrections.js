import { PREFIXES, fold, stripPrefixes } from './hebrew.js';

// Learned corrections: the user's own hand fixes, confirmed one tap at a time and
// applied in code. Pure module — no storage, DOM or network. No regex is ever
// built from a rule string; rules are matched token by token with the same
// tokenizer that found them, so capture and application share their boundaries.

export const MAX_RULES = 200, MAX_RULE_TOKENS = 3, MAX_RULE_CHARS = 64;
export const MAX_PROMPT_RULES = 30, MAX_VOCAB_TERMS = 20, MAX_VOCAB_CHARS = 200;
export const MAX_DIFF_CELLS = 1_000_000;

export const ruleKey = (r) => `${r.language}\u0000${r.from}`;
export const candidateKey = (c) => `${c.language}\u0000${c.from}\u0000${c.to}`;

// Function words a rule may never rewrite. A rule's prefix-stripped stems are
// checked only against the 3+ letter ones: two-letter stopwords hide inside real
// names (כהן, ברק, בעל, כלא).
export const STOPWORDS = new Set([
  ...'של את על זה זו זאת אם כי גם לא כן אבל או עם אני אתה הוא היא אנחנו אתם הם הן יש אין מה מי איך למה כל רק עוד כבר אז פה שם היה היו להיות אחרי לפני כמו בין אל'.split(' '),
  ...'the a an and or but to of in on at for with from by is are was were be been being it its this that these those i you he she we they not no yes so as if then than there here about into'.split(' '),
]);

// ---------- tokenizer ----------

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

// ---------- rule strings ----------

const RULE_SHAPE = /^[\p{L}][\p{L}\p{M}]*(?:(?: |['".&/+\-־])[\p{L}][\p{L}\p{M}]*)*$/u;
const HEB_LETTER = /[א-ת]/g;
const hebLetters = (s) => (s.match(HEB_LETTER) || []).length;
const letterCount = (s) => (s.match(/\p{L}/gu) || []).length;
const startsHebrew = (s) => /^[א-ת]/.test(s);

export function normalizeRuleString(s) {
  if (typeof s !== 'string') return null;
  const n = fold(s).normalize('NFC').trim();
  if (!n || n.length > MAX_RULE_CHARS || !RULE_SHAPE.test(n)) return null;
  if (/\p{Default_Ignorable_Code_Point}/u.test(n)) return null;
  const words = n.split(' ');
  if (words.length > MAX_RULE_TOKENS) return null;
  for (const w of words) {
    const letters = w.match(/\p{L}/gu);
    const hebrew = letters.every((c) => /\p{Script=Hebrew}/u.test(c));
    const latin = letters.every((c) => /\p{Script=Latin}/u.test(c));
    if (!hebrew && !latin) return null;
  }
  return n;
}

export function ruleLanguage(from) {
  return /[א-ת]/.test(from) ? 'he' : 'en';
}

// Uppercases the first letter unless `to` already carries a capital further in,
// so iphone → iPhone at a sentence start never becomes IPhone.
export function capitalizeFor(to) {
  if (/\p{Lu}/u.test(to.slice(1))) return to;
  return to.charAt(0).toUpperCase() + to.slice(1);
}

const isPrefixOnly = (a, b) => stripPrefixes(a).includes(b) || stripPrefixes(b).includes(a);

// The one gate every rule passes, whatever its source: capture, save, import and
// every read from storage.
export function isLearnableRule(rule) {
  if (!rule || typeof rule !== 'object') return false;
  const { from, to, language } = rule;
  if (normalizeRuleString(from) !== from || normalizeRuleString(to) !== to) return false;
  if (language !== ruleLanguage(from) || from === to || isPrefixOnly(from, to)) return false;
  if (!from.includes(' ') && letterCount(from) < 3) return false;
  if (STOPWORDS.has(from)) return false;
  if (stripPrefixes(from).slice(1).some((s) => letterCount(s) >= 3 && STOPWORDS.has(s))) return false;
  return checkRuleSet([rule]).ok;
}

// ---------- the scanner shared by the matcher and the rule-set check ----------

const ruleTokens = (s) => tokenize(s).map((t) => t.folded);

function buildIndex(rules) {
  const first = new Map(), later = new Map();
  const add = (map, key, entry) => { const list = map.get(key); if (list) list.push(entry); else map.set(key, [entry]); };
  for (const rule of rules) {
    const tokens = ruleTokens(rule.from);
    const base = { rule, tokens, longPrefixOk: hebLetters(rule.from) >= 4 };
    add(first, tokens[0], { ...base, sentenceOnly: false });
    const lowerLatin = !/[א-ת]/.test(rule.from) && rule.from === rule.from.toLowerCase();
    const cap = capitalizeFor(tokens[0]);
    if (lowerLatin && cap !== tokens[0]) add(first, cap, { ...base, sentenceOnly: true });
    tokens.forEach((t, position) => { if (position > 0) add(later, t, { ...base, sentenceOnly: false, position }); });
  }
  for (const list of first.values()) list.sort((a, b) => b.tokens.length - a.tokens.length);
  return { first, later };
}

// The keys a token can match a rule's first token by, in the order they are tried.
function tokenKeys(folded) {
  const keys = [{ key: folded, prefixLen: 0, suffixLen: 0 }];
  const stems = stripPrefixes(folded);
  for (let n = 1; n < stems.length; n++) keys.push({ key: stems[n], prefixLen: n, suffixLen: 0 });
  if (folded.length > 2 && folded.endsWith("'s")) keys.push({ key: folded.slice(0, -2), prefixLen: 0, suffixLen: 2 });
  return keys;
}

function firstHits(index, token, sentenceStart) {
  const hits = [];
  for (const k of tokenKeys(token.folded)) {
    for (const entry of index.first.get(k.key) || []) {
      // A glued prefix is optional only for 4+ letters, so אור never rewrites לאור.
      if (k.prefixLen && !entry.longPrefixOk) continue;
      // A possessive belongs after a single word; on a phrase it would move.
      if (k.suffixLen && entry.tokens.length !== 1) continue;
      if (entry.sentenceOnly && !sentenceStart) continue;
      hits.push({ entry, prefixLen: k.prefixLen, suffixLen: k.suffixLen });
    }
  }
  return hits;
}

function isSentenceStart(tokens, text, i) {
  if (i === 0) return true;
  const prev = tokens[i - 1];
  return ['.', '!', '?', '…'].includes(prev.folded) || text.slice(prev.end, tokens[i].start).includes('\n');
}

function matchAt(index, tokens, text, i) {
  for (const hit of firstHits(index, tokens[i], isSentenceStart(tokens, text, i))) {
    const n = hit.entry.tokens.length;
    let ok = true;
    for (let k = 1; k < n && ok; k++) {
      const t = tokens[i + k];
      ok = !!t && t.word && t.folded === hit.entry.tokens[k] && /^\s+$/.test(text.slice(tokens[i + k - 1].end, t.start));
    }
    if (ok && text[tokens[i + n - 1].end] !== '@') return hit;
  }
  return null;
}

function written(matchedText, hit) {
  const { rule, sentenceOnly } = hit.entry;
  return matchedText.slice(0, hit.prefixLen)
    + (sentenceOnly ? capitalizeFor(rule.to) : rule.to)
    + (hit.suffixLen ? matchedText.slice(-hit.suffixLen) : '');
}

export function applyCorrections(text, rules, { onHit } = {}) {
  if (!rules.length) return text;
  const index = buildIndex(rules);
  const tokens = tokenize(text);
  let out = '', cursor = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok.word || text[tok.start - 1] === '@') continue;
    const hit = matchAt(index, tokens, text, i);
    if (!hit) continue;
    const last = tokens[i + hit.entry.tokens.length - 1];
    const matched = text.slice(tok.start, last.end);
    const wrote = written(matched, hit);
    out += text.slice(cursor, tok.start) + wrote;
    cursor = last.end;
    if (wrote !== matched) onHit?.(hit.entry.rule, matched, wrote);
    i += hit.entry.tokens.length - 1;
  }
  return out + text.slice(cursor);
}

export function safeApply(text, rules, onHit) {
  try {
    return applyCorrections(text, rules, { onHit });
  } catch {
    return text;
  }
}

// ---------- the rule-set invariant ----------
//
// A set is valid when no text a splice can write is matched again by any rule,
// except a rule rewriting its own output to identical text (jira → Jira on a
// sentence-start "Jira"). That makes applyCorrections idempotent, which is what
// lets the same rules run before and after cleanup. See the spec, §1.

function formOf(text) {
  const tokens = tokenize(text);
  return {
    text,
    tokens: tokens.map((t, i) => ({
      folded: t.folded,
      word: t.word,
      gap: i > 0 && /^\s+$/.test(text.slice(tokens[i - 1].end, t.start)),
    })),
  };
}

// Does a from aligned at form position `a` agree with the form wherever the two
// overlap? Positions outside the form are free: they are untouched text.
function agrees(tokens, a, fromTokens) {
  for (let j = 1; j < fromTokens.length; j++) {
    const idx = a + j;
    if (idx < 0) continue;
    if (idx >= tokens.length) break;
    const t = tokens[idx];
    if (!t.word || t.folded !== fromTokens[j] || (idx > 0 && !t.gap)) return false;
  }
  return true;
}

// The rules that could match again somewhere a splice of `rule` wrote `form`.
function formConflicts(index, rule, form, sentenceStart) {
  const found = new Set();
  const { tokens } = form;
  tokens.forEach((t, k) => {
    if (!t.word) return;
    for (const hit of firstHits(index, t, k === 0 && sentenceStart)) {
      if (!agrees(tokens, k, hit.entry.tokens)) continue;
      const whole = k === 0 && hit.entry.tokens.length === tokens.length;
      if (hit.entry.rule === rule && whole && written(form.text, hit) === form.text) continue;
      found.add(hit.entry.rule);
    }
    for (const entry of index.later.get(t.folded) || []) {
      const a = k - entry.position;
      // A match starting inside the form is a first-token hit, handled above.
      if (a < 0 && agrees(tokens, a, entry.tokens)) found.add(entry.rule);
    }
  });
  return found;
}

// Which glued prefixes can matter in front of a `to`, found from the from tokens
// themselves instead of trying all 169 prefix forms.
function buildPrefixIndex(rules) {
  const glued = new Map(), hyphen = new Map(), lone = new Set();
  const add = (map, key, value) => { const s = map.get(key); if (s) s.add(value); else map.set(key, new Set([value])); };
  const HYPHENATED = new RegExp(`^([${PREFIXES}]{1,2}[-־])(.+)$`, 'u');
  const LONE = new RegExp(`^[${PREFIXES}]{1,2}$`, 'u');
  for (const rule of rules) {
    for (const f of ruleTokens(rule.from)) {
      for (const stem of stripPrefixes(f).slice(1)) add(glued, stem, f.slice(0, f.length - stem.length));
      const m = HYPHENATED.exec(f);
      if (m) add(hyphen, m[2], m[1]);
      if (LONE.test(f)) lone.add(f);
    }
  }
  return { glued, hyphen, lone };
}

function outputForms(to, prefixIndex) {
  const forms = [];
  for (const c of new Set([to, capitalizeFor(to)])) {
    for (const s of ['', "'s"]) for (const ss of [true, false]) forms.push({ text: c + s, ss });
  }
  const t0 = to.split(' ')[0];
  const prefixes = new Set();
  if (startsHebrew(t0)) {
    prefixes.add('ב');
    for (const p of prefixIndex.glued.get(t0) || []) { prefixes.add(p); if (p.length === 1) prefixes.add('ב' + p); }
    for (const p of prefixIndex.hyphen.get(t0) || []) { prefixes.add(p); if (p.length === 2) prefixes.add('ב' + p); }
  } else {
    for (const v of prefixIndex.lone) for (const h of ['', '-', '־']) prefixes.add(v + h);
  }
  for (const p of prefixes) forms.push({ text: p + to, ss: false });
  return forms;
}

export function checkRuleSet(rules) {
  const index = buildIndex(rules);
  const prefixIndex = buildPrefixIndex(rules);
  const position = new Map(rules.map((r, i) => [r, i]));
  const conflicts = [], seen = new Set();
  for (const rule of rules) {
    for (const { text, ss } of outputForms(rule.to, prefixIndex)) {
      for (const other of formConflicts(index, rule, formOf(text), ss)) {
        const key = `${position.get(rule)}:${position.get(other)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push([rule, other]);
      }
    }
  }
  return conflicts.length ? { ok: false, conflicts } : { ok: true };
}

// Test-only: the rule-set oracle enumerates every output form through these, so
// the enumerated definition and checkRuleSet can never use different predicates.
export const __scanner = { buildIndex, formOf, formConflicts };

// ---------- capture ----------

export function diffTokens(a, b) {
  let s = 0;
  while (s < a.length && s < b.length && a[s].folded === b[s].folded) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e].folded === b[b.length - 1 - e].folded) e++;
  const A = a.slice(s, a.length - e), B = b.slice(s, b.length - e);
  const m = A.length, n = B.length, W = n + 1;
  if (!m && !n) return [];
  if ((m + 1) * W > MAX_DIFF_CELLS) return null;
  const L = new Uint16Array((m + 1) * W);
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      L[i * W + j] = A[i].folded === B[j].folded ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    }
  }
  const hunks = [];
  let cur = null, i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && A[i].folded === B[j].folded) { if (cur) hunks.push(cur); cur = null; i++; j++; continue; }
    cur ??= { from: [], to: [] };
    if (j < n && (i === m || L[i * W + j + 1] >= L[(i + 1) * W + j])) cur.to.push(B[j++]);
    else cur.from.push(A[i++]);
  }
  if (cur) hunks.push(cur);
  return hunks;
}

const isHyphen = (t) => !t.word && (t.folded === '-' || t.folded === '־');

// Filters 0–2: detach a post-split prefix, trim edge punctuation, and require
// 1–3 whitespace-separated words without digits.
function side(tokens, text) {
  let toks = tokens, pre = '';
  if (toks[0]?.prefix) {
    pre = toks[0].folded;
    toks = toks.slice(1);
    if (toks[0] && isHyphen(toks[0])) toks = toks.slice(1);
  }
  while (toks.length && !toks[0].word) toks = toks.slice(1);
  while (toks.length && !toks[toks.length - 1].word) toks = toks.slice(0, -1);
  if (!toks.length || toks.length > MAX_RULE_TOKENS) return null;
  for (let k = 0; k < toks.length; k++) {
    if (!toks[k].word || /\p{N}/u.test(toks[k].folded)) return null;
    if (k > 0 && !/^\s+$/.test(text.slice(toks[k - 1].end, toks[k].start))) return null;
  }
  return { pre, toks, words: toks.map((t) => t.folded) };
}

const fullForm = (s) => s.pre + s.words.join(' ');

function prefixCandidates(s) {
  if (s.pre) return [s.pre];
  const w = s.words[0], out = [];
  if (w.length > 2 && PREFIXES.includes(w[0]) && PREFIXES.includes(w[1])) out.push(w.slice(0, 2));
  if (w.length > 1 && PREFIXES.includes(w[0])) out.push(w[0]);
  return out;
}

const stripSide = (s, p) => (s.pre ? s.words : [s.words[0].slice(p.length), ...s.words.slice(1)]).join(' ');

// Filter 3: which part of each side is a Hebrew prefix, and which is the change.
function resolvePrefixes(f, t) {
  const ff = fullForm(f), ft = fullForm(t);
  if (isPrefixOnly(ff, ft)) return null;
  const fc = prefixCandidates(f), tc = prefixCandidates(t);
  const shared = fc.filter((p) => tc.includes(p));
  if (shared.length) {
    for (const p of shared) {
      const from = stripSide(f, p);
      if (hebLetters(from) >= 4) return { from, to: stripSide(t, p) };
    }
    return { from: ff, to: ft };
  }
  const pf = f.pre || fc.find((p) => p.length === 1) || '';
  const pt = t.pre || tc.find((p) => p.length === 1) || '';
  const sf = pf ? stripSide(f, pf) : f.words.join(' ');
  const st = pt ? stripSide(t, pt) : t.words.join(' ');
  if ((pf || pt) && sf[0] === st[0]) {
    // The change is further into the word, so the differing first letters are prefixes.
    if (hebLetters(sf) < 4 || sf === st) return null;
    return { from: sf, to: st };
  }
  return { from: ff, to: ft };
}

function gateRule(from, to, after, rules) {
  const nf = normalizeRuleString(from), nt = normalizeRuleString(to);
  if (!nf || !nt) return null;
  const rule = { from: nf, to: nt, language: ruleLanguage(nf) };
  if (!isLearnableRule(rule)) return null;
  // Inconsistent edit: the user left the same form unfixed elsewhere.
  if (applyCorrections(after, [rule]) !== after) return null;
  if (rules.some((r) => r.language === rule.language && r.from === rule.from && r.to === rule.to)) return null;
  return rule;
}

// Filter 9: an unchanged neighbour word that makes a two-word sibling rule.
function neighbour(tokens, text, i, dir) {
  const n = tokens[i + dir];
  if (!n || !n.word || n.prefix) return null;
  const gap = dir < 0 ? text.slice(n.end, tokens[i].start) : text.slice(tokens[i].end, n.start);
  if (!/^\s+$/.test(gap) || letterCount(n.folded) < 2 || STOPWORDS.has(n.folded)) return null;
  return n.folded;
}

export function extractCandidates(before, after, { rules = [] } = {}) {
  const ta = tokenize(before), tb = tokenize(after);
  const hunks = diffTokens(ta, tb);
  if (!hunks) return [];
  const ia = new Map(ta.map((t, i) => [t, i])), ib = new Map(tb.map((t, i) => [t, i]));
  const out = [];
  for (const h of hunks) {
    const f = side(h.from, before), t = side(h.to, after);
    if (!f || !t) continue;
    const resolved = resolvePrefixes(f, t);
    if (!resolved) continue;
    let { from, to } = resolved;
    const latin = (s) => /^\p{Script=Latin}/u.test(s);
    if (latin(from) && latin(to) && from.endsWith("'s") && to.endsWith("'s")) {
      from = from.slice(0, -2);
      to = to.slice(0, -2);
    }
    const fi = ia.get(f.toks[0]), ti = ib.get(t.toks[0]);
    if (from !== to && from.toLowerCase() === to.toLowerCase()
      && (isSentenceStart(ta, before, fi) || isSentenceStart(tb, after, ti))) continue;
    const rule = gateRule(from, to, after, rules);
    if (!rule) continue;
    const group = ruleKey(rule);
    out.push({ ...rule, group });
    if (f.toks.length !== 1 || t.toks.length !== 1 || f.pre || t.pre) continue;
    const before1 = neighbour(ta, before, fi, -1) && neighbour(tb, after, ti, -1);
    const after1 = !before1 && neighbour(ta, before, fi, 1) && neighbour(tb, after, ti, 1);
    const n = before1 || after1;
    if (!n) continue;
    const sibling = before1
      ? gateRule(`${n} ${f.words[0]}`, `${n} ${t.words[0]}`, after, rules)
      : gateRule(`${f.words[0]} ${n}`, `${t.words[0]} ${n}`, after, rules);
    if (sibling) out.push({ ...sibling, group });
  }
  return out;
}

export function mergeCandidates(found, pending, dismissed) {
  const seen = new Set(pending.map(candidateKey));
  const out = pending.filter((c) => !dismissed.has(candidateKey(c)));
  for (const c of found) {
    const k = candidateKey(c);
    if (seen.has(k) || dismissed.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

// ---------- documents ----------

const DOC_KEYS = 'examples,rules,v';
const RULE_KEYS = 'count,createdAt,from,language,lastUsedAt,to';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isPlain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const keysOf = (o) => Object.keys(o).sort().join(',');

function copyRule(r) {
  if (!isPlain(r) || keysOf(r) !== RULE_KEYS) return null;
  const { from, to, language, count, createdAt, lastUsedAt } = r;
  if (typeof from !== 'string' || typeof to !== 'string' || typeof language !== 'string') return null;
  if (!Number.isInteger(count) || count < 0 || count > 1_000_000) return null;
  if (typeof createdAt !== 'string' || !DATE.test(createdAt) || typeof lastUsedAt !== 'string' || !DATE.test(lastUsedAt)) return null;
  const rule = { from, to, language, count, createdAt, lastUsedAt };
  return isLearnableRule(rule) ? rule : null;
}

const byUse = (a, b) => b.count - a.count || b.lastUsedAt.localeCompare(a.lastUsedAt)
  || (ruleKey(a) < ruleKey(b) ? -1 : ruleKey(a) > ruleKey(b) ? 1 : 0);

// 'import' is all-or-nothing. 'stored' keeps what it can: losing the whole list
// over one bad rule hurts more than it protects.
export function validateDocument(obj, { mode }) {
  if (!isPlain(obj)) return { ok: false };
  if (mode === 'stored' && ((typeof obj.v === 'number' && obj.v > 1) || !keysOf(obj).split(',').every((k) => DOC_KEYS.includes(k)))) {
    return { ok: false, unsupported: true };
  }
  if (keysOf(obj) !== DOC_KEYS || obj.v !== 1 || !Array.isArray(obj.rules) || !Array.isArray(obj.examples) || obj.examples.length) {
    return { ok: false };
  }
  if (mode === 'import') {
    if (obj.rules.length > MAX_RULES) return { ok: false };
    const rules = obj.rules.map(copyRule);
    if (rules.some((r) => !r)) return { ok: false };
    if (new Set(rules.map(ruleKey)).size !== rules.length || !checkRuleSet(rules).ok) return { ok: false };
    return { ok: true, doc: { v: 1, rules, examples: [] }, dropped: 0 };
  }
  const valid = obj.rules.map(copyRule).filter(Boolean).sort(byUse);
  const unique = [], keys = new Set();
  for (const r of valid) if (!keys.has(ruleKey(r))) { keys.add(ruleKey(r)); unique.push(r); }
  // Keep a rule only if it conflicts with nothing already kept. Any subset of a
  // valid set is valid, so the result always is.
  const partners = new Map();
  for (const [a, b] of checkRuleSet(unique).conflicts || []) {
    for (const [x, y] of [[a, b], [b, a]]) (partners.get(x) ?? partners.set(x, new Set()).get(x)).add(y);
  }
  const kept = new Set();
  for (const r of unique) {
    if (kept.size >= MAX_RULES) break;
    if ([...(partners.get(r) || [])].some((p) => kept.has(p))) continue;
    kept.add(r);
  }
  const rules = unique.filter((r) => kept.has(r));
  return { ok: true, doc: { v: 1, rules, examples: [] }, dropped: obj.rules.length - rules.length };
}

// ---------- what goes to the models ----------

export function relevantRules(text, rules, max = MAX_PROMPT_RULES) {
  const tokens = tokenize(text);
  const hit = new Set();
  const scan = (index) => tokens.forEach((t, i) => {
    if (!t.word) return;
    const m = matchAt(index, tokens, text, i);
    if (m) hit.add(m.entry.rule.origin ?? m.entry.rule);
  });
  scan(buildIndex(rules));
  scan(buildIndex(rules.map((r) => ({ from: r.to, to: r.to, origin: r }))));
  return rules.filter((r) => hit.has(r)).sort(byUse).slice(0, max);
}

export function vocabularyTerms(rules, { maxTerms = MAX_VOCAB_TERMS, maxChars = MAX_VOCAB_CHARS } = {}) {
  const terms = [];
  let chars = 0;
  for (const r of [...rules].filter((r) => r.count >= 2).sort(byUse)) {
    if (r.to.split(' ').length > 2 || STOPWORDS.has(r.to) || terms.includes(r.to)) continue;
    const add = (terms.length ? 2 : 0) + r.to.length;
    if (terms.length >= maxTerms || chars + add > maxChars) break;
    terms.push(r.to);
    chars += add;
  }
  return terms;
}
