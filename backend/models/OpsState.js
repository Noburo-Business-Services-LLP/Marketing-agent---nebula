const mongoose = require('mongoose');

/** Small durable facts the server must remember across restarts (for example which alert has already been sent). */
const OpsStateSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, default: '' }
}, { collection: 'ops_state', timestamps: true });

module.exports = mongoose.models.OpsState || mongoose.model('OpsState', OpsStateSchema);
