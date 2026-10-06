const mongoose = require('mongoose');

// One row each time a CSM opens a client's account: who, which client, when, from where.
const csmSessionSchema = new mongoose.Schema({
  csm: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  openedAt: { type: Date, default: Date.now },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' }
});

module.exports = mongoose.models.CsmSession || mongoose.model('CsmSession', csmSessionSchema);
