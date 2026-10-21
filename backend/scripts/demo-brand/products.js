'use strict';
/**
 * The 8 products of the demo brand as Product rows, each with 2 or 3 locally drawn packshots.
 * Every row is tagged by its picture links (they live under /demo-assets/nilaa/), which `remove` matches.
 */
const images = require('./images');
const { PRODUCTS } = require('./constants');
const { assetUrl } = require('./safety');

/** How many pictures a product gets: the bestsellers 3, the rest 2. */
const pictureCount = (i) => (i < 3 ? 3 : 2);

/** The pictures to draw for every product: [{ product, rel, draw }]. */
function productPictureSpecs() {
  const out = [];
  PRODUCTS.forEach((p, i) => {
    for (let v = 0; v < pictureCount(i); v += 1) out.push({ product: p.slug, rel: `products/${p.slug}-${v + 1}.jpg`, draw: () => images.packshotJpg(p, v) });
  });
  return out;
}

/** The description shown in the catalogue: the copy, then the key ingredients (the field holds at most 500 characters). */
function describe(p) {
  const text = `${p.description} Key ingredients: ${p.ingredients.join(', ')}.`;
  return text.length <= 500 ? text : `${text.slice(0, 497)}...`;
}

/** The Product rows (pure). `createdAt` spreads them over the first week of the account. */
function productRows({ userId, base, createdAt }) {
  return PRODUCTS.map((p, i) => {
    const pics = Array.from({ length: pictureCount(i) }, (_, v) => assetUrl(base, `products/${p.slug}-${v + 1}.jpg`));
    const at = new Date(createdAt.getTime() + (i + 1) * 3 * 60 * 60 * 1000);
    return {
      user: userId, name: p.name, type: 'product', price: p.price, priceNote: p.size, currency: 'INR',
      imageUrl: pics[0], images: pics, keyFeatures: [...p.benefits], description: describe(p),
      category: p.category, tags: p.ingredients.map((x) => x.split(' (')[0].toLowerCase()), createdAt: at, updatedAt: at
    };
  });
}

module.exports = { pictureCount, productPictureSpecs, productRows, describe };
