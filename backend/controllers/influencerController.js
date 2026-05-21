
const Influencer = require('../models/Influencer');

exports.getInfluencers = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const influencers = await Influencer.find({ userId }).sort({ createdAt: -1 });
    res.json({ success: true, influencers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createInfluencer = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const influencer = await Influencer.create({
      userId,
      name: req.body.name,
      email: req.body.email,
      niche: Array.isArray(req.body.niche) ? req.body.niche : [req.body.niche].filter(Boolean),
      profileImage: req.body.profileImage,
      platforms: req.body.platforms || [],
      status: req.body.status || 'invited',
      handle: req.body.handle || '@creator',
      platform: req.body.platform || req.body.platforms?.[0]?.platform || 'instagram',
      followerCount: req.body.followerCount || req.body.platforms?.[0]?.followers || 0,
      engagementRate: req.body.engagementRate || req.body.platforms?.[0]?.engagementRate || 0
    });
    res.status(201).json({ success: true, influencer });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
