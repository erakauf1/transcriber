// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runPipeline } from '../scripts/pipeline.js';

afterEach(() => vi.unstubAllGlobals());

const reply = (text) => ({ ok: true, json: async () => ({ content: [{ type: 'text', text }] }) });
const opts = { provider: 'anthropic', model: 'claude-sonnet-5', apiKey: 'k' };

describe('runPipeline', () => {
  it('runs English terms before cleanup on Hebrew text and returns each stage', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply('{"terms":[{"he":"דיפלוי","en":"deploy"}]}'))
      .mockResolvedValueOnce(reply('צריך לעשות deploy מחר.'));
    vi.stubGlobal('fetch', fetchMock);

    const out = await runPipeline('צריך לעשות דיפלוי מחר', opts);

    expect(out.language).toBe('he');
    expect(out.withTerms).toBe('צריך לעשות deploy מחר');
    expect(out.cleaned).toBe('צריך לעשות deploy מחר.');
    const cleanupBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(cleanupBody.messages.at(-1).content).toBe('צריך לעשות deploy מחר');
  });

  it('applies learned corrections before and after cleanup', async () => {
    // English text skips the English-terms call, so the only fetch is cleanup.
    // The model "reverts" the fix; the post-pass must re-apply it.
    const rules = [{ from: 'Jon', to: 'John', language: 'en' }];
    const fetchMock = vi.fn().mockResolvedValueOnce(reply('I met Jon today.'));
    vi.stubGlobal('fetch', fetchMock);

    const out = await runPipeline('i met Jon today', { ...opts, rules, language: 'en' });

    expect(out.corrected).toBe('i met John today');
    expect(out.cleaned).toBe('I met John today.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the rules the note touches to the cleanup prompt', async () => {
    const rules = [{ from: 'Jon', to: 'John', language: 'en' }];
    const fetchMock = vi.fn().mockResolvedValueOnce(reply('I met John today.'));
    vi.stubGlobal('fetch', fetchMock);

    await runPipeline('i met Jon today', { ...opts, rules, language: 'en' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.system).toContain('"Jon" → "John"');
  });

  it('uses the language it is given instead of detecting one', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply('Clean.'));
    vi.stubGlobal('fetch', fetchMock);

    const out = await runPipeline('שלום', { ...opts, language: 'en' });

    expect(out.language).toBe('en');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
