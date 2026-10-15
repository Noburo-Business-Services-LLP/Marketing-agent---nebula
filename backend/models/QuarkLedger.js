const mongoose = require('mongoose');

/**
 * Append-only record of every change to a Quark balance: a grant, a purchase, a spend, a refund, an expiry
 * or a hold. Rows are only ever inserted. The balance on the user is what the app spends from; this is the
 * trail that explains how it got there (for support, audits and disputes).
 */
const QuarkLedgerSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['grant', 'purchase', 'spend', 'refund', 'expiry', 'hold', 'release', 'adjust'], required: true },
  bucket: { type: String, enum: ['plan', 'topup', 'kept'], default: 'kept' },
  quarks: { type: Number, required: true }, // signed: spends and expiries are negative
  balanceAfter: { type: Number },
  action: { type: String },
  ref: { type: String }, // payment id, job id or similar
  note: { type: String },
  createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

QuarkLedgerSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.models.QuarkLedger || mongoose.model('QuarkLedger', QuarkLedgerSchema);
