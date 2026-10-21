'use strict';
/**
 * Brand memory ("What Nebulaa learned") of the demo brand. Nothing is written by hand: the six source rows (plan,
 * Blueprint, customers, products, post results; competitors in a later stage) are in the database, and the app's own
 * runner (services/brandMemory/runner.js, the code behind "Refresh now") learns from them in this process. It learns in
 * code: no model call, no provider call, nothing charged.
 */

/** Runs one refresh for the account. Returns the runner's answer: { ok, changed } or { ok: false, reason }. */
async function learn(userId, { createBrandMemory = require('../../services/brandMemory/runner').createBrandMemory } = {}) {
  return createBrandMemory().refreshAccount(String(userId));
}

/** The learned items grouped by source, from the stored document (for the seed's own read-back lines). */
function summarise(doc) {
  const bySource = {};
  for (const i of (doc && doc.learnedItems) || []) bySource[i.source] = (bySource[i.source] || 0) + 1;
  const sources = {};
  for (const [k, v] of Object.entries((doc && doc.learnedSources) || {})) sources[k] = { state: v.state, evidenceCount: v.evidenceCount, itemCount: v.itemCount };
  return { items: ((doc && doc.learnedItems) || []).length, bySource, sources };
}

module.exports = { learn, summarise };
