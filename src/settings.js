const STORAGE_KEY = 'openai_api_key';

export function getApiKey() {
  try {
    const value = (localStorage.getItem(STORAGE_KEY) || '').trim();
    return value || null;
  } catch {
    // Storage blocked (e.g. Safari "Block All Cookies") — behave as if no key is saved.
    return null;
  }
}

export function setApiKey(key) {
  try {
    const value = (key || '').trim();
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked — no-op.
  }
}

export function hasApiKey() {
  return getApiKey() !== null;
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
