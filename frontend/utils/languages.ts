// Pure helpers for choosing the extra post languages. No React, no browser APIs.

export const BASE_LANGUAGE_CODES = [
  'english', 'tamil', 'telugu', 'hindi', 'kannada', 'malayalam',
  'marathi', 'bengali', 'gujarati', 'punjabi', 'odia', 'urdu',
] as const;

export const MAX_ADDITIONAL_LANGUAGES = 3;

const MIX_SUFFIX = '_english_mix';

/** 'tamil_english_mix' -> 'tamil'. */
export const baseOf = (contentLanguage?: string | null): string => {
  const value = String(contentLanguage || '').trim().toLowerCase();
  return value.endsWith(MIX_SUFFIX) ? value.slice(0, -MIX_SUFFIX.length) : value;
};

/** Base languages that can be added: every base language except the primary's own. */
export const availableOptions = (primary?: string | null): string[] => {
  const own = baseOf(primary);
  return BASE_LANGUAGE_CODES.filter((code) => code !== own);
};

/** Selected codes that are still allowed for this primary, deduplicated, capped at three. */
export const cleanSelection = (value: unknown, primary?: string | null): string[] => {
  if (!Array.isArray(value)) return [];
  const allowed = availableOptions(primary);
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && allowed.includes(item) && !out.includes(item)) out.push(item);
    if (out.length === MAX_ADDITIONAL_LANGUAGES) break;
  }
  return out;
};

/** Adds the code, or removes it when already chosen. A fourth language is not added. */
export const toggleLanguage = (selected: string[], code: string, primary?: string | null): string[] => {
  const current = cleanSelection(selected, primary);
  if (current.includes(code)) return current.filter((c) => c !== code);
  if (!availableOptions(primary).includes(code) || current.length >= MAX_ADDITIONAL_LANGUAGES) return current;
  return [...current, code];
};

export const isAtCap = (selected: string[]): boolean =>
  Array.isArray(selected) && selected.length >= MAX_ADDITIONAL_LANGUAGES;
