/**
 * Hero video styles: the 13 wizard style slugs, grouped into four rule sets the planner receives as
 * `styleBlock`. Built-in blocks for now; a later task moves them into editable registry entries.
 * `getStyleBlock` is synchronous here, but callers must `await` it (the registry version is async).
 */

const HERO_STYLES = [
  { slug: 'cinematic-commercial', label: 'Cinematic Commercial', group: 'cinematic' },
  { slug: 'storytelling', label: 'Storytelling', group: 'cinematic' },
  { slug: 'product-advertisement', label: 'Product Advertisement', group: 'product' },
  { slug: 'daily-life-vlog', label: 'Daily Life Vlog', group: 'ugc' },
  { slug: 'documentary', label: 'Documentary', group: 'cinematic' },
  { slug: 'educational', label: 'Educational', group: 'explainer' },
  { slug: 'motivational', label: 'Motivational', group: 'explainer' },
  { slug: 'corporate-presentation', label: 'Corporate Presentation', group: 'explainer' },
  { slug: 'testimonial', label: 'Creator recommendation', group: 'ugc' },
  { slug: 'product-showcase', label: 'Product Showcase', group: 'product' },
  { slug: 'news-update', label: 'News Update', group: 'explainer' },
  { slug: 'social-media-reel', label: 'Social Media Reel', group: 'ugc' },
  { slug: 'luxury-advertisement', label: 'Luxury Advertisement', group: 'cinematic' }
];

const DEFAULT_STYLE = 'cinematic-commercial';
const BY_SLUG = new Map(HERO_STYLES.map((s) => [s.slug, s]));

const INTEGRITY = 'Integrity: generated people are characters, never real customers or reviewers; never invent results, numbers or reviews; the clip is disclosed as AI-generated where it is published.';
const REALISM = 'Realism: visible skin texture and pores, flyaway hair, creased fabric, imperfect real light with real shadows; no beauty filter, no plastic skin.';

const GROUP_BLOCKS = {
  cinematic: [
    'Register: cinematic live-action, 24fps, 180-degree shutter, light from a named source (window, lamp, street light), natural colour, fine grain.',
    'Story: a felt arc of SETUP, TENSION, DISCOVERY, TRANSFORMATION and EMOTIONAL PAYOFF, with a quiet beat (a held breath, a glance) before the turn.',
    'Camera: physically operated and motivated: observational wide at the setup, closer on the problem, a slow push on the discovery, an intimate close reaction for the payoff; plausible depth of field.',
    'Dialogue: the planner default, at most two short lines, about 25 words; faces and hands carry the rest.',
    'Score (only when AUDIO allows music): understated, lifting at the discovery, resolving on the final held frame.',
    INTEGRITY,
    REALISM
  ].join('\n'),
  ugc: [
    'Register: phone-camera footage filmed by the person or a friend: about 24mm-equivalent lens, 30fps, small exposure shifts, deep focus, handheld breathing bob and wrist roll, never gimbal-smooth, imperfect framing.',
    'Speech: casual, to the lens, like a voice note to a friend, with contractions and a small stumble or laugh. Higher dialogue budget: about 35-40 words in 15 s, one short line per beat; this replaces the planner default.',
    'Story: a hook in the first 2 seconds (an interrupted thought, a reveal), one honest first impression, a natural sign-off.',
    'Creator recommendation: the speaker is a creator persona or a labelled dramatization, never a real customer; no claims of long-term use or results.',
    'Sound: phone-mic room tone and the real sounds of the place; any music (only when AUDIO allows music) stays low under the voice.',
    INTEGRITY,
    REALISM
  ].join('\n'),
  product: [
    'Register: product-led live-action. The product keeps its exact shape, colour, material and packaging in every shot, from the product reference when supplied; labels are never re-lettered.',
    'Story: the product solves the moment rather than posing: a hook in the first 2 seconds (a texture, a pour, an unexpected use), hands using it for real, a person reacting, a clean final hero frame held long enough to read.',
    'Camera: short shots with one motivated move each (slow push, short slide, top-down), macro texture, real-time speed; real reflections on glass, metal and liquid; the product never floats or glows.',
    'Dialogue: at most two short lines, or none; sound carries the product (cap, pour, fizz, a set-down).',
    INTEGRITY,
    REALISM
  ].join('\n'),
  explainer: [
    'Register: grounded live-action that makes one idea clear: a real person in a real working place, daylight plus practical lamps, steady eye-level framing.',
    'Story: one idea. A hook in the first 2 seconds with a problem the viewer recognises, the mechanism shown with hands and objects, then the result as a visible change, then the next step.',
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

function groupForStyle(slug) {
  return (BY_SLUG.get(slug) || BY_SLUG.get(DEFAULT_STYLE)).group;
}

function getStyleBlock(slug) {
  const style = BY_SLUG.get(slug) || BY_SLUG.get(DEFAULT_STYLE);
  return `Style: ${style.label} (${style.group}).\n${GROUP_BLOCKS[style.group]}`;
}

module.exports = { HERO_STYLES, DEFAULT_STYLE, isHeroStyle, groupForStyle, getStyleBlock };
