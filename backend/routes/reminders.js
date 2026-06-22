/**
 * Reminder Routes
 * Manage scheduled reminders and notifications
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Reminder = require('../models/Reminder');
const Campaign = require('../models/Campaign');

/**
 * GET /api/reminders
 * Get all reminders for the user
 */
router.get('/', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { status, startDate, endDate } = req.query;
    
    const query = { userId };
    
    if (status) query.status = status;
    
    if (startDate || endDate) {
      query.scheduledFor = {};
      if (startDate) query.scheduledFor.$gte = new Date(startDate);
      if (endDate) query.scheduledFor.$lte = new Date(endDate);
    }
    
    const reminders = await Reminder.find(query)
      .populate('campaignId', 'name status platforms')
      .sort({ scheduledFor: 1 });
    
    res.json({
      success: true,
      reminders
    });
  } catch (error) {
    console.error('Get reminders error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch reminders', error: error.message });
  }
});

/**
 * GET /api/reminders/pending
 * Get pending notifications that should be shown now
 */
router.get('/pending', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    const pendingReminders = await Reminder.getPendingReminders(userId);
    
    res.json({
      success: true,
      reminders: pendingReminders,
      count: pendingReminders.length
    });
  } catch (error) {
    console.error('Get pending reminders error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch pending reminders', error: error.message });
  }
});

/**
 * GET /api/reminders/calendar/:year/:month
 * Get reminders for a specific month (for calendar view)
 */
router.get('/calendar/:year/:month', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { year, month } = req.params;
    
    const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
    const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);
    
    const reminders = await Reminder.getUpcomingReminders(userId, startDate, endDate);
    
    // Also get scheduled campaigns for this period
    const campaigns = await Campaign.find({
      userId,
      $or: [
        { scheduledFor: { $gte: startDate, $lte: endDate } },
        { scheduledFor: null, 'scheduling.startDate': { $gte: startDate, $lte: endDate } },
        { scheduledFor: { $exists: false }, 'scheduling.startDate': { $gte: startDate, $lte: endDate } }
      ]
    });
    
    // Combine into calendar events
    const events = [
      ...reminders.map(r => ({
        id: r._id,
        type: 'reminder',
        title: r.title,
        description: r.description,
        scheduledFor: r.scheduledFor,
        time: r.scheduledFor,
        color: r.color,
        status: r.status,
        campaignId: r.campaignId?._id
      })),
      ...campaigns.map(c => ({
        id: c._id,
        type: 'campaign',
        title: c.name,
        description: c.creative?.textContent,
        scheduledFor: (() => {
          if (c.scheduledFor) {
            const d = c.scheduledFor instanceof Date ? c.scheduledFor : new Date(c.scheduledFor);
            if (!isNaN(d.getTime())) return d;
          }
          const start = c.scheduling?.startDate;
          if (!start) return null;
          const datePart = typeof start === 'string'
            ? start.split('T')[0]
            : (start instanceof Date ? start.toISOString().split('T')[0] : new Date(start).toISOString().split('T')[0]);
          const timePart = (c.scheduling?.postTime || '09:00');
          const d = new Date(`${datePart}T${timePart}`);
          return isNaN(d.getTime()) ? null : d;
        })(),
        time: (() => {
          if (c.scheduling?.postTime) return c.scheduling.postTime;
          if (c.scheduledFor) {
            const d = c.scheduledFor instanceof Date ? c.scheduledFor : new Date(c.scheduledFor);
            if (!isNaN(d.getTime())) {
              const hh = String(d.getHours()).padStart(2, '0');
              const mm = String(d.getMinutes()).padStart(2, '0');
              return `${hh}:${mm}`;
            }
          }
          return '09:00';
        })(),
        color: c.status === 'posted' ? '#10b981' : c.status === 'scheduled' ? '#6366f1' : '#f59e0b',
        status: c.status,
        platforms: c.platforms
      }))
    ];
    
    res.json({
      success: true,
      events,
      month: parseInt(month),
      year: parseInt(year)
    });
  } catch (error) {
    console.error('Get calendar events error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch calendar events', error: error.message });
  }
});

/**
 * POST /api/reminders
 * Create a new reminder
 */
router.post('/', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { 
      title, 
      description, 
      scheduledFor, 
      reminderOffset = 30, 
      type = 'custom',
      campaignId,
      platform,
      color,
      notificationChannels = ['in-app']
    } = req.body;
    
    if (!title || !scheduledFor) {
      return res.status(400).json({ 
        success: false, 
        message: 'Title and scheduledFor are required' 
      });
    }
    
    // Calculate reminder time (before scheduled time)
    const scheduledDate = new Date(scheduledFor);
    const reminderTime = new Date(scheduledDate.getTime() - (reminderOffset * 60 * 1000));
    
    const reminder = new Reminder({
      userId,
      type,
      campaignId,
      title,
      description,
      scheduledFor: scheduledDate,
      reminderTime,
      reminderOffset,
      platform,
      color,
      notificationChannels,
      status: 'pending'
    });
    
    await reminder.save();
    
    res.status(201).json({
      success: true,
      reminder,
      message: `Reminder set for ${scheduledDate.toLocaleString()}`
    });
  } catch (error) {
    console.error('Create reminder error:', error);
    res.status(500).json({ success: false, message: 'Failed to create reminder', error: error.message });
  }
});

/**
 * POST /api/reminders/from-campaign/:campaignId
 * Create a reminder from a campaign's schedule
 */
router.post('/from-campaign/:campaignId', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { campaignId } = req.params;
    const { reminderOffset = 30 } = req.body;
    
    const campaign = await Campaign.findOne({ _id: campaignId, userId });
    
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    
    if (!campaign.scheduledFor && !campaign.scheduling?.startDate) {
      return res.status(400).json({ success: false, message: 'Campaign has no scheduled date' });
    }
    
    // Create scheduled time from campaign (prefer canonical scheduledFor when available)
    const scheduledFor = (() => {
      if (campaign.scheduledFor) {
        const d = campaign.scheduledFor instanceof Date ? campaign.scheduledFor : new Date(campaign.scheduledFor);
        return isNaN(d.getTime()) ? null : d;
      }

      const start = campaign.scheduling?.startDate;
      if (!start) return null;
      const datePart = typeof start === 'string'
        ? start.split('T')[0]
        : (start instanceof Date ? start.toISOString().split('T')[0] : new Date(start).toISOString().split('T')[0]);
      const timePart = campaign.scheduling?.postTime || '09:00';
      const d = new Date(`${datePart}T${timePart}`);
      return isNaN(d.getTime()) ? null : d;
    })();

    if (!scheduledFor) {
      return res.status(400).json({ success: false, message: 'Campaign schedule is invalid' });
    }
    
    const reminderTime = new Date(scheduledFor.getTime() - (reminderOffset * 60 * 1000));
    
    // Check if reminder already exists
    const existingReminder = await Reminder.findOne({ campaignId, userId });
    if (existingReminder) {
      return res.status(400).json({ 
        success: false, 
        message: 'Reminder already exists for this campaign' 
      });
    }
    
    const reminder = new Reminder({
      userId,
      type: 'campaign',
      campaignId,
      title: `Campaign: ${campaign.name}`,
      description: `Your ${campaign.platforms.join(', ')} campaign is scheduled to post.`,
      scheduledFor,
      reminderTime,
      reminderOffset,
      platform: campaign.platforms[0],
      color: '#6366f1',
      notificationChannels: ['in-app'],
      status: 'pending'
    });
    
    await reminder.save();
    
    res.status(201).json({
      success: true,
      reminder,
      message: `Reminder set for ${reminderOffset} minutes before campaign`
    });
  } catch (error) {
    console.error('Create campaign reminder error:', error);
    res.status(500).json({ success: false, message: 'Failed to create reminder', error: error.message });
  }
});

/**
 * PUT /api/reminders/:id
 * Update a reminder
 */
router.put('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { id } = req.params;
    
    const reminder = await Reminder.findOneAndUpdate(
      { _id: id, userId },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    
    if (!reminder) {
      return res.status(404).json({ success: false, message: 'Reminder not found' });
    }
    
    res.json({ success: true, reminder });
  } catch (error) {
    console.error('Update reminder error:', error);
    res.status(500).json({ success: false, message: 'Failed to update reminder', error: error.message });
  }
});

/**
 * POST /api/reminders/:id/dismiss
 * Dismiss a reminder
 */
router.post('/:id/dismiss', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { id } = req.params;
    
    const reminder = await Reminder.findOneAndUpdate(
      { _id: id, userId },
      { 
        status: 'dismissed',
        notificationSentAt: new Date()
      },
      { new: true }
    );
    
    if (!reminder) {
      return res.status(404).json({ success: false, message: 'Reminder not found' });
    }
    
    res.json({ success: true, reminder, message: 'Reminder dismissed' });
  } catch (error) {
    console.error('Dismiss reminder error:', error);
    res.status(500).json({ success: false, message: 'Failed to dismiss reminder', error: error.message });
  }
});

/**
 * POST /api/reminders/:id/snooze
 * Snooze a reminder for X minutes
 */
router.post('/:id/snooze', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { id } = req.params;
    const { minutes = 15 } = req.body;
    
    const snoozedUntil = new Date(Date.now() + (minutes * 60 * 1000));
    
    const reminder = await Reminder.findOneAndUpdate(
      { _id: id, userId },
      { 
        status: 'snoozed',
        snoozedUntil,
        reminderTime: snoozedUntil
      },
      { new: true }
    );
    
    if (!reminder) {
      return res.status(404).json({ success: false, message: 'Reminder not found' });
    }
    
    res.json({ 
      success: true, 
      reminder, 
      message: `Reminder snoozed for ${minutes} minutes` 
    });
  } catch (error) {
    console.error('Snooze reminder error:', error);
    res.status(500).json({ success: false, message: 'Failed to snooze reminder', error: error.message });
  }
});

/**
 * DELETE /api/reminders/:id
 * Delete a reminder
 */
router.delete('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { id } = req.params;
    
    const reminder = await Reminder.findOneAndDelete({ _id: id, userId });
    
    if (!reminder) {
      return res.status(404).json({ success: false, message: 'Reminder not found' });
    }
    
    res.json({ success: true, message: 'Reminder deleted' });
  } catch (error) {
    console.error('Delete reminder error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete reminder', error: error.message });
  }
});

module.exports = router;
