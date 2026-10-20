const express = require('express');
const crypto = require('crypto');
const router = express.Router();
// A malformed id is a plain 400 before any query runs (middleware/validateObjectId.js).
require('../middleware/validateObjectId').applyObjectIdParams(router, ['id', 'itemId']);
const { protect } = require('../middleware/auth');
// Shared per-user limits for paid AI, scraping, uploads and ad spend (docs/superpowers/ops/security-hardening.md).
const L = require('../middleware/limits');
const { requireFeatureWhen, wantsPublish } = require('../middleware/requireFeature');
const User = require('../models/User');
const ContentCalendar = require('../models/ContentCalendar');
const { deductCredits, refundCredits } = require('../middleware/trialGuard');
const { videoGenerationQueue } = require('../services/videoGenerationQueue');
const {
  generateMonthlyCalendar,
  createDraftsForItem,
  findItem,
  todaySuggestion,
  calendarMonth,
  startManualCover,
  remapProposalItems
} = require('../services/contentCalendarService');
const { makeCooldown } = require('../services/routeCooldown');
const { planGuidanceFor, withPlanGuidance } = require('../services/week/planContext');

// A calendar row is a reel if its format implies motion.
const isReelFormat = (value = '') => /reel|video/i.test(String(value || ''));

async function getCurrentCalendar(userId) {
  return ContentCalendar.findOne({ userId, month: calendarMonth() }).sort({ createdAt: -1 });
}

// GET is read-only (load-test week 1): it returns this month's calendar, or "not prepared yet" with the status, at
// once. It never makes a calendar (an AI call of 7 to 8 s) and never writes; failed covers are retried by the
// background job (healStaleCovers). A calendar is made by POST /prepare, /regenerate, /generate-next or the plan.
const NOT_PREPARED_MESSAGE = 'Your calendar for this month is not prepared yet.';
const PREPARING_MESSAGE = 'Your calendar for this month is being prepared. This takes about a minute.';
const FAILED_MESSAGE = 'We could not prepare your calendar just now. Please try again.';
const FAILED_SHOWN_MS = 10 * 60 * 1000;
// In this process: accounts whose month is being made in the background, or whose last try failed.
const preparation = new Map();
const depsFor = () => router.testDeps || {};

async function readCurrentCalendar(userId) {
  const CC = depsFor().ContentCalendar || ContentCalendar;
  return CC.findOne({ userId, month: calendarMonth() }).sort({ createdAt: -1 }).lean();
}

function preparationState(userId) {
  const p = preparation.get(String(userId));
  if (!p) return null;
  if (p.state === 'failed' && Date.now() - p.at > FAILED_SHOWN_MS) { preparation.delete(String(userId)); return null; }
  return p.state;
}

function notReadyAnswer(userId) {
  const state = preparationState(userId);
  if (state === 'preparing') return { success: true, calendar: null, status: 'preparing', message: PREPARING_MESSAGE };
  if (state === 'failed') return { success: true, calendar: null, status: 'failed', message: FAILED_MESSAGE };
  return { success: true, calendar: null, status: 'not_prepared', message: NOT_PREPARED_MESSAGE };
}

router.get('/', protect, async (req, res) => {
  try {
    const calendar = await readCurrentCalendar(req.user._id);
    if (!calendar) return res.json(notReadyAnswer(req.user._id));
    res.json({ success: true, calendar, status: 'ready' });
  } catch (error) {
    console.error('Content calendar fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch content calendar' });
  }
});

// Makes this month's calendar in the background (the same generator and the same free-of-Quarks rule the old GET
// used). Answers at once: 200 with the calendar when it exists, 202 "preparing" otherwise. Two clicks make one.
router.post('/prepare', protect, L.heavyAi, async (req, res) => {
  try {
    const userId = String(req.user._id);
    const existing = await readCurrentCalendar(userId);
    if (existing) return res.json({ success: true, calendar: existing, status: 'ready' });
    if (preparationState(userId) === 'preparing') return res.status(202).json(notReadyAnswer(userId));

    preparation.set(userId, { state: 'preparing', at: Date.now() });
    const d = depsFor();
    const generate = d.generateMonthlyCalendar || generateMonthlyCalendar;
    const guidance = d.withPlanGuidance || withPlanGuidance;
    // The same optional choices as "Plan next month": a language and a focus (blank = the account's language and brand memory).
    const language = typeof req.body?.language === 'string' && req.body.language.trim() ? req.body.language.trim().slice(0, 40) : undefined;
    const focus = typeof req.body?.focus === 'string' && req.body.focus.trim() ? req.body.focus.trim().slice(0, 300) : undefined;
    Promise.resolve()
      .then(async () => {
        const user = await (d.User || User).findById(userId);
        const opts = { ...((await guidance(userId)) || {}) };
        if (language) opts.language = language;
        if (focus) opts.focus = focus;
        return generate(user, null, opts);
      })
      .then(() => { preparation.delete(userId); })
      .catch((error) => {
        console.error('Content calendar prepare error:', error && error.message);
        preparation.set(userId, { state: 'failed', at: Date.now() });
      });
    res.status(202).json(notReadyAnswer(userId));
  } catch (error) {
    console.error('Content calendar prepare error:', error);
    res.status(500).json({ success: false, message: 'Failed to prepare the content calendar' });
  }
});

router.get('/history', protect, async (req, res) => {
  try {
    const CC = depsFor().ContentCalendar || ContentCalendar;
    const calendars = await CC.find({ userId: req.user._id }).sort({ month: -1 }).lean();
    res.json({ success: true, calendars });
  } catch (error) {
    console.error('Content calendar history error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch content calendar history' });
  }
});

router.post('/generate-next', protect, L.heavyAi, async (req, res) => {
  try {
    const latestCalendar = await ContentCalendar.findOne({ userId: req.user._id }).sort({ month: -1 });
    let nextMonthStr = calendarMonth();
    if (latestCalendar && latestCalendar.month) {
      const [yearStr, monthStr] = latestCalendar.month.split('-');
      let year = parseInt(yearStr, 10);
      let month = parseInt(monthStr, 10);
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
      nextMonthStr = `${year}-${String(month).padStart(2, '0')}`;
    }
    const user = await User.findById(req.user._id);
    const calendar = await generateMonthlyCalendar(user, nextMonthStr, { language: req.body?.language, focus: req.body?.focus, planGuidance: await planGuidanceFor(req.user._id) });
    res.json({ success: true, calendar });
  } catch (error) {
    console.error('Content calendar generate next error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate next content calendar' });
  }
});

// Both are free for the customer, so each is limited to one call per account per 10 minutes.
const regenerateCooldown = makeCooldown(10 * 60 * 1000);
const weekCooldown = makeCooldown(10 * 60 * 1000);
const COOLDOWN_MESSAGE = 'You just did this. Please wait a few minutes and try again.';

router.post('/regenerate', protect, L.heavyAi, async (req, res) => {
  try {
    if (!regenerateCooldown.hit(req.user._id).ok) return res.status(429).json({ success: false, message: COOLDOWN_MESSAGE });
    const user = await User.findById(req.user._id);
    const targetMonth = req.body.month || calendarMonth();
    const oldCalendar = await ContentCalendar.findOne({ userId: req.user._id, month: targetMonth }).lean().catch(() => null);
    const calendar = await generateMonthlyCalendar(user, targetMonth, { language: req.body?.language, focus: req.body?.focus, planGuidance: await planGuidanceFor(req.user._id) });
    if (oldCalendar) {
      try { await remapProposalItems({ userId: req.user._id, oldCalendar, newCalendar: calendar }); }
      catch (e) { console.warn('[calendar] could not re-point weekly items:', e.message); }
    }
    res.json({ success: true, calendar });
  } catch (error) {
    console.error('Content calendar regenerate error:', error);
    res.status(500).json({ success: false, message: 'Failed to regenerate content calendar' });
  }
});

// Covers arrive after the plan, and every calendar made before this feature
// has none. This lets the UI ask for one without regenerating the whole month.
const coverCooldown = makeCooldown(60 * 1000);
router.testDeps = undefined; // tests put fakes here; never set in production

router.post('/cover', protect, L.heavyAi, async (req, res) => {
  try {
    if (!coverCooldown.hit(req.user._id).ok) {
      return res.status(429).json({ success: false, message: 'Please wait a minute before making another cover.' });
    }
    const month = req.body?.month || calendarMonth();
    const calendar = await ContentCalendar.findOne({ userId: req.user._id, month });
    if (!calendar) {
      return res.status(404).json({ success: false, message: 'No calendar for that month yet.' });
    }
    const user = await User.findById(req.user._id);
    // Not awaited inside: rendering takes long enough to time out the request, and the client polls the calendar.
    const r = await startManualCover(calendar, user, { deps: router.testDeps || {} });
    if (r.reason === 'spend-guard') {
      return res.status(429).json({ success: false, message: 'Covers are paused for now. Please try again a little later.' });
    }
    if (r.reason === 'daily-cap') {
      return res.status(429).json({ success: false, message: 'You have made enough covers for today. Please try again tomorrow.' });
    }
    res.json({ success: true, status: 'pending' });
  } catch (error) {
    console.error('Content calendar cover error:', error);
    res.status(500).json({ success: false, message: 'Could not start the cover image.' });
  }
});

router.get('/today', protect, async (req, res) => {
  try {
    const calendar = await getCurrentCalendar(req.user._id);
    const suggestion = todaySuggestion(calendar);
    res.json({ success: true, suggestion, calendarId: calendar?._id || null });
  } catch (error) {
    console.error('Content calendar today error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch today suggestion' });
  }
});

router.patch('/settings', protect, async (req, res) => {
  try {
    let calendar;
    if (req.body.calendarId) {
      calendar = await ContentCalendar.findOne({ _id: req.body.calendarId, userId: req.user._id });
    } else {
      calendar = await getCurrentCalendar(req.user._id);
    }
    
    if (!calendar) return res.status(404).json({ success: false, message: 'Content calendar not found' });

    if (typeof req.body.autoGenerate === 'boolean') {
      // The month's count is kept when the switch is flipped, so off-and-on cannot buy a fresh allowance.
      calendar.autoGenerate = req.body.autoGenerate;
    }
    if (req.body.autoGenerateLimit !== undefined) {
      const n = Math.round(Number(req.body.autoGenerateLimit));
      if (!Number.isFinite(n) || n < 1 || n > 31) {
        return res.status(400).json({ success: false, message: 'Pick between 1 and 31 posts.' });
      }
      calendar.autoGenerateLimit = n;
    }
    if (typeof req.body.approved === 'boolean') calendar.approved = req.body.approved;
    await calendar.save();

    res.json({ success: true, calendar });
  } catch (error) {
    console.error('Content calendar settings error:', error);
    res.status(500).json({ success: false, message: 'Failed to update content calendar settings' });
  }
});

router.patch('/items/:itemId', protect, async (req, res) => {
  try {
    const calendar = await getCurrentCalendar(req.user._id);
    if (!calendar) return res.status(404).json({ success: false, message: 'Content calendar not found' });

    const item = findItem(calendar, req.params.itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Calendar item not found' });

    [
      'format',
      'contentPillar',
      'headline',
      'creativeConcept',
      'productNeeded',
      'shootType',
      'cta',
      'objective',
      'status'
    ].forEach((field) => {
      if (req.body[field] !== undefined) item[field] = req.body[field];
    });

    await calendar.save();
    res.json({ success: true, calendar, item });
  } catch (error) {
    console.error('Content calendar item update error:', error);
    res.status(500).json({ success: false, message: 'Failed to update calendar item' });
  }
});

// POST /items/:itemId/auto-generate
// Approve on a reel day kicks the full AI Reels pipeline off in the
// background. Reuses the exact machinery /video-generation/createVideo
// uses — same queue, same job type, same Draft record — so the wizard can
// resume from the returned jobId and autofill as each stage lands.
router.post('/items/:itemId/auto-generate', protect, L.heavyAi, async (req, res) => {
  const userId = req.user?._id ? String(req.user._id) : (req.user?.id ? String(req.user.id) : null);
  if (!userId) return res.status(401).json({ success: false, message: 'Authentication required' });

  // Charged before the job exists; the charge (with its ref and payer) is recorded on the job at enqueue time so a
  // failure or cancel refunds exactly it (D74: no recorded charge, no refund). Only a failure BEFORE the job exists refunds here.
  const d = depsFor();
  const charge = d.deductCredits || deductCredits;
  const refund = d.refundCredits || refundCredits;
  const queue = d.videoGenerationQueue || videoGenerationQueue;
  let creditsTaken = false;
  let chargeRef = '';
  let chargePayerId = '';
  try {
    const CC = d.ContentCalendar || ContentCalendar;
    const calendar = await CC.findOne({ userId: req.user._id, month: calendarMonth() }).sort({ createdAt: -1 });
    if (!calendar) return res.status(404).json({ success: false, message: 'Content calendar not found' });

    const item = findItem(calendar, req.params.itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Calendar item not found' });

    if (!isReelFormat(item.format)) {
      return res.status(400).json({
        success: false,
        message: `Day ${item.day} is a ${item.format}, not a reel. Use Save Draft for non-reel formats.`
      });
    }

    // Idempotency — a second Approve must not spawn a second render.
    if (item.reelQueueJobId) {
      return res.json({
        success: true,
        alreadyRunning: true,
        jobId: item.reelQueueJobId,
        calendar,
        message: 'A reel build is already running for this day.'
      });
    }

    const user = await (d.User || User).findById(req.user._id);
    const profile = user?.businessProfile || {};
    const language = String(calendar.language || profile.language || 'English').trim();

    // Map the calendar row onto the shape /createVideo expects. The concept
    // and CTA carry the marketing intent; business profile supplies the
    // brand context the calendar row doesn't hold.
    const payload = {
      description: [item.headline, item.creativeConcept].filter(Boolean).join('. '),
      videoStyle: 'Cinematic Commercial',
      language,
      aspectRatio: '9:16',
      sceneCount: 5,
      cta: item.cta || '',
      objective: item.objective || 'awareness',
      productName: item.productNeeded || profile.heroProduct || '',
      businessName: calendar.businessName || profile.businessName || '',
      source: 'smart-calendar',
      calendarItemId: String(item._id),
      calendarDay: item.day
    };

    chargeRef = `calreel:${crypto.randomUUID()}`;
    const creditResult = await charge(userId, 'campaign_full', 1, `Smart Calendar reel — day ${item.day}`, { ref: chargeRef });
    if (!creditResult.success) {
      return res.status(403).json({
        success: false,
        creditsExhausted: true,
        message: creditResult.error || 'Insufficient Quarks to generate this reel.'
      });
    }
    creditsTaken = true;
    chargePayerId = creditResult.payerId ? String(creditResult.payerId) : '';

    const baseUrl = String(process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const queued = await queue.enqueue({
      userId,
      jobType: 'create_video_pipeline',
      payload: {
        payload,
        user: { _id: req.user?._id, id: req.user?.id, businessProfile: profile },
        baseUrl
      },
      metadata: { quarkCharge: [{ action: 'campaign_full', count: 1, ref: chargeRef, payerId: chargePayerId }] }
    });
    creditsTaken = false; // the job owns the refund from here

    // Mirror /createVideo: seed the Draft so the wizard has something to
    // resume against before the pipeline writes its first real stage.
    try {
      const Draft = d.Draft || require('../models/Draft');
      await Draft.findOneAndUpdate(
        { 'generationProgress.jobId': queued.jobId, userId: String(userId) },
        {
          $set: {
            title: String(item.headline || `Day ${item.day} reel`).substring(0, 50),
            status: 'processing',
            origin: 'automation',
            sourceType: 'reel',
            contentType: 'reel',
            'generationProgress.step': 'Queued in background',
            'generationProgress.progress': 0
          }
        },
        { upsert: true, new: true }
      );
    } catch (draftErr) {
      console.error('[calendar auto-generate] Draft seed failed:', draftErr.message);
    }

    item.reelQueueJobId = queued.jobId;
    item.reelQueuedAt = new Date();
    item.status = 'generating';
    await calendar.save();

    return res.status(202).json({
      success: true,
      jobId: queued.jobId,
      status: queued.status,
      progress: queued.progress,
      currentStep: queued.currentStep,
      calendar,
      item
    });
  } catch (error) {
    if (creditsTaken) {
      try {
        await refund(userId, 'campaign_full', 1, 'Refund: Smart Calendar reel enqueue failed', { ref: chargeRef, ...(chargePayerId ? { payerId: chargePayerId } : {}) });
      } catch (refundErr) {
        console.error('[calendar auto-generate] refund failed:', refundErr.message);
      }
    }
    console.error('Calendar auto-generate error:', error);
    return res.status(500).json({ success: false, message: 'Failed to start reel generation' });
  }
});

router.post('/items/:itemId/create-draft', protect, requireFeatureWhen('publish', wantsPublish), async (req, res) => {
  try {
    const calendar = await getCurrentCalendar(req.user._id);
    if (!calendar) return res.status(404).json({ success: false, message: 'Content calendar not found' });

    const item = findItem(calendar, req.params.itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Calendar item not found' });

    const result = await createDraftsForItem(calendar, item, { publish: req.body.publish === true });
    res.json({ success: true, ...result, calendar });
  } catch (error) {
    console.error('Content calendar draft error:', error);
    res.status(500).json({ success: false, message: 'Failed to create calendar draft' });
  }
});

router.post('/reorder', protect, async (req, res) => {
  try {
    const orderedIds = Array.isArray(req.body.orderedIds) ? req.body.orderedIds.map(String) : [];
    if (orderedIds.length === 0) return res.status(400).json({ success: false, message: 'orderedIds is required' });

    const calendar = await getCurrentCalendar(req.user._id);
    if (!calendar) return res.status(404).json({ success: false, message: 'Content calendar not found' });

    const itemsById = new Map();
    (calendar.weeks || []).forEach((week) => (week.items || []).forEach((item) => itemsById.set(String(item._id), item.toObject())));
    const orderedItems = orderedIds.map((id) => itemsById.get(id)).filter(Boolean);
    const remainingItems = Array.from(itemsById.entries())
      .filter(([id]) => !orderedIds.includes(id))
      .map(([, item]) => item);
    const nextItems = [...orderedItems, ...remainingItems].slice(0, 30).map((item, index) => ({ ...item, day: index + 1 }));

    calendar.weeks = [1, 2, 3, 4].map((weekNumber) => ({
      weekNumber,
      items: nextItems.slice((weekNumber - 1) * 8, weekNumber === 4 ? 30 : weekNumber * 8)
    }));
    await calendar.save();

    res.json({ success: true, calendar });
  } catch (error) {
    console.error('Content calendar reorder error:', error);
    res.status(500).json({ success: false, message: 'Failed to reorder content calendar' });
  }
});

const backgroundQueue = require('../services/backgroundQueue');
const Draft = require('../models/Draft');

// POST /api/content-calendar/:id/auto-generate-week
router.post('/:id/auto-generate-week', protect, L.heavyAi, async (req, res) => {
  try {
    const calendar = await ContentCalendar.findOne({ _id: req.params.id, userId: req.user._id || req.user.id });
    if (!calendar) return res.status(404).json({ success: false, message: 'Content calendar not found' });
    if (!weekCooldown.hit(req.user._id || req.user.id).ok) return res.status(429).json({ success: false, message: COOLDOWN_MESSAGE });

    let weekNumber = parseInt(req.body.weekNumber, 10);
    if (isNaN(weekNumber)) {
      // Default to week based on current day of month
      const day = new Date().getDate();
      if (day <= 7) weekNumber = 1;
      else if (day <= 14) weekNumber = 2;
      else if (day <= 21) weekNumber = 3;
      else weekNumber = 4;
    }

    backgroundQueue.enqueue({
      calendarId: calendar._id,
      weekNumber
    });

    res.json({ success: true, message: `Weekly content generation queued for Week ${weekNumber}` });
  } catch (error) {
    console.error('Auto generate week error:', error);
    res.status(500).json({ success: false, message: 'Failed to queue weekly generation' });
  }
});

// GET /api/content-calendar/:id/weekly-drafts
router.get('/:id/weekly-drafts', protect, async (req, res) => {
  try {
    const calendar = await ContentCalendar.findOne({ _id: req.params.id, userId: req.user._id || req.user.id });
    if (!calendar) return res.status(404).json({ success: false, message: 'Content calendar not found' });

    const query = { contentCalendarId: calendar._id, userId: req.user._id || req.user.id };
    if (req.query.week) {
      query.calendarWeek = parseInt(req.query.week, 10);
    }

    const drafts = await Draft.find(query).sort({ calendarDay: 1 });
    res.json({ success: true, drafts });
  } catch (error) {
    console.error('Fetch weekly drafts error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch weekly drafts' });
  }
});

module.exports = router;
