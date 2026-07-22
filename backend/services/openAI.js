const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

function fetchWithTimeout(url, opts = {}, timeoutMs = 90000) {
  return new Promise(async (resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      resolve(res);
    } catch (err) {
      reject(err);
    } finally {
      clearTimeout(timer);
    }
  });
}

async function callOpenAI(prompt, options = {}) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const {
    temperature = 0.7,
    maxTokens = 2500,
    timeout = 90000,
    model = OPENAI_MODEL,
    jsonMode = false,
    systemMessage = null
  } = options;

  const messages = [];
  if (systemMessage) {
    messages.push({ role: 'system', content: systemMessage });
  }
  messages.push({ role: 'user', content: prompt });

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens
  };
  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetchWithTimeout(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }, timeout);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI returned empty content');
  }
  return content;
}

module.exports = {
  callOpenAI
};
