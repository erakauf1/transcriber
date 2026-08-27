import { describe, it, expect, vi, afterEach } from 'vitest';
import { transcribe, TranscriptionError, TRANSCRIBE_MODEL } from '../src/transcribe.js';

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
