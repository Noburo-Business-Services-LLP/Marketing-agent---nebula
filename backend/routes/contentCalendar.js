const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const ContentCalendar = require('../models/ContentCalendar');
const { deductCredits, refundCredits } = require('../middleware/trialGuard');
const { videoGenerationQueue } = require('../services/videoGenerationQueue');
const {
  generateMonthlyCalendar,
  createDraftsForItem,
  findItem,
  todaySuggestion,
  calendarMonth
} = require('../services/contentCalendarService');

// A calendar row is a reel if its format implies motion.
const isReelFormat = (value = '') => /reel|video/i.test(String(value || ''));

async function getCurrentCalendar(userId) {
  return ContentCalendar.findOne({ userId, month: calendarMonth() }).sort({ createdAt: -1 });
}

router.get('/', protect, async (req, res) => {
  try {
    let calendar = await getCurrentCalendar(req.user._id);
    if (!calendar) {
      const user = await User.findById(req.user._id);
      calendar = await generateMonthlyCalendar(user);
    }
    res.json({ success: true, calendar });
  } catch (error) {
    console.error('Content calendar fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch content calendar' });
  }
});
router.get('/history', protect, async (req, res) => {
  try {
    const calendars = await ContentCalendar.find({ userId: req.user._id }).sort({ month: -1 });
    res.json({ success: true, calendars });
  } catch (error) {
    console.error('Content calendar history error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch content calendar history' });
  }
});

router.post('/generate-next', protect, async (req, res) => {
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
    const calendar = await generateMonthlyCalendar(user, nextMonthStr);
    res.json({ success: true, calendar });
  } catch (error) {
    console.error('Content calendar generate next error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate next content calendar' });
  }
});

router.post('/regenerate', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const targetMonth = req.body.month || calendarMonth();
    const calendar = await generateMonthlyCalendar(user, targetMonth);
    res.json({ success: true, calendar });
  } catch (error) {
    console.error('Content calendar regenerate error:', error);
    res.status(500).json({ success: false, message: 'Failed to regenerate content calendar' });
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

    if (typeof req.body.autoGenerate === 'boolean') calendar.autoGenerate = req.body.autoGenerate;
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
router.post('/items/:itemId/auto-generate', protect, async (req, res) => {
  const userId = req.user?._id ? String(req.user._id) : (req.user?.id ? String(req.user.id) : null);
  if (!userId) return res.status(401).json({ success: false, message: 'Authentication required' });

  let creditsTaken = false;
  try {
    const calendar = await getCurrentCalendar(req.user._id);
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

    const user = await User.findById(req.user._id);
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

    const creditResult = await deductCredits(userId, 'campaign_full', 1, `Smart Calendar reel — day ${item.day}`);
    if (!creditResult.success) {
      return res.status(403).json({
        success: false,
        creditsExhausted: true,
        message: creditResult.error || 'Insufficient credits to generate this reel.'
      });
    }
    creditsTaken = true;

    const baseUrl = String(process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const queued = await videoGenerationQueue.enqueue({
      userId,
      jobType: 'create_video_pipeline',
      payload: {
        payload,
        user: { _id: req.user?._id, id: req.user?.id, businessProfile: profile },
        baseUrl
      }
    });

    // Mirror /createVideo: seed the Draft so the wizard has something to
    // resume against before the pipeline writes its first real stage.
    try {
      const Draft = require('../models/Draft');
      await Draft.findOneAndUpdate(
        { 'generationProgress.jobId': queued.jobId, userId: String(userId) },
        {
          $set: {
            title: String(item.headline || `Day ${item.day} reel`).substring(0, 50),
            status: 'processing',
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
        await refundCredits(userId, 'campaign_full', 1, 'Refund: Smart Calendar reel enqueue failed');
      } catch (refundErr) {
        console.error('[calendar auto-generate] refund failed:', refundErr.message);
      }
    }
    console.error('Calendar auto-generate error:', error);
    return res.status(500).json({ success: false, message: 'Failed to start reel generation' });
  }
});

router.post('/items/:itemId/create-draft', protect, async (req, res) => {
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
router.post('/:id/auto-generate-week', protect, async (req, res) => {
  try {
    const calendar = await ContentCalendar.findOne({ _id: req.params.id, userId: req.user._id || req.user.id });
    if (!calendar) return res.status(404).json({ success: false, message: 'Content calendar not found' });

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
    res.status(500).json({ success: false, message: 'Failed to queue weekly generation', error: error.message });
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
    res.status(500).json({ success: false, message: 'Failed to fetch weekly drafts', error: error.message });
  }
});

module.exports = router;
