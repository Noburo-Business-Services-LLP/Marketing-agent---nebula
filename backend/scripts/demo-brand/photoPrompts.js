'use strict';
/**
 * The real pictures for the demo brand (Zaya Naturals): 24 slots, each one the SAME file the drawn picture uses, so a real
 * photo put in place of a drawn one replaces it everywhere (product pages, posts, carousels, Photoshoot) with no database change.
 * Made once by the owner with scripts/generate-demo-photos.js (docs/superpowers/ops/demo-photos.md).
 *
 * Pure data: no network, no files, no canvas, no sharp. Change a prompt here, then redo that one slot.
 *
 * The packaging is described as plain and unbranded on purpose (an image model cannot spell a label); the real product names and
 * labels live in the drawn pictures, so the demo story and the real photos only need to agree on shape and colour.
 */

// Every picture is generated at the one measured size (4:5, 1024x1280, the rate in config/apiCosts.js) and cropped to the slot's size.
const GEN_SIZE = Object.freeze({ width: 1024, height: 1280 });

const STYLE_RULES = [
  'Photorealistic commercial photography for an Indian ayurveda-inspired skincare brand, shot on a full-frame camera with a prime lens, natural true-to-life colours, believable materials and soft realistic shadows.',
  'No people and no faces anywhere (a hand is the most that may appear, and only where the scene says so).',
  'No real brand names or logos; every label and package is plain, blank and unbranded.',
  'No text, letters, numbers, symbols or watermarks anywhere in the image.',
  'Vertical 4:5 composition with the main subject near the centre and some calm space around it, so it can be cropped square or taller without losing it.'
].join(' ');

// Plain descriptions of each product's packaging (shape and colour only), reused in the scenes.
const PACK = Object.freeze({
  serum: 'a small amber glass dropper bottle with a gold-and-black dropper cap and a plain blank cream label',
  mask: 'a squat frosted amber glass jar with a rose-gold lid and a plain blank cream label',
  toner: 'a slim blush-tinted frosted glass bottle with a fine mist spray and a cream cap, plain blank label',
  cleanser: 'a soft green squeezable tube with a flat plum-coloured cap, plain blank label',
  cream: 'a small ivory glass jar with a rose-gold lid and a plain blank label',
  spf: 'a soft peach-coloured squeezable tube with a white cap, plain blank label',
  oil: 'a dark brown glass bottle with a plum-coloured cap and a plain blank label',
  balms: 'three small lip balm tubes in terracotta, dusty rose and deep beetroot, plain and blank'
});

/**
 * One entry per slot, in the order they are made.
 *  slot   the short name (used for the scratch file and --only)
 *  rel    the path under backend/demo-assets/zaya/ of the drawn picture this one replaces
 *  size   the size of that drawn picture (width x height); the real photo is cropped to it
 *  group  how the Library and the product pages use it (for the contact sheet)
 *  scene  the exact picture asked for
 */
const SLOTS = Object.freeze([
  // ---- product pictures (the catalogue and the first slide of many posts), square
  { slot: 'product-marble', group: 'Product page', rel: 'products/kumkumadi-glow-serum-1.jpg', size: [800, 800],
    scene: `${PACK.serum}, standing alone on a polished white Makrana marble slab with soft grey veining, a single gold saffron thread beside it, bright clean daylight from the left, gentle reflection, airy and minimal, centred.` },
  { slot: 'product-clay', group: 'Product page', rel: 'products/saffron-sandal-face-mask-1.jpg', size: [800, 800],
    scene: `${PACK.mask}, resting on a rough terracotta clay slab, with a small carved sandalwood stick and a few dried saffron strands in a tiny brass dish beside it, warm low sunlight from the right, earthy ochre and burnt-orange palette.` },
  { slot: 'product-leaf', group: 'Product page', rel: 'products/rose-petal-toner-1.jpg', size: [800, 800],
    scene: `${PACK.toner}, placed on a large fresh green banana leaf with water droplets, scattered pink rose petals around the base, soft diffused shade light, cool green and blush palette, slightly low camera angle.` },
  { slot: 'swatch-texture', group: 'Product page', rel: 'products/kumkumadi-glow-serum-3.jpg', size: [800, 800],
    scene: 'An extreme close-up, almost abstract, of golden-amber serum oil: one glossy drop falling from a glass dropper tip above a shallow pool, plus a smeared swatch of the oil on a clean pale stone surface catching the light, shallow depth of field, warm backlight, rich amber and honey tones.' },
  { slot: 'packaging-stack', group: 'Product page', rel: 'products/neem-turmeric-cleanser-1.jpg', size: [800, 800],
    scene: `A tidy stack of three plain kraft-paper product boxes with a green tube of cleanser (${PACK.cleanser}) leaning against them, tied with natural jute twine and a sprig of dried neem leaves, on a pale grey concrete surface, soft overcast window light, sustainable and honest mood, seen from slightly above.` },
  { slot: 'marketplace-white', group: 'Product page', rel: 'products/tinted-mineral-spf-40-1.jpg', size: [800, 800],
    scene: `${PACK.spf}, standing upright, on a seamless pure white background with a faint natural shadow underneath, bright even catalogue light, like a clean online marketplace listing, nothing else in the frame.` },

  // ---- posts (4:5)
  { slot: 'flatlay-turmeric', group: 'Post', rel: 'posts/neem-turmeric-cleanser-inside.jpg', size: [864, 1080],
    scene: 'A top-down flat lay of ingredients on a pale linen cloth: fresh turmeric roots, a small heap of bright yellow turmeric powder in a brass bowl, a few neem leaves, and a halved lime, arranged loosely with space between them, soft even daylight, saturated yellow and green palette.' },
  { slot: 'flatlay-neem', group: 'Post', rel: 'posts/neem-turmeric-cleanser-ritual.jpg', size: [864, 1080],
    scene: `Morning wash ritual: ${PACK.cleanser} lying on a wet slate-grey stone ledge beside a cluster of fresh neem leaves with water droplets, a folded white cotton towel at the edge, cool blue-green morning light, crisp and clean, shot from a low three-quarter angle.` },
  { slot: 'flatlay-amla', group: 'Post', rel: 'posts/coconut-hibiscus-hair-oil-inside.jpg', size: [864, 1080],
    scene: `A top-down flat lay on a dark carved wooden board: ${PACK.oil}, whole green amla gooseberries, red hibiscus flowers, a halved coconut with white flesh and a small wooden comb, deep moody side light, rich green, red and brown palette.` },
  { slot: 'flatlay-rose', group: 'Post', rel: 'posts/rose-petal-toner-inside.jpg', size: [864, 1080],
    scene: `A top-down flat lay on a pale pink textured paper: ${PACK.toner} lying on its side, fresh pink and red rose petals, a few whole rosebuds, a small glass bowl of rose water and cotton rounds, soft high-key light, romantic blush and ivory palette.` },
  { slot: 'diwali-diyas', group: 'Post', rel: 'posts/soon-dhanteras.jpg', size: [864, 1080],
    scene: `${PACK.serum}, standing on a brass plate surrounded by many lit clay diyas, marigold garlands and scattered gold coins, a polished brass kalash behind, deep warm evening darkness with glowing golden bokeh lights, Diwali night mood, amber and deep maroon palette.` },
  { slot: 'gifting-hamper', group: 'Post', rel: 'posts/soon-box-live.jpg', size: [864, 1080],
    scene: `An open wooden gift hamper with a handloom silk cloth lining in magenta and gold, holding ${PACK.serum}, ${PACK.mask} and ${PACK.balms}, with dried rose petals and a small brass diya tucked in, seen from slightly above on a cream surface, soft festive light, plain unbranded packaging, elegant and generous.` },
  { slot: 'bathroom-shelf', group: 'Post', rel: 'posts/kumkumadi-glow-serum-ritual.jpg', size: [864, 1080],
    scene: `A lived-in bathroom shelf in soft morning light: a white tiled wall, a wooden shelf holding ${PACK.serum}, ${PACK.toner}, a small green plant in a terracotta pot and a folded cotton towel, sunlight streaming through a frosted window casting soft shadows, calm and unstaged, nobody in the room.` },
  { slot: 'monsoon-mood', group: 'Post', rel: 'posts/sea-monsoon.jpg', size: [864, 1080],
    scene: `${PACK.oil}, on a windowsill with a rainy view: raindrops running down the glass, blurred lush green coconut palms outside, grey-blue soft light, a steaming clay cup of masala tea beside it, cosy monsoon Sunday mood, cool teal and warm brown palette.` },
  { slot: 'sandal-ritual', group: 'Post', rel: 'posts/saffron-sandal-face-mask-ritual.jpg', size: [864, 1080],
    scene: `A weekend clay-mask ritual still life: an open wide brass bowl of pale saffron-yellow clay paste with a flat wooden brush resting in it, ${PACK.mask} behind, a sandalwood block and a few saffron threads, rose water in a small glass, warm afternoon light, honey and cream palette, shot from slightly above.` },
  { slot: 'summer-spf', group: 'Post', rel: 'posts/sea-summer.jpg', size: [864, 1080],
    scene: `${PACK.spf}, lying on a sunlit whitewashed stone step beside a straw hat, sunglasses and a halved orange, hard bright midday sun with crisp shadows, bright turquoise sky edge at the top, summer in a coastal Tamil town, saturated warm colours.` },
  { slot: 'lip-balm-trio', group: 'Post', rel: 'posts/lip-balm-trio-offer.jpg', size: [864, 1080],
    scene: `${PACK.balms}, standing upright and lying side by side on a golden silk fabric with soft folds, with a few dried rose petals and a drop of honey on a small spoon, warm golden-hour backlight, rich terracotta, rose and gold palette.` },

  // ---- one carousel, four slides with one look: warm cream linen, brass, a single soft window light from the left
  { slot: 'carousel-1', group: 'Carousel (night cream), slide 1', rel: 'posts/bakuchi-night-repair-cream-inside.jpg', size: [864, 1080],
    scene: 'Slide 1 of a four-slide set, all in the same look: warm cream linen surface, brass accents, one soft window light from the left, muted ivory and gold palette. This slide: the raw ingredients arranged in a loose circle on the linen: dark bakuchi seeds in a small brass bowl, a block of pale shea butter, a small jar of golden ghee, dried rose petals, shot from above.' },
  { slot: 'carousel-2', group: 'Carousel (night cream), slide 2', rel: 'products/bakuchi-night-repair-cream-2.jpg', size: [800, 800],
    scene: 'Slide 2 of a four-slide set, all in the same look: warm cream linen surface, brass accents, one soft window light from the left, muted ivory and gold palette. This slide: a close-up of rich ivory night cream, a thick swirl lifted with a small brass spatula from an open jar, the texture sharp, a hint of linen behind.' },
  { slot: 'carousel-3', group: 'Carousel (night cream), slide 3', rel: 'products/bakuchi-night-repair-cream-1.jpg', size: [800, 800],
    scene: `Slide 3 of a four-slide set, all in the same look: warm cream linen surface, brass accents, one soft window light from the left, muted ivory and gold palette. This slide: ${PACK.cream}, closed, centred on the linen with a small brass dish beside it, calm and simple, a gentle shadow to the right.` },
  { slot: 'carousel-4', group: 'Carousel (night cream), slide 4', rel: 'posts/bakuchi-night-repair-cream-inside-4.jpg', size: [864, 1080],
    scene: `Slide 4 of a four-slide set, all in the same look: warm cream linen surface, brass accents, one soft window light from the left, muted ivory and gold palette. This slide: a bedside table at night: ${PACK.cream} next to a small brass lamp with a warm glow, a glass of water, a folded cream linen cloth, the window light turned dusky blue, a peaceful end-of-day mood.` },

  // ---- three Photoshoot images (one per finished job: product shoot, flat lay, festival)
  { slot: 'photoshoot-studio', group: 'Photoshoot 1 (product shoot)', rel: 'photoshoot/job1-01-studio.jpg', size: [864, 1080],
    scene: `${PACK.serum}, on a styled studio set: a seamless warm cream paper backdrop, a round pale wooden riser, a sprig of dried flowers, one soft key light from the left and a gentle shadow, the edge of a softbox just visible, premium and calm.` },
  { slot: 'photoshoot-flatlay', group: 'Photoshoot 2 (flat lay)', rel: 'photoshoot/job2-03-natural.jpg', size: [960, 960],
    scene: `A top-down natural flat lay on a pale beige linen cloth: ${PACK.mask} with its lid off beside it, fresh green leaves, a few dried saffron strands and sandalwood shavings, a wooden spoon, loosely scattered, soft even daylight, earthy cream, green and saffron palette, square-friendly composition.` },
  { slot: 'photoshoot-festival', group: 'Photoshoot 3 (festival)', rel: 'photoshoot/job3-02-flowers.jpg', size: [720, 1280],
    scene: `${PACK.oil}, standing in a heap of orange and yellow marigold flowers on a deep red cloth, two lit clay lamps glowing at the sides, warm out-of-focus golden lights behind, tall vertical composition with the bottle low and central, festive evening mood, saffron, gold and crimson palette.` }
]);

/** The extra fourth slide that exists only when its real photo does (the drawn carousel has three). */
const CAROUSEL_EXTRA = Object.freeze({ key: 'bakuchi-night-repair-cream-inside', rel: 'posts/bakuchi-night-repair-cream-inside-4.jpg' });

/** The full prompt sent for one slot. */
const promptFor = (entry) => `${entry.scene} ${STYLE_RULES}`;

/** A safe path under the demo folder: relative, no climbing out, a .jpg in one of the three picture folders. */
function relOk(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\\') || rel.includes('..') || rel.startsWith('/')) return false;
  return /^(products|posts|photoshoot)\/[a-z0-9-]+\.jpg$/.test(rel);
}

module.exports = { GEN_SIZE, STYLE_RULES, PACK, SLOTS, CAROUSEL_EXTRA, promptFor, relOk };
