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
  // A caught Error (or any object with a message) is read through its message.
  const value = text && typeof text === 'object' && 'message' in (text as object) ? (text as { message: unknown }).message : text;
  return isSafeCustomerMessage(value) ? (value as string).trim() : fallback;
}

export const SOCIAL_ADDON_MESSAGE = 'This account needs the Publish add-on to connect social accounts.';

// The add-on gate: staff and CSM sessions see the server's real reason (it may say "plan"); customers get one plain sentence.
export function gateMessage(serverMessage: unknown, isStaff: boolean, plain: string = SOCIAL_ADDON_MESSAGE): string {
  if (!isStaff || typeof serverMessage !== 'string') return plain;
  const t = serverMessage.trim();
  return t && t.length <= 200 ? t : plain;
}
