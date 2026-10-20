/**
 * The one place HTML written by the AI (or any user text) is cleaned before it is put into the page.
 * DOMPurify does the work; this file only holds the allowed tags and attributes and the settings.
 * Everything else is dropped: scripts, styles, event handlers, links, images, classes, ids, data- and aria- attributes.
 */
import DOMPurify from 'dompurify';

export const STRATEGY_ALLOWED_TAGS = ['h1', 'h2', 'h3', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br'] as const;
export const STRATEGY_ALLOWED_ATTR = ['colspan', 'rowspan'] as const;

/** Spelled out even though ALLOWED_ATTR already excludes them, so a later edit cannot let them through by accident. */
const FORBIDDEN_ATTR = ['style', 'class', 'id', 'href', 'src', 'srcset', 'action', 'formaction', 'xlink:href', 'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus'];
const FORBIDDEN_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'input', 'button', 'link', 'meta', 'base', 'img', 'video', 'audio', 'a', 'template', 'noscript'];

type Purifier = {
  isSupported: boolean;
  sanitize: (dirty: string, cfg: Record<string, unknown>) => unknown;
  addHook: (name: string, fn: (node: any, data: any) => void) => void;
};

/** A cell span is a small whole number or it goes. */
function spanHook(_node: unknown, data: { attrName?: string; attrValue?: string; keepAttr?: boolean }) {
  if ((data.attrName === 'colspan' || data.attrName === 'rowspan') && !/^\d{1,2}$/.test(String(data.attrValue || '').trim())) data.keepAttr = false;
}

/** Builds a cleaner around any DOMPurify instance (the browser one in the app, a jsdom one in the tests). */
export function createStrategySanitizer(purify: Purifier): (input: unknown) => string {
  purify.addHook('uponSanitizeAttribute', spanHook);
  return (input: unknown): string => {
    if (!purify.isSupported) return ''; // no DOM to clean with: show nothing rather than something unchecked
    // Code fences around the HTML are plain text from the AI, not markup.
    const text = String(input ?? '').replace(/```(?:html)?/gi, '');
    const clean = purify.sanitize(text, {
      ALLOWED_TAGS: [...STRATEGY_ALLOWED_TAGS],
      ALLOWED_ATTR: [...STRATEGY_ALLOWED_ATTR],
      FORBID_TAGS: FORBIDDEN_TAGS,
      FORBID_ATTR: FORBIDDEN_ATTR,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      ALLOW_UNKNOWN_PROTOCOLS: false,
      KEEP_CONTENT: true,
      RETURN_DOM: false,
      RETURN_DOM_FRAGMENT: false,
      RETURN_TRUSTED_TYPE: false,
    });
    return String(clean).trim();
  };
}

let appSanitizer: ((input: unknown) => string) | null = null;

/** Keeps headings, paragraphs, lists and tables; drops everything else. Safe to call on any text. */
export function sanitizeStrategyHtml(input: unknown): string {
  if (!appSanitizer) {
    if (typeof window === 'undefined') return '';
    appSanitizer = createStrategySanitizer((DOMPurify as any)(window));
  }
  return appSanitizer(input);
}
