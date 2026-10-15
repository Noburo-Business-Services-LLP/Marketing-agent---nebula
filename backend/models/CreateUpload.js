const mongoose = require('mongoose');

// A file a customer dropped into the Create box (a pamphlet, a poster, a price list), what was read from it, and
// where the original is kept so it can be used again. Private to the account; deletable by the customer.
const createUploadSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, default: '', maxlength: 200 },
  mimeType: { type: String, default: '', maxlength: 60 },
  kind: { type: String, default: 'other', maxlength: 30 },
  url: { type: String, default: '', maxlength: 600 },
  summary: { type: String, default: '', maxlength: 600 },
  brief: { type: String, default: '', maxlength: 1500 },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  notes: { type: String, default: '', maxlength: 400 },
}, { timestamps: true });

createUploadSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.models.CreateUpload || mongoose.model('CreateUpload', createUploadSchema);
