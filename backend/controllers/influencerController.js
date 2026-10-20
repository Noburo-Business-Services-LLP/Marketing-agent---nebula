
const Influencer = require('../models/Influencer');
const { fail } = require('../utils/httpError');

exports.getInfluencers = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const influencers = await Influencer.find({ userId }).sort({ createdAt: -1 });
    res.json({ success: true, influencers });
  } catch (error) {
    console.error('influencerController.js request failed:', error && error.message);
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
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
    return fail(res, error, 'We could not save that. Please check the details and try again.');
  }
};

exports.updateInfluencer = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const influencer = await Influencer.findOneAndUpdate(
      { _id: req.params.id, userId },
      {
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
      },
      { new: true }
    );

    if (!influencer) {
      return res.status(404).json({ success: false, message: 'Influencer not found' });
    }

    res.json({ success: true, influencer });
  } catch (error) {
    return fail(res, error, 'We could not save that. Please check the details and try again.');
  }
};

exports.deleteInfluencer = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const deleted = await Influencer.findOneAndDelete({ _id: req.params.id, userId });

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Influencer not found' });
    }

    res.json({ success: true, message: 'Influencer deleted' });
  } catch (error) {
    console.error('influencerController.js request failed:', error && error.message);
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};
