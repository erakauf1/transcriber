import { describe, it, expect } from 'vitest';
import { restoreLoanwords, LOANWORDS } from '../src/loanwords.js';

describe('restoreLoanwords', () => {
  it('replaces a transliterated term with its Latin spelling', () => {
    expect(restoreLoanwords('העלתה את זה לסטייג\'ינג')).toBe('העלתה את זה לstaging');
  });

  it('handles the Hebrew definite/prepositional prefix form', () => {
    expect(restoreLoanwords('לא חוסם את הרליס')).toBe('לא חוסם את הrelease');
  });

  it('replaces several terms in one message', () => {
    const out = restoreLoanwords('יש באג בדשבורד אבל זה מיינור');
    expect(out).toContain('bug');
    expect(out).toContain('dashboard');
    expect(out).toContain('minor');
  });

  it('leaves text without loanwords untouched', () => {
    const text = 'הפגישה נקבעה לארבע וחצי ברעננה';
    expect(restoreLoanwords(text)).toBe(text);
  });

  it('never alters a place name that resembles nothing in the table', () => {
    expect(restoreLoanwords('ביום שני הבא ברעננה')).toContain('רעננה');
  });

  it('does not match a loanword embedded inside a longer Hebrew word', () => {
    // באג must not fire inside באגרטל ("in a vase")
    expect(restoreLoanwords('שמתי פרחים באגרטל')).toBe('שמתי פרחים באגרטל');
  });

  it('is idempotent — running twice changes nothing further', () => {
    const once = restoreLoanwords('העלינו לסטייג\'ינג');
    expect(restoreLoanwords(once)).toBe(once);
  });

  it('exposes the table so it can be extended', () => {
    expect(LOANWORDS['סטייג\'ינג']).toBe('staging');
    expect(Object.keys(LOANWORDS).length).toBeGreaterThan(15);
  });

  it('preserves a stacked two-letter Hebrew prefix', () => {
    expect(restoreLoanwords('אבי מהבקנט סיים')).toBe('אבי מהbackend סיים');
  });

  it('handles the short spelling of bug', () => {
    expect(restoreLoanwords('יש שם עוד בג אחד')).toBe('יש שם עוד bug אחד');
  });
});
