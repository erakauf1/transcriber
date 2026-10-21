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
