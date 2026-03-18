const express = require('express');
const router = express.Router();
const BrandAsset = require('../models/BrandAsset');
const { protect } = require('../middleware/auth');
const { uploadBase64Image, deleteImage } = require('../services/imageUploader');

/**
 * @route   GET /api/brand-assets
 * @desc    Get all brand assets for current user
 * @access  Private
 */
router.get('/', protect, async (req, res) => {
  try {
    const { type } = req.query;
    const query = { user: req.user._id };
    
    if (type && ['logo', 'template'].includes(type)) {
      query.type = type;
    }
    
    const assets = await BrandAsset.find(query)
      .sort({ isPrimary: -1, createdAt: -1 });
    
    res.json({
      success: true,
      assets,
      count: assets.length
    });
  } catch (error) {
    console.error('Error fetching brand assets:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch brand assets' });
  }
});

/**
 * @route   GET /api/brand-assets/logos
 * @desc    Get only logos for current user
 * @access  Private
 */
router.get('/logos', protect, async (req, res) => {
  try {
    const logos = await BrandAsset.find({ user: req.user._id, type: 'logo' })
      .sort({ isPrimary: -1, createdAt: -1 });
    
    res.json({
      success: true,
      logos,
      count: logos.length
    });
  } catch (error) {
    console.error('Error fetching logos:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch logos' });
  }
});

/**
 * @route   GET /api/brand-assets/templates
 * @desc    Get only templates for current user
 * @access  Private
 */
router.get('/templates', protect, async (req, res) => {
  try {
    const templates = await BrandAsset.find({ user: req.user._id, type: 'template' })
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      templates,
      count: templates.length
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch templates' });
  }
});

/**
 * @route   POST /api/brand-assets/upload
 * @desc    Upload a new brand asset (logo or template)
 * @access  Private
 */
router.post('/upload', protect, async (req, res) => {
  try {
    const { imageData, type, name, isPrimary, defaultPosition, defaultSize } = req.body;
    
    if (!imageData) {
      return res.status(400).json({ success: false, message: 'Image data is required' });
    }
    
    if (!type || !['logo', 'template'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Type must be "logo" or "template"' });
    }
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    
    // Upload to Cloudinary
    const folder = type === 'logo' ? 'nebula-brand-logos' : 'nebula-brand-templates';
    const uploadResult = await uploadBase64Image(imageData, folder);
    
    if (!uploadResult.success) {
      return res.status(500).json({ success: false, message: 'Failed to upload image to cloud storage' });
    }
    
    // Create brand asset record
    const asset = new BrandAsset({
      user: req.user._id,
      type,
      name: name.trim(),
      url: uploadResult.url,
      cloudinaryPublicId: uploadResult.publicId,
      width: uploadResult.width || 0,
      height: uploadResult.height || 0,
      fileSize: uploadResult.bytes || 0,
      format: uploadResult.format || 'png',
      isPrimary: type === 'logo' ? (isPrimary || false) : false,
      defaultPosition: defaultPosition || 'bottom-right',
      defaultSize: defaultSize || 'medium'
    });
    
    await asset.save();
    
    console.log(`✅ Brand ${type} uploaded for user ${req.user._id}: ${name}`);
    
    res.status(201).json({
      success: true,
      asset,
      message: `${type === 'logo' ? 'Logo' : 'Template'} uploaded successfully`
    });
  } catch (error) {
    console.error('Error uploading brand asset:', error);
    res.status(500).json({ success: false, message: 'Failed to upload brand asset' });
  }
});

/**
 * @route   PUT /api/brand-assets/:id
 * @desc    Update a brand asset (name, isPrimary, position, size)
 * @access  Private
 */
router.put('/:id', protect, async (req, res) => {
  try {
    const { name, isPrimary, defaultPosition, defaultSize } = req.body;
    
    const asset = await BrandAsset.findOne({ _id: req.params.id, user: req.user._id });
    
    if (!asset) {
      return res.status(404).json({ success: false, message: 'Asset not found' });
    }
    
    if (name) asset.name = name.trim();
    if (typeof isPrimary === 'boolean' && asset.type === 'logo') asset.isPrimary = isPrimary;
    if (defaultPosition) asset.defaultPosition = defaultPosition;
    if (defaultSize) asset.defaultSize = defaultSize;
    
    await asset.save();
    
    res.json({
      success: true,
      asset,
      message: 'Asset updated successfully'
    });
  } catch (error) {
    console.error('Error updating brand asset:', error);
    res.status(500).json({ success: false, message: 'Failed to update brand asset' });
  }
});

/**
 * @route   PUT /api/brand-assets/:id/set-primary
 * @desc    Set a logo as primary
 * @access  Private
 */
router.put('/:id/set-primary', protect, async (req, res) => {
  try {
    const asset = await BrandAsset.findOne({ _id: req.params.id, user: req.user._id, type: 'logo' });
    
    if (!asset) {
      return res.status(404).json({ success: false, message: 'Logo not found' });
    }
    
    // Set all other logos as non-primary
    await BrandAsset.updateMany(
      { user: req.user._id, type: 'logo', _id: { $ne: asset._id } },
      { isPrimary: false }
    );
    
    asset.isPrimary = true;
    await asset.save();
    
    res.json({
      success: true,
      asset,
      message: 'Primary logo updated'
    });
  } catch (error) {
    console.error('Error setting primary logo:', error);
    res.status(500).json({ success: false, message: 'Failed to set primary logo' });
  }
});

/**
 * @route   DELETE /api/brand-assets/:id
 * @desc    Delete a brand asset
 * @access  Private
 */
router.delete('/:id', protect, async (req, res) => {
  try {
    const asset = await BrandAsset.findOne({ _id: req.params.id, user: req.user._id });
    
    if (!asset) {
      return res.status(404).json({ success: false, message: 'Asset not found' });
    }
    
    // Delete from Cloudinary
    if (asset.cloudinaryPublicId) {
      try {
        await deleteImage(asset.cloudinaryPublicId);
      } catch (cloudinaryError) {
        console.warn('Failed to delete from Cloudinary:', cloudinaryError.message);
      }
    }
    
    await asset.deleteOne();
    
    console.log(`🗑️ Brand ${asset.type} deleted for user ${req.user._id}: ${asset.name}`);
    
    res.json({
      success: true,
      message: `${asset.type === 'logo' ? 'Logo' : 'Template'} deleted successfully`
    });
  } catch (error) {
    console.error('Error deleting brand asset:', error);
    res.status(500).json({ success: false, message: 'Failed to delete brand asset' });
  }
});

/**
 * @route   GET /api/brand-assets/primary-logo
 * @desc    Get the primary logo for current user
 * @access  Private
 */
router.get('/primary-logo', protect, async (req, res) => {
  try {
    let logo = await BrandAsset.findOne({ user: req.user._id, type: 'logo', isPrimary: true });
    
    // If no primary, get the most recent logo
    if (!logo) {
      logo = await BrandAsset.findOne({ user: req.user._id, type: 'logo' })
        .sort({ createdAt: -1 });
    }
    
    res.json({
      success: true,
      logo: logo || null
    });
  } catch (error) {
    console.error('Error fetching primary logo:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch primary logo' });
  }
});

module.exports = router;
