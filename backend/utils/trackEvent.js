const FeatureEvent = require('../models/FeatureEvent');

// Fire-and-forget — never throws, never blocks response
const trackEvent = (userId, feature) => {
  if (!userId || !feature) return;
  FeatureEvent.create({ userId, feature }).catch(() => {});
};

module.exports = trackEvent;
