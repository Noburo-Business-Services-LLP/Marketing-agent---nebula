const mongoose = require('mongoose');

const mentionLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  mention: {
    type: String,
    required: true
  },
  dateUsed: {
    type: Date,
    default: Date.now,
    expires: 86400 // Automatically delete document 24 hours (86400 seconds) after creation
  }
});

// Composite index for fast lookup of mentions by user
mentionLogSchema.index({ userId: 1, mention: 1 });

module.exports = mongoose.model('MentionLog', mentionLogSchema);
