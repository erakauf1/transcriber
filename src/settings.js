const STORAGE_KEY = 'openai_api_key';

export function getApiKey() {
  const value = (localStorage.getItem(STORAGE_KEY) || '').trim();
  return value || null;
}

export function setApiKey(key) {
  const value = (key || '').trim();
  if (value) localStorage.setItem(STORAGE_KEY, value);
  else localStorage.removeItem(STORAGE_KEY);
}

export function hasApiKey() {
  return getApiKey() !== null;
}
