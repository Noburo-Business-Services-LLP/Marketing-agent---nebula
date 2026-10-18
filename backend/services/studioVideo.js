/**
 * The Videos flow: turn an idea and a few choices into a concept the owner can read, then into one prompt for
 * Gemini Omni, then run the job (charge, make, store, refund on failure). Pure helpers are exported for tests.
 */
const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

// Look keys are the cover-image slugs (frontend/public/assets/video-styles/<slug>.jpg).
// Each direction is one or two sentences for the model: what the camera and sound do. No brands, no on-screen text.
const STYLE_LIST = [
  ['cinematic-commercial', 'Cinematic Commercial', 'Film-style colour grading, shallow depth of field and dramatic lighting', 'Cinematic commercial: 3 to 4 shots with clean cuts, slow camera moves, shallow depth of field, rich film-style colour and dramatic light. Emotional music and natural ambient sound.'],
  ['storytelling', 'Storytelling', 'A story with characters and clear emotional moments', 'A small story with a beginning, a turn and a warm ending, told through believable characters and clear emotional moments. Natural acting, steady camera, gentle music.'],
  ['product-advertisement', 'Product Advertisement', 'A clean studio look that keeps the focus on the product', 'Product advertisement: clean close-ups and a smooth reveal of the product, soft studio-quality light, a hand interacting naturally with it, then a wider shot. Confident friendly voice-over and light music.'],
  ['daily-life-vlog', 'Daily Life Vlog', 'Handheld, casual footage filmed from a first-person view', 'Handheld first-person vlog filmed on a phone, natural light, casual and unpolished, one continuous shot with small natural movements and pauses. The person talks straight to the camera.'],
  ['documentary', 'Documentary', 'Observational footage with a realistic, natural look', 'Observational documentary footage: real people doing real work, natural light, a patient handheld camera, unstaged moments and ambient sound.'],
  ['educational', 'Educational', 'A clear, steady pace with visuals that support the explanation', 'Calm explainer: a presenter or hands demonstrating one idea at an even pace, steady framing, clear simple visuals that support each point, friendly voice.'],
  ['motivational', 'Motivational', 'Building momentum with uplifting, aspirational imagery', 'Uplifting motivational film: early light, effort turning into progress, rising energy through the shots, wide aspirational frames, building music and an encouraging voice.'],
  ['corporate-presentation', 'Corporate Presentation', 'A polished, professional look that puts data first', 'Polished professional presentation: clean modern office or workspace, neutral colours, stable tripod shots, a confident presenter, measured pace and subtle background music.'],
  ['testimonial', 'Testimonial', 'A customer speaking to the camera to build trust', 'A real-looking customer speaks to the camera in a relaxed single shot, natural light, honest and warm, small gestures, the product or place briefly visible behind or in hand.'],
  ['product-showcase', 'Product Showcase', 'The product shown prominently on a lit set', 'Product showcase: the product placed prominently on a lit set, slow orbit and push-in moves, crisp highlights on its shape and finish, a short confident voice-over and light music.'],
  ['news-update', 'News Update', 'News-broadcast framing with lower-third titles', 'News-broadcast framing: a presenter at a desk or on location speaking to camera in a steady medium shot, with cutaway shots that illustrate the story, a serious clear delivery. Do not show any on-screen text.'],
  ['social-media-reel', 'Social Media Reel', 'Fast cuts, vertical format and a strong opening moment', 'Fast social reel: a strong hook in the first second, quick cuts every one to two seconds, energetic camera moves, bright punchy colour and upbeat music with a catchy beat.'],
  ['luxury-advertisement', 'Luxury Advertisement', 'A restrained, premium look in gold and black', 'Luxury advertisement: restrained and premium, deep blacks with warm gold highlights, very slow elegant camera moves, rich textures, minimal movement in front of the lens, soft refined music.'],
  ['unboxing', 'UGC Unboxing', 'Someone opens it for the first time, on a phone', 'User-made unboxing filmed on a phone: hands open the package for the first time, natural indoor light, excited reactions, close-ups of the product, casual voice.'],
  ['fashion-lookbook', 'Fashion Lookbook', 'Fabric, fit and movement, styled like a campaign', 'Fashion lookbook: the garments shown in movement so fabric, fit and drape are clear, styled like a campaign with confident poses, soft directional light and stylish music.'],
  ['festive-campaign', 'Festive Campaign', 'Warm celebration, family and gifting', 'Warm festival atmosphere: lamps, fairy lights and decorations, family and friends smiling and gifting, golden light, joyful music and ambient sound, gentle handheld moves.'],
  ['behind-the-scenes', 'Behind the Scenes', 'The making: hands, tools and craft', 'Behind the scenes: close shots of hands, tools and materials in the making, authentic workshop sound, natural light, a proud finished result at the end.'],
  ['founder-story', 'Founder Story', 'Why the business exists, in plain words', 'The founder speaks plainly and sincerely to the camera in their own place of work, natural light, with short cutaways of the work and the people. Warm, honest and unhurried.'],
  ['before-and-after', 'Before and After', 'A clear change, shown not told', 'Before and after: first the plain starting situation, then a clean transformation moment, then the clearly improved result in the same framing so the change is obvious.'],
  ['get-ready-with-me', 'Get Ready With Me', 'A relaxed routine, step by step', 'Get ready with me: a relaxed first-person routine shown step by step, a person chatting casually to the camera while they go, bright natural light, small cuts between steps.'],
  ['myth-busting', 'Myth Busting Q&A', 'One common question, answered plainly', 'Myth busting: the person raises one common question or myth, then answers it plainly and confidently to the camera, with a simple gesture and a short cutaway that backs the answer.'],
  ['comedy-skit', 'Comedy Skit', 'A relatable moment with a funny turn', 'Light comedy skit: a relatable everyday moment that takes a funny turn, expressive acting, quick timing, simple staging and playful music. Never mocking anyone.']
];
const STYLES = Object.fromEntries(STYLE_LIST.map(([key, label, hint, direction]) => [key, { label, hint, direction, image: `/assets/video-styles/${key}.jpg` }]));
// Old looks saved on earlier videos keep working: each points at the nearest new style.
const STYLE_ALIASES = { natural: 'daily-life-vlog', cinematic: 'cinematic-commercial', product: 'product-advertisement', festive: 'festive-campaign' };
const DEFAULT_STYLE = 'daily-life-vlog';

const LANGUAGES = { english: 'English', hindi: 'Hindi', tamil: 'Tamil', telugu: 'Telugu', kannada: 'Kannada', malayalam: 'Malayalam', none: '' };
const LANGUAGE_SCRIPTS = { hindi: 'Devanagari script', tamil: 'Tamil script', telugu: 'Telugu script', kannada: 'Kannada script', malayalam: 'Malayalam script' };
const LANGUAGE_LABELS = { english: 'English', hindi: 'Hindi', tamil: 'Tamil', telugu: 'Telugu', kannada: 'Kannada', malayalam: 'Malayalam', none: 'No speech, music only' };
const VOICES = ['female', 'male'];
const MAX_CLIPS = 6;
// Omni makes 9:16 and 16:9 only. 1:1 and 4:5 are not possible, so they are never offered.
const ASPECT_RATIOS = ['9:16', '16:9'];
// Platforms a video can be posted to (ids as in frontend/utils/platforms.ts; "x" is accepted for "twitter").
const PLATFORM_IDS = ['instagram', 'facebook', 'linkedin', 'twitter', 'youtube'];
const WIDE_PLATFORMS = ['youtube', 'linkedin'];

function styleOf(key) {
  const k = String(key || '');
  if (STYLES[k]) return k;
  if (STYLE_ALIASES[k]) return STYLE_ALIASES[k];
  return DEFAULT_STYLE;
}
function languageOf(key) { return Object.prototype.hasOwnProperty.call(LANGUAGES, key) ? key : 'english'; }
function voiceOf(v) { return v === 'male' ? 'male' : 'female'; }
function clipsOf(n) { const x = Math.floor(Number(n)); return Number.isFinite(x) ? Math.min(MAX_CLIPS, Math.max(1, x)) : 1; }
function aspectOf(a) { return a === '16:9' ? '16:9' : '9:16'; }
/** Keeps only known platform ids, once each; "x" becomes "twitter". */
function platformsOf(list) {
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    let k = String(p || '').trim().toLowerCase();
    if (k === 'x') k = 'twitter';
    if (PLATFORM_IDS.includes(k) && !out.includes(k)) out.push(k);
  }
  return out;
}
/** Suggested shape: wide only when every chosen platform is wide-first, otherwise vertical. */
function shapeFor(platforms) {
  const list = platformsOf(platforms);
  return list.length && list.every((p) => WIDE_PLATFORMS.includes(p)) ? '16:9' : '9:16';
}
const platformShapes = () => Object.fromEntries(PLATFORM_IDS.map((p) => [p, shapeFor([p])]));

const orientationText = (aspectRatio) => (aspectRatio === '16:9' ? 'horizontal 16:9' : 'vertical 9:16');
const CONTINUE_TEXT = 'Continue directly from the reference frame of the previous clip: same person, clothes, place, light and mood; the story moves on.';

/** What the model is asked: a plain concept for the owner and the spoken line (one per clip for a longer video). */
function buildConceptPrompt({ idea, style, language, brand, who, where, products, clips = 1, aspectRatio = '9:16' }) {
  const lang = LANGUAGES[languageOf(language)];
  const script = LANGUAGE_SCRIPTS[languageOf(language)] || '';
  const n = clipsOf(clips);
  const seconds = n * 10;
  const multi = n > 1;
  const dialogueRule = multi
    ? `- If the idea already contains words someone should say (in quotation marks, or after "says", "saying", "dialogue" or "tagline"), those words MUST be used exactly as written, copied unchanged and in the same order, split between the ${n} clips at natural sentence or phrase breaks so each clip gets a share of about the same length. Do not shorten, reword, improve or add to them, and do not drop any. Only when the language chosen below differs from the language they are written in, translate them faithfully and keep every fact.`
    : '- If the idea already contains words someone should say (in quotation marks, or after "says", "saying", "dialogue" or "tagline"), the spoken line MUST be exactly those words, copied unchanged, even if longer than 18 words. Do not shorten, reword, improve or add to them. Only when the language chosen below differs from the language they are written in, translate them faithfully and keep every fact.';
  const spokenSpec = lang
    ? `the exact words from the idea if it gives any, otherwise one natural sentence of at most 18 words, spoken in ${lang}${script ? `, written in ${script} (never in English letters)` : ''}, using only facts from the idea`
    : '';
  const shape = multi
    ? `{
  "title": "3 to 6 words about the idea",
  "concept": "2 or 3 plain sentences telling the owner what the whole video will show, in simple English",
  "parts": [ ${n} entries, one per 10 second clip in story order, each: { "beats": ["2 or 3 short shot descriptions, one line each"], "spokenLine": ${lang ? `"${spokenSpec}"` : '""'} } ]
}`
    : `{
  "title": "3 to 6 words about the idea",
  "concept": "2 or 3 plain sentences telling the owner what the video will show, in simple English",
  "beats": ["3 short shot descriptions, one line each"],
  "spokenLine": ${lang ? `"${spokenSpec}"` : '""'}
}`;
  const st = STYLES[styleOf(style)];
  return `You help the owner of a small Indian business plan a ${seconds} second ${orientationText(aspectRatio)} marketing video${multi ? `, made of ${n} clips of 10 seconds that play one after another as one story` : ''}.

THE VIDEO MUST BE ABOUT THIS IDEA. It is the subject of the video. Use every product, offer, place and name it mentions exactly as written:
"""
${clip(idea, 1200) || '(none written: invent a simple, honest video for the business below)'}
"""

RULES
- Never replace the idea's business, product or offer with the account's own business. If the idea names a business or product, that is the one in the video.
- Use the account details below ONLY to fill what the idea leaves out (for example the city or the business name when the idea names none).
- Never invent prices, discounts, phone numbers or claims that are not in the idea.
${dialogueRule}
${multi ? `- The ${n} clips are one continuous story with the same person, place and look. Each clip moves the story on: do not repeat the same shot in two clips.\n` : ''}- Describe only what the camera sees and what is said. Do not describe on-screen text, captions or titles: they are not added.
${script ? `- Write every spoken line in ${lang}, in ${script}. Only the spoken lines are in ${lang}; the concept and shots stay in simple English.\n` : ''}
ACCOUNT DETAILS (background only):
- Business: ${clip(brand && brand.name, 80) || 'unknown'}
- What they do: ${clip(brand && brand.industry, 80) || 'unknown'}
- City: ${clip(brand && brand.location, 80) || 'unknown'}

CHOICES:
- Look: ${st.label} (${st.hint})
- Who appears: ${clip(who, 200) || 'a believable local person, chosen by you'}
- Where: ${clip(where, 200) || 'a believable local setting, chosen by you'}
- Products shown: ${clip(products, 200) || 'the products in the idea'}
- Spoken language: ${lang ? `${lang}${script ? ` (${script})` : ''}` : 'no speech, music only'}

Return JSON only:
${shape}`;
}

function parseConcept(raw, clips = 1) {
  let obj = {};
  try {
    const s = String(raw || '');
    obj = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
  } catch (_) { obj = {}; }
  const n = clipsOf(clips);
  const cleanBeats = (arr, max) => (Array.isArray(arr) ? arr.map((b) => clip(b, 160)).filter(Boolean).slice(0, max) : []);
  if (n > 1) {
    const src = Array.isArray(obj.parts) ? obj.parts : [];
    const parts = Array.from({ length: n }, (_, i) => ({ beats: cleanBeats(src[i] && src[i].beats, 4), spokenLine: clip(src[i] && src[i].spokenLine, 240) }));
    return { title: clip(obj.title, 60), concept: clip(obj.concept, 600), beats: parts[0].beats, spokenLine: parts.map((p) => p.spokenLine).filter(Boolean).join(' '), parts };
  }
  return { title: clip(obj.title, 60), concept: clip(obj.concept, 600), beats: cleanBeats(obj.beats, 4), spokenLine: clip(obj.spokenLine, 220) };
}

/** The one prompt sent to the model for one clip. Everything the owner can see and edit is in here; nothing else is added. */
const STUDIO_SECONDS = 10;
/** About how long a line takes to say at a natural pace (roughly 2.3 words a second), kept inside the clip. */
function speechSeconds(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.min(STUDIO_SECONDS - 1, Math.max(2, Math.round(words / 2.3)));
}

function assemblePrompt({ concept, beats = [], spokenLine, style, language, voice, aspectRatio, who, where, hasProductPhoto, hasPersonPhoto, hasPlacePhoto, brandName, continuation = false }) {
  const lang = LANGUAGES[languageOf(language)];
  const parts = [];
  if (continuation) parts.push(CONTINUE_TEXT);
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
  if (lang && spokenLine) {
    parts.push(`The voice is a ${voiceOf(voice)} voice.`);
    const secs = speechSeconds(spokenLine);
    parts.push(`A person says clearly in ${lang}, saying exactly these words, word for word, without adding, dropping or changing any word: "${clip(spokenLine, 240)}" She says the line ONCE only, starting about one second in and finishing in about ${secs} seconds. She never repeats any word, phrase or sentence, and says nothing else. For the rest of the ${STUDIO_SECONDS} seconds there is no speech at all: only action, expressions, ambient sound and soft music. Lips match the words.`);
  } else parts.push('No spoken words. Music and natural ambient sound only.');
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

module.exports = {
  speechSeconds, buildReferencePrompt, STYLES, STYLE_ALIASES, DEFAULT_STYLE, LANGUAGES, LANGUAGE_SCRIPTS, LANGUAGE_LABELS, VOICES, MAX_CLIPS, ASPECT_RATIOS, PLATFORM_IDS, CONTINUE_TEXT, styleOf, languageOf, voiceOf, clipsOf, aspectOf, platformsOf, shapeFor, platformShapes, buildConceptPrompt, parseConcept, assemblePrompt, clip };
