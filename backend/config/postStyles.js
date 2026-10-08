/**
 * Post styles: how a designed social post should look. "plain" keeps today's behaviour (a lit photo with
 * little or no text). Every other style asks for a finished, Instagram-ready design with real text on it.
 * The wording is provider-agnostic; it is appended to the image prompt for whichever image model runs.
 */
const POST_STYLES = [
  { id: 'plain', label: 'Plain photo', blurb: 'A clean, well lit photo with little or no text.' },
  { id: 'minimal', label: 'Minimal showcase', blurb: 'One product, lots of space, a short headline.',
    layout: 'Minimal product showcase: one hero product on a clean seamless background with generous empty space and a soft natural shadow. A short, elegant headline and a small line for the brand. Calm, premium, uncluttered; two or three colours at most.' },
  { id: 'offer', label: 'Offer poster', blurb: 'A bold offer, prices and a contact strip.',
    layout: 'Offer poster: a bold headline on a decorative ribbon or banner at the top, the offer shown large and unmissable in a burst, badge or ribbon, the products arranged below in a styled setting, price tags on the products when prices are given, and a contact strip along the bottom. High contrast, energetic, easy to read on a phone.' },
  { id: 'celebration', label: 'Festive celebration', blurb: 'Rich, warm and celebratory for festivals and sales.',
    layout: 'Festive celebration design: rich warm colours, gold accents, lamps, flowers or festive props, a celebratory headline inside a decorative ribbon, the products shown inside a warm festive setting, sparkle and soft glow. Joyful and premium, never cluttered.' },
  { id: 'catalogue', label: 'Range catalogue', blurb: 'Everything you sell, with category icons.',
    layout: 'Range catalogue design: a strong headline at the top, a row of three or four category icons each with a short label, a styled scene that shows the range together, a short tagline such as "all under one roof", and an address and phone strip at the bottom. Organised, trustworthy, rich in detail.' },
  { id: 'announcement', label: 'Announcement', blurb: 'New arrival, opening or timing change.',
    layout: 'Announcement design: a clear typographic layout with one big message, a supporting image or product beside or behind it, a small badge such as NEW or OPEN, and the key details underneath. Clean, modern and confident.' },
];

const BY_ID = new Map(POST_STYLES.map((s) => [s.id, s]));
const DEFAULT_POST_STYLE = 'plain';

const isPostStyle = (id) => typeof id === 'string' && BY_ID.has(id);

const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, n);

/** The details a post may show. Only what the person typed; nothing is ever invented. */
function normalisePostDetails(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const items = String(r.items == null ? '' : r.items).split('\n').map((l) => clean(l, 80)).filter(Boolean).slice(0, 12);
  return {
    headline: clean(r.headline, 90),
    offer: clean(r.offer, 120),
    items,
    phone: clean(r.phone, 60),
    address: clean(r.address, 200),
    hours: clean(r.hours, 80),
    tagline: clean(r.tagline, 80),
  };
}

const hasDetails = (d) => Boolean(d.headline || d.offer || d.items.length || d.phone || d.address || d.hours || d.tagline);

/**
 * The paragraph added to the image prompt for a style. The text lines are exact, so the model spells them
 * as given; it is told not to add any other wording, numbers, prices or contact details.
 */
function buildStyleDirective(styleId, rawDetails, { language = 'English' } = {}) {
  const style = BY_ID.get(styleId);
  if (!style || !style.layout) return '';
  const d = normalisePostDetails(rawDetails);
  const lines = [];
  if (d.headline) lines.push(`Headline: "${d.headline}"`);
  if (d.offer) lines.push(`Offer: "${d.offer}"`);
  if (d.items.length) lines.push(`Items and prices, one per line: ${d.items.map((i) => `"${i}"`).join('; ')}`);
  if (d.tagline) lines.push(`Tagline: "${d.tagline}"`);
  if (d.phone) lines.push(`Phone: "${d.phone}"`);
  if (d.address) lines.push(`Address: "${d.address}"`);
  if (d.hours) lines.push(`Opening hours: "${d.hours}"`);
  const textPart = lines.length
    ? `TEXT TO SHOW ON THE DESIGN (spell every character exactly as written, in ${language} where it is words, and write nothing else). The words before each colon below only tell you what the text is for: never print those words themselves, print only what is inside the quotation marks, and add an icon (a phone, a map pin, a clock) beside contact lines instead of a label:\n${lines.join('\n')}\nDo not invent any other words, numbers, prices, discounts, phone numbers or addresses.`
    : `No exact text was supplied. Use at most a short headline of a few words in ${language} that fits the idea, and do not show any prices, phone numbers or addresses.`;
  return `DESIGN TREATMENT: this is a finished, Instagram-ready social media post design, not a plain photograph. ${style.layout}\n${textPart}\nThe artwork must look professionally designed, with a clear visual hierarchy, a limited colour palette that follows the brand colours, and text that is large, sharp and fully readable with no cut-off letters.`;
}

module.exports = { POST_STYLES, DEFAULT_POST_STYLE, isPostStyle, normalisePostDetails, hasDetails, buildStyleDirective };
