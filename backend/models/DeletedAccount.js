const mongoose = require('mongoose');

/**
 * A one-way hash of the email of an account that was deleted. It cannot be turned back into the email. It exists only so that
 * deleting and signing up again does not give a second free Blueprint.
 */
const DeletedAccountSchema = new mongoose.Schema({
  emailHash: { type: String, required: true, unique: true },
  deletedAt: { type: Date, default: Date.now }
}, { collection: 'deleted_accounts' });

module.exports = mongoose.models.DeletedAccount || mongoose.model('DeletedAccount', DeletedAccountSchema);
