import { describe, it, expect, vi, afterEach } from 'vitest';
import { applyEnglishTerms, findEnglishTerms, restoreEnglishTerms } from '../src/englishTerms.js';

afterEach(() => vi.unstubAllGlobals());

const opts = { provider: 'anthropic', model: 'claude-sonnet-5', apiKey: 'sk-ant-test' };

function stubReply(text) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text }], usage: {} }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('applyEnglishTerms', () => {
  it('replaces model-proposed phrases with their English spelling', () => {
    const out = applyEnglishTerms('כי שני ויפי אינג\'ינירינג עזבו, שניים או שלושה ויפי פרודקט עזבו', [
      { he: 'ויפי אינג\'ינירינג', en: 'VP engineering' },
      { he: 'ויפי פרודקט', en: 'VP product' },
    ]);
    expect(out).toBe('כי שני VP engineering עזבו, שניים או שלושה VP product עזבו');
  });

  it('preserves attached Hebrew prefix letters', () => {
    expect(applyEnglishTerms('העלינו לסטייג\'ינג מהבקנד', [
      { he: 'סטייג\'ינג', en: 'staging' },
      { he: 'בקנד', en: 'backend' },
    ])).toBe('העלינו לstaging מהbackend');
  });

  it('rejects a replacement in Hebrew letters — a name can never become another name', () => {
    const text = 'אני עדיין ברעננה';
    expect(applyEnglishTerms(text, [{ he: 'רעננה', en: 'הרצליה' }])).toBe(text);
  });

  it('rejects a mixed-script replacement', () => {
    const text = 'יש באג קטן';
    expect(applyEnglishTerms(text, [{ he: 'באג', en: 'bugקטן' }])).toBe(text);
  });

  it('does not match inside a longer Hebrew word', () => {
    const text = 'שמתי פרחים באגרטל';
    expect(applyEnglishTerms(text, [{ he: 'באג', en: 'bug' }])).toBe(text);
  });

  it('ignores a pair whose Hebrew does not appear in the text', () => {
    const text = 'הכל בסדר';
    expect(applyEnglishTerms(text, [{ he: 'דיפלוי', en: 'deploy' }])).toBe(text);
  });

  it('ignores malformed entries', () => {
    const text = 'יש באג';
    expect(applyEnglishTerms(text, [null, { he: 'באג' }, { en: 'bug' }, 'באג'])).toBe(text);
  });

  it('accepts English terms with punctuation', () => {
    expect(applyEnglishTerms('ויפי אר אנד די', [{ he: 'ויפי אר אנד די', en: 'VP R&D' }])).toBe('VP R&D');
    expect(applyEnglishTerms('נעשה פולו-אפ', [{ he: 'פולו-אפ', en: 'follow-up' }])).toBe('נעשה follow-up');
  });
});

describe('findEnglishTerms', () => {
  it('parses the terms array, tolerating a fenced reply', async () => {
    stubReply('```json\n{"terms": [{"he": "דיפלוי", "en": "deploy"}]}\n```');
    expect(await findEnglishTerms('נעשה דיפלוי', opts)).toEqual([{ he: 'דיפלוי', en: 'deploy' }]);
  });

  it('returns an empty list when terms is missing', async () => {
    stubReply('{}');
    expect(await findEnglishTerms('שלום', opts)).toEqual([]);
  });
});

describe('restoreEnglishTerms', () => {
  it('applies what the model found', async () => {
    stubReply('{"terms": [{"he": "ויפי פרודקט", "en": "VP product"}]}');
    expect(await restoreEnglishTerms('שני ויפי פרודקט עזבו', 'he', opts)).toBe('שני VP product עזבו');
  });

  it('returns the text unchanged when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await restoreEnglishTerms('נעשה דיפלוי', 'he', opts)).toBe('נעשה דיפלוי');
  });

  it('returns the text unchanged on unparseable output', async () => {
    stubReply('not json');
    expect(await restoreEnglishTerms('נעשה דיפלוי', 'he', opts)).toBe('נעשה דיפלוי');
  });

  it('skips the call for English messages and when no key is set', async () => {
    const fetchMock = stubReply('{"terms": []}');
    await restoreEnglishTerms('hello there', 'en', opts);
    await restoreEnglishTerms('נעשה דיפלוי', 'he', { ...opts, apiKey: '' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
