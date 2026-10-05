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

const NAMES: Record<string, string> = {
  english: 'English', tamil: 'Tamil', telugu: 'Telugu', hindi: 'Hindi', kannada: 'Kannada',
  malayalam: 'Malayalam', marathi: 'Marathi', bengali: 'Bengali', gujarati: 'Gujarati',
  punjabi: 'Punjabi', odia: 'Odia', urdu: 'Urdu',
};

/** English display name of a language code or of a draft's language value ('English', 'tamil'). */
export const languageName = (code?: string | null): string => NAMES[baseOf(code)] || '';

export interface LanguageChoice { code: string; name: string; created: boolean }

/**
 * What the "Add languages" menu offers for one draft: the client's own extra languages first,
 * then the remaining base languages. The draft's own language is never offered; a language that
 * already has a version is marked created.
 */
export const languageChoices = (input: { additional?: string[]; draftLanguage?: string | null; created?: string[] }) => {
  const own = baseOf(input.draftLanguage);
  const created = input.created || [];
  const make = (code: string): LanguageChoice => ({ code, name: NAMES[code] || code, created: created.includes(code) });
  const mine = cleanSelection(input.additional, own).map(make);
  const mineCodes = mine.map((m) => m.code);
  const other = BASE_LANGUAGE_CODES.filter((c) => c !== own && !mineCodes.includes(c)).map(make);
  return { mine, other };
};

type VariantLike = { _id?: string; languageVariantOf?: string | null; language?: string };

/** The language versions made from one draft. */
export const versionsOf = <T extends VariantLike>(rows: T[], draftId?: string | null): T[] =>
  (Array.isArray(rows) ? rows : []).filter((r) => r && r.languageVariantOf && String(r.languageVariantOf) === String(draftId));

/** "Kannada version" for a language version, otherwise an empty string. */
export const variantLabel = (draft?: VariantLike | null): string =>
  draft && draft.languageVariantOf && languageName(draft.language) ? `${languageName(draft.language)} version` : '';
