const mongoose = require('mongoose');

const featureEventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  feature: { type: String, required: true },
  feature_module: { type: String, default: '' }, // campaigns, competitors, analytics, social, brand, chat
  credits_consumed: { type: Number, default: 0 },
  status: { type: String, enum: ['success', 'failed'], default: 'success' },
  timestamp: { type: Date, default: Date.now, index: true }
});

featureEventSchema.index({ userId: 1, feature: 1 });
featureEventSchema.index({ userId: 1, timestamp: -1 });

module.exports = mongoose.model('FeatureEvent', featureEventSchema);
