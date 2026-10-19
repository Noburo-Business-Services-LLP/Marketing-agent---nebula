'use strict';
/**
 * The one place a Photoshoot photo is made. Every test and the real-database check replace this with a fake; the real
 * function is only reached from a running server with the owner's switch on (ENABLE_PHOTOSHOOT=on).
 *
 * make({ prompt, references, aspectRatio }) -> { ok: true, url } | { ok: false, reason }
 * Quality and the number of references are the constants the price is derived from (config/apiCosts.js), so the work
 * and the price cannot drift apart. A result that is not an https link (the store was not reached) is a failure: a
 * photoshoot job never keeps an image inside the database.
 */
const { PHOTOSHOOT_QUALITY, PHOTOSHOOT_MAX_REFERENCES } = require('../../config/apiCosts');

function createGenerator({ generateImage } = {}) {
  const gen = generateImage || ((prompt, opts) => require('../openaiImage').generateOpenAIImage(prompt, opts));
  async function make({ prompt, references = [], aspectRatio = '1:1' }) {
    try {
      const refs = Array.isArray(references) ? references.slice(0, PHOTOSHOOT_MAX_REFERENCES) : [];
      if (!refs.length) return { ok: false, reason: 'no_reference' };
      const out = await gen(String(prompt || ''), { aspectRatio, references: refs, quality: PHOTOSHOOT_QUALITY });
      const url = out && out.success ? String(out.imageUrl || '') : '';
      if (!/^https:\/\//i.test(url)) return { ok: false, reason: out && out.success ? 'not_stored' : 'provider' };
      return { ok: true, url };
    } catch (_) {
      return { ok: false, reason: 'provider' };
    }
  }
  return { make };
}

module.exports = { createGenerator };
