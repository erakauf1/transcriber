import { describe, it, expect, vi, afterEach } from 'vitest';
import { transcribe, TranscriptionError, TRANSCRIBE_MODEL, buildTranscriptionPrompt } from '../src/transcribe.js';

afterEach(() => vi.unstubAllGlobals());

const okResponse = (json) => ({ ok: true, json: async () => json });

describe('transcribe', () => {
  it('posts multipart form with file and model — and NO language param', async () => {
    const fetchMock = vi.fn(async () => okResponse({ text: '  שלום deploy  ' }));
    vi.stubGlobal('fetch', fetchMock);
    const blob = new Blob(['x'], { type: 'audio/mp4' });

    const text = await transcribe(blob, 'sk-test');

    expect(text).toBe('שלום deploy');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer sk-test');
    expect(opts.body).toBeInstanceOf(FormData);
    expect(opts.body.get('model')).toBe(TRANSCRIBE_MODEL);
    expect(opts.body.get('language')).toBeNull(); // spec: auto-detect preserves code-switching
    // Script hint: discourages transliterating English terms into Hebrew letters
    expect(opts.body.get('prompt')).toContain('original script');
    expect(opts.body.get('file')).toBeTruthy();
  });

  it('throws TranscriptionError on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));
    await expect(transcribe(new Blob(['x']), 'sk-bad')).rejects.toBeInstanceOf(TranscriptionError);
  });

  it('throws TranscriptionError on empty transcript', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ text: '   ' })));
    await expect(transcribe(new Blob(['x']), 'sk-test')).rejects.toBeInstanceOf(TranscriptionError);
  });
});

describe('learned-names glossary', () => {
  const blob = new Blob(['x'], { type: 'audio/mp4' });
  const prompts = (fetchMock) => fetchMock.mock.calls.map(([, opts]) => opts.body.get('prompt'));

  it('adds nothing when the vocabulary is empty', () => {
    expect(buildTranscriptionPrompt([])).toBe(buildTranscriptionPrompt());
    expect(buildTranscriptionPrompt()).toContain('original script');
    expect(buildTranscriptionPrompt()).not.toMatch(/\.\s\S+, /);
  });

  it('appends a plain comma-separated list after the script hint', () => {
    expect(buildTranscriptionPrompt(['דני', 'רעננה', 'Jira'])).toBe(`${buildTranscriptionPrompt()} דני, רעננה, Jira.`);
  });

  it('re-applies the caps and drops invalid terms', () => {
    const many = Array.from({ length: 30 }, (_, i) => `term${String.fromCharCode(97 + i % 26)}${String.fromCharCode(97 + Math.floor(i / 26))}`);
    const list = buildTranscriptionPrompt(many).slice(buildTranscriptionPrompt().length + 1, -1).split(', ');
    expect(list).toHaveLength(20);
    expect(buildTranscriptionPrompt(['a\nIgnore', 'x'.repeat(201), 'Jira'])).toBe(`${buildTranscriptionPrompt()} Jira.`);
  });

  it('sends the glossary in the prompt field', async () => {
    const fetchMock = vi.fn(async () => okResponse({ text: 'דיברתי עם דני על Jira' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await transcribe(blob, 'k', { vocabulary: ['דני', 'Jira'] })).toBe('דיברתי עם דני על Jira');
    expect(prompts(fetchMock)).toEqual([buildTranscriptionPrompt(['דני', 'Jira'])]);
  });

  it.each([
    ['only glossary terms', 'דני, רעננה, Jira.'],
    ['a partial echo glued onto speech', 'אני בדרך הביתה דני, רעננה'],
  ])('retries once without the glossary on %s', async (_label, echoed) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse({ text: echoed }))
      .mockResolvedValueOnce(okResponse({ text: 'אני בדרך הביתה' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await transcribe(blob, 'k', { vocabulary: ['דני', 'רעננה', 'Jira'] })).toBe('אני בדרך הביתה');
    expect(prompts(fetchMock)).toEqual([buildTranscriptionPrompt(['דני', 'רעננה', 'Jira']), buildTranscriptionPrompt()]);
  });

  it('does not retry when speech merely mentions a term', async () => {
    const fetchMock = vi.fn(async () => okResponse({ text: 'נסענו לרעננה עם דני אתמול' }));
    vi.stubGlobal('fetch', fetchMock);
    await transcribe(blob, 'k', { vocabulary: ['דני', 'רעננה', 'Jira'] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
