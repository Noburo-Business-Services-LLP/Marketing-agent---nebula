'use strict';
/**
 * Erasure of listening data other than whole-account deletion (that is the data registry's job).
 * A score has no text, but it must not outlive the inbox item it describes: when the item is gone the score goes too and the
 * weekly totals are rebuilt, so deleted comments stop counting. Every query carries the account id; nothing here can reach
 * another account's rows, and nothing here throws into the caller.
 * The Inbox has no item-delete path today. If one is added it must call eraseForInboxItems (a test reads the route source for this).
 */
const PAGE = 500;       // scores looked at per page
const MAX_PAGES = 6;    // pages per run: at most 3000 newest scores are checked
const MAX_REMOVE = 1000; // scores removed per run; the rest go on the next pass

const errTag = (e) => `${(e && (e.name || 'Error')) || 'Error'}${e && e.code ? ` ${e.code}` : ''}`; // never e.message

function defaultDeps({ Message } = {}) {
  return {
    store: new Proxy({}, { get: (_, k) => (...a) => require('./store').listeningStore()[k](...a) }),
    // Which of these inbox items still exist for this account.
    existingIds: async (userId, ids) => {
      const rows = await (Message || require('../../models/SocialInboxMessage')).find({ _id: { $in: ids }, userId }).select('_id').lean();
      return new Set(rows.map((r) => String(r._id)));
    }
  };
}

/** Delete the scores for these inbox items (this account only) and rebuild the weekly totals. Returns { removed }. Never throws. */
async function eraseForInboxItems({ userId, itemIds = [], now = new Date(), store } = {}) {
  try {
    const ids = [...new Set((itemIds || []).map(String))];
    if (!userId || !ids.length) return { removed: 0 };
    const st = store || defaultDeps().store;
    const removed = await st.deleteScores(userId, ids);
    if (removed > 0) {
      try { await st.rebuildWeeks(userId, now); } catch (e) { console.error('[listening] could not rebuild the weekly totals after an erase:', errTag(e)); }
    }
    return { removed };
  } catch (e) {
    console.error('[listening] erase failed:', errTag(e));
    return { removed: 0 };
  }
}

/** Remove this account's scores whose inbox item no longer exists. Bounded, repeatable, never throws. Returns { removed }. */
async function sweepOrphans({ userId, now = new Date(), deps } = {}) {
  try {
    if (!userId) return { removed: 0 };
    const d = { ...defaultDeps(deps || {}), ...(deps || {}) };
    let removed = 0;
    let before = null;
    for (let page = 0; page < MAX_PAGES && removed < MAX_REMOVE; page++) {
      const rows = (await d.store.scoredPage(userId, { before, limit: PAGE })) || [];
      if (!rows.length) break;
      before = rows[rows.length - 1]._id;
      const ids = rows.map((r) => String(r.inboxItemId));
      const alive = await d.existingIds(userId, ids); // a failure here throws: nothing is removed on a doubt
      const gone = ids.filter((id) => !alive.has(id)).slice(0, MAX_REMOVE - removed);
      if (gone.length) removed += (await d.store.deleteScores(userId, gone)) || 0;
      if (rows.length < PAGE) break;
    }
    if (removed > 0) {
      try { await d.store.rebuildWeeks(userId, now); } catch (e) { console.error('[listening] could not rebuild the weekly totals after a sweep:', errTag(e)); }
    }
    return { removed };
  } catch (e) {
    console.error('[listening] orphan sweep failed:', errTag(e));
    return { removed: 0 };
  }
}

module.exports = { eraseForInboxItems, sweepOrphans, PAGE, MAX_PAGES, MAX_REMOVE };
