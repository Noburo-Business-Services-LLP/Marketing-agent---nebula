/**
 * Builds the Content Strategy PDF from the document the server returns.
 *
 * The AI writes this document with its own inline styling ("make it look premium"), and that styling
 * can break the picture the PDF is made from (a blank PDF was delivered once). So the document is
 * reduced to plain structure first and drawn with our own fixed styling, and a PDF that came out blank
 * is refused instead of saved.
 */

const ALLOWED_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'strong', 'b', 'em', 'i', 'br', 'div', 'span']);
const KEEP_ATTRS = ['colspan', 'rowspan'];

/** Keeps headings, paragraphs, lists and tables; drops scripts, styles, classes, images and every other attribute. */
export function sanitizeStrategyHtml(input: string): string {
  let html = String(input || '');
  html = html.replace(/```(?:html)?/gi, '');
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<(script|style|iframe|object|embed|svg|noscript|head)\b[\s\S]*?<\/\1\s*>/gi, '');
  html = html.replace(/<!doctype[^>]*>/gi, '');
  html = html.replace(/<\/?(html|body)\b[^>]*>/gi, '');
  html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match, tag: string, attrs: string) => {
    const name = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return '';
    if (match.startsWith('</')) return `</${name}>`;
    const kept = KEEP_ATTRS
      .map((a) => { const m = new RegExp(`\\b${a}\\s*=\\s*["']?(\\d{1,2})["']?`, 'i').exec(attrs || ''); return m ? ` ${a}="${m[1]}"` : ''; })
      .join('');
    return `<${name}${kept}>`;
  });
  return html.trim();
}

/** Share of pixels that are not near-white, from RGBA data. A readable page has at least a fraction of a percent. */
export function nonWhiteShare(data: ArrayLike<number>): number {
  let dark = 0;
  const pixels = Math.floor(data.length / 4);
  if (pixels === 0) return 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 215 || data[i + 1] < 215 || data[i + 2] < 215) dark += 1;
  }
  return dark / pixels;
}

export const MIN_INK_SHARE = 0.004;

const PAGE_WIDTH_PT = 595.28;
const PAGE_HEIGHT_PT = 841.89;
const MARGIN_PT = 36;

const STYLE = `
  .nb-strategy { background:#ffffff; color:#1f2937; font-family: Inter, Arial, sans-serif; font-size:13px; line-height:1.5; padding:0; }
  .nb-strategy h1 { font-size:24px; margin:0 0 12px; color:#111827; }
  .nb-strategy h2 { font-size:18px; margin:22px 0 8px; color:#111827; }
  .nb-strategy h3, .nb-strategy h4 { font-size:15px; margin:16px 0 6px; color:#111827; }
  .nb-strategy p { margin:0 0 10px; }
  .nb-strategy ul, .nb-strategy ol { margin:0 0 12px; padding-left:20px; }
  .nb-strategy li { margin-bottom:4px; }
  .nb-strategy table { width:100%; border-collapse:collapse; margin:8px 0 16px; font-size:12px; }
  .nb-strategy th, .nb-strategy td { border:1px solid #d1d5db; padding:6px 8px; text-align:left; vertical-align:top; }
  .nb-strategy th { background:#f3f4f6; font-weight:700; }
`;

/** Returns the finished PDF. Throws when the page could not be drawn or came out blank. */
export async function buildStrategyPdf(html: string): Promise<Blob> {
  const clean = sanitizeStrategyHtml(html);
  if (clean.replace(/<[^>]*>/g, '').trim().length < 40) throw new Error('The strategy document was empty.');

  const [{ jsPDF }, h2cModule] = await Promise.all([import('jspdf'), import('html2canvas')]);
  const html2canvas: any = (h2cModule as any).default || h2cModule;

  const wrap = document.createElement('div');
  wrap.setAttribute('aria-hidden', 'true');
  // On screen but behind the page, at a fixed width, so the browser lays it out and paints it for real.
  wrap.style.cssText = 'position:fixed;left:0;top:0;width:595px;z-index:-1;pointer-events:none;background:#ffffff;';
  wrap.innerHTML = `<style>${STYLE}</style><div class="nb-strategy" style="width:523px;margin:0 36px;padding:36px 0;">${clean}</div>`;
  document.body.appendChild(wrap);

  try {
    const canvas: HTMLCanvasElement = await html2canvas(wrap, { backgroundColor: '#ffffff', scale: 2, windowWidth: 595, useCORS: false, logging: false });
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('The page could not be drawn.');
    const sample = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    if (nonWhiteShare(sample) < MIN_INK_SHARE) throw new Error('The strategy page came out blank.');

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pxPerPt = canvas.width / PAGE_WIDTH_PT;
    const pagePx = Math.floor(PAGE_HEIGHT_PT * pxPerPt);
    const pages = Math.max(1, Math.ceil(canvas.height / pagePx));
    for (let p = 0; p < pages; p++) {
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = Math.min(pagePx, canvas.height - p * pagePx);
      const sctx = slice.getContext('2d');
      if (!sctx) throw new Error('The page could not be drawn.');
      sctx.fillStyle = '#ffffff';
      sctx.fillRect(0, 0, slice.width, slice.height);
      sctx.drawImage(canvas, 0, p * pagePx, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
      if (p > 0) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, PAGE_WIDTH_PT, slice.height / pxPerPt);
    }
    return pdf.output('blob');
  } finally {
    document.body.removeChild(wrap);
  }
}
