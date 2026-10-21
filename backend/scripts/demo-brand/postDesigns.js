'use strict';
/**
 * How every demo post picture is laid out (D125): which layout family, which real photo (photoPrompts.js slot) and how it is
 * cropped, the palette mood, and the small texts around the headline. Pure data: no canvas, no files.
 *
 * The headline itself is always the post's `head` (contentBank.js / content.js), so the picture, the stored imageText and
 * the calendar line say the same thing; the texts here (kicker, sub, items, badge) are the supporting lines and agree with
 * the caption. No medical claims, no before-and-after (the brand rules in constants.js), no named competitors.
 */
const { PRODUCTS } = require('./constants');
const bank = require('./contentBank');

const bySlug = Object.fromEntries(PRODUCTS.map((p) => [p.slug, p]));
const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

/** A crop: zoom (>= 1) around a focus point (fx, fy from 0 to 1), optionally flipped, warmed or muted. */
const crop = (zoom = 1, fx = 0.5, fy = 0.5, more = {}) => ({ zoom, fx, fy, ...more });

/** The 24 photo slots (photoPrompts.js) and where the main subject of each sits. */
const PHOTO_SLOTS = Object.freeze([
  'product-marble', 'product-clay', 'product-leaf', 'swatch-texture', 'packaging-stack', 'marketplace-white',
  'flatlay-turmeric', 'flatlay-neem', 'flatlay-amla', 'flatlay-rose', 'diwali-diyas', 'gifting-hamper', 'bathroom-shelf',
  'monsoon-mood', 'sandal-ritual', 'summer-spf', 'lip-balm-trio', 'carousel-1', 'carousel-2', 'carousel-3', 'carousel-4',
  'photoshoot-studio', 'photoshoot-flatlay', 'photoshoot-festival'
]);

// ---- per product: the seven posts each product has (ritual, inside, howto, story, offer, myth, batch)
const P = {
  'kumkumadi-glow-serum': {
    ritual: { family: 'hero', mood: 'plum', photoSlot: 'swatch-texture', crop: crop(1.12, 0.55, 0.36), kicker: 'The night ritual', sub: 'Kumkumadi Glow Serum, with real saffron and manjistha' },
    inside: { family: 'inside', mood: 'ivory', photoSlot: 'product-marble', crop: crop(1.3, 0.5, 0.5), items: ['Saffron', 'Manjistha', 'Sandalwood', 'Vetiver'],
      slides: [
        { family: 'spotlight', mood: 'forest', photoSlot: 'photoshoot-flatlay', crop: crop(3.4, 0.83, 0.16), head: 'Saffron', body: 'Real threads, steeped in oil for weeks.' },
        { family: 'spotlight', mood: 'terracotta', photoSlot: 'swatch-texture', crop: crop(1.7, 0.5, 0.78), head: 'Manjistha', body: 'A root used in ayurveda for centuries.' }
      ] },
    howto: { family: 'reel', mood: 'ivory', photoSlot: 'bathroom-shelf', crop: crop(1.4, 0.38, 0.55), kicker: 'Reel · how to', length: '0:30' },
    story: { family: 'testimonial', mood: 'ivory', photoSlot: 'product-marble', crop: crop(1.1, 0.5, 0.5, { flip: true }) },
    offer: { family: 'offer', mood: 'ivory', photoSlot: 'bathroom-shelf', crop: crop(1.12, 0.45, 0.47), badge: 'FREE SHIPPING', badgeSub: 'THIS WEEK', kicker: 'The night duo offer', sub: 'Kumkumadi Serum with the Rose Toner, shipped free across India.' },
    myth: { family: 'mythFact', variant: 'cards', mood: 'ivory', photoSlot: 'product-marble', crop: crop(1.35, 0.5, 0.55, { flip: true }),
      slides: [
        { family: 'slide', mood: 'ivory', photoSlot: 'swatch-texture', crop: crop(1.25, 0.55, 0.5), head: 'Why a light oil works', body: 'It sinks in within minutes, with no grease. Fragrance-light, for daily night use.' },
        { family: 'slide', mood: 'ivory', photoSlot: 'photoshoot-studio', crop: crop(1.2, 0.55, 0.55), head: 'How to use it', body: 'Warm three drops between your palms, press into clean skin, leave it on overnight.' }
      ] },
    batch: { family: 'collage', mood: 'terracotta', kicker: 'Batch 14 · steeped six weeks', photos: [{ photoSlot: 'swatch-texture', crop: crop(1.4, 0.55, 0.4) }, { photoSlot: 'product-marble', crop: crop(1.25, 0.5, 0.55) }, { photoSlot: 'photoshoot-flatlay', crop: crop(2.4, 0.78, 0.2) }] }
  },
  'saffron-sandal-face-mask': {
    ritual: { family: 'arch', mood: 'saffron', photoSlot: 'sandal-ritual', crop: crop(1.1, 0.45, 0.55), kicker: 'The Sunday ritual', sub: 'Mix with rose water, rest ten minutes, rinse with cool water.' },
    inside: { family: 'inside', mood: 'sage', photoSlot: 'photoshoot-flatlay', crop: crop(1.15, 0.45, 0.5), items: ['Saffron', 'Sandalwood', 'Multani mitti', 'Rose water'],
      slides: [
        { family: 'spotlight', mood: 'plum', photoSlot: 'sandal-ritual', crop: crop(2.6, 0.84, 0.8), head: 'Sandalwood', body: 'Slow-ground for a soft, calm smell.' },
        { family: 'spotlight', mood: 'saffron', photoSlot: 'sandal-ritual', crop: crop(2.1, 0.45, 0.6), head: 'Multani mitti', body: 'Gentle clay that soaks up the day.' }
      ] },
    howto: { family: 'reel', mood: 'plum', photoSlot: 'sandal-ritual', crop: crop(1.3, 0.5, 0.5, { flip: true }), variant: 'bottom', kicker: 'Reel · how to', length: '0:30' },
    story: { family: 'testimonial', mood: 'terracotta', photoSlot: 'product-clay', crop: crop(1.2, 0.4, 0.6), variant: 'panel' },
    offer: { family: 'offer', mood: 'saffron', photoSlot: 'product-clay', crop: crop(1.15, 0.42, 0.55), badge: inr(1149), badgeSub: 'MASK + TONER', kicker: 'Sunday ritual pack', sub: 'Saffron Sandal Mask with the Rose Toner, this weekend only.' },
    myth: { family: 'mythFact', mood: 'ivory', photoSlot: 'product-clay', crop: crop(1.3, 0.42, 0.55, { flip: true }),
      slides: [
        { family: 'slide', mood: 'sage', photoSlot: 'sandal-ritual', crop: crop(1.5, 0.45, 0.6), head: 'Calm is the point', body: 'A good clay mask should feel soft. If it stings, wash it off.' },
        { family: 'slide', mood: 'sage', photoSlot: 'photoshoot-flatlay', crop: crop(1.3, 0.45, 0.55), head: 'How to use it', body: 'Mix a spoon with rose water, apply, rest ten minutes, rinse with cool water.' }
      ] },
    batch: { family: 'collage', mood: 'ivory', kicker: 'Slow-ground sandalwood', photos: [{ photoSlot: 'sandal-ritual', crop: crop(1.7, 0.84, 0.78) }, { photoSlot: 'product-clay', crop: crop(1.2, 0.4, 0.6) }, { photoSlot: 'photoshoot-flatlay', crop: crop(2.2, 0.4, 0.78) }] }
  },
  'rose-petal-toner': {
    ritual: { family: 'split', mood: 'blush', photoSlot: 'product-leaf', crop: crop(1.08, 0.5, 0.5), kicker: 'Morning and midday', body: 'Rose water from Kannauj with aloe, alcohol-free. Mist from an arm’s length and pat gently.', note: 'Rose Petal Toner · 150 ml' },
    inside: { family: 'inside', mood: 'blush', photoSlot: 'flatlay-rose', crop: crop(1.2, 0.45, 0.45), items: ['Rose water', 'Aloe vera', 'Glycerin'],
      slides: [
        { family: 'spotlight', mood: 'plum', photoSlot: 'flatlay-rose', crop: crop(2.4, 0.2, 0.84), head: 'Rose', body: 'Steam-distilled in Kannauj, never perfumed.' },
        { family: 'spotlight', mood: 'forest', photoSlot: 'product-leaf', crop: crop(2.2, 0.5, 0.86), head: 'Aloe vera', body: 'Light water for a fresh feel.' }
      ] },
    howto: { family: 'reel', mood: 'forest', photoSlot: 'product-leaf', crop: crop(1.35, 0.5, 0.4), variant: 'card', kicker: 'Reel · how to', length: '0:20' },
    story: { family: 'testimonial', mood: 'blush', photoSlot: 'flatlay-rose', crop: crop(1.2, 0.45, 0.5), variant: 'panel' },
    offer: { family: 'offer', mood: 'ivory', photoSlot: 'flatlay-rose', crop: crop(1.25, 0.45, 0.45, { flip: true }), badge: 'FREE MINI', badgeSub: 'ROSE TONER', kicker: 'Until the weekend', sub: 'With every order above ₹1,499.' },
    myth: { family: 'mythFact', mood: 'blush', photoSlot: 'product-leaf', crop: crop(1.25, 0.5, 0.45),
      slides: [
        { family: 'slide', mood: 'blush', photoSlot: 'flatlay-rose', crop: crop(1.5, 0.3, 0.3), head: 'What a toner does', body: 'It gets skin ready for serum, so the next step sinks in better. Ours has no alcohol.' },
        { family: 'slide', mood: 'blush', photoSlot: 'product-leaf', crop: crop(1.3, 0.5, 0.55), head: 'How to use it', body: 'Close your eyes, mist from an arm’s length and pat gently.' }
      ] },
    batch: { family: 'collage', variant: 'grid', mood: 'sage', kicker: 'Fresh from Kannauj', photos: [{ photoSlot: 'flatlay-rose', crop: crop(1.8, 0.22, 0.3) }, { photoSlot: 'product-leaf', crop: crop(1.15, 0.5, 0.5) }, { photoSlot: 'bathroom-shelf', crop: crop(1.7, 0.55, 0.45) }] }
  },
  'neem-turmeric-cleanser': {
    ritual: { family: 'arch', mood: 'sage', photoSlot: 'flatlay-neem', crop: crop(1.08, 0.55, 0.45), kicker: 'Morning and after a long day', sub: 'Neem and Turmeric Cleanser. Soap-free, never tight.' },
    inside: { family: 'inside', mood: 'saffron', photoSlot: 'flatlay-turmeric', crop: crop(1.05, 0.48, 0.42), items: ['Neem', 'Turmeric', 'Tulsi', 'Coconut cleansers'],
      slides: [
        { family: 'spotlight', mood: 'forest', photoSlot: 'flatlay-turmeric', crop: crop(2.3, 0.45, 0.62), head: 'Turmeric', body: 'The golden spice from our kitchens.' },
        { family: 'spotlight', mood: 'ivory', photoSlot: 'flatlay-neem', crop: crop(2.0, 0.2, 0.45), head: 'Neem', body: 'The tree outside every Tamil home.' }
      ] },
    howto: { family: 'reel', mood: 'sage', photoSlot: 'flatlay-neem', crop: crop(1.3, 0.55, 0.5, { flip: true }), variant: 'bottom', kicker: 'Reel · how to', length: '0:30' },
    story: { family: 'testimonial', mood: 'forest', photoSlot: 'flatlay-neem', crop: crop(1.15, 0.5, 0.5), variant: 'panel' },
    offer: { family: 'offer', mood: 'forest', photoSlot: 'packaging-stack', crop: crop(1.12, 0.5, 0.55), badge: '10% OFF', badgeSub: 'CODE ZAYA10', kicker: 'Your first order', sub: 'Use ZAYA10 on the cleanser and everything else in the cart.', burstBg: '#E8A33A', burstInk: '#2A1529' },
    myth: { family: 'mythFact', variant: 'cards', mood: 'sage', photoSlot: 'packaging-stack', crop: crop(1.25, 0.5, 0.5, { flip: true }),
      slides: [
        { family: 'slide', mood: 'sage', photoSlot: 'flatlay-neem', crop: crop(1.4, 0.55, 0.5), head: 'Foam is only soap', body: 'Our gel cleans with gentle cleansers and leaves skin soft, never tight.' },
        { family: 'slide', mood: 'sage', photoSlot: 'flatlay-turmeric', crop: crop(1.3, 0.5, 0.45), head: 'How to use it', body: 'Wet your face, take one pump, massage for a minute and rinse.' }
      ] },
    batch: { family: 'collage', mood: 'sage', kicker: 'Sun-dried neem', photos: [{ photoSlot: 'flatlay-turmeric', crop: crop(1.5, 0.6, 0.4) }, { photoSlot: 'flatlay-neem', crop: crop(1.6, 0.3, 0.45) }, { photoSlot: 'packaging-stack', crop: crop(1.3, 0.5, 0.5) }] }
  },
  'bakuchi-night-repair-cream': {
    ritual: { family: 'minimal', mood: 'ivory', photoSlot: 'carousel-3', crop: crop(1.12, 0.5, 0.48), price: inr(1099), sub: 'Bakuchi Night Repair Cream · 50 g' },
    inside: { family: 'inside', mood: 'plum', photoSlot: 'carousel-1', crop: crop(1.0, 0.5, 0.42), items: ['Bakuchi', 'Shea butter', 'Ashwagandha'],
      slides: [
        { family: 'spotlight', mood: 'forest', photoSlot: 'carousel-1', crop: crop(2.8, 0.42, 0.2), head: 'Bakuchi', body: 'The plant many people choose over retinol.' },
        { family: 'spotlight', mood: 'ivory', photoSlot: 'carousel-1', crop: crop(2.5, 0.42, 0.46), head: 'Shea butter', body: 'A rich cushion for night.' }
      ],
      extra: { family: 'spotlight', mood: 'night', photoSlot: 'carousel-4', crop: crop(1.5, 0.45, 0.6), head: 'Made for night', body: 'A pea-sized amount after your serum, then sleep.' } },
    howto: { family: 'reel', mood: 'plum', photoSlot: 'carousel-2', crop: crop(1.2, 0.45, 0.55), variant: 'card', kicker: 'Reel · how to', length: '0:30' },
    story: { family: 'testimonial', mood: 'night', photoSlot: 'carousel-4', crop: crop(1.2, 0.45, 0.6) },
    offer: { family: 'offer', mood: 'plum', photoSlot: 'carousel-4', crop: crop(1.12, 0.45, 0.62), badge: inr(2199), badgeSub: 'CREAM + SERUM', kicker: 'The night duo', sub: 'Bakuchi Night Cream with the Kumkumadi Serum, a small saving.', burstBg: '#E8A33A', burstInk: '#2A1529' },
    myth: { family: 'mythFact', variant: 'cards', mood: 'ivory', photoSlot: 'carousel-3', crop: crop(1.3, 0.5, 0.5, { flip: true }),
      slides: [
        { family: 'slide', mood: 'ivory', photoSlot: 'carousel-1', crop: crop(1.4, 0.45, 0.35), head: 'Meet bakuchi', body: 'A plant many people find kinder than retinol. Start slow, twice a week.' },
        { family: 'slide', mood: 'ivory', photoSlot: 'carousel-2', crop: crop(1.3, 0.45, 0.55), head: 'Always wear sunscreen', body: 'Night cream at night, sunscreen by day. Every day.' }
      ] },
    batch: { family: 'collage', mood: 'terracotta', kicker: 'Stirred, never rushed', photos: [{ photoSlot: 'carousel-2', crop: crop(1.3, 0.45, 0.5) }, { photoSlot: 'carousel-1', crop: crop(1.6, 0.42, 0.4) }, { photoSlot: 'carousel-3', crop: crop(1.2, 0.5, 0.5) }] }
  },
  'tinted-mineral-spf-40': {
    ritual: { family: 'split', side: 'right', mood: 'saffron', photoSlot: 'marketplace-white', crop: crop(1.0, 0.45, 0.52), kicker: 'Every morning', body: 'Thirty minutes before you step out, and again if you are outdoors for hours.', note: 'Tinted Mineral SPF 40' },
    inside: { family: 'inside', mood: 'terracotta', photoSlot: 'summer-spf', crop: crop(1.0, 0.5, 0.58), items: ['Zinc oxide', 'Iron oxides (tint)', 'Carrot seed oil'],
      slides: [
        { family: 'spotlight', mood: 'ivory', photoSlot: 'marketplace-white', crop: crop(1.7, 0.45, 0.4), head: 'Zinc oxide', body: 'A mineral shield that sits on skin.' },
        { family: 'spotlight', mood: 'terracotta', photoSlot: 'summer-spf', crop: crop(2.0, 0.55, 0.55), head: 'Iron oxides', body: 'The sheer tint, matched to Indian skin.' }
      ] },
    howto: { family: 'reel', mood: 'ivory', photoSlot: 'summer-spf', crop: crop(1.25, 0.55, 0.55, { flip: true }), variant: 'bottom', kicker: 'Reel · how to', length: '0:25' },
    story: { family: 'testimonial', mood: 'ivory', photoSlot: 'summer-spf', crop: crop(1.1, 0.55, 0.5), variant: 'panel' },
    offer: { family: 'offer', mood: 'saffron', photoSlot: 'summer-spf', crop: crop(1.1, 0.6, 0.5), badge: inr(1049), badgeSub: 'SPF + CLEANSER', kicker: 'This week only', sub: 'Tinted Mineral SPF 40 with the Neem Cleanser.' },
    myth: { family: 'mythFact', mood: 'ivory', photoSlot: 'marketplace-white', crop: crop(1.2, 0.45, 0.5),
      slides: [
        { family: 'slide', mood: 'ivory', photoSlot: 'summer-spf', crop: crop(1.4, 0.55, 0.5), head: 'Every skin tone needs it', body: 'Ours has a sheer tint made for Indian skin tones, so there is no white cast.' },
        { family: 'slide', mood: 'ivory', photoSlot: 'marketplace-white', crop: crop(1.3, 0.45, 0.55), head: 'How much to use', body: 'Two finger lengths, thirty minutes before you step out.' }
      ] },
    batch: { family: 'collage', variant: 'grid', mood: 'blush', kicker: 'Matched to fifty skin tones', photos: [{ photoSlot: 'marketplace-white', crop: crop(1.15, 0.45, 0.5) }, { photoSlot: 'summer-spf', crop: crop(1.3, 0.55, 0.55, { flip: true }) }, { photoSlot: 'summer-spf', crop: crop(2.2, 0.8, 0.62) }] }
  },
  'coconut-hibiscus-hair-oil': {
    ritual: { family: 'arch', mood: 'forest', photoSlot: 'flatlay-amla', crop: crop(1.15, 0.45, 0.5), kicker: 'The Sunday oil bath', sub: 'Coconut and Hibiscus Hair Oil, the recipe from home.' },
    inside: { family: 'inside', mood: 'ivory', photoSlot: 'flatlay-amla', crop: crop(1.0, 0.5, 0.45, { flip: true }), items: ['Coconut oil', 'Hibiscus', 'Curry leaf', 'Fenugreek'],
      slides: [
        { family: 'spotlight', mood: 'plum', photoSlot: 'flatlay-amla', crop: crop(2.6, 0.78, 0.13), head: 'Hibiscus', body: 'The red flower every grandmother knew.' },
        { family: 'spotlight', mood: 'forest', photoSlot: 'flatlay-amla', crop: crop(2.6, 0.86, 0.44), head: 'Coconut', body: 'Cold-pressed, never refined.' }
      ] },
    howto: { family: 'reel', mood: 'terracotta', photoSlot: 'flatlay-amla', crop: crop(1.4, 0.45, 0.55, { flip: true }), variant: 'bottom', kicker: 'Reel · how to', length: '0:30' },
    story: { family: 'testimonial', mood: 'forest', photoSlot: 'monsoon-mood', crop: crop(1.15, 0.5, 0.55) },
    offer: { family: 'offer', mood: 'terracotta', photoSlot: 'monsoon-mood', crop: crop(1.1, 0.5, 0.55, { flip: true }), badge: `2 FOR ${inr(1099)}`, badgeSub: 'HAIR OIL', kicker: 'Oil bath bundle', sub: 'Coconut and Hibiscus Hair Oil, a perfect gift for the family.', burstBg: '#E8A33A', burstInk: '#2A1529' },
    myth: { family: 'mythFact', variant: 'cards', mood: 'sage', photoSlot: 'flatlay-amla', crop: crop(1.3, 0.45, 0.5),
      slides: [
        { family: 'slide', mood: 'sage', photoSlot: 'monsoon-mood', crop: crop(1.3, 0.5, 0.6), head: 'A ritual, not a rule', body: 'Plenty of people in their twenties and thirties still do a Sunday oil bath.' },
        { family: 'slide', mood: 'sage', photoSlot: 'photoshoot-festival', crop: crop(1.3, 0.5, 0.55), head: 'How to use it', body: 'Warm it slightly, massage your scalp, leave it on for an hour, wash as usual.' }
      ] },
    batch: { family: 'collage', variant: 'grid', mood: 'ivory', kicker: 'Curry leaf and hibiscus', photos: [{ photoSlot: 'flatlay-amla', crop: crop(1.8, 0.8, 0.15) }, { photoSlot: 'photoshoot-festival', crop: crop(1.3, 0.5, 0.55) }, { photoSlot: 'monsoon-mood', crop: crop(1.4, 0.5, 0.6) }] }
  },
  'lip-balm-trio': {
    ritual: { family: 'minimal', mood: 'blush', photoSlot: 'lip-balm-trio', crop: crop(1.05, 0.55, 0.5), price: inr(399), sub: 'Lip Balm Trio · Bare, Rose and Beet' },
    inside: { family: 'inside', mood: 'terracotta', photoSlot: 'lip-balm-trio', crop: crop(1.25, 0.55, 0.48), items: ['Beeswax', 'Kokum butter', 'Beetroot tint', 'Rose'],
      slides: [
        { family: 'spotlight', mood: 'ivory', photoSlot: 'lip-balm-trio', crop: crop(1.9, 0.5, 0.45), head: 'Kokum butter', body: 'A gentle butter from the Western Ghats.' },
        { family: 'spotlight', mood: 'saffron', photoSlot: 'lip-balm-trio', crop: crop(2.6, 0.3, 0.82), head: 'Beeswax', body: 'A soft seal for dry lips.' }
      ] },
    howto: { family: 'reel', mood: 'plum', photoSlot: 'lip-balm-trio', crop: crop(1.3, 0.55, 0.5, { flip: true }), variant: 'card', kicker: 'Reel · how to', length: '0:15' },
    story: { family: 'testimonial', mood: 'blush', photoSlot: 'gifting-hamper', crop: crop(1.3, 0.6, 0.5) },
    offer: { family: 'offer', mood: 'blush', photoSlot: 'gifting-hamper', crop: crop(1.2, 0.62, 0.5), badge: 'FREE', badgeSub: 'LIP BALM TRIO', kicker: 'Our festive thank-you', sub: 'With every order above ₹1,499.' },
    myth: { family: 'mythFact', mood: 'blush', photoSlot: 'lip-balm-trio', crop: crop(1.4, 0.55, 0.5, { flip: true }),
      slides: [
        { family: 'slide', mood: 'blush', photoSlot: 'lip-balm-trio', crop: crop(1.7, 0.5, 0.5), head: 'Care first, colour second', body: 'A tint with kokum butter. Bare, Rose and Beet cover most moods.' },
        { family: 'slide', mood: 'blush', photoSlot: 'gifting-hamper', crop: crop(1.7, 0.66, 0.5), head: 'Keep one everywhere', body: 'One in your bag, one by the bed and one in the car.' }
      ] },
    batch: { family: 'collage', mood: 'sage', kicker: 'Three shades, one pour', photos: [{ photoSlot: 'lip-balm-trio', crop: crop(1.5, 0.55, 0.5) }, { photoSlot: 'gifting-hamper', crop: crop(1.8, 0.65, 0.5) }] }
  }
};

// ---- the hand-written posts (founder, education, seasonal, the next weeks)
const KEYED = {
  'founder-brass-pot': { family: 'statement', mood: 'ivory', photoSlot: 'swatch-texture', crop: crop(1.5, 0.55, 0.3), kicker: 'Founder story · Aanya', sub: 'Every Zaya recipe begins in my paati’s kitchen. The serum is still poured and labelled by hand in Chennai.' },
  'founder-chemist': { family: 'split', mood: 'ivory', photoSlot: 'photoshoot-studio', crop: crop(1.15, 0.55, 0.55), kicker: 'Meet the team', body: 'He tests the pH, the texture and the smell of every batch before it is bottled.', note: 'Swipe to meet him',
    slides: [
      { family: 'slide', mood: 'ivory', photoSlot: 'swatch-texture', crop: crop(1.3, 0.55, 0.45), head: 'pH, texture, smell', body: 'Three checks on every batch. If a batch is not right, it does not leave the studio.' },
      { family: 'slide', mood: 'ivory', photoSlot: 'packaging-stack', crop: crop(1.2, 0.5, 0.5), head: 'Clean, not clinical', body: 'Made the way grandmothers did, tested the way dermatologists want.' }
    ] },
  'founder-first-orders': { family: 'collage', variant: 'grid', mood: 'terracotta', kicker: 'Chennai, 2022', reel: true, photos: [{ photoSlot: 'packaging-stack', crop: crop(1.2, 0.5, 0.5) }, { photoSlot: 'gifting-hamper', crop: crop(1.3, 0.5, 0.5) }, { photoSlot: 'flatlay-rose', crop: crop(1.4, 0.45, 0.5) }] },
  'founder-why-chennai': { family: 'split', side: 'right', mood: 'forest', photoSlot: 'flatlay-neem', crop: crop(1.12, 0.5, 0.5, { flip: true }), kicker: 'Founder story', body: 'Neem, curry leaves and coconut oil from a few hours away. If a formula works in Chennai humidity, it works anywhere.', note: 'Made in Chennai' },
  'founder-label': { family: 'statement', mood: 'terracotta', photoSlot: 'packaging-stack', crop: crop(1.5, 0.5, 0.48), kicker: 'Read the label', sub: 'Every ingredient on a Zaya jar is named, with where it comes from.' },

  'edu-order': { family: 'list', mood: 'ivory', photoSlot: 'bathroom-shelf', crop: crop(1.25, 0.45, 0.42), kicker: 'Skin school', swipe: true,
    items: ['Cleanser: wash the day off', 'Toner: preps skin for the next step', 'Serum: the step that does the work', 'Cream: seal it in at night', 'Sunscreen: every morning, last'],
    slides: [
      { family: 'slide', mood: 'ivory', photoSlot: 'flatlay-neem', crop: crop(1.3, 0.55, 0.5), head: 'Start with a cleanser', body: 'Morning and night. Soap-free, so skin is never tight.' },
      { family: 'slide', mood: 'ivory', photoSlot: 'summer-spf', crop: crop(1.3, 0.55, 0.55), head: 'End with sunscreen', body: 'Every morning, as the last step. Even on cloudy days.' }
    ] },
  'edu-labels': { family: 'tip', mood: 'sage', photoSlot: 'carousel-3', crop: crop(1.4, 0.5, 0.5), kicker: 'Label school', body: 'The plain name of the ingredient, where it comes from, and how much is inside.', note: 'Swipe for examples',
    slides: [
      { family: 'slide', mood: 'sage', photoSlot: 'carousel-1', crop: crop(1.7, 0.4, 0.25, { flip: true }), head: 'The plain name', body: 'Bakuchi, not a code. If a word on the label is new to you, ask us.' },
      { family: 'slide', mood: 'sage', photoSlot: 'photoshoot-flatlay', crop: crop(1.3, 0.45, 0.5), head: 'Where it is from', body: 'Rose water from Kannauj, neem from home. The source belongs on the label.' }
    ] },
  'edu-spf-humid': { family: 'tip', mood: 'terracotta', photoSlot: 'summer-spf', crop: crop(1.3, 0.55, 0.55), kicker: 'Did you know?', body: 'Sweat does not mean the sunscreen has gone, but reapply every two to three hours outdoors.', note: 'Save for summer' },
  'edu-patch': { family: 'statement', mood: 'sage', photoSlot: 'flatlay-neem', crop: crop(2.0, 0.22, 0.45), kicker: 'Skin school', sub: 'Try a new product on your inner arm for a day before it meets your face. Every brand, ours too.' },
  'edu-oil-types': { family: 'list', mood: 'forest', photoSlot: 'flatlay-amla', crop: crop(1.3, 0.5, 0.3), kicker: 'Hair school', swipe: true,
    items: ['Coconut: cold-pressed, for softness', 'Hibiscus: the flower for shine', 'Curry leaf: the kitchen classic', 'Leave it on for an hour, then wash'],
    slides: [
      { family: 'slide', mood: 'forest', photoSlot: 'monsoon-mood', crop: crop(1.6, 0.35, 0.55, { flip: true }), head: 'How long to leave it', body: 'An hour is plenty. Wash with a mild shampoo and warm water.' },
      { family: 'slide', mood: 'forest', photoSlot: 'photoshoot-festival', crop: crop(1.4, 0.5, 0.5), head: 'Make it a Sunday ritual', body: 'Warm the oil slightly, massage slowly, rest, then wash.' }
    ] },
  'edu-glow-water': { family: 'reel', mood: 'plum', photoSlot: 'photoshoot-studio', crop: crop(1.15, 0.55, 0.55), variant: 'bottom', kicker: 'Reel · night routine', length: '0:40' },
  'edu-lips': { family: 'split', mood: 'terracotta', photoSlot: 'lip-balm-trio', crop: crop(1.3, 0.55, 0.5, { flip: true }), kicker: 'Lip care', body: 'AC, monsoon, the train. A kokum butter balm in your bag solves most of it.', note: 'Bare · Rose · Beet' },
  'edu-clay': { family: 'tip', mood: 'saffron', photoSlot: 'sandal-ritual', crop: crop(1.45, 0.45, 0.55), kicker: 'Skin school', body: 'Once or twice a week is plenty. Rinse with cool water, then toner and serum.', note: 'Save this' },

  'sea-summer': { family: 'list', mood: 'saffron', photoSlot: 'summer-spf', crop: crop(1.15, 0.55, 0.35), kicker: 'Summer routine',
    items: ['Cleanse: neem cleanser in the morning', 'Protect: tinted SPF before you step out', 'Refresh: rose toner mist at midday'] },
  'sea-monsoon': { family: 'hero', mood: 'forest', photoSlot: 'monsoon-mood', crop: crop(1.05, 0.5, 0.42), kicker: 'Monsoon Sunday', sub: 'Hibiscus and curry leaf in cold-pressed coconut oil, just as it was done at home.' },
  'sea-independence': { family: 'festive', mood: 'forest', motif: 'tricolour', photoSlot: 'lip-balm-trio', crop: crop(1.2, 0.55, 0.5), script: 'சுதந்திர தின வாழ்த்துகள்', sub: 'Independence Day: a free Lip Balm Trio on every order above ₹1,499.' },
  'sea-onam': { family: 'festive', mood: 'forest', motif: 'pookalam', photoSlot: 'photoshoot-festival', crop: crop(1.15, 0.5, 0.55), script: 'ഓണാശംസകൾ', sub: 'Flowers on the floor, oil in the hair, family around the table.' },
  'sea-rakhi': { family: 'festive', variant: 'full', mood: 'plum', motif: 'rangoli', photoSlot: 'gifting-hamper', crop: crop(1.1, 0.5, 0.5), script: 'शुभ रक्षाबंधन', sub: 'Three gifts under ₹999 that arrive in time. Swipe.',
    slides: [
      { family: 'slide', mood: 'blush', photoSlot: 'lip-balm-trio', crop: crop(1.3, 0.55, 0.5), head: 'For her: Lip Balm Trio', body: '₹399. Three tinted balms with kokum butter.' },
      { family: 'slide', mood: 'blush', photoSlot: 'flatlay-amla', crop: crop(1.2, 0.45, 0.5), head: 'For him: the Hair Oil', body: '₹599. And the Rose Toner, ₹549, for anyone.' }
    ] },
  'sea-ganesh': { family: 'festive', mood: 'festive', motif: 'toran', photoSlot: 'sandal-ritual', crop: crop(1.15, 0.45, 0.55), script: 'गणपति बप्पा मोरया', sub: 'Sandal and saffron for the quiet moment between the pooja and the guests.' },
  'sea-navratri-start': { family: 'reel', mood: 'festive', photoSlot: 'gifting-hamper', crop: crop(1.45, 0.38, 0.45), variant: 'card', kicker: 'Reel · Navratri', length: '0:45' },
  'sea-navratri-end': { family: 'story', mood: 'plum', photoSlot: 'flatlay-rose', crop: crop(1.15, 0.45, 0.5), kicker: 'Thank you for tagging us', options: ['Rose toner mist', 'Kumkumadi nights'] },

  'soon-karwa': { family: 'festive', mood: 'night', motif: 'moon', photoSlot: 'product-clay', crop: crop(1.2, 0.4, 0.58), script: 'करवा चौथ', sub: 'Mask on for ten minutes, rose water, a little serum. Wishing you a beautiful evening.' },
  'soon-dhanteras': { family: 'festive', mood: 'festive', motif: 'diyas', variant: 'full', photoSlot: 'diwali-diyas', crop: crop(1.1, 0.5, 0.42), script: 'शुभ धनतेरस', sub: 'Gold is for the locker. The glow is for every day.' },
  'soon-box-live': { family: 'launch', mood: 'ivory', photoSlot: 'gifting-hamper', crop: crop(1.08, 0.5, 0.5), kicker: 'Now live', sub: 'Serum, saffron mask, rose toner and a lip balm, wrapped by hand.', price: '₹1,999', swipe: true,
    slides: [
      { family: 'slide', mood: 'ivory', photoSlot: 'gifting-hamper', crop: crop(1.8, 0.36, 0.55), head: 'What is inside', body: 'Kumkumadi Serum, Saffron Sandal Mask, Rose Toner and a lip balm.' },
      { family: 'slide', mood: 'ivory', photoSlot: 'packaging-stack', crop: crop(1.5, 0.4, 0.4, { flip: true }), head: 'Wrapped by hand', body: 'In cotton and sage, with a card. Free shipping across India.' }
    ] },
  'soon-early-bird': { family: 'offer', mood: 'festive', photoSlot: 'lip-balm-trio', crop: crop(1.15, 0.5, 0.45), badge: 'FREE', badgeSub: 'LIP BALM TRIO', kicker: 'Early bird Diwali', sub: 'On orders above ₹1,499. Azhagu for you, a small gift for them.', burstBg: '#E8A33A', burstInk: '#2A1529' },
  'soon-packing': { family: 'collage', variant: 'grid', mood: 'festive', kicker: 'Behind the scenes', reel: true, photos: [{ photoSlot: 'gifting-hamper', crop: crop(1.2, 0.5, 0.5) }, { photoSlot: 'packaging-stack', crop: crop(1.3, 0.5, 0.5, { flip: true }) }, { photoSlot: 'diwali-diyas', crop: crop(1.5, 0.5, 0.4) }] },
  'soon-bhaidooj': { family: 'minimal', mood: 'festive', photoSlot: 'photoshoot-festival', crop: crop(1.08, 0.5, 0.55), price: `2 for ${inr(1099)}`, sub: 'Coconut and Hibiscus Hair Oil · two bottles, wrapped' },
  'soon-last-date': { family: 'countdown', mood: 'ivory', photoSlot: 'flatlay-rose', crop: crop(1.3, 0.4, 0.3, { flip: true }), kicker: 'Diwali delivery', big: 'Order by Sunday', line: 'and it reaches you before Diwali', sub: 'Metros in three days, the rest of India in five.' },
  'soon-oilbath': { family: 'hero', mood: 'festive', align: 'center', photoSlot: 'photoshoot-festival', crop: crop(1.05, 0.5, 0.45), kicker: 'Diwali morning', sub: 'Warm the hibiscus oil, massage slowly, wash with warm water.' },
  'soon-prep': { family: 'list', mood: 'festive', photoSlot: 'product-marble', crop: crop(1.25, 0.5, 0.45), kicker: 'Diwali skin prep', swipe: true,
    items: ['Every day: water, and sleep early', 'Twice this week: the saffron mask', 'Every night: three drops of serum', 'Keep it simple: nothing new this week'],
    slides: [
      { family: 'slide', mood: 'festive', photoSlot: 'sandal-ritual', crop: crop(1.4, 0.45, 0.55), head: 'Mask twice', body: 'Day two and day five, ten minutes each.' },
      { family: 'slide', mood: 'festive', photoSlot: 'swatch-texture', crop: crop(1.3, 0.55, 0.4), head: 'Serum every night', body: 'Three drops on clean skin, then sleep early.' }
    ] },
  'soon-guide': { family: 'guide', mood: 'ivory', kicker: 'Diwali gift guide',
    cells: [
      { name: 'Lip Balm Trio', price: inr(399), photoSlot: 'lip-balm-trio', crop: crop(1.2, 0.55, 0.5) },
      { name: 'Rose Toner', price: inr(549), photoSlot: 'product-leaf', crop: crop(1.3, 0.5, 0.45) },
      { name: 'Neem Cleanser', price: inr(449), photoSlot: 'flatlay-neem', crop: crop(1.3, 0.55, 0.5) },
      { name: 'Hair Oil', price: inr(599), photoSlot: 'flatlay-amla', crop: crop(1.3, 0.45, 0.5) }
    ],
    slides: [
      { family: 'slide', mood: 'ivory', photoSlot: 'lip-balm-trio', crop: crop(1.6, 0.5, 0.5, { flip: true }), head: 'For the one who has everything', body: 'The Lip Balm Trio, ₹399: three shades they will actually use.' },
      { family: 'slide', mood: 'ivory', photoSlot: 'monsoon-mood', crop: crop(1.15, 0.55, 0.7), head: 'For the oil bath lover', body: 'The Hibiscus Hair Oil, ₹599, wrapped and ready.' }
    ] },
  'soon-night': { family: 'split', side: 'right', mood: 'night', photoSlot: 'flatlay-neem', crop: crop(1.25, 0.55, 0.5), kicker: 'After the pooja', body: 'Neem cleanser, rose mist, a little serum, and you are done. Nalla thookkam awaits.', note: 'Neem Cleanser' },
  'soon-winter': { family: 'hero', mood: 'night', photoSlot: 'carousel-4', crop: crop(1.1, 0.45, 0.45), kicker: 'Winter skin', sub: 'Bakuchi Night Repair Cream: a pea-sized amount after your serum.' },
  'soon-stories': { family: 'testimonial', mood: 'festive', photoSlot: 'diwali-diyas', crop: crop(1.3, 0.5, 0.5), kicker: 'Your glow stories', quote: 'I used the mask before every Navratri night. Nobody believed I had danced till one.', person: 'Swathi, Chennai', swipe: true,
    slides: [
      { family: 'testimonial', mood: 'festive', photoSlot: 'flatlay-rose', crop: crop(1.3, 0.45, 0.5), kicker: 'Your glow stories', head: 'A tradition now', quote: 'The rose mist between garba rounds is now a tradition in our group.', person: 'Neha, Ahmedabad' },
      { family: 'testimonial', mood: 'festive', photoSlot: 'gifting-hamper', crop: crop(1.2, 0.5, 0.5), kicker: 'Your glow stories', head: 'The gift that called back', quote: 'I gifted the box to my sister. She called me before she even opened the serum.', person: 'Lakshmi, Chennai' }
    ] }
};

/**
 * The lines of each reel's second scene (videos.js): the how-to steps and the batch-day steps per product, and the hand-written
 * reels. They repeat the caption's own words.
 */
const REEL_LINES = Object.freeze({
  'kumkumadi-glow-serum': { howto: ['Warm three drops in your palms', 'Press into clean skin', 'Leave it on overnight'], batch: ['Saffron steeped six weeks', 'Filtered by hand', 'Poured in Chennai'] },
  'saffron-sandal-face-mask': { howto: ['Mix a spoon with rose water', 'Apply, rest ten minutes', 'Rinse with cool water'], batch: ['Sandalwood ground on stone', 'Mixed in small batches', 'Packed by hand'] },
  'rose-petal-toner': { howto: ['Close your eyes', 'Mist from an arm\u2019s length', 'Pat gently'], batch: ['Rose water from Kannauj', 'Every drum smelled first', 'Bottled by hand'] },
  'neem-turmeric-cleanser': { howto: ['Wet your face', 'One pump, one minute', 'Rinse and pat dry'], batch: ['Neem leaves dried in the sun', 'Blended soap-free', 'Poured by hand'] },
  'bakuchi-night-repair-cream': { howto: ['After your serum', 'A pea-sized amount', 'Twice a week to start'], batch: ['Shea butter and bakuchi', 'Stirred, never rushed', 'Poured into jars'] },
  'tinted-mineral-spf-40': { howto: ['Two finger lengths', 'Thirty minutes before you go', 'Reapply when outdoors'], batch: ['Fifty Indian skin tones', 'One swatch at a time', 'One sheer tint'] },
  'coconut-hibiscus-hair-oil': { howto: ['Warm it slightly', 'Massage your scalp', 'Rest an hour, then wash'], batch: ['Curry leaf and hibiscus', 'Slow-steeped in coconut oil', 'Bottled by hand'] },
  'lip-balm-trio': { howto: ['One in your bag', 'One by the bed', 'One in the car'], batch: ['Three shades', 'One steady pour', 'Capped by hand'] }
});
const REEL_KEYED = Object.freeze({
  'founder-first-orders': { kicker: 'Chennai, 2022', head: 'Where it all began', lines: ['A dining table', 'Amma wrote the cards', 'Appa taped the boxes'] },
  'edu-glow-water': { kicker: 'The studio routine', head: 'A calm night routine', lines: ['Sleep and water', 'Sunscreen by day', 'A ritual you can keep'] },
  'sea-navratri-start': { kicker: 'After the garba', head: 'Calm skin by morning', lines: ['Cleanse', 'Mist', 'Serum, then sleep'] },
  'soon-packing': { kicker: 'Behind the scenes', head: 'Every box by hand', lines: ['A card from Aanya', 'Wrapped in cotton and sage', 'Six hands, one long table'] }
});

/** The words of a reel's three scenes: { kicker, head, lines } for the second scene (the first is the post's own head). */
function reelLinesFor(spec) {
  if (REEL_KEYED[spec.key]) return REEL_KEYED[spec.key];
  const m = /-(howto|batch)$/.exec(spec.key);
  const L = REEL_LINES[spec.product];
  if (!m || !L) throw new Error(`no reel lines for ${spec.key}`);
  const short = (bank.PRODUCT_LINES[spec.product] || {}).short || '';
  return m[1] === 'howto' ? { kicker: 'How to use it', head: short, lines: L.howto } : { kicker: 'Behind the batch', head: 'Made by hand in Chennai', lines: L.batch };
}

const KIND = /-(ritual|inside|howto|story|offer|myth|batch)$/;

/**
 * The design of one post: { cover, slides } where cover is the post's picture and slides the 2nd, 3rd (and 4th) carousel
 * slides. `spec` is a content.js post spec; `extra` asks for the night cream's fourth slide.
 */
function designFor(spec, { extra = false } = {}) {
  const product = bySlug[spec.product] || PRODUCTS[0];
  let base = KEYED[spec.key];
  const m = KIND.exec(spec.key);
  if (!base && m && P[product.slug]) base = P[product.slug][m[1]];
  if (!base) throw new Error(`no design for ${spec.key}`);
  const L = bank.PRODUCT_LINES[product.slug] || {};
  const cover = { ...base, key: spec.key, product: product.slug, head: spec.head };
  delete cover.slides; delete cover.extra;
  if (m && m[1] === 'story' && !cover.quote) { cover.quote = L.quote; cover.person = L.person; }
  if (m && m[1] === 'myth') { cover.myth = L.myth; cover.fact = L.fact; cover.swipe = true; }
  if (spec.fmt === 'reel' && cover.family === 'collage') cover.reel = true;
  let slides = (base.slides || []).map((s) => ({ ...s, product: product.slug }));
  if (extra && base.extra) slides = [...slides, { ...base.extra, product: product.slug }];
  const total = slides.length + 1;
  slides = slides.map((s, i) => ({ ...s, key: `${spec.key}-${i + 2}`, slide: i + 2, total, swipe: s.family !== 'slide' && i + 2 < total }));
  if (cover.family === 'testimonial' && slides.length) { cover.slide = 1; cover.total = total; }
  return { cover, slides };
}

/** Every photo slot a design uses (cover, prints, cells and slides). */
function slotsOf(design) {
  const d = design;
  return [d.photoSlot, ...(d.photos || []).map((p) => p.photoSlot), ...(d.cells || []).map((c) => c.photoSlot)].filter(Boolean);
}

module.exports = { PHOTO_SLOTS, P, KEYED, REEL_LINES, designFor, reelLinesFor, slotsOf, inr };
