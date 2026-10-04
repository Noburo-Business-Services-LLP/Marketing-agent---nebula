import { useSyncExternalStore } from 'react';
import { ONBOARDING_STRINGS, type OnboardingLang, type OnboardingStrings } from './onboardingStrings';
import { getOnboardingLang, setOnboardingLang, subscribeOnboardingLang } from './onboardingLangStore';

/** The page's language and its strings. Changing it re-renders everything that reads it. */
export function useOnboardingLang(): { lang: OnboardingLang; t: OnboardingStrings; setLang: (l: OnboardingLang) => void } {
  const lang = useSyncExternalStore(subscribeOnboardingLang, getOnboardingLang, () => 'en' as OnboardingLang);
  return { lang, t: ONBOARDING_STRINGS[lang], setLang: setOnboardingLang };
}
