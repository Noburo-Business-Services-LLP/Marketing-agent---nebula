import type { OnboardingLang } from './onboardingStrings';

/**
 * The one language choice for the sign-up page, kept outside React so the step
 * guide, the questions and the pictures beside them all follow one switcher.
 * It is remembered in the browser; if the browser blocks storage, the choice
 * still works until the page is closed.
 */

/** Same key the step guide has always used, so an earlier choice is kept. */
export const LANG_STORAGE_KEY = 'nebulaa_onboarding_lang';

function isLang(v: unknown): v is OnboardingLang {
  return v === 'en' || v === 'ta' || v === 'hi';
}

function readStored(): OnboardingLang {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    if (isLang(v)) return v;
  } catch {}
  return 'en';
}

let current: OnboardingLang | null = null;
const listeners = new Set<() => void>();

export function getOnboardingLang(): OnboardingLang {
  if (current === null) current = readStored();
  return current;
}

export function setOnboardingLang(l: OnboardingLang) {
  current = l;
  try { localStorage.setItem(LANG_STORAGE_KEY, l); } catch {}
  listeners.forEach((fn) => fn());
}

export function subscribeOnboardingLang(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** For tests: forget the in-memory choice so the next read goes to storage. */
export function resetOnboardingLangForTest() {
  current = null;
}
