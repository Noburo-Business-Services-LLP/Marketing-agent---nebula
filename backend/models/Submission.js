
const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  collaborationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Collaboration',
    required: true
  },
  mediaUrl: {
    type: String,
    required: true
  },
  thumbnailUrl: String,
  caption: String,
  hashtags: [String],
  approvalStatus: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected', 'Needs Changes', 'Published'],
    default: 'Pending'
  },
  feedback: String
}, { timestamps: true });

submissionSchema.index({ userId: 1, collaborationId: 1, approvalStatus: 1 });

module.exports = mongoose.model('Submission', submissionSchema);
