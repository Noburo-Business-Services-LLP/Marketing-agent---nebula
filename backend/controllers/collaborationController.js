
const Collaboration = require('../models/Collaboration');

exports.getCollaborations = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const collaborations = await Collaboration.find({ userId })
      .populate('campaignId', 'name title campaignName')
      .populate('influencerId', 'name email profileImage platforms status')
      .sort({ createdAt: -1 });
    res.json({ success: true, collaborations });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.inviteCollaboration = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const collaboration = await Collaboration.create({
      userId,
      campaignId: req.body.campaignId,
      influencerId: req.body.influencerId,
      platform: req.body.platform,
      contentType: req.body.contentType,
      dueDate: req.body.dueDate,
      status: req.body.status || 'Pending',
      assignedBy: userId
    });
    res.status(201).json({ success: true, collaboration });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.deleteCollaboration = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const deleted = await Collaboration.findOneAndDelete({ _id: req.params.id, userId });

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Collaboration not found' });
    }

    res.json({ success: true, message: 'Collaboration deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
