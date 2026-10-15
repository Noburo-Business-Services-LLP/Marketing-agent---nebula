/**
 * The Videos flow: turn an idea and a few choices into a concept the owner can read, then into one prompt for
 * Gemini Omni, then run the job (charge, make, store, refund on failure). Pure helpers are exported for tests.
 */
const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

const STYLES = {
  natural: {
    label: 'Real and personal',
    hint: 'Someone talks to the camera, like a phone video',
    direction: 'Handheld vertical phone video, natural light, believable and unpolished like a real person filming in the shop. One continuous shot with small natural movements and pauses.'
  },
  cinematic: {
    label: 'Cinematic',
    hint: 'A short film: several shots, music, no talking',
    direction: 'Cinematic multi-shot vertical short film: 3 to 4 shots with clean cuts, slow camera moves, shallow depth of field, rich warm colour, subtle film grain. Emotional music and natural ambient sound; no spoken dialogue unless a line is given.'
  },
  product: {
    label: 'Product showcase',
    hint: 'Your product up close with a voice-over',
    direction: 'Product advertisement: clean close-ups and a smooth reveal of the product exactly as in the reference photo, soft studio-quality light, a hand interacting naturally with it, then a wider shot of it in its place. Confident friendly voice-over and light music.'
  },
  festive: {
    label: 'Festive',
    hint: 'Warm festival mood: lamps, lights, family',
    direction: 'Warm festival atmosphere: lamps, fairy lights and decorations, people smiling, golden light, joyful music and ambient sound. Natural handheld camera with gentle moves.'
  }
};
const LANGUAGES = { english: 'English', tamil: 'Tamil', none: '' };

function styleOf(key) { return STYLES[key] ? key : 'natural'; }
function languageOf(key) { return Object.prototype.hasOwnProperty.call(LANGUAGES, key) ? key : 'english'; }

/** What the model is asked to write: a plain concept for the owner and a short spoken line. */
function buildConceptPrompt({ idea, style, language, brand, who, where, products }) {
  const lang = LANGUAGES[languageOf(language)];
  return `You help the owner of a small Indian business plan a 10 second vertical marketing video.

THE VIDEO MUST BE ABOUT THIS IDEA. It is the subject of the video. Use every product, offer, place and name it mentions exactly as written:
"""
${clip(idea, 1200) || '(none written: invent a simple, honest video for the business below)'}
"""

RULES
- Never replace the idea's business, product or offer with the account's own business. If the idea names a business or product, that is the one in the video.
- Use the account details below ONLY to fill what the idea leaves out (for example the city or the business name when the idea names none).
- Never invent prices, discounts, phone numbers or claims that are not in the idea.
- Describe only what the camera sees and what is said. Do not describe on-screen text, captions or titles: they are not added.

ACCOUNT DETAILS (background only):
- Business: ${clip(brand && brand.name, 80) || 'unknown'}
- What they do: ${clip(brand && brand.industry, 80) || 'unknown'}
- City: ${clip(brand && brand.location, 80) || 'unknown'}

CHOICES:
- Look: ${STYLES[styleOf(style)].label} (${STYLES[styleOf(style)].hint})
- Who appears: ${clip(who, 200) || 'a believable local person, chosen by you'}
- Where: ${clip(where, 200) || 'a believable local setting, chosen by you'}
- Products shown: ${clip(products, 200) || 'the products in the idea'}
- Spoken language: ${lang || 'no speech, music only'}

Return JSON only:
{
  "title": "3 to 6 words about the idea",
  "concept": "2 or 3 plain sentences telling the owner what the video will show, in simple English",
  "beats": ["3 short shot descriptions, one line each"],
  "spokenLine": ${lang ? `"one natural sentence of at most 18 words spoken in ${lang}${lang === 'Tamil' ? ', in Tamil script' : ''}, using only facts from the idea"` : '""'}
}`;
}

function parseConcept(raw) {
  let obj = {};
  try {
    const s = String(raw || '');
    obj = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
  } catch (_) { obj = {}; }
  const beats = Array.isArray(obj.beats) ? obj.beats.map((b) => clip(b, 160)).filter(Boolean).slice(0, 4) : [];
  return { title: clip(obj.title, 60), concept: clip(obj.concept, 600), beats, spokenLine: clip(obj.spokenLine, 220) };
}

/** The one prompt sent to the model. Everything the owner can see and edit is in here; nothing else is added. */
function assemblePrompt({ concept, beats = [], spokenLine, style, language, aspectRatio, who, where, hasProductPhoto, hasPersonPhoto, hasPlacePhoto, brandName }) {
  const lang = LANGUAGES[languageOf(language)];
  const parts = [];
  parts.push(`${aspectRatio === '16:9' ? 'Horizontal 16:9' : 'Vertical 9:16'} video, 10 seconds, real-world look, not obviously AI.`);
  parts.push(STYLES[styleOf(style)].direction);
  if (concept) parts.push(`What the video shows: ${concept}`);
  if (beats.length) parts.push(`Shots: ${beats.map((b, i) => `(${i + 1}) ${b}`).join(' ')}`);
  if (who) parts.push(`The person: ${clip(who, 300)}.${hasPersonPhoto ? ' Use the person in the reference photo; keep the same face and clothes.' : ''}`);
  else if (hasPersonPhoto) parts.push('Use the person in the reference photo; keep the same face and clothes.');
  if (hasPersonPhoto) parts.push('If the person photo shows several views of one person it is a reference sheet: film that person, and never show the sheet itself.');
  if (where) parts.push(`The place: ${clip(where, 300)}.${hasPlacePhoto ? ' Match the place in the reference photo.' : ''}`);
  else if (hasPlacePhoto) parts.push('Match the place in the reference photo.');
  if (hasProductPhoto) parts.push('Show the product exactly as in the reference photo: same shape, colours and label.');
  if (lang && spokenLine) parts.push(`A person says clearly in ${lang}: "${clip(spokenLine, 240)}" with natural pauses; lips match the words. Soft music under the voice.`);
  else parts.push('No spoken words. Music and natural ambient sound only.');
  if (brandName) parts.push(`Brand: ${clip(brandName, 60)}. Show brand text only where it appears in a reference photo; do not invent logos, prices or other text.`);
  parts.push('No subtitles, no watermarks, no gibberish text.');
  return parts.join(' ');
}

/** The picture made for a person or a place before it is filmed. No text, so nothing to proofread. */
function buildReferencePrompt({ kind, description, city }) {
  const d = clip(description, 300) || (kind === 'person' ? 'a friendly local shop owner' : 'a clean, welcoming local shop');
  if (kind === 'person') {
    return `Character reference sheet on a plain light grey studio background. The same person shown in three views side by side from the waist up: front, three-quarter and side profile, with one larger close-up of the face. Realistic photography, natural skin texture and believable clothes, soft even light. The person: ${d}. Indian setting${city ? `, ${clip(city, 40)}` : ''}. No text, no labels, no logos, no watermark.`;
  }
  return `Realistic wide photograph of a real place: ${d}. Natural light, lived-in and believable, an everyday Indian business${city ? ` in ${clip(city, 40)}` : ''}. No people, no text, no signs with words, no logos, no watermark.`;
}

module.exports = { buildReferencePrompt, STYLES, LANGUAGES, styleOf, languageOf, buildConceptPrompt, parseConcept, assemblePrompt, clip };
