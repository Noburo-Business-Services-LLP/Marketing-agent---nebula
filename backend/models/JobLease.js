const mongoose = require('mongoose');

/**
 * One row per background job (name) that must run on one server at a time (see services/leaseLock.js).
 * `expiresAt` is both the lease end and, one day later, the TTL that cleans the row up.
 */
const JobLeaseSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  holder: { type: String, default: '' },
  expiresAt: { type: Date, required: true }
}, { collection: 'job_leases', timestamps: true });

JobLeaseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

module.exports = mongoose.models.JobLease || mongoose.model('JobLease', JobLeaseSchema);
