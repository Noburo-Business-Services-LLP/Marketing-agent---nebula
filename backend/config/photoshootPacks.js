'use strict';
/**
 * The ready-made Photoshoot packs. Pure config: no database, no network, no prices typed here (each photo is priced by
 * the `photoshoot_image` action in config/apiCosts.js, so a pack costs that times its photo count).
 *
 * Every scene line below goes into an image prompt as written, so each one describes ONLY a setting, light and props:
 * never a person, a face, hands, a body or a mannequin, never a logo, a brand name, text or a festival or religious
 * symbol. The fixed safety rules (services/photoshoot/prompt.js) are added to every prompt on top of these lines.
 * Adding a pack or a scene: keep to those rules and run `node --test tests/photoshootPacks.test.js`.
 *
 * Fields: key, title, subtitle (one line for the tile), counts (photo counts the customer may choose, per product),
 * defaultCount, aspectRatios (first is the default), backgrounds (optional choice; [] = fixed by the pack),
 * place (true: the customer may set the scenes marked `place` in their own space, from Brand assets), scenes.
 */

const BACKGROUNDS = Object.freeze({
  cream: { label: 'Warm cream', prompt: 'a warm cream seamless backdrop' },
  grey: { label: 'Soft grey', prompt: 'a soft light grey seamless backdrop' },
  pastel: { label: 'Pastel', prompt: 'a gentle pastel colour backdrop chosen to suit the product' },
  deep: { label: 'Deep colour', prompt: 'a rich deep colour backdrop chosen to make the product stand out' },
  wood: { label: 'Natural wood', prompt: 'a natural light wood surface' },
  marble: { label: 'Marble', prompt: 'a white marble surface' },
  linen: { label: 'Linen', prompt: 'a soft natural linen cloth' }
});

const ASPECT_LABELS = Object.freeze({ '1:1': 'Square', '4:5': 'Portrait', '9:16': 'Story', '16:9': 'Wide' });

const PACKS = Object.freeze([
  {
    key: 'product',
    title: 'Product photoshoot',
    subtitle: 'Styled studio and setting shots',
    counts: [4, 6], defaultCount: 6, aspectRatios: ['1:1', '4:5'],
    backgrounds: ['cream', 'grey', 'pastel', 'deep'], place: true,
    scenes: [
      { key: 'studio', label: 'Studio light', prompt: 'centred on {background} with soft studio light from the left and a gentle natural shadow' },
      { key: 'hero', label: 'Hero angle', prompt: 'from a low three-quarter angle on {background}, crisp rim light, premium advertising look' },
      { key: 'surface', label: 'On a surface', prompt: 'standing on a clean tabletop in front of {background}, with one simple prop that suits the product' },
      { key: 'detail', label: 'Close detail', prompt: 'as a close detail shot showing its texture and finish, shallow depth of field, {background} softly behind' },
      { key: 'setting', label: 'In a setting', prompt: 'in a bright, tidy real-life setting where it would be used, daylight from a window', place: true },
      { key: 'shelf', label: 'On display', prompt: 'on a neat display shelf with a few plain, unbranded props, warm shop lighting', place: true }
    ]
  },
  {
    key: 'marketplace',
    title: 'Marketplace pack',
    subtitle: 'Square photos on pure white for online shops',
    counts: [4], defaultCount: 4, aspectRatios: ['1:1'],
    backgrounds: [], place: false,
    scenes: [
      { key: 'front', label: 'Front', prompt: 'from the front on a pure white background (#FFFFFF), filling about 85 percent of the frame, even shadowless light' },
      { key: 'side', label: 'Side', prompt: 'from the side on a pure white background (#FFFFFF), filling about 85 percent of the frame, even shadowless light' },
      { key: 'angle', label: 'Angle', prompt: 'from a three-quarter angle on a pure white background (#FFFFFF), filling about 85 percent of the frame, even light' },
      { key: 'closeup', label: 'Close-up', prompt: 'as a close-up of its most important detail on a pure white background (#FFFFFF), sharp focus' }
    ]
  },
  {
    key: 'festival',
    title: 'Festival pack',
    subtitle: 'Your product in warm festive scenes',
    counts: [4, 8], defaultCount: 8, aspectRatios: ['1:1', '4:5', '9:16'],
    backgrounds: [], place: false,
    scenes: [
      { key: 'lights', label: 'Lights and lamps', prompt: 'surrounded by small warm oil lamps and string lights in a cosy evening scene, golden glow' },
      { key: 'flowers', label: 'Flowers', prompt: 'on a table decorated with marigold and jasmine flowers, soft morning light' },
      { key: 'gift', label: 'Gift ready', prompt: 'beside elegant gift boxes with plain ribbons, ready for giving, warm festive colours' },
      { key: 'table', label: 'Celebration table', prompt: 'on a festive celebration table with sweets in plain bowls and soft candle light' },
      { key: 'pattern', label: 'Colour pattern', prompt: 'on a floor decorated with a colourful geometric powder pattern of simple shapes, top light' },
      { key: 'glow', label: 'Evening glow', prompt: 'in a warm evening scene with soft out-of-focus lights behind, rich gold and red tones' },
      { key: 'brass', label: 'Brass and silk', prompt: 'on rich silk cloth beside plain polished brass bowls, warm traditional styling' },
      { key: 'confetti', label: 'Celebration', prompt: 'with gold confetti and soft sparkles falling around it, joyful celebration mood' }
    ]
  },
  {
    key: 'lifestyle',
    title: 'Lifestyle and in use',
    subtitle: 'Natural everyday settings, no people',
    counts: [4, 6], defaultCount: 6, aspectRatios: ['4:5', '1:1', '9:16'],
    backgrounds: [], place: true,
    scenes: [
      { key: 'home', label: 'At home', prompt: 'in a bright, lived-in home setting where it is used every day, soft daylight', place: true },
      { key: 'table', label: 'On the table', prompt: 'on a breakfast or work table ready to be used, with a cup and a notebook nearby', place: true },
      { key: 'outdoor', label: 'Outdoors', prompt: 'outdoors in natural light, on a bench or a garden table, leaves softly in the background' },
      { key: 'ready', label: 'Ready to use', prompt: 'set out ready to use, the scene suggesting the moment just before it is used, the room empty', place: true },
      { key: 'shelf', label: 'On the shelf', prompt: 'on a home shelf among a few plain, unbranded everyday things', place: true },
      { key: 'travel', label: 'On the go', prompt: 'beside an open bag on a desk, ready to be taken along, natural light' }
    ]
  },
  {
    key: 'flatlay',
    title: 'Flat lay',
    subtitle: 'Top-down arrangements with props',
    counts: [4], defaultCount: 4, aspectRatios: ['1:1', '4:5'],
    backgrounds: ['wood', 'marble', 'linen', 'pastel'], place: false,
    scenes: [
      { key: 'minimal', label: 'Minimal', prompt: 'as a top-down flat lay on {background} with lots of space around it and two small plain props' },
      { key: 'colour', label: 'Colourful', prompt: 'as a top-down flat lay on {background} with bright, colourful props arranged in a neat grid' },
      { key: 'natural', label: 'Natural', prompt: 'as a top-down flat lay on {background} with leaves, flowers and natural materials around it' },
      { key: 'kit', label: 'Everything you need', prompt: 'as a top-down flat lay on {background} with the things it is used with arranged neatly around it' }
    ]
  },
  {
    key: 'white',
    title: 'Clean white background',
    subtitle: 'Catalogue and website photos',
    counts: [4], defaultCount: 4, aspectRatios: ['1:1', '4:5'],
    backgrounds: [], place: false,
    scenes: [
      { key: 'front', label: 'Front', prompt: 'from the front on a clean white background with a soft natural shadow underneath' },
      { key: 'angle', label: 'Angle', prompt: 'from a three-quarter angle on a clean white background with a soft natural shadow' },
      { key: 'top', label: 'From above', prompt: 'from slightly above on a clean white background, soft even light' },
      { key: 'reflect', label: 'Reflection', prompt: 'on a clean white glossy surface with a faint reflection below it' }
    ]
  }
]);

const packOf = (key) => PACKS.find((p) => p.key === key) || null;

module.exports = { PACKS, BACKGROUNDS, ASPECT_LABELS, packOf };
