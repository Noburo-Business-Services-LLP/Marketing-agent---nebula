const mongoose = require('mongoose');

const brandAssetSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['logo', 'template'],
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  url: {
    type: String,
    required: true
  },
  cloudinaryPublicId: {
    type: String,
    required: true
  },
  width: {
    type: Number,
    default: 0
  },
  height: {
    type: Number,
    default: 0
  },
  fileSize: {
    type: Number,
    default: 0
  },
  format: {
    type: String,
    default: 'png'
  },
  // For logos: default position when overlaying on posters
  defaultPosition: {
    type: String,
    enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'],
    default: 'bottom-right'
  },
  // For logos: default size percentage (relative to poster)
  defaultSize: {
    type: String,
    enum: ['small', 'medium', 'large'],
    default: 'medium'
  },
  isPrimary: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for faster queries
brandAssetSchema.index({ user: 1, type: 1, createdAt: -1 });

// Ensure only one primary logo per user
brandAssetSchema.pre('save', async function(next) {
  if (this.isPrimary && this.type === 'logo') {
    await this.constructor.updateMany(
      { user: this.user, type: 'logo', _id: { $ne: this._id } },
      { isPrimary: false }
    );
  }
  next();
});

module.exports = mongoose.model('BrandAsset', brandAssetSchema);
