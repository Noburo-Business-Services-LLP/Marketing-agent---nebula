const mongoose = require('mongoose');

/** A switch the owner can flip to stop one AI provider being used (a runaway bill, an outage, a bad batch). */
const AiSwitchSchema = new mongoose.Schema({
  provider: { type: String, required: true, unique: true },
  disabled: { type: Boolean, default: false },
  note: { type: String, default: '' },
  updatedBy: { type: String, default: '' }
}, { collection: 'ai_switches', timestamps: true });

module.exports = mongoose.models.AiSwitch || mongoose.model('AiSwitch', AiSwitchSchema);
