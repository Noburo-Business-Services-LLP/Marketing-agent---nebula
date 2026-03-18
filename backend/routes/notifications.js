/**
 * Notification Routes
 * 
 * API endpoints for in-app notifications
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Notification = require('../models/Notification');
const notificationScheduler = require('../services/notificationScheduler');

/**
 * GET /api/notifications
 * Get all notifications for the current user
 */
router.get('/', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { status, limit = 20, unreadOnly } = req.query;

    const query = { userId };
    
    if (status) {
      query.status = status;
    }
    
    if (unreadOnly === 'true') {
      query.readAt = null;
      query.status = { $in: ['sent', 'pending'] }; // Include pending notifications too
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .select('-emailError');

    // Get unread count - include both sent and pending
    const unreadCount = await Notification.countDocuments({
      userId,
      readAt: null,
      status: { $in: ['sent', 'pending'] }
    });

    res.json({
      success: true,
      notifications,
      unreadCount
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
  }
});

/**
 * GET /api/notifications/unread-count
 * Get count of unread notifications
 */
router.get('/unread-count', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const count = await Notification.countDocuments({
      userId,
      readAt: null,
      status: { $in: ['sent', 'pending'] }
    });

    res.json({
      success: true,
      count
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ success: false, message: 'Failed to get unread count' });
  }
});

/**
 * PUT /api/notifications/:id/read
 * Mark a notification as read
 */
router.put('/:id/read', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId },
      { readAt: new Date(), status: 'read' },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    res.json({
      success: true,
      notification
    });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark notification as read' });
  }
});

/**
 * PUT /api/notifications/read-all
 * Mark all notifications as read
 */
router.put('/read-all', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const result = await Notification.updateMany(
      { userId, readAt: null },
      { readAt: new Date(), status: 'read' }
    );

    res.json({
      success: true,
      message: `Marked ${result.modifiedCount} notifications as read`
    });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark all as read' });
  }
});

/**
 * DELETE /api/notifications/:id
 * Delete a notification
 */
router.delete('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      userId
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    res.json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete notification' });
  }
});

/**
 * DELETE /api/notifications
 * Clear all notifications
 */
router.delete('/', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const result = await Notification.deleteMany({ userId });

    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} notifications`
    });
  } catch (error) {
    console.error('Clear notifications error:', error);
    res.status(500).json({ success: false, message: 'Failed to clear notifications' });
  }
});

/**
 * POST /api/notifications/test
 * Send a test notification (for testing purposes)
 */
router.post('/test', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { campaignId } = req.body;

    if (!campaignId) {
      return res.status(400).json({ success: false, message: 'Campaign ID required' });
    }

    const result = await notificationScheduler.triggerTestNotification(campaignId, userId);

    res.json(result);
  } catch (error) {
    console.error('Test notification error:', error);
    res.status(500).json({ success: false, message: 'Failed to send test notification' });
  }
});

/**
 * POST /api/notifications/process
 * Force process all scheduled campaigns and create/send pending notifications
 */
router.post('/process', protect, async (req, res) => {
  try {
    console.log('🔄 Manually triggering notification processing...');
    await notificationScheduler.processScheduledCampaigns();
    
    // Get current notification status
    const userId = req.user.userId || req.user.id;
    const notifications = await Notification.find({ userId }).sort({ createdAt: -1 }).limit(10);
    
    res.json({
      success: true,
      message: 'Notification processing triggered',
      notifications: notifications.map(n => ({
        id: n._id,
        type: n.type,
        title: n.title,
        status: n.status,
        scheduledFor: n.scheduledFor,
        emailSent: n.emailSent
      }))
    });
  } catch (error) {
    console.error('Process notifications error:', error);
    res.status(500).json({ success: false, message: 'Failed to process notifications' });
  }
});

/**
 * POST /api/notifications/test
 * Create a test notification for popup testing
 */
router.post('/test', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { minutesLeft = 15, campaignName = 'Test Campaign' } = req.body;
    
    // Create the scheduled time (now + minutesLeft minutes)
    const scheduledTime = new Date(Date.now() + minutesLeft * 60 * 1000);
    
    const notification = new Notification({
      userId: userId,
      type: minutesLeft >= 25 ? 'campaign_reminder_30' : 'campaign_reminder_15',
      title: `Campaign Reminder - ${minutesLeft} Minutes Left!`,
      message: `Your campaign "${campaignName}" goes live in ${minutesLeft} minutes!`,
      scheduledFor: new Date(),
      sentAt: new Date(),
      status: 'sent',
      metadata: {
        campaignName: campaignName,
        platforms: ['instagram'],
        scheduledTime: scheduledTime.toLocaleString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        }),
        scheduledTimeISO: scheduledTime.toISOString(),
        minutesLeft: minutesLeft
      }
    });

    await notification.save();
    
    res.json({
      success: true,
      message: `Test notification created for "${campaignName}"`,
      notification
    });
  } catch (error) {
    console.error('Create test notification error:', error);
    res.status(500).json({ success: false, message: 'Failed to create test notification' });
  }
});

/**
 * POST /api/notifications/check-now
 * Force check all scheduled campaigns and send notifications NOW
 */
router.post('/check-now', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const Campaign = require('../models/Campaign');
    const sesEmailService = require('../services/sesEmailService');
    
    console.log('🔔 Manual notification check triggered by user');
    
    // Get all scheduled campaigns for this user with a short timeout
    const campaigns = await Campaign.find({
      userId,
      status: 'scheduled'
    }).maxTimeMS(5000).lean();
    
    console.log(`📋 Found ${campaigns.length} scheduled campaigns for user`);
    
    if (campaigns.length === 0) {
      return res.json({
        success: true,
        message: 'No scheduled campaigns found',
        notifications: []
      });
    }
    
    const now = new Date();
    const createdNotifications = [];
    
    for (const campaign of campaigns) {
      // Parse campaign scheduled time
      if (!campaign.scheduling?.startDate) continue;
      
      const dateStr = campaign.scheduling.startDate;
      const datePart = typeof dateStr === 'string' ? dateStr.split('T')[0] : dateStr;
      const startDate = new Date(datePart + 'T00:00:00');
      
      const postTime = campaign.scheduling.postTime || '10:00';
      const [hours, minutes] = postTime.split(':').map(Number);
      startDate.setHours(hours || 10, minutes || 0, 0, 0);
      
      const timeDiff = startDate.getTime() - now.getTime();
      const minutesUntilLive = Math.round(timeDiff / (1000 * 60));
      
      console.log(`📊 Campaign "${campaign.name}": scheduled ${startDate.toISOString()}, ${minutesUntilLive} min until live`);
      
      // Check for 30-min notification
      if (minutesUntilLive >= 25 && minutesUntilLive <= 35) {
        const existing = await Notification.findOne({
          campaignId: campaign._id,
          type: 'campaign_reminder_30'
        });
        
        if (!existing) {
          const notification = new Notification({
            userId,
            campaignId: campaign._id,
            type: 'campaign_reminder_30',
            title: 'Campaign Reminder - 30 Minutes Left!',
            message: `Your campaign "${campaign.name}" goes live in 30 minutes!`,
            scheduledFor: new Date(),
            sentAt: new Date(),
            status: 'sent',
            metadata: {
              campaignName: campaign.name,
              platforms: campaign.platforms || [],
              scheduledTime: startDate.toLocaleString(),
              minutesLeft: 30
            }
          });
          await notification.save();
          createdNotifications.push({ campaign: campaign.name, type: '30-min' });
          console.log(`✅ Created 30-min notification for: ${campaign.name}`);
          
          // Send email
          if (sesEmailService.initialized) {
            await sesEmailService.sendCampaignReminder({
              to: 'navaneethakrishnan821@gmail.com',
              campaignName: campaign.name,
              minutesBefore: 30,
              scheduledTime: startDate.toLocaleString(),
              platforms: campaign.platforms || []
            });
            console.log(`📧 Email sent for 30-min reminder`);
          }
        }
      }
      
      // Check for 15-min notification
      if (minutesUntilLive >= 10 && minutesUntilLive <= 20) {
        const existing = await Notification.findOne({
          campaignId: campaign._id,
          type: 'campaign_reminder_15'
        });
        
        if (!existing) {
          const notification = new Notification({
            userId,
            campaignId: campaign._id,
            type: 'campaign_reminder_15',
            title: 'Campaign Reminder - 15 Minutes Left!',
            message: `Your campaign "${campaign.name}" goes live in 15 minutes!`,
            scheduledFor: new Date(),
            sentAt: new Date(),
            status: 'sent',
            metadata: {
              campaignName: campaign.name,
              platforms: campaign.platforms || [],
              scheduledTime: startDate.toLocaleString(),
              minutesLeft: 15
            }
          });
          await notification.save();
          createdNotifications.push({ campaign: campaign.name, type: '15-min' });
          console.log(`✅ Created 15-min notification for: ${campaign.name}`);
          
          // Send email
          if (sesEmailService.initialized) {
            await sesEmailService.sendCampaignReminder({
              to: 'navaneethakrishnan821@gmail.com',
              campaignName: campaign.name,
              minutesBefore: 15,
              scheduledTime: startDate.toLocaleString(),
              platforms: campaign.platforms || []
            });
            console.log(`📧 Email sent for 15-min reminder`);
          }
        }
      }
    }
    
    res.json({
      success: true,
      message: `Checked ${campaigns.length} campaigns, created ${createdNotifications.length} notifications`,
      campaigns: campaigns.map(c => ({
        name: c.name,
        scheduledDate: c.scheduling?.startDate,
        scheduledTime: c.scheduling?.postTime
      })),
      notifications: createdNotifications
    });
  } catch (error) {
    console.error('Manual check error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
