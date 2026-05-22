
const Submission = require('../models/Submission');
const Collaboration = require('../models/Collaboration');

exports.createSubmission = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const submission = await Submission.create({
      userId,
      collaborationId: req.body.collaborationId,
      mediaUrl: req.body.mediaUrl,
      thumbnailUrl: req.body.thumbnailUrl,
      caption: req.body.caption,
      hashtags: req.body.hashtags || [],
      approvalStatus: 'Pending'
    });
    res.status(201).json({ success: true, submission });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getSubmissions = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const submissions = await Submission.find({ userId })
      .populate({
        path: 'collaborationId',
        populate: [{ path: 'influencerId', select: 'name' }, { path: 'campaignId', select: 'name title' }]
      })
      .sort({ createdAt: -1 });
    res.json({ success: true, submissions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

async function updateApproval(req, res, status) {
  try {
    const userId = req.user.userId || req.user.id;
    const submission = await Submission.findOneAndUpdate(
      { _id: req.params.id, userId },
      { approvalStatus: status, feedback: req.body.feedback || '' },
      { new: true }
    );
    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }
    await Collaboration.findByIdAndUpdate(submission.collaborationId, { status });
    return res.json({ success: true, submission });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

exports.approveSubmission = (req, res) => updateApproval(req, res, 'Approved');
exports.rejectSubmission = (req, res) => updateApproval(req, res, 'Rejected');
exports.requestChangesSubmission = (req, res) => updateApproval(req, res, 'Needs Changes');
