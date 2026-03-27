const mongoose = require('mongoose');

const featureEventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  feature: { type: String, required: true },
  timestamp: { type: Date, default: Date.now, index: true }
});

featureEventSchema.index({ userId: 1, feature: 1 });
featureEventSchema.index({ userId: 1, timestamp: -1 });

module.exports = mongoose.model('FeatureEvent', featureEventSchema);
