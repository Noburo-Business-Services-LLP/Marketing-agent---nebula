const Campaign = require('../models/Campaign');
const { publishCampaignToSocial } = require('./campaignPublisher');
const { computeNextRecurringStartDate } = require('../utils/scheduling');

function isEnabled() {
  return String(process.env.ENABLE_CAMPAIGN_SCHEDULER || 'true').toLowerCase() !== 'false';
}

async function processDueCampaigns({ now = new Date(), limit = 20 } = {}) {
  const dueCampaigns = await Campaign.find({
    status: 'scheduled',
    'scheduling.startDate': { $lte: now },
  })
    .sort({ 'scheduling.startDate': 1 })
    .limit(limit);

  for (const campaign of dueCampaigns) {
    try {
      const result = await publishCampaignToSocial(campaign);
      const nextRecurring = computeNextRecurringStartDate(campaign, { now });

      if (result.success) {
        const update = {
          socialPostId: result.postId,
          publishedAt: new Date(),
          publishResult: result.data,
          lastPublishError: null,
        };

        if (nextRecurring) {
          update.status = 'scheduled';
          update['scheduling.startDate'] = nextRecurring.startDate;
          update['scheduling.postTime'] = nextRecurring.postTime;
          update['scheduling.scheduleType'] = nextRecurring.scheduleType;
          update['scheduling.interval'] = nextRecurring.interval;
          if (nextRecurring.timezoneOffsetMinutes !== null && nextRecurring.timezoneOffsetMinutes !== undefined) {
            update['scheduling.timezoneOffsetMinutes'] = nextRecurring.timezoneOffsetMinutes;
          }
        } else {
          update.status = 'posted';
        }

        await Campaign.findByIdAndUpdate(campaign._id, { $set: update });
        continue;
      }

      // If social publishing isn't configured, still "trigger" the scheduled campaign
      // so the UI reflects the scheduled action occurred.
      const notConfigured = String(result.error || '').toLowerCase().includes('not configured');
      if (notConfigured) {
        const update = {
          publishedAt: new Date(),
          publishResult: { simulated: true, reason: result.error || 'API not configured' },
          lastPublishError: null,
        };

        if (nextRecurring) {
          update.status = 'scheduled';
          update['scheduling.startDate'] = nextRecurring.startDate;
          update['scheduling.postTime'] = nextRecurring.postTime;
          update['scheduling.scheduleType'] = nextRecurring.scheduleType;
          update['scheduling.interval'] = nextRecurring.interval;
          if (nextRecurring.timezoneOffsetMinutes !== null && nextRecurring.timezoneOffsetMinutes !== undefined) {
            update['scheduling.timezoneOffsetMinutes'] = nextRecurring.timezoneOffsetMinutes;
          }
        } else {
          update.status = 'posted';
        }

        await Campaign.findByIdAndUpdate(campaign._id, { $set: update });
        continue;
      }

      await Campaign.findByIdAndUpdate(campaign._id, {
        $set: {
          lastPublishError: result.error || result.message || 'Failed to publish',
          publishResult: result.data || result,
        },
      });
    } catch (e) {
      await Campaign.findByIdAndUpdate(campaign._id, {
        $set: {
          lastPublishError: e.message || 'Failed to publish',
        },
      });
    }
  }
}

function startCampaignScheduler({ intervalMs = 30_000, logger = console } = {}) {
  if (!isEnabled()) {
    logger.log('🕒 Campaign scheduler disabled (ENABLE_CAMPAIGN_SCHEDULER=false)');
    return () => {};
  }

  logger.log(`🕒 Campaign scheduler started (interval ${intervalMs}ms)`);
  const timer = setInterval(() => {
    processDueCampaigns().catch((e) => logger.error('Campaign scheduler error:', e));
  }, intervalMs);

  // Run once immediately
  processDueCampaigns().catch((e) => logger.error('Campaign scheduler error:', e));

  return () => clearInterval(timer);
}

module.exports = {
  processDueCampaigns,
  startCampaignScheduler,
};
