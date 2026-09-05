import { describe, it, expect, beforeEach } from 'vitest';
import {
  getOpenAIKey, setOpenAIKey, hasOpenAIKey,
  getAnthropicKey, setAnthropicKey, hasAnthropicKey,
  getNoiseSuppressionEnabled, setNoiseSuppressionEnabled,
  getOpenRouterKey, setOpenRouterKey, hasOpenRouterKey,
  getCleanupProvider, setCleanupProvider,
  getRefineProvider, setRefineProvider,
  getCleanupModel, setCleanupModel,
  getRefineModel, setRefineModel,
} from '../src/settings.js';

describe('OpenAI key storage', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when no key stored', () => {
    expect(getOpenAIKey()).toBeNull();
    expect(hasOpenAIKey()).toBe(false);
  });

  it('stores and retrieves a key, trimmed', () => {
    setOpenAIKey('  sk-test-123  ');
    expect(getOpenAIKey()).toBe('sk-test-123');
    expect(hasOpenAIKey()).toBe(true);
    expect(localStorage.getItem('openai_api_key')).toBe('sk-test-123');
  });

  it('setting an empty/whitespace key clears storage', () => {
    setOpenAIKey('sk-test-123');
    setOpenAIKey('   ');
    expect(getOpenAIKey()).toBeNull();
    expect(localStorage.getItem('openai_api_key')).toBeNull();
  });
});

describe('Anthropic key storage', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when no key stored', () => {
    expect(getAnthropicKey()).toBeNull();
    expect(hasAnthropicKey()).toBe(false);
  });

  it('stores and retrieves a key, trimmed', () => {
    setAnthropicKey('  sk-ant-test-123  ');
    expect(getAnthropicKey()).toBe('sk-ant-test-123');
    expect(hasAnthropicKey()).toBe(true);
    expect(localStorage.getItem('anthropic_api_key')).toBe('sk-ant-test-123');
  });

  it('setting an empty/whitespace key clears storage', () => {
    setAnthropicKey('sk-ant-test-123');
    setAnthropicKey('   ');
    expect(getAnthropicKey()).toBeNull();
    expect(localStorage.getItem('anthropic_api_key')).toBeNull();
  });

  it('is independent from the OpenAI key', () => {
    setOpenAIKey('sk-openai');
    expect(getAnthropicKey()).toBeNull();
    expect(hasAnthropicKey()).toBe(false);
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

describe('OpenRouter key storage', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when no key stored', () => {
    expect(getOpenRouterKey()).toBeNull();
    expect(hasOpenRouterKey()).toBe(false);
  });

  it('stores and retrieves a key, trimmed', () => {
    setOpenRouterKey('  sk-or-test-123  ');
    expect(getOpenRouterKey()).toBe('sk-or-test-123');
    expect(hasOpenRouterKey()).toBe(true);
    expect(localStorage.getItem('openrouter_api_key')).toBe('sk-or-test-123');
  });
});

describe('cleanup provider setting', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to anthropic', () => {
    expect(getCleanupProvider()).toBe('anthropic');
  });

  it('persists a chosen provider', () => {
    setCleanupProvider('openrouter');
    expect(getCleanupProvider()).toBe('openrouter');
    expect(localStorage.getItem('cleanup_provider')).toBe('openrouter');
  });
});

describe('refine provider setting', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to openai', () => {
    expect(getRefineProvider()).toBe('openai');
  });

  it('persists a chosen provider', () => {
    setRefineProvider('anthropic');
    expect(getRefineProvider()).toBe('anthropic');
    expect(localStorage.getItem('refine_provider')).toBe('anthropic');
  });
});

describe('cleanup/refine model settings', () => {
  beforeEach(() => localStorage.clear());

  it('default to openrouter/auto', () => {
    expect(getCleanupModel()).toBe('openrouter/auto');
    expect(getRefineModel()).toBe('openrouter/auto');
  });

  it('persist a chosen model independently', () => {
    setCleanupModel('deepseek/deepseek-chat-v3.1:free');
    setRefineModel('meta-llama/llama-3.3-70b-instruct:free');
    expect(getCleanupModel()).toBe('deepseek/deepseek-chat-v3.1:free');
    expect(getRefineModel()).toBe('meta-llama/llama-3.3-70b-instruct:free');
  });
});
