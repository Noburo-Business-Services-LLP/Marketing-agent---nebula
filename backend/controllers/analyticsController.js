
const mongoose = require('mongoose');
const Influencer = require('../models/Influencer');
const Collaboration = require('../models/Collaboration');
const Submission = require('../models/Submission');
const InfluencerAnalytics = require('../models/Analytics');

exports.getInfluencerAnalytics = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const [totalInfluencers, pendingApprovals, activeCollaborations, topCampaigns, platformAnalytics, totals] = await Promise.all([
      Influencer.countDocuments({ userId }),
      Submission.countDocuments({ userId, approvalStatus: 'Pending' }),
      Collaboration.countDocuments({ userId, status: { $in: ['Pending', 'Accepted', 'Needs Changes'] } }),
      Collaboration.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(String(userId)) } },
        { $group: { _id: '$campaignId', total: { $sum: 1 } } },
        { $sort: { total: -1 } },
        { $limit: 5 }
      ]),
      InfluencerAnalytics.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(String(userId)) } },
        {
          $group: {
            _id: '$platform',
            impressions: { $sum: '$impressions' },
            engagement: { $sum: '$engagement' },
            clicks: { $sum: '$clicks' },
            conversions: { $sum: '$conversions' }
          }
        }
      ]),
      InfluencerAnalytics.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(String(userId)) } },
        {
          $group: {
            _id: null,
            likes: { $sum: '$likes' },
            views: { $sum: '$views' },
            shares: { $sum: '$shares' },
            clicks: { $sum: '$clicks' },
            engagement: { $sum: '$engagement' },
            conversions: { $sum: '$conversions' }
          }
        }
      ])
    ]);

    res.json({
      success: true,
      dashboard: {
        totalInfluencers,
        pendingApprovals,
        activeCollaborations,
        topPerformingCampaigns: topCampaigns,
        platformAnalytics
      },
      totals: totals[0] || { likes: 0, views: 0, shares: 0, clicks: 0, engagement: 0, conversions: 0 }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
