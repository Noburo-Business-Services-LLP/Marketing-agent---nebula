const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  // A business may offer physical goods, services, or both. Services have no
  // stock and often no single price, which is why price is optional below.
  type: {
    type: String,
    enum: ['product', 'service'],
    default: 'product'
  },
  price: {
    type: Number,
    min: 0
  },
  // Free text for cases a single number cannot express — "From ₹5,000/session",
  // "Hourly", "Quote on request".
  priceNote: {
    type: String,
    default: '',
    maxlength: 120
  },
  currency: {
    type: String,
    default: 'INR'
  },
  imageUrl: {
    type: String, // URL or base64. Primary image; kept so existing consumers
                  // (Reels product picker, campaign generation) are unaffected.
    default: ''
  },
  // Additional images — angles, contexts, lifestyle shots. Generation draws on
  // these for variety; a single reference produces repetitive output.
  images: {
    type: [String],
    default: []
  },
  // Concrete selling points, used as copy source material.
  keyFeatures: {
    type: [String],
    default: []
  },
  description: {
    type: String,
    default: '',
    maxlength: 500
  },
  // Retained so no existing data is destroyed, but no longer written or shown:
  // this is a catalogue of what a business offers, not a stock ledger. Nebulaa
  // has no way to know real stock levels, so the numbers were never true.
  stockStatus: {
    type: String,
    enum: ['in-stock', 'out-of-stock', 'low-stock'],
    default: 'in-stock'
  },
  stockQuantity: {
    type: Number,
    default: 0
  },
  category: {
    type: String,
    default: 'General'
  },
  tags: [String],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field on save, and sync stockStatus only when stock is
// actually being tracked. Previously this ran unconditionally: stockQuantity
// defaults to 0, so every new entry was written as "out-of-stock" whether or
// not anyone had said anything about stock.
productSchema.pre('save', function(next) {
  this.updatedAt = Date.now();

  if (this.isModified('stockQuantity')) {
    if (this.stockQuantity <= 0) {
      this.stockStatus = 'out-of-stock';
    } else if (this.stockQuantity < 10) {
      this.stockStatus = 'low-stock';
    } else {
      this.stockStatus = 'in-stock';
    }
  }

  next();
});

// Index for search optimization
productSchema.index({ user: 1, name: 'text', category: 1 });

module.exports = mongoose.model('Product', productSchema);
