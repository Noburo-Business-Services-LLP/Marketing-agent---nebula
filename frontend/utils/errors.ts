// Pure helpers so customers never see raw provider text.

export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again later.';

const BLOCKED = /http|gemini|google|ayrshare|openai|razorpay|quota|plan|billing|api key/i;

export function isSafeCustomerMessage(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (!t || t.length > 200) return false;
  return !BLOCKED.test(t);
}

// Shows a server message as is only when it is safe; otherwise a plain sentence.
export function customerMessage(text: unknown, fallback: string = GENERIC_ERROR_MESSAGE): string {
  return isSafeCustomerMessage(text) ? (text as string).trim() : fallback;
}
