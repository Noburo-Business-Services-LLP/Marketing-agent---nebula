/**
 * Link and image guards for URLs that come from scraped pages, providers or users.
 * React escapes text, but a `javascript:` or `data:` value in `href` still runs when clicked, so every
 * link built from data goes through `safeHref`, and every picture from third-party data through `safeSrc`.
 */

const CONTROL_OR_SPACE_INSIDE = /[\u0000-\u001f\u007f-\u009f\s\\]/;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]*={0,2}$/i;

function baseOrigin(): string {
  try {
    if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null') return window.location.origin;
  } catch { /* fall through */ }
  return 'http://localhost';
}

/** Returns the normalised http(s) URL, or undefined for anything else (javascript:, data:, vbscript:, file:, blob:, mailto:, tricks). */
export function safeHref(url?: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  const raw = url.trim();
  if (!raw) return undefined;
  // Tabs, newlines, NUL and other control characters are stripped by browsers inside a scheme ("java\tscript:"), so refuse them outright.
  if (/[\u0000-\u001f\u007f-\u009f]/.test(raw)) return undefined;
  // Protocol-relative and backslash forms ("//host", "/\host", "\\host") send the visitor to a host the data chose.
  if (/^[\\/]{2}/.test(raw) || raw.startsWith('\\')) return undefined;
  if (/\s/.test(raw) || raw.includes('\\')) return undefined;
  try {
    const parsed = new URL(raw, baseOrigin());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    if (parsed.username || parsed.password) return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

/** For `<img src>` and `<video src>` from third-party data: http(s), blob:, or a base64 png/jpeg/webp/gif data URL. Never SVG. */
export function safeSrc(url?: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  const raw = url.trim();
  if (!raw) return undefined;
  if (/^data:/i.test(raw)) return DATA_IMAGE.test(raw) ? raw : undefined;
  if (/^blob:/i.test(raw)) {
    if (CONTROL_OR_SPACE_INSIDE.test(raw)) return undefined;
    return /^blob:https?:\/\/[^\s]+$/i.test(raw) ? raw : undefined;
  }
  return safeHref(raw);
}

/** `window.open` for a data-driven URL: opens only a safe URL, always with noopener and noreferrer. Returns false when nothing was opened. */
export function openSafe(url?: unknown, target: string = '_blank'): boolean {
  const safe = safeHref(url) ?? safeSrc(url);
  if (!safe || typeof window === 'undefined') return false;
  window.open(safe, target, 'noopener,noreferrer');
  return true;
}
