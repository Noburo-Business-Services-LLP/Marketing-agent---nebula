
const mongoose = require('mongoose');

const collaborationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true
  },
  influencerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Influencer',
    required: true
  },
  platform: {
    type: String,
    enum: ['instagram', 'youtube', 'linkedin', 'facebook', 'twitter', 'x'],
    required: true
  },
  contentType: {
    type: String,
    required: true,
    trim: true
  },
  dueDate: Date,
  status: {
    type: String,
    enum: ['Pending', 'Accepted', 'Approved', 'Rejected', 'Needs Changes', 'Published'],
    default: 'Pending'
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

collaborationSchema.index({ userId: 1, campaignId: 1, influencerId: 1, platform: 1 });

module.exports = mongoose.model('Collaboration', collaborationSchema);
