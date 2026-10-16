const mongoose = require('mongoose');

/**
 * What the law requires us to keep after an account is deleted: the payment and the tax invoice details (who was invoiced, the
 * GSTIN if any, the amount, the date, the invoice). Kept apart from the account and used for nothing else. Removed after the
 * retention period.
 */
const RetainedPaymentSchema = new mongoose.Schema({
  razorpayPaymentId: { type: String, index: true },
  razorpayOrderId: { type: String },
  item: { type: String },
  amount: { type: Number },
  currency: { type: String, default: 'INR' },
  exGstAmount: { type: Number },
  status: { type: String },
  paidAt: { type: Date },
  invoiceUrl: { type: String, default: '' },
  invoicedTo: {
    name: { type: String, default: '' },
    legalName: { type: String, default: '' },
    gstin: { type: String, default: '' },
    stateCode: { type: String, default: '' }
  },
  retainUntil: { type: Date, index: true }
}, { collection: 'retained_payments', timestamps: true });

module.exports = mongoose.models.RetainedPayment || mongoose.model('RetainedPayment', RetainedPaymentSchema);
