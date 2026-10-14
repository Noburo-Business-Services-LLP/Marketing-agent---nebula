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

function languageWords(code) {
  const c = String(code || 'english').toLowerCase();
  if (c.endsWith('_english_mix')) {
    const base = LANGUAGE_WORDS[c.replace('_english_mix', '')] || c.replace('_english_mix', '');
    return `a natural mix of ${base} and English words`;
  }
  return LANGUAGE_WORDS[c] || String(code || 'English');
}

const tidy = (v) => String(v == null ? '' : v).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const ASPECT_WORDS = { '1:1': 'square', '4:5': '4:5 portrait', '9:16': '9:16 vertical story', '16:9': '16:9 landscape', '3:4': '3:4 portrait' };

/** The one request sent to the image model. Plain language, no rule lists. */
function buildDirectPrompt({ brief, brand = {}, language, aspectRatio, hasLogo, noLogo, logoCorner = '', details = {}, designText = '', reserve = '', productCount = 0, series = null, imageText = '', hasEnvironment = false, hasContinuity = false }) {
  const lines = [];
  const kind = tidy(brand.industry) || 'local business';
  lines.push(`Create a finished, professional social media post (${ASPECT_WORDS[aspectRatio] || '4:5 portrait'}) for ${tidy(brand.name) || 'the business'}, a ${kind} business${tidy(brand.location) ? ' in ' + tidy(brand.location) : ''}.`);
  lines.push(`What the post is about: ${tidy(brief)}`);
  if (series) {
    lines.push(`This picture is ${tidy(series.label) || 'one'} of a connected series that is posted together${series.role ? ` (its job in the story: ${tidy(series.role)})` : ''}. The whole series shares one look${tidy(series.concept) ? `: ${tidy(series.concept)}` : ''}${tidy(series.visualSystem) ? ` Visual system: ${tidy(series.visualSystem)}` : ''}${tidy(series.mechanism) ? ` Recurring device: ${tidy(series.mechanism)}` : ''} Keep the same palette, type style and design language so the pictures clearly belong together, while each one has its own composition.`);
  }
  if (tidy(imageText)) lines.push(`Show this text on the picture exactly, spelled character for character: "${tidy(imageText)}". Do not add other headline wording. Every slide or post in the series uses the same language as this one.`);
  if (tidy(brand.about)) lines.push(`About the business: ${tidy(brand.about).slice(0, 300)}`);
  if (brand.colours && brand.colours.length) lines.push(`Brand colours to lean on: ${brand.colours.join(', ')}.`);
  lines.push(`All words on the image must be in ${languageWords(language)}, spelled correctly, in large readable type.`);
  const facts = [];
  if (details.headline) facts.push(`headline "${details.headline}"`);
  if (details.offer) facts.push(`offer "${details.offer}"`);
  if (details.phone) facts.push(`phone number "${details.phone}"`);
  if (details.address) facts.push(`address "${details.address}"`);
  if (details.hours) facts.push(`opening hours "${details.hours}"`);
  if (brand.website) facts.push(`website "${brand.website}"`);
  if (facts.length) lines.push(`Show these exact details, spelled character for character: ${facts.join('; ')}.`);
  lines.push('Use only the details given here. Do not invent phone numbers, addresses, websites, prices, discounts, years, customer counts or claims. If a detail is not given, leave that space out.');
  if (logoCorner) lines.push(`Keep the ${String(logoCorner).replace('-', ' ')} corner of the picture calm and free of text or important detail: the real business logo is placed there afterwards. Do not draw any logo, brand mark or emblem yourself.`);
  else if (hasLogo) lines.push('The first attached picture is the business logo. Place it cleanly in one corner exactly as it is, with its colours and lettering unchanged, and do not draw any other logo or brand mark.');
  else if (noLogo) lines.push('Do not draw any logo, emblem or brand mark. The business name may appear only as plain text.');
  if (productCount > 0) lines.push(`The other attached ${productCount === 1 ? 'picture shows' : 'pictures show'} the real product${productCount === 1 ? '' : 's'}: keep ${productCount === 1 ? 'its' : 'their'} shape, colour and details faithfully.`);
  if (hasEnvironment) lines.push('One attached picture shows the real place: keep it recognisable.');
  if (hasContinuity) lines.push('The last attached picture is the previous one in this series: match its colours, type style and visual language, but do not copy its composition.');
  if (designText) lines.push(designText);
  lines.push('It must look like one cohesive, polished design made by a professional agency, with real-looking people or products where it helps. Not a template, not stock clip art, no watermarks.');
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
    let result = await gen(prompt, { aspectRatio: input.aspectRatio, references: refs });
    if (!result || !result.success || !result.imageUrl) return { success: false, error: (result && result.error) || 'no picture' };

    // Read the picture back: the numbers from the brief must be there, and no number nobody supplied may be.
    // One retry, then keep the better of the two.
    const required = requiredNumbers({ brief: [input.brief, input.imageText].filter(Boolean).join(' '), details: input.details });
    const allowedText = [input.brief, input.imageText, input.series && input.series.concept, input.series && input.series.visualSystem, input.series && input.series.mechanism, input.brand && input.brand.name, input.brand && input.brand.location, input.brand && input.brand.website, ...Object.values(input.details || {}).map((v) => (Array.isArray(v) ? v.join(' ') : v))].filter(Boolean).join(' ');
    let checked = false;
    let missing = [];
    let extra = [];
    if (result.imageUrl.startsWith('http')) {
      const text = await read(result.imageUrl).catch(() => '');
      if (text) {
        checked = true;
        missing = missingNumbers(required, text);
        extra = extraNumbers(allowedText, text);
        // A single post is remade for either problem. Pictures in a series are remade only for a missing number:
        // an extra number is logged, but a second picture would double the wait for every slide.
        const retryExtra = input.retryOnExtra !== false;
        if (missing.length || (retryExtra && extra.length)) {
          const fixes = [];
          if (missing.length) fixes.push(`the picture must clearly show these numbers exactly: ${missing.join(', ')}`);
          if (retryExtra && extra.length) fixes.push(`do not show any number that was not given, such as: ${extra.join(', ')}; remove those claims entirely`);
          const again = await gen(`${prompt}\nImportant: ${fixes.join('; ')}.`, { aspectRatio: input.aspectRatio, references: refs });
          if (again && again.success && again.imageUrl) {
            const text2 = again.imageUrl.startsWith('http') ? await read(again.imageUrl).catch(() => '') : '';
            if (text2) {
              const m2 = missingNumbers(required, text2);
              const e2 = extraNumbers(allowedText, text2);
              if (m2.length + e2.length <= missing.length + extra.length) { result = again; missing = m2; extra = e2; }
            }
          }
        }
      }
    }
    return { success: true, imageUrl: result.imageUrl, model: result.model, promptUsed: prompt, checked, missing, extra, logoPlacedByModel: hasLogo };
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
  return { success: true, imageUrl: url, model: out.model, promptUsed: out.promptUsed, checked: out.checked, missing: out.missing, extra: out.extra };
}

module.exports = { generateDirectSeriesImage, extraNumbers, buildDirectPrompt, generateDirectPost, requiredNumbers, missingNumbers, languageWords };
