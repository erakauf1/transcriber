const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ATTRIBUTION_TITLE = 'Voice Note Transcriber';
const ATTRIBUTION_REFERER = 'https://the-transcriber.netlify.app';

async function callAnthropic({ model, apiKey, systemPrompt, messages, maxTokens, timeoutMs }) {
  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        thinking: { type: 'disabled' },
        system: systemPrompt,
        messages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(`Network error: ${err.message}`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.error?.message;
    throw new Error(detail ? `Request failed: ${detail}` : `Request failed (HTTP ${res.status})`);
  }
  const data = await res.json();
  const out = data.content?.find((b) => b.type === 'text')?.text?.trim();
  if (!out) throw new Error('Empty response');
  return out;
}

async function callOpenAICompatible({
  provider, model, apiKey, systemPrompt, messages, temperature, jsonMode, timeoutMs,
}) {
  const url = provider === 'openrouter' ? OPENROUTER_URL : OPENAI_URL;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = ATTRIBUTION_REFERER;
    headers['X-Title'] = ATTRIBUTION_TITLE;
  }

  const body = {
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (jsonMode) body.response_format = { type: 'json_object' };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(`Network error: ${err.message}`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.error?.message;
    throw new Error(detail ? `Request failed: ${detail}` : `Request failed (HTTP ${res.status})`);
  }
  const data = await res.json();
  const out = data.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error('Empty response');
  return out;
}

export async function callChatModel({
  provider, model, apiKey, systemPrompt, messages,
  temperature, maxTokens, jsonMode = false, timeoutMs = 60000,
}) {
  if (provider === 'anthropic') {
    return callAnthropic({ model, apiKey, systemPrompt, messages, maxTokens, timeoutMs });
  }
  if (provider === 'openai' || provider === 'openrouter') {
    return callOpenAICompatible({ provider, model, apiKey, systemPrompt, messages, temperature, jsonMode, timeoutMs });
  }
  throw new Error(`Unknown provider: ${provider}`);
}
