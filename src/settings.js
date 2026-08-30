const OPENAI_STORAGE_KEY = 'openai_api_key';
const ANTHROPIC_STORAGE_KEY = 'anthropic_api_key';

function readKey(storageKey) {
  try {
    const value = (localStorage.getItem(storageKey) || '').trim();
    return value || null;
  } catch {
    // Storage blocked (e.g. Safari "Block All Cookies") — behave as if no key is saved.
    return null;
  }
}

function writeKey(storageKey, key) {
  try {
    const value = (key || '').trim();
    if (value) localStorage.setItem(storageKey, value);
    else localStorage.removeItem(storageKey);
  } catch {
    // Storage blocked — no-op.
  }
}

export function getOpenAIKey() {
  return readKey(OPENAI_STORAGE_KEY);
}
export function setOpenAIKey(key) {
  writeKey(OPENAI_STORAGE_KEY, key);
}
export function hasOpenAIKey() {
  return getOpenAIKey() !== null;
}

export function getAnthropicKey() {
  return readKey(ANTHROPIC_STORAGE_KEY);
}
export function setAnthropicKey(key) {
  writeKey(ANTHROPIC_STORAGE_KEY, key);
}
export function hasAnthropicKey() {
  return getAnthropicKey() !== null;
}

const NS_KEY = 'noiseSuppressionEnabled';

export function getNoiseSuppressionEnabled() {
  try {
    const val = localStorage.getItem(NS_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export function setNoiseSuppressionEnabled(enabled) {
  try {
    localStorage.setItem(NS_KEY, String(!!enabled));
  } catch {
    // Storage blocked — no-op.
  }
}
