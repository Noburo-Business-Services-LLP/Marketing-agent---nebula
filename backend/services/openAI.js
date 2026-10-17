const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// The writing models. English copy and plans use one, Indian-language copy uses a stronger one; both are settings,
// so a model can be changed without a release. OPENAI_MODEL is left alone for code that names it directly.
const TEXT_MODEL_ENGLISH = () => process.env.TEXT_MODEL_ENGLISH || 'gpt-5.5';
// The creative planning steps (concepts, slide plans, visual systems) have their own setting, because the model that
// plans decides how the pictures look. Copy in a regional language is written by TEXT_MODEL_REGIONAL.
const TEXT_MODEL_PLANNING = () => process.env.TEXT_MODEL_PLANNING || 'gpt-5.5';
const TEXT_MODEL_REGIONAL = () => process.env.TEXT_MODEL_REGIONAL || 'gpt-6.1-sol';
// If the writing model fails, these Gemini models take over (in this order).
const TEXT_BACKUP_MODELS = () => String(process.env.TEXT_BACKUP_MODELS || 'gemini-3.8-flash,gemini-3.7-flash').split(',').map((m) => m.trim()).filter(Boolean);

/** Anything that is not plain English (Tamil, Hindi, Telugu... or a mix with English) is written by the regional model. */
function isRegionalLanguage(language) {
  const c = String(language || '').trim().toLowerCase();
  if (!c) return false;
  if (c === 'english' || c === 'en') return false;
  return true;
}

function textModelFor(language, purpose = '') {
  if (purpose === 'plan') return TEXT_MODEL_PLANNING();
  return isRegionalLanguage(language) ? TEXT_MODEL_REGIONAL() : TEXT_MODEL_ENGLISH();
}

// gpt-4 and older take max_tokens and a temperature; the newer families take max_completion_tokens, a fixed
// temperature, and spend part of that budget thinking.
const isLegacyChatModel = (model) => /^(gpt-3|gpt-4|chatgpt-4o)/.test(String(model || ''));
/** The most output tokens one call can be billed for (thinking tokens included): what is sent as the limit to the provider. */
const maxOutputTokens = (model, maxTokens) => (isLegacyChatModel(model) ? maxTokens : Math.max(maxTokens * 3, 4000));
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
    systemMessage = null,
    onUsage = null
  } = options;

  const messages = [];
  if (systemMessage) {
    messages.push({ role: 'system', content: systemMessage });
  }
  // OpenAI refuses a JSON-mode request whose messages never mention JSON; say so instead of failing over to a weaker model.
  const userText = jsonMode && !/json/i.test(`${systemMessage || ''} ${prompt}`)
    ? `${prompt}\n\nReturn your answer as a single JSON object.`
    : prompt;
  messages.push({ role: 'user', content: userText });

  const legacy = isLegacyChatModel(model);
  const body = { model, messages };
  if (legacy) {
    body.temperature = temperature;
    body.max_tokens = maxTokens;
  } else {
    // Thinking tokens count against this budget, so it is larger than the visible answer needs.
    body.max_completion_tokens = maxOutputTokens(model, maxTokens);
    if (process.env.TEXT_REASONING_EFFORT !== 'off') body.reasoning_effort = process.env.TEXT_REASONING_EFFORT || 'low';
  }
  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }
  // Thinking models are slower than the old ones; give them room.
  const effectiveTimeout = legacy ? timeout : Math.max(timeout, 180000);

  const send = () => fetchWithTimeout(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }, effectiveTimeout);

  let res = await send();
  // A model that does not take reasoning_effort: ask again without it.
  if (!res.ok && res.status === 400 && body.reasoning_effort) {
    const why = await res.clone().text().catch(() => '');
    if (/reasoning_effort|unsupported|not supported/i.test(why)) {
      delete body.reasoning_effort;
      res = await send();
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  const data = await res.json();
  // Report what the provider says it billed, even when the reply is empty (a reasoning model can spend its whole budget thinking).
  if (typeof onUsage === 'function' && data && data.usage) { try { onUsage(data.usage); } catch (_) { /* a reporting callback never breaks the call */ } }
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
 *
 * `noFallback: true` pins the call to `model`: if it fails the error is thrown and Gemini is NOT tried (default false,
 * so every other caller keeps the fallback).
 */
async function callTextLLM(prompt, { jsonMode = false, maxTokens = 3000, temperature = 0.7, timeout = 120000, skipCache = false, language = '', model = '', purpose = '', noFallback = false, onUsage = null } = {}) {
  const chosen = model || textModelFor(language, purpose);
  try {
    return await callOpenAI(prompt, { model: chosen, temperature, maxTokens, timeout, jsonMode, onUsage });
  } catch (openAiErr) {
    // noFallback: the caller pinned this model on purpose (a priced background job); a failure is its to handle, never a second paid call.
    if (noFallback) throw openAiErr;
    console.warn(`[TextLLM] ${chosen} call failed, falling back to Gemini: ${openAiErr.message}`);
    const { callGemini } = require('./geminiAI');
    try {
      return await callGemini(prompt, { skipCache, models: TEXT_BACKUP_MODELS() });
    } catch (geminiErr) {
      // Both writers failed: this is the case customers notice.
      require('./opsAlerts').recordFailure('ai_text', `OpenAI: ${openAiErr.message} | Gemini: ${geminiErr.message}`);
      throw geminiErr;
    }
  }
}

module.exports = {
  maxOutputTokens,
  callOpenAI,
  callTextLLM,
  textModelFor,
  isRegionalLanguage
};
