import { describe, it, expect, beforeEach } from 'vitest';
import { getApiKey, setApiKey, hasApiKey, getNoiseSuppressionEnabled, setNoiseSuppressionEnabled } from '../src/settings.js';

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

describe('noise suppression setting', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to true when nothing stored', () => {
    expect(getNoiseSuppressionEnabled()).toBe(true);
  });

  it('persists false', () => {
    setNoiseSuppressionEnabled(false);
    expect(getNoiseSuppressionEnabled()).toBe(false);
    expect(localStorage.getItem('noiseSuppressionEnabled')).toBe('false');
  });

  it('persists true', () => {
    setNoiseSuppressionEnabled(false);
    setNoiseSuppressionEnabled(true);
    expect(getNoiseSuppressionEnabled()).toBe(true);
    expect(localStorage.getItem('noiseSuppressionEnabled')).toBe('true');
  });
});
