/**
 * Shared list of Gemini TEXT models (image models are NOT handled here).
 *
 * Google retires text models for new accounts ("is no longer available to new users"),
 * so the list is configurable and models that are gone are remembered for the life of the process.
 *
 *   GEMINI_TEXT_MODELS   comma separated, first is tried first; replaces the default list
 *   GEMINI_PRO_MODEL     the "pro" model slot in the default list (default gemini-2.5-pro)
 */

const CURRENT_LITE_MODEL = 'gemini-3.5-flash-lite';
const LEGACY_FLASH_MODEL = 'gemini-2.5-flash';
const LEGACY_FLASH_LITE_MODEL = 'gemini-2.5-flash-lite';

// Models the provider said are gone. Never expires: a retired model does not come back.
const retired = new Set();

function getPrimaryModel() {
  return process.env.GEMINI_PRO_MODEL || 'gemini-2.5-pro';
}

function dedupe(list) {
  return list.filter((m, i) => m && list.indexOf(m) === i);
}

function configuredModels() {
  const raw = process.env.GEMINI_TEXT_MODELS;
  if (typeof raw !== 'string') return [];
  return dedupe(raw.split(',').map((m) => m.trim()));
}

/**
 * The ordered list of text models to try. Retired models are left out unless that would leave nothing.
 * withPrimary: include the pro model slot (the router does; cheap one-shot helpers do not).
 */
function getTextModelChain({ withPrimary = true } = {}) {
  const configured = configuredModels();
  let chain;
  if (configured.length > 0) {
    chain = configured;
  } else {
    chain = withPrimary
      ? dedupe([CURRENT_LITE_MODEL, getPrimaryModel(), LEGACY_FLASH_MODEL, LEGACY_FLASH_LITE_MODEL])
      : dedupe([CURRENT_LITE_MODEL, LEGACY_FLASH_LITE_MODEL, LEGACY_FLASH_MODEL]); // light helpers stay cheap
  }
  const live = chain.filter((m) => !retired.has(m));
  return live.length > 0 ? live : chain;
}

/**
 * True when the failure means this model is gone or not for us: not found, or "no longer available to new users".
 * Quota (429) is NOT permanent; see isModelUnavailableError in the router for the temporary cases.
 */
function isModelRetiredError(status, bodyText) {
  const text = String(bodyText || '');
  if (Number(status) === 404) return true;
  return /no longer available|is not found|not found for API version|NOT_FOUND|is not supported for generateContent/i.test(text);
}

function markModelRetired(model) {
  if (model) retired.add(model);
}

function isModelRetired(model) {
  return retired.has(model);
}

function _resetRetiredModels() {
  retired.clear();
}

module.exports = {
  CURRENT_LITE_MODEL,
  getPrimaryModel,
  getTextModelChain,
  isModelRetiredError,
  markModelRetired,
  isModelRetired,
  _resetRetiredModels
};
