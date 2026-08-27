import { describe, it, expect, beforeEach } from 'vitest';
import { getApiKey, setApiKey, hasApiKey } from '../src/settings.js';

describe('settings', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when no key stored', () => {
    expect(getApiKey()).toBeNull();
    expect(hasApiKey()).toBe(false);
  });

  it('stores and retrieves a key, trimmed', () => {
    setApiKey('  sk-test-123  ');
    expect(getApiKey()).toBe('sk-test-123');
    expect(hasApiKey()).toBe(true);
    expect(localStorage.getItem('openai_api_key')).toBe('sk-test-123');
  });

  it('setting an empty/whitespace key clears storage', () => {
    setApiKey('sk-test-123');
    setApiKey('   ');
    expect(getApiKey()).toBeNull();
    expect(localStorage.getItem('openai_api_key')).toBeNull();
  });
});
