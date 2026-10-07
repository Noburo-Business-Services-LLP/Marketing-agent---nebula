const mongoose = require('mongoose');

// One row per action a Nebulaa staff member takes (add Quarks, disable, assign, role change, reset, open account).
const staffActionSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  actorRole: { type: String, default: '' },
  action: { type: String, required: true, index: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  at: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.models.StaffAction || mongoose.model('StaffAction', staffActionSchema);
