'use strict';
/**
 * What the memory learns from the account's own products and services. PURE.
 * Counts only: catalogue size, photo coverage, the price range (one currency only, never mixed) and the main category
 * (never the default "General"). Product names are the owner's own words and may appear in the shown text; the prompt
 * lines carry no prices and no counts.
 */
const { str, plural, makeItem, sourceResult, isNum } = require('./common');

const MIN_PRICED = 2;
const MIN_FOR_CATEGORY = 3;

const hasPhoto = (p) => Boolean(str(p && p.imageUrl) || (Array.isArray(p && p.images) && p.images.some((u) => str(u))));
const money = (n, cur) => (!cur || cur === 'INR' ? `Rs ${Math.round(n).toLocaleString('en-IN')}` : `${cur} ${Math.round(n)}`);

function learnFromProducts(products = []) {
  const list = (Array.isArray(products) ? products : []).filter((p) => p && str(p.name));
  if (!list.length) return sourceResult('none', 'No products or services added yet. Add them under Brand assets, then Products, and Nebulaa learns from them.');
  const items = [];
  const services = list.filter((p) => p.type === 'service').length;
  const goods = list.length - services;
  const photos = list.filter(hasPhoto).length;

  const parts = [goods ? plural(goods, 'product', 'products') : '', services ? plural(services, 'service', 'services') : ''].filter(Boolean).join(' and ');
  items.push(makeItem({
    key: 'products-catalogue', source: 'products', kind: 'catalogue', confidence: 'strong',
    text: `You have ${parts} on file${photos ? `, ${photos === list.length ? 'all' : photos} with a photo` : ', none with a photo yet'}.`,
    promptLine: '',
    evidenceCount: list.length, evidenceUnit: list.length === 1 ? 'item' : 'items', evidenceText: `from ${plural(list.length, 'item', 'items')} in your catalogue`
  }));

  const missing = list.length - photos;
  if (missing > 0 && photos > 0) {
    items.push(makeItem({
      key: 'products-photos', source: 'products', kind: 'photos', confidence: 'strong',
      text: `${plural(missing, 'item has', 'items have')} no photo yet, so posts about ${missing === 1 ? 'it' : 'them'} cannot show the real thing.`,
      promptLine: 'Prefer the products that have real photos on file.',
      evidenceCount: missing, evidenceUnit: 'items', evidenceText: `from ${plural(list.length, 'item', 'items')} in your catalogue`
    }));
  }

  // Price range: only stored prices above 0, all in one currency.
  const priced = list.filter((p) => isNum(p.price) && p.price > 0);
  const currencies = [...new Set(priced.map((p) => str(p.currency).toUpperCase() || 'INR'))];
  if (priced.length >= MIN_PRICED && currencies.length === 1) {
    const prices = priced.map((p) => p.price).sort((a, b) => a - b);
    const lo = prices[0];
    const hi = prices[prices.length - 1];
    items.push(makeItem({
      key: 'products-prices', source: 'products', kind: 'prices', confidence: 'strong',
      text: lo === hi ? `Your priced items all cost ${money(lo, currencies[0])}.` : `Your prices run from ${money(lo, currencies[0])} to ${money(hi, currencies[0])}.`,
      promptLine: '',
      evidenceCount: priced.length, evidenceUnit: 'items', evidenceText: `from ${plural(priced.length, 'priced item', 'priced items')}`
    }));
  }

  // Main category: at least three items and at least half of them in one real category.
  const cats = {};
  for (const p of list) { const c = str(p.category); if (c && c.toLowerCase() !== 'general') cats[c] = (cats[c] || 0) + 1; }
  const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
  if (list.length >= MIN_FOR_CATEGORY && top && top[1] * 2 >= list.length) {
    items.push(makeItem({
      key: 'products-category', source: 'products', kind: 'category', confidence: 'strong',
      text: `Most of what you sell is ${top[0]} (${top[1]} of ${list.length}).`,
      promptLine: `Most of what the business sells is ${top[0]}.`,
      evidenceCount: top[1], evidenceUnit: 'items', evidenceText: `from ${plural(list.length, 'item', 'items')} in your catalogue`
    }));
  }

  return sourceResult('none', '', { evidenceCount: list.length, evidenceUnit: 'items', items });
}

module.exports = { learnFromProducts, MIN_PRICED, MIN_FOR_CATEGORY };
