/**
 * The default way a single post's picture is made: the person's own brief, a few real brand facts and the
 * logo go straight to the image model in one request, the way a person would ask ChatGPT. The model does the
 * design. This replaced a chain of rewriting steps that turned briefs into mood pictures and lost the offer.
 *
 * Rules that keep it honest: only supplied details are printed (no invented phone numbers, prices or claims),
 * and a quick read of the finished picture checks that the numbers in the brief really appear on it.
 * Set IMAGE_MODE=pipeline to go back to the older chain.
 */
const LANGUAGE_WORDS = {
  english: 'English',
  tamil: 'Tamil (Tamil script)',
  hindi: 'Hindi (Devanagari script)',
  telugu: 'Telugu (Telugu script)',
  kannada: 'Kannada (Kannada script)',
  malayalam: 'Malayalam (Malayalam script)',
};

const SCRIPTS = {
  tamil: /[\u0B80-\u0BFF]/, hindi: /[\u0900-\u097F]/, telugu: /[\u0C00-\u0C7F]/, kannada: /[\u0C80-\u0CFF]/, malayalam: /[\u0D00-\u0D7F]/,
};
const ANY_INDIC = /[\u0900-\u0D7F]/;

/** { base, mix } from a language value such as "tamil", "Tamil", "tamil_english_mix" or "Tamil + English". */
function languageKind(code) {
  const c = String(code || 'english').toLowerCase();
  const mix = /mix|\+|&/.test(c) && /english/.test(c) || c.endsWith('_english_mix');
  const base = Object.keys(SCRIPTS).find((k) => c.includes(k)) || 'english';
  return { base, mix };
}

/**
 * Does a headline written by an earlier step contradict the language chosen? Plain Tamil with an all-English
 * headline, or plain English with a Tamil one. A mix accepts either. A mismatch means the words are treated as
 * the idea to express in the right language, not as exact text to copy.
 */
function textMismatchesLanguage(text, code) {
  const t = String(text || '');
  if (!t.trim()) return false;
  const { base, mix } = languageKind(code);
  if (mix) return false;
  if (base === 'english') return ANY_INDIC.test(t);
  return !SCRIPTS[base].test(t);
}

function languageWords(code) {
  const c = String(code || 'english').toLowerCase();
  if (c.endsWith('_english_mix')) {
    const base = LANGUAGE_WORDS[c.replace('_english_mix', '')] || c.replace('_english_mix', '');
    return `a natural mix of ${base} and English words`;
  }
  return LANGUAGE_WORDS[c] || String(code || 'English');
}

/** A plain colour name for a hex code, so the picture is told "deep navy blue" and never has a code to print. */
function hexToName(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return 'a brand colour';
  const r = parseInt(h.slice(0, 2), 16) / 255; const g = parseInt(h.slice(2, 4), 16) / 255; const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const l = (max + min) / 2; const d = max - min;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let hue = 0;
  if (d) {
    if (max === r) hue = ((g - b) / d) % 6; else if (max === g) hue = (b - r) / d + 2; else hue = (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
  }
  if (l < 0.1) return 'near-black';
  if (l > 0.93) return 'off-white';
  const tone = l < 0.3 ? 'deep ' : (l > 0.75 ? 'soft ' : '');
  if (sat < 0.12) return l < 0.35 ? 'charcoal grey' : (l > 0.7 ? 'light grey' : 'grey');
  let name;
  if (hue < 15 || hue >= 345) name = 'red'; else if (hue < 40) name = l > 0.7 ? 'peach' : 'orange'; else if (hue < 65) name = l > 0.7 ? 'cream' : 'golden yellow';
  else if (hue < 165) name = 'green'; else if (hue < 195) name = 'teal'; else if (hue < 255) name = l < 0.3 ? 'navy blue' : 'blue';
  else if (hue < 290) name = 'purple'; else name = 'magenta pink';
  return `${tone}${name}`.replace('deep navy blue', 'deep navy blue');
}

/** Colour codes in free text become colour names, so no code can end up printed on a picture. */
function humanizeColours(text) {
  return String(text == null ? '' : text).replace(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g, (_, hex) => hexToName(hex));
}

const tidy = (v) => humanizeColours(String(v == null ? '' : v)).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const ASPECT_WORDS = { '1:1': 'square', '4:5': '4:5 portrait', '9:16': '9:16 vertical story', '16:9': '16:9 landscape', '3:4': '3:4 portrait' };

const DENSITY_TEXT = {
  clean: 'It must work as an Instagram post seen on a phone while scrolling, and it must feel calm, simple and uncluttered. Use a plain, even background in one or two brand colours. One single focal subject (a real person, the product, or the shop itself), large and well lit. One short bold headline of at most six words, with a lot of empty space around it. At most one small supporting line and the logo. No scattered props, no sticky notes, no tags, no collage, no patterns, no frames, no icons, no lists. Simple does not mean a blank card: the subject must be vivid. Friendly and commercial, not abstract or editorial. No watermarks.',
  balanced: 'It must work as an Instagram post seen on a phone while scrolling: one clear focal subject (a real person, the product, or the shop itself), vivid warm colour with strong contrast, one bold headline, the offer or message stated plainly, and supporting details such as icons, badges or a short list where they help. Fill the frame with content and never leave large empty blocks or an empty card. Polished and professional, but friendly and commercial, not minimalist, abstract or editorial. No watermarks.',
  rich: 'It must work as an Instagram post seen on a phone while scrolling, and it should feel rich, festive and full: layered props and patterns, badges, icons, tags and several supporting elements around a strong focal subject, like a lively shop-front poster. Keep the headline dominant and fully readable, and keep every word spelled correctly. Friendly and commercial. No watermarks.',
};
const densityText = (d) => DENSITY_TEXT[String(d || '').toLowerCase()] || DENSITY_TEXT.balanced;

/** The one request sent to the image model. Plain language, no rule lists. */
function buildDirectPrompt({ brief, brand = {}, language, aspectRatio, hasLogo, noLogo, logoCorner = '', details = {}, designText = '', reserve = '', productCount = 0, series = null, variety = false, imageText = '', hasEnvironment = false, hasContinuity = false, density = 'balanced' }) {
  const lines = [];
  const kind = tidy(brand.industry) || 'local business';
  lines.push(`Create a finished, professional social media post (${ASPECT_WORDS[aspectRatio] || '4:5 portrait'}) for ${tidy(brand.name) || 'the business'}, a ${kind} business${tidy(brand.location) ? ' in ' + tidy(brand.location) : ''}.`);
  lines.push(`What the post is about: ${tidy(brief)}`);
  if (series) {
    lines.push(`This picture is ${tidy(series.label) || 'one'} of a connected series that is posted together${series.role ? ` (its job in the story: ${tidy(series.role)})` : ''}. The whole series shares one look${tidy(series.concept) ? `: ${tidy(series.concept)}` : ''}${tidy(series.visualSystem) ? ` Visual system: ${tidy(series.visualSystem)}` : ''}${tidy(series.mechanism) ? ` Recurring device: ${tidy(series.mechanism)}` : ''} Keep the same palette, type style and design language so the pictures clearly belong together, while each one has its own composition.`);
  }
  if (series && variety) lines.push('No decorative light streaks, glowing lines, beams, lens flares or diagonal stripes across the picture unless the brief asks for them. Each post in this series goes out on a different day, so this one must have its own scene, subject and composition: do not reuse the same person, room, landmark or layout as the others. Share only the palette, type style and brand feel.');
  if (tidy(imageText)) {
    if (textMismatchesLanguage(imageText, language)) {
      // An earlier step wrote the headline in the wrong language. Keep its meaning, say it in the chosen language.
      lines.push(`The headline should express this idea: "${tidy(imageText)}". Write it naturally in ${languageWords(language)}, in that language only, and do not leave it in another language.`);
    } else {
      lines.push(`Show this text on the picture exactly, spelled character for character: "${tidy(imageText)}". Do not add other headline wording.`);
    }
  }
  const lang = languageKind(language);
  if (!lang.mix && lang.base !== 'english') lines.push('Use no English words except brand names, product names and unavoidable terms.');
  if (!lang.mix && lang.base === 'english') lines.push('Use no words from other languages.');
  if (tidy(brand.about)) lines.push(`About the business: ${tidy(brand.about).slice(0, 300)}`);
  if (brand.colours && brand.colours.length) lines.push(`Brand colours to lean on: ${brand.colours.map((c) => hexToName(c)).join(', ')}.`);
  lines.push(`All words on the image must be in ${languageWords(language)}, spelled correctly, in large readable type.`);
  const facts = [];
  if (details.headline) facts.push(`headline "${details.headline}"`);
  if (details.offer) facts.push(`offer "${details.offer}"`);
  if (details.phone) facts.push(`phone number "${details.phone}"`);
  if (details.address) facts.push(`address "${details.address}"`);
  if (details.hours) facts.push(`opening hours "${details.hours}"`);
  if (brand.website) facts.push(`website "${brand.website}"`);
  if (facts.length) lines.push(`Show these exact details, spelled character for character: ${facts.join('; ')}.`);
  lines.push('Use only the details given here. Do not invent phone numbers, addresses, websites, prices, discounts, years, customer counts or claims. If a detail is not given, leave that space out. Colours, styles and instructions are not words: never print colour codes, hex values, reference numbers, ids, dates or times on the picture unless they are in the exact details above.');
  if (logoCorner) lines.push(`Keep the ${String(logoCorner).replace('-', ' ')} corner of the picture calm and free of text or important detail: the real business logo is placed there afterwards. Do not draw any logo, brand mark or emblem yourself.`);
  else if (hasLogo) lines.push('The first attached picture is the business logo. Place it cleanly in one corner exactly as it is, with its colours and lettering unchanged, and do not draw any other logo or brand mark.');
  else if (noLogo) lines.push('Do not draw any logo, emblem or brand mark. The business name may appear only as plain text.');
  if (productCount > 0) lines.push(`The other attached ${productCount === 1 ? 'picture shows' : 'pictures show'} the real product${productCount === 1 ? '' : 's'}: keep ${productCount === 1 ? 'its' : 'their'} shape, colour and details faithfully.`);
  if (hasEnvironment) lines.push('One attached picture shows the real place: keep it recognisable.');
  if (hasContinuity) lines.push('The last attached picture is the previous one in this series: match its colours, type style and visual language, but do not copy its composition.');
  if (designText) lines.push(designText);
  lines.push(densityText(density));
  if (reserve) lines.push(reserve);
  return lines.join('\n');
}

/** Numbers that must appear on the picture: those the person typed in the brief or the exact details. */
function requiredNumbers({ brief = '', details = {} } = {}) {
  const text = [brief, details.headline, details.offer, details.phone].filter(Boolean).join(' ');
  const found = (text.match(/\d[\d,.]*\d|\d/g) || []).map((n) => n.replace(/[,.]/g, ''));
  return Array.from(new Set(found.filter((n) => n.length >= 2 || /%/.test(text)))).slice(0, 8);
}

/**
 * The required numbers that do not appear as a whole number in the text read from the picture. Whole numbers only:
 * "14999" must not count as showing "1499". A price printed with a currency sign or Indian commas still matches.
 */
function missingNumbers(required, readText) {
  const tokens = new Set((String(readText || '').match(/\d[\d,.]*\d|\d/g) || []).map((n) => n.replace(/[,.]/g, '')));
  return required.filter((n) => !tokens.has(n));
}

async function fetchReference(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const mimeType = (res.headers.get('content-type') || 'image/png').split(';')[0];
    if (!/^image\//.test(mimeType)) return null;
    return { mimeType, data: buf.toString('base64') };
  } catch (_) { return null; }
}

/**
 * Makes the picture. `io` injects the network for tests. Returns { success, imageUrl, model, promptUsed, checked }.
 * Never throws; on failure returns { success:false, error } so the caller can fall back to the older chain.
 */
async function generateDirectPost(input, io = {}) {
  const gen = io.generate || require('./openaiImage').generateOpenAIImage;
  const read = io.readText || (async (url) => {
    const buf = await (io.fetchBuffer ? io.fetchBuffer(url) : fetch(url).then((r) => r.arrayBuffer()).then((b) => Buffer.from(b)));
    return require('./openaiImage').readTextFromImage(buf);
  });
  const getRef = io.fetchReference || fetchReference;
  try {
    const refs = [];
    // Overlay mode: the exact logo file is placed afterwards, so the model only reserves the corner for it.
    const overlay = Boolean(input.overlayLogo && input.logoUrl);
    if (input.logoUrl && !overlay) { const l = await getRef(input.logoUrl); if (l) refs.push(l); }
    for (const url of (input.productUrls || []).slice(0, 4)) { const p = await getRef(url); if (p) refs.push(p); }
    let hasEnvironment = false;
    let hasContinuity = false;
    if (input.environmentUrl) { const e = await getRef(input.environmentUrl); if (e) { refs.push(e); hasEnvironment = true; } }
    if (input.continuityUrl) { const c = await getRef(input.continuityUrl); if (c) { refs.push(c); hasContinuity = true; } }
    const hasLogo = !overlay && Boolean(input.logoUrl) && refs.length > 0;
    const productCount = Math.max(0, refs.length - (hasLogo ? 1 : 0) - (hasEnvironment ? 1 : 0) - (hasContinuity ? 1 : 0));
    const prompt = buildDirectPrompt({ ...input, hasLogo, noLogo: input.logoUrl === '' || input.noLogo, logoCorner: overlay ? (input.logoPosition || 'bottom-right') : '', productCount, hasEnvironment, hasContinuity });
    // Quality is chosen per picture: plain English starts at low (proofread, and remade at medium if anything is wrong);
    // other languages start at medium because their small text fails at low about two times in five.
    const lang = languageKind(input.language);
    const startQuality = input.quality || process.env.IMAGE_QUALITY_START || ((lang.base === 'english' && !lang.mix) ? 'low' : 'medium');
    const remakeQuality = startQuality === 'low' ? 'medium' : 'high';
    let result = await gen(prompt, { aspectRatio: input.aspectRatio, references: refs, quality: startQuality });
    let usedQuality = startQuality;
    if (!result || !result.success || !result.imageUrl) return { success: false, error: (result && result.error) || 'no picture' };

    // Read the picture back. Two checks run together: the numbers (the ones from the brief must be there, none
    // nobody supplied may be) and a proofread of the words (headline as written, spelling, cut-off sentences,
    // wrong-language words). One remake at most, then the better of the two is kept.
    const required = requiredNumbers({ brief: [input.brief, input.imageText].filter(Boolean).join(' '), details: input.details });
    const allowedText = [input.brief, input.imageText, input.series && input.series.concept, input.series && input.series.visualSystem, input.series && input.series.mechanism, input.brand && input.brand.name, input.brand && input.brand.location, input.brand && input.brand.website, ...Object.values(input.details || {}).map((v) => (Array.isArray(v) ? v.join(' ') : v))].filter(Boolean).join(' ');
    const allowedNumbers = Array.from(new Set([...(allowedText.match(/\d[\d,.]*\d|\d/g) || []).map((n) => n.replace(/[,.]/g, ''))])).slice(0, 20);
    const proofread = io.proofread || require('./proofread').proofreadImage;
    const { fixInstructions } = require('./proofread');
    const expected = [];
    if (input.imageText && !textMismatchesLanguage(input.imageText, input.language)) expected.push({ label: 'headline', text: tidy(input.imageText) });
    for (const k of ['headline', 'offer', 'phone', 'tagline']) if (input.details && input.details[k]) expected.push({ label: k, text: tidy(input.details[k]) });
    const retryExtra = input.retryOnExtra !== false;
    // A single post is remade for any problem. A picture in a series only for a missing number or a headline that
    // does not read as written: a second picture would double the wait for every slide.
    const blocking = (i) => (retryExtra ? true : (i.kind === 'headline' || i.kind === 'cut_off'));
    const assess = async (url) => {
      if (!String(url).startsWith('http')) return { checked: false, missing: [], extra: [], issues: [] };
      const [text, pr] = await Promise.all([
        read(url).catch(() => ''),
        proofread({ imageUrl: url, languageName: languageWords(input.language), expected, allowedNumbers }).catch(() => ({ checked: false, issues: [] })),
      ]);
      return {
        checked: Boolean(text) || Boolean(pr && pr.checked),
        missing: text ? missingNumbers(required, text) : [],
        extra: text ? extraNumbers(allowedText, text) : [],
        issues: (pr && pr.issues) || [],
      };
    };
    const score = (a) => a.missing.length + (retryExtra ? a.extra.length : 0) + a.issues.filter(blocking).length;
    let current = await assess(result.imageUrl);
    if (current.checked && score(current) > 0) {
      const fixes = [];
      if (current.missing.length) fixes.push(`the picture must clearly show these numbers exactly: ${current.missing.join(', ')}`);
      if (retryExtra && current.extra.length) fixes.push(`do not show any number that was not given, such as: ${current.extra.join(', ')}; remove those claims entirely`);
      fixes.push(...fixInstructions(current.issues.filter(blocking)));
      const again = await gen(`${prompt}\nImportant corrections: ${fixes.join('; ')}.`, { aspectRatio: input.aspectRatio, references: refs, quality: remakeQuality });
      if (again && again.success && again.imageUrl) {
        const next = await assess(again.imageUrl);
        if (!next.checked || score(next) <= score(current)) { result = again; current = next.checked ? next : current; usedQuality = remakeQuality; }
      }
    }
    const checked = current.checked; const missing = current.missing; const extra = current.extra; const issues = current.issues;
    return { success: true, imageUrl: result.imageUrl, model: result.model, promptUsed: prompt, checked, missing, extra, issues, logoPlacedByModel: hasLogo, quality: usedQuality };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/** Numbers on the picture that nobody supplied (a made-up "18+ years", a made-up discount). Two digits or more only. */
function extraNumbers(allowedText, readText) {
  const allowed = new Set((String(allowedText || '').match(/\d[\d,.]*\d|\d/g) || []).map((n) => n.replace(/[,.]/g, '')));
  const seen = (String(readText || '').match(/\d[\d,.]*\d|\d/g) || []).map((n) => n.replace(/[,.]/g, ''));
  return Array.from(new Set(seen.filter((n) => n.length >= 2 && !allowed.has(n)))).slice(0, 6);
}

/**
 * One picture of a carousel or a campaign. Same direct request, plus the series look, the exact text for this
 * picture, an optional previous picture to match, and the saved header and footer laid on at the end.
 * Returns { success, imageUrl, model, promptUsed } or { success:false } so the caller can use the older chain.
 */
async function generateDirectSeriesImage(input, io = {}) {
  const { frameInstruction, addFramesToImage } = require('./postFrames');
  const reserve = frameInstruction({ headerUrl: input.headerUrl, footerUrl: input.footerUrl, aspectRatio: input.aspectRatio });
  const out = await generateDirectPost({ ...input, reserve, retryOnExtra: false }, io);
  if (!out.success) return out;
  let url = out.imageUrl;
  if (input.headerUrl || input.footerUrl) {
    const framed = await (io.addFrames || addFramesToImage)(url, { headerUrl: input.headerUrl, footerUrl: input.footerUrl });
    if (framed && framed.applied) url = framed.imageUrl;
  }
  return { success: true, imageUrl: url, model: out.model, promptUsed: out.promptUsed, checked: out.checked, missing: out.missing, extra: out.extra, issues: out.issues || [] };
}

module.exports = { languageKind, textMismatchesLanguage, hexToName, humanizeColours, generateDirectSeriesImage, extraNumbers, buildDirectPrompt, generateDirectPost, requiredNumbers, missingNumbers, languageWords };
