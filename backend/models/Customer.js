const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  mobileNumber: { type: String, required: true, trim: true },
  shopName: { type: String, required: true, trim: true },

  selectedPlan: {
    tier: { type: String, enum: ['pro', 'growth', 'scale'] },
    cycle: { type: String, enum: ['monthly', 'quarterly', 'annual'] },
    planId: { type: String },
    amount: { type: Number },
  },

  razorpaySubscriptionId: { type: String, index: true },
  razorpayPaymentId: { type: String },
  paymentStatus: {
    type: String,
    enum: ['pending', 'trialing', 'paid', 'failed', 'cancelled'],
    default: 'pending',
  },
  paidAt: { type: Date },

  // 7-day free trial — mandate authorized at signup, first charge happens at trialEndsAt
  trialStartAt: { type: Date },
  trialEndsAt: { type: Date },

  createdAt: { type: Date, default: Date.now },
});

customerSchema.index({ email: 1, createdAt: -1 });

module.exports = mongoose.model('Customer', customerSchema);
