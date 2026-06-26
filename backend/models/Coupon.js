const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  discountedAmount: { type: Number, default: 5000 },  // ₹5,000
  originalAmount:   { type: Number, default: 7500 },  // ₹7,500
  maxUses:   { type: Number, default: 1 },
  usedCount: { type: Number, default: 0 },
  isActive:  { type: Boolean, default: true },
  note:      { type: String, default: '' },   // e.g. "For Bobby - early adopter"
  usedBy: [{
    userId: { type: mongoose.Schema.Types.ObjectId },
    email:  { type: String },
    usedAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

module.exports = mongoose.model('Coupon', couponSchema);
