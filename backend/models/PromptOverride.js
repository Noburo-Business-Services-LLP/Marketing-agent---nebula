const mongoose = require('mongoose');

/**
 * A user's edited version of one of the prompts the platform ships with.
 *
 * Per-account by design: editing here changes generation for this user only,
 * so tuning against live data cannot affect anyone else. The shipped default
 * always remains recoverable — deleting the override restores it, which is
 * why the default is never copied into this record.
 */
const promptOverrideSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Matches an id in services/promptRegistry.js
  promptId: {
    type: String,
    required: true,
    trim: true
  },
  template: {
    type: String,
    required: true,
    maxlength: 20000
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

promptOverrideSchema.index({ user: 1, promptId: 1 }, { unique: true });

promptOverrideSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('PromptOverride', promptOverrideSchema);
