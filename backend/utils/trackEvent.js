const FeatureEvent = require('../models/FeatureEvent');

// Fire-and-forget — never throws, never blocks response
const trackEvent = (userId, feature, meta = {}) => {
  if (!userId || !feature) return;
  FeatureEvent.create({
    userId,
    feature,
    feature_module: meta.feature_module || '',
    credits_consumed: meta.credits_consumed || 0,
    status: meta.status || 'success',
  }).catch(() => {});
};

module.exports = trackEvent;
