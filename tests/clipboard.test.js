import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyText } from '../src/clipboard.js';

afterEach(() => vi.unstubAllGlobals());

describe('copyText', () => {
  it('returns true when clipboard write succeeds', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('hello')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('returns false when clipboard write rejects', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    expect(await copyText('hello')).toBe(false);
  });

  it('returns false when clipboard API is missing', async () => {
    vi.stubGlobal('navigator', {});
    expect(await copyText('hello')).toBe(false);
  });
});
