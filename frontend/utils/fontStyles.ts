// The Google Fonts stylesheet in index.html starts as media="print" so it never blocks the first paint. This switches it
// on once it has loaded. It used to be an inline onload="this.media='all'" attribute; it lives in the bundle now so the
// page has no inline script left (needed before a strict Content-Security-Policy, see
// docs/superpowers/ops/security-hardening.md). The <noscript> copy in index.html covers browsers without scripts.
export function enableFontStylesheet(doc: Document = document): void {
  const link = doc.getElementById('nb-font-styles') as HTMLLinkElement | null;
  if (!link || link.media === 'all') return;
  const on = () => { link.media = 'all'; };
  // Already loaded (the bundle can run after the stylesheet arrived): .sheet is set then.
  if (link.sheet) { on(); return; }
  link.addEventListener('load', on, { once: true });
}
