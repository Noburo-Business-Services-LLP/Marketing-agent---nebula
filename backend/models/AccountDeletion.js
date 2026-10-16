const mongoose = require('mongoose');

/**
 * The record of one request to delete an account, kept after the account is gone as evidence that it was done. It holds no
 * personal data: only a one-way hash of the account, the dates, and what each step did.
 */
const StepSchema = new mongoose.Schema({
  name: String,
  status: { type: String, enum: ['done', 'failed', 'skipped'], default: 'done' },
  detail: { type: String, default: '' },
  at: { type: Date, default: Date.now }
}, { _id: false });

const AccountDeletionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, index: true }, // the id only; the account is erased at the end
  accountHash: { type: String, index: true },
  via: { type: String, enum: ['self', 'staff'], default: 'self' },
  status: { type: String, enum: ['pending', 'restored', 'running', 'completed', 'failed'], default: 'pending', index: true },
  requestedAt: { type: Date, default: Date.now },
  purgeAfter: { type: Date, index: true },
  completedAt: { type: Date },
  attempts: { type: Number, default: 0 },
  steps: { type: [StepSchema], default: [] }
}, { collection: 'account_deletions', timestamps: true });

module.exports = mongoose.models.AccountDeletion || mongoose.model('AccountDeletion', AccountDeletionSchema);
