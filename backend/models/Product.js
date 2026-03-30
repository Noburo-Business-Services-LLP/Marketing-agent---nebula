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
  price: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'INR'
  },
  imageUrl: {
    type: String, // URL or base64
    default: ''
  },
  description: {
    type: String,
    default: '',
    maxlength: 500
  },
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

// Update the updatedAt field on save and sync stockStatus
productSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  if (this.stockQuantity <= 0) {
    this.stockStatus = 'out-of-stock';
  } else if (this.stockQuantity < 10) {
    this.stockStatus = 'low-stock';
  } else {
    this.stockStatus = 'in-stock';
  }
  
  next();
});

// Index for search optimization
productSchema.index({ user: 1, name: 'text', category: 1 });

module.exports = mongoose.model('Product', productSchema);
