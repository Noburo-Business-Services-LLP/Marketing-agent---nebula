/**
 * Customer wording for a Quark figure. The owner wants Quarks kept and the posts-and-videos equivalent added beside
 * them, so every message that names a figure builds it here, from config/apiCosts.js (never typed by hand).
 */
const { QUARK_COSTS, outputsFor } = require('./apiCosts');

const count = (n, one, many) => `${Number(n).toLocaleString('en-IN')} ${n === 1 ? one : many}`;

/** "about 24 posts or 1 video" for a balance. Empty when it buys no post. */
function equivalentText(quarks) {
  const o = outputsFor(quarks);
  if (!o.posts) return '';
  return o.videos ? `about ${count(o.posts, 'post', 'posts')} or ${count(o.videos, 'video', 'videos')}` : `about ${count(o.posts, 'post', 'posts')}`;
}

/** "about 1 video's worth" for a price: videos when it is a video's price or more, otherwise posts, at least 1. */
function worthText(quarks) {
  const q = Number(quarks) || 0;
  if (q <= 0) return '';
  if (q >= QUARK_COSTS.studio_video) {
    const n = Math.max(1, Math.round(q / QUARK_COSTS.studio_video));
    return `about ${n} ${n === 1 ? "video's" : "videos'"} worth`;
  }
  const n = Math.max(1, Math.round(q / QUARK_COSTS.image_generated));
  return `about ${n} ${n === 1 ? "post's" : "posts'"} worth`;
}

/** "161 Quarks (about 1 video's worth)" for a price. */
function priceText(quarks) {
  const w = worthText(quarks);
  const q = Number(quarks) || 0;
  return w ? `${q.toLocaleString('en-IN')} Quarks (${w})` : `${q.toLocaleString('en-IN')} Quarks`;
}

/** "4,200 Quarks (about 381 posts or 26 videos)" for a balance. */
function balanceText(quarks) {
  const e = equivalentText(quarks);
  const q = Number(quarks) || 0;
  return e ? `${q.toLocaleString('en-IN')} Quarks (${e})` : `${q.toLocaleString('en-IN')} Quarks`;
}

module.exports = { equivalentText, worthText, priceText, balanceText };
