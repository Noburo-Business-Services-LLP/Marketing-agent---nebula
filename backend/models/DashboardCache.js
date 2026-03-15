const mongoose = require('mongoose');

const dashboardCacheSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['dashboard', 'strategic'],
    required: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: false });

// One cache entry per user per type
dashboardCacheSchema.index({ userId: 1, type: 1 }, { unique: true });

// Get cached data
dashboardCacheSchema.statics.getCached = async function(userId, type) {
  const cached = await this.findOne({ userId, type }).lean();
  return cached ? cached.data : null;
};

// Set cached data (upsert)
dashboardCacheSchema.statics.setCached = async function(userId, type, data) {
  await this.findOneAndUpdate(
    { userId, type },
    { userId, type, data, updatedAt: new Date() },
    { upsert: true, new: true }
  );
};

// Clear cache for a user (one type or all)
dashboardCacheSchema.statics.clearCache = async function(userId, type) {
  if (type) {
    await this.deleteOne({ userId, type });
  } else {
    await this.deleteMany({ userId });
  }
};

module.exports = mongoose.model('DashboardCache', dashboardCacheSchema);
