/**
 * The sample photos on the cover tiles (Create content, Photoshoot packs, Home): one photo per slot, made ONCE by the
 * owner with scripts/generate-sample-photos.js and saved as frontend/public/samples/<slot>.webp.
 *
 * This file is the reviewable list of the exact prompts. Change a prompt here, then redo that one slot
 * (docs/superpowers/ops/sample-photos.md). The slot names must stay the same as in frontend/utils/samplePhotos.ts
 * (a test checks it).
 *
 * Every prompt ends with STYLE_RULES: photorealistic commercial photography of small Indian businesses' products,
 * no faces, no brand names or logos, no text, and calm space at the lower left where the tile title is laid over it.
 */

const STYLE_RULES = [
  'Photorealistic commercial product photography, shot on a full-frame camera with a prime lens, natural true-to-life colours, sharp focus on the product, soft realistic shadows.',
  'No people\'s faces anywhere in the image (a hand is the most that may appear).',
  'No real brand names or logos; packaging and labels are plain and unbranded.',
  'No text, letters, numbers or watermarks anywhere in the image.',
  'Wide landscape 3:2 composition with the main subject a little right of centre and calmer, darker space at the lower left.'
].join(' ');

/** One entry per slot: what the tile is, and the scene. Order = the order they are made in. */
const SLOTS = [
  {
    slot: 'pack-product', tile: 'Photoshoot pack: Product photoshoot',
    scene: 'A handmade chocolate brownie gift box with a plain kraft paper sleeve, standing on a styled studio set: a warm cream paper backdrop, a round wooden riser, a sprig of dried flowers, one soft spotlight from the left and a gentle shadow; the edge of a softbox light is just visible at the right of the frame.'
  },
  {
    slot: 'pack-marketplace', tile: 'Photoshoot pack: Marketplace pack',
    scene: 'Three identical glass jars of homemade mango pickle with plain unlabelled lids, shown from the front, the side and a three-quarter angle, side by side on a seamless pure white background, even shadowless light, like a clean online shop listing.'
  },
  {
    slot: 'pack-festival', tile: 'Photoshoot pack: Festival pack',
    scene: 'A plain gift box of Indian sweets (kaju katli and laddoos) on a brass plate, surrounded by lit clay diyas, marigold flowers and warm string lights on a festive table at evening, golden glow and soft out-of-focus lights behind, Diwali mood.'
  },
  {
    slot: 'pack-lifestyle', tile: 'Photoshoot pack: Lifestyle and in use',
    scene: 'A bar of handmade herbal soap on a wooden soap dish beside a white bathroom basin, a folded cotton towel and a small green plant nearby, soft morning window light, a tidy lived-in home, nobody in the room.'
  },
  {
    slot: 'pack-flatlay', tile: 'Photoshoot pack: Flat lay',
    scene: 'A top-down flat lay of three handmade soap bars, a wooden comb, dried rose petals and eucalyptus leaves neatly arranged on a terracotta-coloured surface, even soft light, lots of clean space between the items.'
  },
  {
    slot: 'pack-white', tile: 'Photoshoot pack: Clean white background',
    scene: 'A scented soy candle in a plain amber glass jar with a wooden lid, on a seamless clean white background with a soft natural shadow underneath, bright even catalogue light.'
  },
  {
    slot: 'create-video', tile: 'Create: Video',
    scene: 'A cinematic still from a short product video: hot South Indian filter coffee being poured from a height into a steel tumbler and dabarah on a café counter, the stream of coffee caught mid-pour with steam rising, shallow depth of field, warm morning light, a slight motion blur.'
  },
  {
    slot: 'create-photoshoot', tile: 'Create: Photoshoot',
    scene: 'A small product photoshoot in progress: a handmade ceramic coffee mug on a pastel paper sweep backdrop, two softbox lights and a white reflector visible at the edges of the frame, a camera on a tripod slightly out of focus in the foreground.'
  },
  {
    slot: 'create-single', tile: 'Create: Single post',
    scene: 'A hand lighting a clay diya with a match on a floor decorated with a colourful rangoli of simple shapes, a plain box of sweets and marigolds beside it, warm Diwali evening glow, only the hand is visible.'
  },
  {
    slot: 'create-campaign', tile: 'Create: Campaign',
    scene: 'Nine printed square photos laid out on a wooden table in a neat three by three grid like a social media feed, every photo showing the same home bakery\'s cakes, cookies and bread in one consistent warm style, seen from slightly above.'
  },
  {
    slot: 'create-carousel', tile: 'Create: Carousel',
    scene: 'Three square printed photos of handmade candles standing upright in a row on a table, slightly overlapping like slides being swiped, the middle one in sharp focus and the two at the sides softly out of focus, warm light.'
  },
  {
    slot: 'create-linkedin', tile: 'Create: LinkedIn',
    scene: 'A tidy modern office desk with a closed laptop, a leather notebook and pen, a cup of masala chai and a small potted plant, a neat sample box of a small business\'s product on the desk, soft daylight from a window, calm professional mood.'
  }
];

/** The full prompt sent for one slot. */
function promptFor(entry) {
  return `${entry.scene} ${STYLE_RULES}`;
}

module.exports = { SLOTS, STYLE_RULES, promptFor };
