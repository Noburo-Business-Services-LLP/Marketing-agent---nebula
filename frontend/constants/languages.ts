/**
 * Content languages the product supports.
 *
 * Kept in one place because Settings and Onboarding both offer this choice,
 * and the backend enum has to agree with both. Every regional language can be
 * used on its own or blended with English inside each post.
 */
export const CONTENT_LANGUAGES: { value: string; label: string }[] = [
  { value: 'english', label: 'English' },
  { value: 'tamil', label: 'Tamil' },
  { value: 'telugu', label: 'Telugu' },
  { value: 'hindi', label: 'Hindi' },
  { value: 'kannada', label: 'Kannada' },
  { value: 'malayalam', label: 'Malayalam' },
  { value: 'marathi', label: 'Marathi' },
  { value: 'bengali', label: 'Bengali' },
  { value: 'gujarati', label: 'Gujarati' },
  { value: 'punjabi', label: 'Punjabi' },
  { value: 'odia', label: 'Odia' },
  { value: 'urdu', label: 'Urdu' },
  { value: 'tamil_english_mix', label: 'Tamil + English mix' },
  { value: 'telugu_english_mix', label: 'Telugu + English mix' },
  { value: 'hindi_english_mix', label: 'Hindi + English mix' },
  { value: 'kannada_english_mix', label: 'Kannada + English mix' },
  { value: 'malayalam_english_mix', label: 'Malayalam + English mix' },
  { value: 'marathi_english_mix', label: 'Marathi + English mix' },
  { value: 'bengali_english_mix', label: 'Bengali + English mix' },
  { value: 'gujarati_english_mix', label: 'Gujarati + English mix' },
  { value: 'punjabi_english_mix', label: 'Punjabi + English mix' },
  { value: 'odia_english_mix', label: 'Odia + English mix' },
  { value: 'urdu_english_mix', label: 'Urdu + English mix' }
];
