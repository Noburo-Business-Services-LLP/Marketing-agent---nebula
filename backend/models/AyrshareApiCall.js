const mongoose = require('mongoose');

// One doc per (day, endpoint, status-bucket). Tiny, upsert-friendly, aggregation-friendly.
// Lets us show: total today, breakdown by endpoint, breakdown by success/error, trend across days.
const AyrshareApiCallSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, index: true }, // "YYYY-MM-DD" in UTC
    endpoint: { type: String, required: true },          // e.g. "/api/user", "/api/post"
    method: { type: String, default: 'GET' },
    statusBucket: { type: String, default: 'unknown' },  // "2xx" | "4xx" | "5xx" | "blocked" | "error"
    count: { type: Number, default: 0 },
    lastCalledAt: { type: Date, default: Date.now }
  },
  { timestamps: true, collection: 'ayrshare_api_calls' }
);

AyrshareApiCallSchema.index({ date: 1, endpoint: 1, method: 1, statusBucket: 1 }, { unique: true });

module.exports = mongoose.model('AyrshareApiCall', AyrshareApiCallSchema);
