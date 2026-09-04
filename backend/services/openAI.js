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

/**
 * The shared text-generation entry point for the whole content/creative
 * pipeline — copy, captions, prompts, scripts. OpenAI first, Gemini only if
 * OpenAI errors or is unconfigured. Lives here, not in geminiAI.js, so it
 * reads as what it is: OpenAI is the primary provider for text, Gemini is
 * the safety net, not the other way around.
 *
 * Deliberately does NOT cover every callGemini() in the codebase — dashboard
 * analytics, social-listening analysis, translation utilities and ICP/
 * strategy generation are a different job (understanding/analyzing existing
 * data) from writing new copy or prompts, and were left on Gemini directly
 * rather than swept in along with this.
 *
 * `jsonMode` must be set correctly by the caller: OpenAI errors on a
 * JSON-mode request whose prompt doesn't itself ask for JSON, so this
 * can't safely guess it from the prompt text.
 */
async function callTextLLM(prompt, { jsonMode = false, maxTokens = 3000, temperature = 0.7, timeout = 120000, skipCache = false } = {}) {
  try {
    return await callOpenAI(prompt, { model: OPENAI_MODEL, temperature, maxTokens, timeout, jsonMode });
  } catch (openAiErr) {
    console.warn(`[TextLLM] OpenAI call failed, falling back to Gemini: ${openAiErr.message}`);
    const { callGemini } = require('./geminiAI');
    return callGemini(prompt, { skipCache });
  }
}

module.exports = {
  callOpenAI,
  callTextLLM
};
