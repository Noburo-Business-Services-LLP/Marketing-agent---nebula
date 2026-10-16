const mongoose = require('mongoose');

/** What the AI providers have cost us today, estimated from our own cost table, in US dollars. One row per UTC day. */
const AiSpendDaySchema = new mongoose.Schema({
  day: { type: String, required: true, unique: true }, // YYYY-MM-DD, UTC
  totalUsd: { type: Number, default: 0 },
  byProvider: { type: mongoose.Schema.Types.Mixed, default: {} },
  alerted70: { type: Boolean, default: false },
  alerted100: { type: Boolean, default: false }
}, { collection: 'ai_spend_days', timestamps: true, minimize: false });

module.exports = mongoose.models.AiSpendDay || mongoose.model('AiSpendDay', AiSpendDaySchema);
