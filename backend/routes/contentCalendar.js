const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const ContentCalendar = require('../models/ContentCalendar');
const {
  generateMonthlyCalendar,
  createDraftsForItem,
  findItem,
  todaySuggestion,
  calendarMonth
} = require('../services/contentCalendarService');

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

router.post('/regenerate', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const calendar = await generateMonthlyCalendar(user);
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
    const calendar = await getCurrentCalendar(req.user._id);
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
