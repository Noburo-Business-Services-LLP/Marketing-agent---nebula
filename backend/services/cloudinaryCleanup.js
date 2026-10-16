'use strict';
/**
 * Finding and deleting a customer's files in Cloudinary. Only files in our own "nebula" folders are touched, so shared or
 * stock files are never deleted. The files are found from the links stored on the customer's records.
 */
const URL_RE = /res\.cloudinary\.com\/[^/"'\s\\]+\/(image|video|raw)\/upload\/(?:[^/"'\s\\]+\/)*?(?:v\d+\/)?(nebula[a-z0-9_-]*\/[^"'\s\\?#)]+)/gi;

/** [{ resourceType, publicId }] found in any text, without repeats. */
function extractAssets(text) {
  const seen = new Map();
  const s = String(text || '');
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(s)) !== null) {
    const type = m[1].toLowerCase();
    let id = decodeURIComponent(m[2]);
    if (type !== 'raw') id = id.replace(/\.[a-z0-9]{2,5}$/i, '');
    seen.set(`${type}:${id}`, { resourceType: type, publicId: id });
  }
  return [...seen.values()];
}

/** Deletes in batches of 100 per type. Returns how many were asked for and how many batches failed. */
async function deleteAssets(assets, { cloudinary = require('cloudinary').v2 } = {}) {
  const byType = { image: [], video: [], raw: [] };
  for (const a of assets) (byType[a.resourceType] || byType.image).push(a.publicId);
  let requested = 0; let failedBatches = 0;
  for (const [type, ids] of Object.entries(byType)) {
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      requested += batch.length;
      try { await cloudinary.api.delete_resources(batch, { resource_type: type, type: 'upload' }); }
      catch (e) { failedBatches += 1; console.error('[account delete] Cloudinary batch failed:', e && e.message); }
    }
  }
  return { requested, failedBatches };
}

module.exports = { extractAssets, deleteAssets };
