'use strict';
// The prompt for one designed page: a shared style (so all pages match), the exact text, and what to draw.
// The model is told to print only the given lines and to leave a corner empty for the real logo.

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

/** One style paragraph shared by every page of one Blueprint, so the pages look like one document. */
function buildStyleSpec({ businessName, industry, colours = [] } = {}) {
  const hexes = (colours || []).map((c) => (c && c.hex) || c).filter((h) => /^#[0-9a-f]{6}$/i.test(String(h)));
  const palette = hexes.length
    ? `Brand colours: ${hexes.slice(0, 3).join(', ')}. Build the whole design around them, with a warm off-white or very dark navy as the base.`
    : 'Use one confident colour family with a warm off-white or very dark navy as the base.';
  const sector = clean(industry) ? ` for a ${clean(industry)} business` : '';
  return [
    `A single page of a premium brand-strategy proposal${sector}${businessName ? ` called ${clean(businessName)}` : ''}, in the style of a modern agency pitch deck: an infographic poster with cards, icons, arrows and step flows.`,
    palette,
    'Lettering: a bold, characterful display face for the headline and a clean sans-serif for body text; the same lettering on every page. Generous spacing, strong hierarchy, easy to read at a glance.',
    'Where people appear, make them look real and natural (a photograph look), diverse and friendly. Never a celebrity, never a real customer.',
  ].join(' ');
}

/** The full prompt for one page of the deck. */
function buildPagePrompt(page, style) {
  const p = page || {};
  const lines = (p.lines || []).map(clean).filter(Boolean);
  const textPart = lines.length
    ? `TEXT TO PRINT (spell every character exactly as written, and print nothing else, no other words, numbers, names or logos):\n${lines.map((l, i) => `${i + 1}. "${l}"`).join('\n')}`
    : 'Print only the heading. No other words or numbers.';
  const head = p.kind === 'cover'
    ? `COVER PAGE. The big headline is the business name "${clean(p.title)}", with the small label "${clean(p.kicker)}" above it.`
    : p.kind === 'closing'
      ? `CLOSING PAGE. The big heading is "${clean(p.title)}" and the small line "${clean(p.kicker)}". Show the contact lines below as clear separate cards.`
      : `CONTENT PAGE. The page heading is "${clean(p.title)}" and the small label above it is "${clean(p.kicker)}".`;
  return [
    clean(style),
    head,
    textPart,
    `WHAT TO DRAW: ${clean(p.visual) || 'a clean infographic that fits the text'}. One idea only, with the text above carried by cards or panels that suit it.`,
    'LAYOUT RULES: portrait page. Keep the top-left corner (about 18 percent of the width and 8 percent of the height) completely empty and calm, because the real logo is added there afterwards. Keep the bottom 6 percent of the page empty, because a footer is added there. Do not draw any logo, watermark, page number, or the words "Prepared by".',
  ].join('\n\n');
}

module.exports = { buildStyleSpec, buildPagePrompt };
