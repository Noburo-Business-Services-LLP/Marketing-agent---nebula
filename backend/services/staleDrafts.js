/**
 * Pictures that never finish. A server restart, a crash or a lost connection can leave a draft saying "creating"
 * for ever, with the Quarks already taken. This finds drafts that have shown no progress for a long time, marks
 * them as not finished, and gives the Quarks back where nothing was delivered.
 *   single post, nothing made   -> one picture refunded
 *   carousel, no slide made     -> every slide refunded
 *   carousel with some slides   -> kept as it is (the finished slides are real), marked as not finished
 *   campaign post               -> marked as not finished; its Quarks were taken per run, not per picture
 * Runs once at start and then every few minutes. Safe to run twice: a draft is only ever handled once.
 */
const STALE_MINUTES = Number(process.env.STALE_DRAFT_MINUTES || 20);
const MESSAGE = 'This did not finish. You can create it again.';

async function reapStaleDrafts({ Draft, refund, now = Date.now(), log = console }) {
  const cutoff = new Date(now - STALE_MINUTES * 60000);
  const stale = await Draft.find({ status: 'processing', updatedAt: { $lt: cutoff } }).limit(200);
  let handled = 0;
  for (const d of stale) {
    // Claim it first: only the process that flips the status refunds, so nothing is refunded twice.
    const claimed = await Draft.updateOne({ _id: d._id, status: 'processing' }, { $set: { status: 'failed', errorMessage: MESSAGE } });
    if (!claimed || !(claimed.modifiedCount || claimed.nModified)) continue;
    handled += 1;
    try {
      const slides = Array.isArray(d.carouselSlides) ? d.carouselSlides : [];
      if (d.contentType === 'carousel' && slides.length && !slides.some((s) => s && s.imageUrl)) {
        await refund(String(d.userId), 'carousel_generated', slides.length, 'Refund: carousel did not finish');
      } else if (d.contentType === 'post' && !d.imageUrl) {
        await refund(String(d.userId), 'image_generated', 1, 'Refund: picture did not finish');
      }
    } catch (error) {
      log.error('[stale-drafts] refund failed:', error.message);
    }
  }
  if (handled) log.log(`[stale-drafts] ${handled} unfinished ${handled === 1 ? 'draft' : 'drafts'} closed`);
  return { handled };
}

function startStaleDraftReaper({ intervalMs = 5 * 60 * 1000, logger = console } = {}) {
  const Draft = require('../models/Draft');
  const { refundCredits } = require('../middleware/trialGuard');
  const tick = () => reapStaleDrafts({ Draft, refund: refundCredits, log: logger }).catch((e) => logger.error('[stale-drafts] run failed:', e.message));
  setTimeout(tick, 30000);
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { reapStaleDrafts, startStaleDraftReaper, STALE_MINUTES, MESSAGE };
