/**
 * Hero video styles: the 13 wizard style slugs, grouped into four rule sets the planner receives as
 * `styleBlock`. Each group's rules are an editable prompt-registry entry (hero_video.style.<group>,
 * stage hero-video, no variables), so Prompt Studio edits apply. The built-in text below is the
 * shipped default and the synchronous fallback when the registry lookup fails.
 *
 * Distilled from the ai-video-studio skills: cinematic <- cinematic-look + camera-direction + the
 * director's brief; ugc <- ugc-influencer-videos + remove-ai-look realism phrases; product <-
 * product-in-hand-and-photos + product B-roll rules; explainer <- ad-strategy-and-scripts.
 * Each block (with its one-line header) stays under the planner's STYLE_BLOCK_MAX of 1,200 characters.
 */

// Blurbs follow the wizard's VIDEO_STYLES list (ReelGenerator.tsx). Testimonial is shown as
// "Creator recommendation": a generated person is never presented as a customer.
const HERO_STYLES = [
  { slug: 'cinematic-commercial', label: 'Cinematic Commercial', group: 'cinematic', blurb: 'Filmic grade, shallow depth, dramatic light' },
  { slug: 'storytelling', label: 'Storytelling', group: 'cinematic', blurb: 'Narrative arc with characters and emotional beats' },
  { slug: 'product-advertisement', label: 'Product Advertisement', group: 'product', blurb: 'Clean studio focus on the product itself' },
  { slug: 'daily-life-vlog', label: 'Daily Life Vlog', group: 'ugc', blurb: 'Handheld, casual, first-person energy' },
  { slug: 'documentary', label: 'Documentary', group: 'cinematic', blurb: 'Observational, grounded, real-world texture' },
  { slug: 'educational', label: 'Educational', group: 'explainer', blurb: 'Clear explainer pacing with visual aids' },
  { slug: 'motivational', label: 'Motivational', group: 'explainer', blurb: 'Rising energy, aspirational imagery' },
  { slug: 'corporate-presentation', label: 'Corporate Presentation', group: 'explainer', blurb: 'Polished, professional, data-forward' },
  { slug: 'testimonial', label: 'Creator recommendation', group: 'ugc', blurb: 'A creator to camera, honest and trust-building' },
  { slug: 'product-showcase', label: 'Product Showcase', group: 'product', blurb: 'Hero product on a lit stage' },
  { slug: 'news-update', label: 'News Update', group: 'explainer', blurb: 'Broadcast framing with lower-third titling' },
  { slug: 'social-media-reel', label: 'Social Media Reel', group: 'ugc', blurb: 'Fast cuts, vertical-first, punchy hooks' },
  { slug: 'luxury-advertisement', label: 'Luxury Advertisement', group: 'cinematic', blurb: 'Restrained, premium, gold and black' }
];

const DEFAULT_STYLE = 'cinematic-commercial';
const BY_SLUG = new Map(HERO_STYLES.map((s) => [s.slug, s]));

const STYLE_PROMPT_KEYS = {
  cinematic: 'hero_video.style.cinematic',
  ugc: 'hero_video.style.ugc',
  product: 'hero_video.style.product',
  explainer: 'hero_video.style.explainer'
};

const INTEGRITY = 'Integrity: generated people are characters, never real customers or reviewers; never invent results, numbers or reviews; the clip is disclosed as AI-generated where it is published.';
const REALISM = 'Realism: visible skin texture and pores, flyaway hair, creased fabric, imperfect real light with real shadows; no beauty filter, no plastic skin.';

const GROUP_BLOCKS = {
  cinematic: [
    'Register: cinematic live-action, 24fps, 180-degree shutter, fine grain; light from a named source (window, lamp, street light), its direction and softness held in every shot; one mood, one grade.',
    'Story: a felt arc of SETUP, TENSION, DISCOVERY, TRANSFORMATION and EMOTIONAL PAYOFF, with a quiet beat (a held breath, a glance) before the turn.',
    'Camera: physically operated and motivated: observational wide at the setup, closer on the problem, a slow push on the discovery, an intimate close reaction for the payoff. One main move per shot, simpler as the face gets bigger; real time, no slow motion.',
    'Dialogue: the planner default, at most two short lines, about 25 words; faces and hands carry the rest.',
    'Score (only when AUDIO allows music): understated, lifting at the discovery, resolving on the final held frame.',
    INTEGRITY,
    REALISM
  ].join('\n'),
  ugc: [
    'Register: raw phone footage: about 24mm-equivalent lens, 30fps, deep focus, small exposure shifts, handheld breathing bob and wrist roll, never gimbal-smooth; held by the person or one unseen friend.',
    'Format: one person, one product, one idea; jump cuts every 3-5 s.',
    'Speech: casual, to the lens, like a voice note to a friend, with contractions and a small stumble or laugh. Higher dialogue budget: about 35-40 words in 15 s, one short line per beat; this replaces the planner default.',
    'Story: a hook in the first 2 seconds (an interrupted thought, a reveal), one honest first impression, a natural sign-off.',
    'Creator recommendation: a creator persona or a labelled dramatization, never a real customer; no claims of long-term use or results.',
    'Sound: phone-mic room tone; music (only when AUDIO allows music) stays low under the voice.',
    INTEGRITY,
    REALISM
  ].join('\n'),
  product: [
    'Register: product-led live-action. The product keeps its exact shape, colour, material, label text and real-world scale in every shot, from the product reference when supplied; labels are never re-lettered.',
    'Story: the product solves the moment rather than posing: a hook in the first 2 seconds (a texture, a pour, an unexpected use), hands using it for real, a person reacting, a clean final hero frame held long enough to read.',
    'Hands: a believable grip, five fingers, label toward the lens and never covered.',
    'Camera: short shots with one motivated move each (slow push, short slide, top-down), macro texture, real time; real reflections on glass, metal and liquid; the product never floats or glows.',
    'Dialogue: at most two short lines, or none; sound carries the product (cap, pour, fizz, a set-down).',
    INTEGRITY,
    REALISM
  ].join('\n'),
  explainer: [
    'Register: grounded live-action that makes one idea clear: a real person in a real working place, daylight plus practical lamps, steady eye-level framing.',
    'Story: one idea. A hook in the first 2 seconds with a problem the viewer recognises, the mechanism shown with hands and objects, then the result as a visible change, then one next step.',
    'Text: the model draws nothing on screen: no charts, lower-thirds, slides or legible screens; titles are added after generation.',
    'Dialogue: at most two short lines, spoken plainly like a colleague explaining, not a presenter.',
    'Proof: only facts from the brand context; otherwise demonstrate instead of claiming.',
    INTEGRITY,
    REALISM
  ].join('\n')
};

function isHeroStyle(slug) {
  return typeof slug === 'string' && BY_SLUG.has(slug);
}

const styleFor = (slug) => BY_SLUG.get(slug) || BY_SLUG.get(DEFAULT_STYLE);
const header = (style) => `Style: ${style.label} (${style.group}).`;

function groupForStyle(slug) {
  return styleFor(slug).group;
}

/** The shipped rules for a style, synchronously, without the registry. */
function getBuiltInStyleBlock(slug) {
  const style = styleFor(slug);
  return `${header(style)}\n${GROUP_BLOCKS[style.group]}`;
}

/**
 * The rules for a style as this user will get them: their Prompt Studio edit of the group's entry,
 * else the shipped default. Any lookup failure (or an empty result) falls back to the built-in text.
 * `deps.buildPrompt` is injectable for tests.
 */
async function getStyleBlock(slug, userId = null, deps = {}) {
  const style = styleFor(slug);
  let rules = '';
  try {
    const build = deps.buildPrompt || require('./promptRegistry').buildPrompt;
    rules = String((await build(userId || null, STYLE_PROMPT_KEYS[style.group], {})) || '').trim();
  } catch (err) {
    console.error(`[heroVideoStyles] style rules lookup failed for ${style.group}:`, err && err.message);
  }
  return `${header(style)}\n${rules || GROUP_BLOCKS[style.group]}`;
}

module.exports = {
  HERO_STYLES, DEFAULT_STYLE, STYLE_PROMPT_KEYS, GROUP_BLOCKS,
  isHeroStyle, groupForStyle, getStyleBlock, getBuiltInStyleBlock
};
