'use strict';
/**
 * Real videos in the demo (D127). The owner makes real videos in the dev app as the demo user; this module is the pure part of
 * keeping them. Nothing here touches a database, the network or the disk.
 *
 *  - A DRAWN row is one the seed made: its video link is under /demo-assets/zaya/ (the marker of safety.MARKERS.StudioVideo).
 *  - A REAL row is a completed video of the demo user whose link is anywhere else (the app stores the clip in the cloud).
 *  - A KEPT row is a real row with `demoKeep` set, a short text `<product slug>|<reel post key>`: the product it stands for
 *    (its drawn Videos-page clip is not redrawn) and the reel post in the Library it plays for (that reel is not redrawn).
 *    `seed-demo-brand.js create` never wipes kept rows and relinks the reel to them.
 */
const { ASSET_PATH } = require('./safety');

const ASSET_RE = new RegExp(`${ASSET_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`);
const isDrawnUrl = (url) => ASSET_RE.test(String(url || ''));
const isKept = (row) => Boolean(row && typeof row.demoKeep === 'string' && row.demoKeep);
const isReal = (row) => Boolean(row && row.status === 'completed' && row.videoUrl && !isDrawnUrl(row.videoUrl));

/** Counts for the status mode. */
function summarize(rows) {
  const real = rows.filter(isReal);
  return { real: real.length, kept: real.filter(isKept).length, drawn: rows.filter((r) => isDrawnUrl(r.videoUrl)).length, other: rows.length - real.length - rows.filter((r) => isDrawnUrl(r.videoUrl)).length };
}

const STOP = new Set(['and', 'the', 'with', 'for', 'from']);
const words = (s) => String(s || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !STOP.has(w));

/** The product a real video is about, by its words: the name counts most, then the ingredients. '' when nothing matches. */
function productOf(video, products) {
  const text = [video.title, video.idea, video.concept, video.spokenLine].join(' ').toLowerCase();
  let best = ''; let top = 0;
  for (const p of products) {
    let score = text.includes(p.name.toLowerCase()) ? 6 : 0;
    for (const w of new Set(words(p.name))) if (text.includes(w)) score += 2;
    for (const w of new Set((p.ingredients || []).flatMap((i) => words(i.split('(')[0])))) if (text.includes(w)) score += 1;
    if (score > top) { top = score; best = p.slug; }
  }
  return best;
}

/**
 * The plan for adopting (pure). Inputs:
 *  rows:     all StudioVideo rows of the demo user ({ _id, status, videoUrl, title, idea, concept, spokenLine, createdAt, demoKeep })
 *  reels:    the seed's reel slots [{ key, product, url }] (url = the drawn clip the Library reel plays now)
 *  products: [{ slug, name, ingredients }]
 *  studio:   the seed's Videos-page slots [{ slug, url }] (drawn)
 * Returns { tag: [{ id, keep }], removeRows: [id], relink: [{ from, to }], files: [relative path], skipped: [text] }.
 * Real videos are taken oldest first; each one stands for its product, plays for the first free reel of that product (else the
 * first free reel), and its product's drawn Videos-page clip is removed.
 */
function plan({ rows, reels, products, studio }) {
  const real = rows.filter(isReal).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const taken = new Set(real.filter(isKept).map((r) => String(r.demoKeep).split('|')[1]).filter(Boolean));
  const filled = new Set(real.filter(isKept).map((r) => String(r.demoKeep).split('|')[0]).filter(Boolean));
  const out = { tag: [], removeRows: [], relink: [], files: [], skipped: [] };
  for (const r of real.filter((x) => !isKept(x))) {
    const product = productOf(r, products);
    const reel = reels.find((x) => !taken.has(x.key) && x.product === product) || reels.find((x) => !taken.has(x.key));
    if (reel) { taken.add(reel.key); out.relink.push({ from: reel.url, to: r.videoUrl }); out.files.push(`videos/reel-${reel.key}.mp4`); }
    else out.skipped.push(`${r.title || r._id}: every reel already plays a real video`);
    out.tag.push({ id: r._id, keep: `${product}|${reel ? reel.key : ''}` });
    const slot = product && !filled.has(product) ? studio.find((s) => s.slug === product) : null;
    if (product) filled.add(product);
    if (slot) {
      for (const d of rows.filter((x) => x.videoUrl === slot.url)) out.removeRows.push(d._id);
      out.files.push(`videos/${slot.slug}.mp4`, `videos/${slot.slug}.jpg`);
    }
  }
  return out;
}

/** What `create` needs from the kept rows: the links to lay over the reels and the slots that are filled. */
function keepState(rows) {
  const reelUrls = {}; const products = new Set(); const reels = new Set();
  for (const r of rows.filter((x) => isReal(x) && isKept(x))) {
    const [product, reel] = String(r.demoKeep).split('|');
    if (product) products.add(product);
    if (reel) { reelUrls[reel] = r.videoUrl; reels.add(reel); }
  }
  return { reelUrls, products, reels };
}

module.exports = { isDrawnUrl, isReal, isKept, summarize, productOf, plan, keepState };
