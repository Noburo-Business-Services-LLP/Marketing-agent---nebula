// Pure rules for the extra post languages a client can add. No I/O here.
const BASE_LANGUAGES = [
  'english', 'tamil', 'telugu', 'hindi', 'kannada', 'malayalam',
  'marathi', 'bengali', 'gujarati', 'punjabi', 'odia', 'urdu',
];
const MAX_ADDITIONAL_LANGUAGES = 3;
const MIX_SUFFIX = '_english_mix';

const LABELS = {
  english: 'English', tamil: 'Tamil', telugu: 'Telugu', hindi: 'Hindi',
  kannada: 'Kannada', malayalam: 'Malayalam', marathi: 'Marathi', bengali: 'Bengali',
  gujarati: 'Gujarati', punjabi: 'Punjabi', odia: 'Odia', urdu: 'Urdu',
};

function baseOf(contentLanguage) {
  const value = String(contentLanguage || '').trim().toLowerCase();
  return value.endsWith(MIX_SUFFIX) ? value.slice(0, -MIX_SUFFIX.length) : value;
}

function isBaseLanguage(code) {
  return BASE_LANGUAGES.includes(String(code || ''));
}

function sanitizeAdditionalLanguages(list, primary) {
  if (!Array.isArray(list)) return [];
  const primaryBase = baseOf(primary);
  const out = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const code = item.trim().toLowerCase();
    if (!isBaseLanguage(code) || code === primaryBase || out.includes(code)) continue;
    out.push(code);
    if (out.length === MAX_ADDITIONAL_LANGUAGES) break;
  }
  return out;
}

function languageLabel(code) {
  return LABELS[baseOf(code)] || '';
}

module.exports = {
  BASE_LANGUAGES, MAX_ADDITIONAL_LANGUAGES, baseOf, isBaseLanguage,
  sanitizeAdditionalLanguages, languageLabel,
};
