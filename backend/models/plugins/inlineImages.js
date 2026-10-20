'use strict';
/**
 * Save-time backstop for pictures written as base64 into Draft and Campaign (impact map inline-images.md section 4,
 * decision D102). The generators store their pictures themselves (services/imageStore.js) and fail cleanly; this
 * catches every other writer (a customer save of a poster the browser holds as base64, a copy from an older row).
 *
 * Only the picture fields are looked at (`imageUrl`, `imageUrlNoLogo`, `imageUrls` at any depth under the configured
 * top paths). A data URI there is stored and replaced by its https link. When the store fails (no storage, a refused
 * type, an outage) the write is NOT failed: the value is kept and an error is logged, because a hook that fails a
 * write after a charge could skip a refund in a route that does not expect a save error. The migration
 * (scripts/migrate-inline-images.js) sweeps what had to be kept.
 *
 * Covered: document save (new or modified paths only), insertMany, updateOne/updateMany/findOneAndUpdate/replaceOne/
 * findOneAndReplace ($set, $setOnInsert, $push/$addToSet, top-level keys). Not covered: native driver writes
 * (`Model.collection.*`). Off with INLINE_IMAGE_MODE=legacy.
 */

const IMAGE_KEYS = new Set(['imageUrl', 'imageUrlNoLogo', 'imageUrls']);
const isDataUri = (v) => typeof v === 'string' && /^\s*data:/i.test(v);
const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v) && !(v instanceof Date) && !(v._bsontype);

/** The last path segment that is a field name (skips array indexes and positional operators). */
function lastKey(path) {
  const parts = String(path).split('.').filter((p) => !/^(\d+|\$|\$\[[^\]]*\])$/.test(p));
  return parts[parts.length - 1] || '';
}

function containsDataUri(value, key, depth = 0) {
  if (depth > 6 || value == null) return false;
  if (typeof value === 'string') return IMAGE_KEYS.has(key) && isDataUri(value);
  if (Array.isArray(value)) return value.some((v) => containsDataUri(v, key, depth + 1));
  if (isPlainObject(value)) return Object.keys(value).some((k) => containsDataUri(value[k], k, depth + 1));
  return false;
}

/** A copy of `value` with every data URI under a picture key replaced by `put(dataUri)`. */
async function transform(value, key, put, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (typeof value === 'string') return IMAGE_KEYS.has(key) && isDataUri(value) ? put(value) : value;
  if (Array.isArray(value)) {
    const out = [];
    for (const v of value) out.push(await transform(v, key, put, depth + 1));
    return out;
  }
  if (isPlainObject(value)) {
    const out = { ...value };
    for (const k of Object.keys(out)) out[k] = await transform(out[k], k, put, depth + 1);
    return out;
  }
  return value;
}

function makePut({ store, folder, logger, stats }) {
  const cache = new Map();
  return async (dataUri) => {
    if (cache.has(dataUri)) return cache.get(dataUri);
    let url = dataUri;
    try {
      const out = await store.storeImage(dataUri, { folder });
      url = out && out.url ? out.url : dataUri;
      if (out && out.stored) stats.stored += 1; else stats.kept += 1;
    } catch (e) {
      stats.kept += 1;
      logger.error(`[inline-images] kept a data URI (${e && e.code ? e.code : 'error'}): ${e && e.message}`);
    }
    cache.set(dataUri, url);
    return url;
  };
}

const toPlain = (v) => (v && typeof v.toObject === 'function' ? v.toObject({ depopulate: true }) : (Array.isArray(v) ? v.map((x) => (x && typeof x.toObject === 'function' ? x.toObject({ depopulate: true }) : x)) : v));

/** Document save: store data URIs in the configured top paths that are new or modified. Exported for tests. */
async function processDocument(doc, { paths, store, folder, logger = console }) {
  const stats = { stored: 0, kept: 0 };
  const put = makePut({ store, folder, logger, stats });
  for (const p of paths) {
    if (!doc.isNew && !doc.isModified(p)) continue;
    const current = toPlain(doc.get(p));
    if (!containsDataUri(current, lastKey(p))) continue;
    const next = await transform(current, lastKey(p), put);
    doc.set(p, next);
    doc.markModified(p);
  }
  return stats;
}

/** Update query: the same for $set, $setOnInsert, $push/$addToSet and top-level keys. Mutates and returns `update`. */
async function processUpdate(update, { paths, store, folder, logger = console }) {
  const stats = { stored: 0, kept: 0 };
  if (!update || typeof update !== 'object' || Array.isArray(update)) return stats;
  const put = makePut({ store, folder, logger, stats });
  const tops = new Set(paths.map((p) => p.split('.')[0]));
  const handle = async (bag) => {
    if (!bag || typeof bag !== 'object') return;
    for (const k of Object.keys(bag)) {
      if (k.startsWith('$') || !tops.has(k.split('.')[0])) continue;
      const key = lastKey(k);
      const v = bag[k];
      const each = v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.$each);
      const target = each ? v.$each : v;
      if (!containsDataUri(target, key)) continue;
      const next = await transform(target, key, put);
      bag[k] = each ? { ...v, $each: next } : next;
    }
  };
  await handle(update);
  for (const op of ['$set', '$setOnInsert', '$push', '$addToSet']) await handle(update[op]);
  return stats;
}

function inlineImagesPlugin(schema, { paths, folder = 'nebula-campaign-posts', storeModule = () => require('../../services/imageStore'), logger = console } = {}) {
  const on = () => String(process.env.INLINE_IMAGE_MODE || '').toLowerCase() !== 'legacy';
  const opts = () => ({ paths, folder, store: storeModule(), logger });

  schema.pre('save', async function inlineImagesSave() {
    if (!on()) return;
    await processDocument(this, opts());
  });
  schema.pre('insertMany', async function inlineImagesInsertMany(next, docs) {
    if (!on() || !Array.isArray(docs)) return;
    for (const d of docs) {
      if (!d || typeof d !== 'object') continue;
      if (typeof d.isModified === 'function') await processDocument(d, opts());
      else await processUpdate(d, opts());
    }
  });
  for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace']) {
    schema.pre(op, async function inlineImagesUpdate() {
      if (!on()) return;
      const u = this.getUpdate();
      await processUpdate(u, opts());
      this.setUpdate(u);
    });
  }
}

module.exports = { inlineImagesPlugin, processDocument, processUpdate, containsDataUri, transform, lastKey, IMAGE_KEYS };
