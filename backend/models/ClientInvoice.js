const mongoose = require('mongoose');

// One row per managed client per service month: the invoice, and whether and how it was paid.
// Amounts are whole paise (1 rupee = 100 paise) so nothing is ever rounded twice.
const clientInvoiceSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ }, // 'YYYY-MM'
  exPaise: { type: Number, required: true, min: 0 },
  gstPercent: { type: Number, required: true, min: 0 },
  gstInclusive: { type: Boolean, default: false }, // the amount typed by staff already contained the GST
  gstPaise: { type: Number, required: true, min: 0 },
  totalPaise: { type: Number, required: true, min: 0 },
  months: { type: Number, enum: [1, 3, 6, 12], default: 1 }, // how many months this billing period covers
  planName: { type: String, default: '', maxlength: 80 },
  status: { type: String, enum: ['invoiced', 'paid', 'void'], default: 'invoiced' },
  invoiceNumber: { type: String, default: '', maxlength: 40 },
  invoiceUrl: { type: String, default: '', maxlength: 500 },
  zohoInvoiceId: { type: String, default: '' },
  issuedOn: { type: Date },
  dueOn: { type: Date },
  paidOn: { type: Date },
  paidMode: { type: String, enum: ['bank', 'cheque', 'upi', 'cash', 'razorpay', 'other', null], default: null },
  paidReference: { type: String, default: '', maxlength: 100 },
  note: { type: String, default: '', maxlength: 300 },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

clientInvoiceSchema.index({ client: 1, period: 1 }, { unique: true });

module.exports = mongoose.models.ClientInvoice || mongoose.model('ClientInvoice', clientInvoiceSchema);
