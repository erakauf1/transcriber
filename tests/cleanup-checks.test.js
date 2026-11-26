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
