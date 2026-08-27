import { describe, it, expect } from 'vitest';
import { detectLanguage } from '../src/language.js';

describe('detectLanguage', () => {
  it('detects Hebrew text', () => {
    expect(detectLanguage('שלום, מה קורה? רציתי להגיד לך משהו חשוב')).toBe('he');
  });

  it('detects English text', () => {
    expect(detectLanguage('Hey, I wanted to tell you something important')).toBe('en');
  });

  it('mixed text with Hebrew majority stays Hebrew', () => {
    expect(detectLanguage('אני צריך לעשות deploy למחר ואחרי זה לשלוח follow-up')).toBe('he');
  });

  it('mixed text with English majority stays English', () => {
    expect(detectLanguage('I told Yossi שלום and then we discussed the whole deployment plan')).toBe('en');
  });

  it('empty string defaults to English', () => {
    expect(detectLanguage('')).toBe('en');
  });

  it('digits and punctuation only default to English', () => {
    expect(detectLanguage('123 456!')).toBe('en');
  });
});
