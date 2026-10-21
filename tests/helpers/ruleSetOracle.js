import { PREFIXES } from '../../src/hebrew.js';
import { capitalizeFor, __scanner } from '../../src/corrections.js';

// The enumerated definition of the rule-set invariant (spec §1): every output form
// p + c(to) + s a splice can write, checked with the scanner's own predicates.
// checkRuleSet looks at a chosen subset of these forms; this checks them all.
const LETTERS = [...PREFIXES];
const PREFIX_FORMS = [''];
for (const a of LETTERS) {
  for (const p of [a, ...LETTERS.map((b) => a + b)]) PREFIX_FORMS.push(p, p + '-', p + '־');
}

export function oracleCheck(rules) {
  const { buildIndex, formOf, formConflicts } = __scanner;
  const index = buildIndex(rules);
  const conflicts = [];
  for (const rule of rules) {
    const found = new Set();
    for (const p of PREFIX_FORMS) {
      for (const c of new Set([rule.to, capitalizeFor(rule.to)])) {
        for (const s of ['', "'s"]) {
          for (const ss of [true, false]) {
            for (const other of formConflicts(index, rule, formOf(p + c + s), ss)) found.add(other);
          }
        }
      }
    }
    for (const other of found) conflicts.push([rule, other]);
  }
  return conflicts.length ? { ok: false, conflicts } : { ok: true };
}
