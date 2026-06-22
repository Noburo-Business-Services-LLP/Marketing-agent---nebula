const express = require('express');
const router = express.Router();
const BrandAsset = require('../models/BrandAsset');
const BrandIntelligenceProfile = require('../models/BrandIntelligenceProfile');
const Campaign = require('../models/Campaign');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { uploadBase64Image, deleteImage } = require('../services/imageUploader');
const { deepScrapeWebsite } = require('../services/scraper');
const {
  analyzeBrandInputs,
  determineBrandColors,
  normalizeHexColor,
  normalizePastPost
} = require('../services/brandIntelligenceService');

function getUserId(req) {
  return req.user?._id || req.user?.id || req.user?.userId || null;
}

function hasOwn(input, key) {
  return Object.prototype.hasOwnProperty.call(input || {}, key);
}

function sanitizeProfilePatch(input = {}) {
  const assetsInput = input?.assets || {};
  const customInput = input?.customProfile || {};

  return {
    brandName: hasOwn(input, 'brandName') ? String(input.brandName || '').trim() : undefined,
    brandDescription: hasOwn(input, 'brandDescription')
      ? String(input.brandDescription || '').trim()
      : undefined,
    assets: {
      primaryColor:
        hasOwn(input, 'primaryColor') || hasOwn(assetsInput, 'primaryColor')
          ? normalizeHexColor(input.primaryColor || assetsInput.primaryColor || '')
          : undefined,
      secondaryColor:
        hasOwn(input, 'secondaryColor') || hasOwn(assetsInput, 'secondaryColor')
          ? normalizeHexColor(input.secondaryColor || assetsInput.secondaryColor || '')
          : undefined,
      fontType:
        hasOwn(input, 'fontType') || hasOwn(assetsInput, 'fontType')
          ? String(input.fontType || assetsInput.fontType || '').trim()
          : undefined,
      primaryLogoUrl:
        hasOwn(input, 'primaryLogoUrl') || hasOwn(assetsInput, 'primaryLogoUrl')
          ? String(input.primaryLogoUrl || assetsInput.primaryLogoUrl || '').trim()
          : undefined
    },
    enforcementMode: ['strict', 'adaptive', 'off'].includes(String(input.enforcementMode || '').toLowerCase())
      ? String(input.enforcementMode).toLowerCase()
      : undefined,
    customProfile: {
      tone: hasOwn(customInput, 'tone') ? String(customInput.tone || '').trim().toLowerCase() : undefined,
      writingStyle: hasOwn(customInput, 'writingStyle')
        ? String(customInput.writingStyle || '').trim().toLowerCase()
        : undefined,
      ctaStyle: hasOwn(customInput, 'ctaStyle')
        ? String(customInput.ctaStyle || '').trim().toLowerCase()
        : undefined,
      visualStyle: hasOwn(customInput, 'visualStyle')
        ? String(customInput.visualStyle || '').trim().toLowerCase()
        : undefined
    },
    customProfileProvided:
      hasOwn(customInput, 'tone') ||
      hasOwn(customInput, 'writingStyle') ||
      hasOwn(customInput, 'ctaStyle') ||
      hasOwn(customInput, 'visualStyle')
  };
}

async function getPrimaryLogoUrlForUser(userId) {
  if (!userId) return '';
  const primaryLogo =
    (await BrandAsset.findOne({ user: userId, type: 'logo', isPrimary: true }).sort({ createdAt: -1 })) ||
    (await BrandAsset.findOne({ user: userId, type: 'logo' }).sort({ createdAt: -1 }));
  return String(primaryLogo?.url || '');
}

function buildProfileResponse(profileDoc) {
  if (!profileDoc) return null;
  const profile = profileDoc.toObject ? profileDoc.toObject() : profileDoc;
  const effective = {
    tone: profile?.customProfile?.tone || profile?.detectedProfile?.tone || 'professional',
    writingStyle: profile?.customProfile?.writingStyle || profile?.detectedProfile?.writingStyle || 'formal',
    ctaStyle: profile?.customProfile?.ctaStyle || profile?.detectedProfile?.ctaStyle || 'balanced',
    visualStyle: profile?.customProfile?.visualStyle || profile?.detectedProfile?.visualStyle || 'clean-minimal'
  };
  return {
    ...profile,
    effectiveProfile: effective
  };
}

function campaignToPastPosts(campaigns = []) {
  return campaigns
    .map((campaign) => {
      const caption = String(
        campaign?.creative?.textContent ||
          campaign?.creative?.captions ||
          campaign?.notes ||
          ''
      ).trim();
      const imageUrl = String(
        (Array.isArray(campaign?.creative?.imageUrls) && campaign.creative.imageUrls[0]) ||
          campaign?.creative?.videoUrl ||
          ''
      ).trim();
      if (!caption && !imageUrl) return null;
      return {
        source: 'campaign_history',
        platform: String((campaign?.platforms && campaign.platforms[0]) || 'instagram').toLowerCase(),
        caption,
        imageUrl,
        campaignId: campaign?._id || null,
        postedAt: campaign?.createdAt || null
      };
    })
    .filter(Boolean);
}

function computeHasBrandAssets(profile = {}) {
  return Boolean(
    String(profile?.brandName || '').trim() ||
      String(profile?.brandDescription || '').trim() ||
      String(profile?.assets?.primaryLogoUrl || '').trim() ||
      normalizeHexColor(profile?.assets?.primaryColor || '') ||
      normalizeHexColor(profile?.assets?.secondaryColor || '') ||
      String(profile?.assets?.fontType || '').trim()
  );
}

/**
 * @route   GET /api/brand-assets
 * @desc    Get all brand assets for current user
 * @access  Private
 */
router.get('/', protect, async (req, res) => {
  try {
    const { type } = req.query;
    const userId = getUserId(req);
    const query = { user: userId };
    
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
    const userId = getUserId(req);
    const logos = await BrandAsset.find({ user: userId, type: 'logo' })
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
    const userId = getUserId(req);
    const templates = await BrandAsset.find({ user: userId, type: 'template' })
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
    const userId = getUserId(req);
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
    
    const shouldSetPrimary = type === 'logo' ? Boolean(isPrimary || (await BrandAsset.countDocuments({ user: userId, type: 'logo' })) === 0) : false;
    if (shouldSetPrimary) {
      await BrandAsset.updateMany({ user: userId, type: 'logo' }, { isPrimary: false });
    }

    // Create brand asset record
    const asset = new BrandAsset({
      user: userId,
      type,
      name: name.trim(),
      url: uploadResult.url,
      cloudinaryPublicId: uploadResult.publicId,
      width: uploadResult.width || 0,
      height: uploadResult.height || 0,
      fileSize: uploadResult.bytes || 0,
      format: uploadResult.format || 'png',
      isPrimary: shouldSetPrimary,
      defaultPosition: defaultPosition || 'bottom-right',
      defaultSize: defaultSize || 'medium'
    });
    
    await asset.save();

    if (type === 'logo') {
      await BrandIntelligenceProfile.findOneAndUpdate(
        { userId },
        {
          $set: {
            hasBrandAssets: true,
            'assets.primaryLogoUrl': String(uploadResult.url || '')
          }
        },
        { upsert: true, setDefaultsOnInsert: true, new: true }
      );
    }
    
    console.log(`✅ Brand ${type} uploaded for user ${userId}: ${name}`);
    
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
 * @route   GET /api/brand-assets/intelligence-profile
 * @desc    Get brand intelligence profile (auto-seeded from user + logos if needed)
 * @access  Private
 */
router.get('/intelligence-profile', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const user = await User.findById(userId).select('companyName businessProfile');
    const bp = user?.businessProfile || {};
    const logoUrl = await getPrimaryLogoUrlForUser(userId);

    let profile = await BrandIntelligenceProfile.findOne({ userId });
    if (!profile) {
      profile = await BrandIntelligenceProfile.create({
        userId,
        brandName: String(bp.companyName || user?.companyName || '').trim(),
        brandDescription: String(bp.description || '').trim(),
        assets: {
          primaryLogoUrl: logoUrl || '',
          primaryColor: normalizeHexColor(bp?.brandAssets?.brandColors?.[0] || ''),
          secondaryColor: normalizeHexColor(bp?.brandAssets?.brandColors?.[1] || ''),
          fontType: ''
        },
        hasBrandAssets: Boolean(
          logoUrl ||
            bp?.companyName ||
            user?.companyName ||
            bp?.description ||
            bp?.brandAssets?.brandColors?.length
        )
      });
    }

    if (!profile.assets?.primaryLogoUrl && logoUrl) {
      profile.assets.primaryLogoUrl = logoUrl;
    }

    if (!Array.isArray(profile.pastPosts) || profile.pastPosts.length === 0) {
      const recentCampaigns = await Campaign.find({ userId })
        .sort({ createdAt: -1 })
        .limit(16)
        .select('platforms creative createdAt');
      const historySamples = campaignToPastPosts(recentCampaigns).slice(0, 20);
      if (historySamples.length) {
        profile.pastPosts = historySamples.map((p) => normalizePastPost(p));
      }
    }

    const analysis = analyzeBrandInputs({
      brandName: profile.brandName,
      brandDescription: profile.brandDescription,
      primaryColor: profile.assets?.primaryColor || '',
      secondaryColor: profile.assets?.secondaryColor || '',
      fontType: profile.assets?.fontType || '',
      pastPosts: profile.pastPosts || [],
      businessProfile: bp
    });

    profile.detectedProfile = analysis.detectedProfile;
    profile.confidence = analysis.confidence;
    profile.patterns = analysis.patterns;
    profile.hasBrandAssets = computeHasBrandAssets(profile);
    profile.hasPastPosts = Boolean((profile.pastPosts || []).length);
    profile.lastAnalyzedAt = new Date();
    await profile.save();

    res.json({
      success: true,
      profile: buildProfileResponse(profile)
    });
  } catch (error) {
    console.error('Error fetching brand intelligence profile:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch brand intelligence profile' });
  }
});

/**
 * @route   PUT /api/brand-assets/intelligence-profile
 * @desc    Edit/customize brand intelligence profile values
 * @access  Private
 */
router.put('/intelligence-profile', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const patch = sanitizeProfilePatch(req.body || {});

    let profile = await BrandIntelligenceProfile.findOne({ userId });
    if (!profile) {
      profile = new BrandIntelligenceProfile({ userId });
    }

    if (patch.brandName !== undefined) profile.brandName = patch.brandName;
    if (patch.brandDescription !== undefined) profile.brandDescription = patch.brandDescription;
    if (patch.assets?.primaryColor !== undefined) profile.assets.primaryColor = patch.assets.primaryColor;
    if (patch.assets?.secondaryColor !== undefined) profile.assets.secondaryColor = patch.assets.secondaryColor;
    if (patch.assets?.fontType !== undefined) profile.assets.fontType = patch.assets.fontType;
    if (patch.assets?.primaryLogoUrl !== undefined) profile.assets.primaryLogoUrl = patch.assets.primaryLogoUrl;
    if (patch.enforcementMode) profile.enforcementMode = patch.enforcementMode;

    if (patch.customProfileProvided) {
      profile.customProfile = {
        tone:
          patch.customProfile.tone !== undefined
            ? patch.customProfile.tone
            : profile.customProfile?.tone || '',
        writingStyle:
          patch.customProfile.writingStyle !== undefined
            ? patch.customProfile.writingStyle
            : profile.customProfile?.writingStyle || '',
        ctaStyle:
          patch.customProfile.ctaStyle !== undefined
            ? patch.customProfile.ctaStyle
            : profile.customProfile?.ctaStyle || '',
        visualStyle:
          patch.customProfile.visualStyle !== undefined
            ? patch.customProfile.visualStyle
            : profile.customProfile?.visualStyle || ''
      };
      profile.isUserCustomized = true;
    }

    profile.hasBrandAssets = computeHasBrandAssets(profile);
    profile.hasPastPosts = Boolean((profile.pastPosts || []).length);
    await profile.save();

    res.json({
      success: true,
      profile: buildProfileResponse(profile),
      message: 'Brand profile updated'
    });
  } catch (error) {
    console.error('Error updating brand intelligence profile:', error);
    res.status(500).json({ success: false, message: 'Failed to update brand profile' });
  }
});

/**
 * @route   POST /api/brand-assets/intelligence-profile/analyze
 * @desc    Analyze brand inputs and generate tone/style profile + confidence scores
 * @access  Private
 */
router.post('/intelligence-profile/analyze', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const user = await User.findById(userId).select('companyName businessProfile');
    const bp = user?.businessProfile || {};
    const patch = sanitizeProfilePatch(req.body || {});

    let profile = await BrandIntelligenceProfile.findOne({ userId });
    if (!profile) {
      profile = new BrandIntelligenceProfile({ userId });
    }

    if (patch.brandName !== undefined) profile.brandName = patch.brandName;
    if (patch.brandDescription !== undefined) profile.brandDescription = patch.brandDescription;
    if (patch.assets?.primaryColor !== undefined) profile.assets.primaryColor = patch.assets.primaryColor;
    if (patch.assets?.secondaryColor !== undefined) profile.assets.secondaryColor = patch.assets.secondaryColor;
    if (patch.assets?.fontType !== undefined) profile.assets.fontType = patch.assets.fontType;

    const logoUrl = await getPrimaryLogoUrlForUser(userId);
    if (!profile.assets.primaryLogoUrl && logoUrl) {
      profile.assets.primaryLogoUrl = logoUrl;
    }

    const payloadPosts = Array.isArray(req.body?.pastPosts)
      ? req.body.pastPosts.map((p) => normalizePastPost(p)).filter((p) => p.caption || p.imageUrl)
      : [];
    if (payloadPosts.length) {
      profile.pastPosts = payloadPosts.slice(0, 40);
    } else if (!profile.pastPosts?.length) {
      const recentCampaigns = await Campaign.find({ userId })
        .sort({ createdAt: -1 })
        .limit(20)
        .select('platforms creative createdAt');
      profile.pastPosts = campaignToPastPosts(recentCampaigns).slice(0, 24).map((p) => normalizePastPost(p));
    }

    const analysis = analyzeBrandInputs({
      brandName: profile.brandName || bp.companyName || user?.companyName || '',
      brandDescription: profile.brandDescription || bp.description || '',
      primaryColor: profile.assets?.primaryColor || '',
      secondaryColor: profile.assets?.secondaryColor || '',
      fontType: profile.assets?.fontType || '',
      pastPosts: profile.pastPosts || [],
      businessProfile: bp
    });

    profile.detectedProfile = analysis.detectedProfile;
    profile.confidence = analysis.confidence;
    profile.patterns = analysis.patterns;
    profile.hasBrandAssets = analysis.flags.hasBrandAssets || computeHasBrandAssets(profile);
    profile.hasPastPosts = analysis.flags.hasPastPosts || Boolean((profile.pastPosts || []).length);
    profile.lastAnalyzedAt = new Date();

    if (!profile.isUserCustomized) {
      profile.customProfile = {
        tone: profile.detectedProfile.tone || '',
        writingStyle: profile.detectedProfile.writingStyle || '',
        ctaStyle: profile.detectedProfile.ctaStyle || '',
        visualStyle: profile.detectedProfile.visualStyle || ''
      };
    }

    await profile.save();

    res.json({
      success: true,
      profile: buildProfileResponse(profile),
      confidenceScore: Math.round((profile.confidence?.overall || 0) * 100),
      message: 'Brand profile analyzed successfully'
    });
  } catch (error) {
    console.error('Error analyzing brand profile:', error);
    res.status(500).json({ success: false, message: 'Failed to analyze brand profile' });
  }
});

/**
 * @route   POST /api/brand-assets/intelligence-profile/colors
 * @desc    Resolve brand primary/secondary colors from website or manual input
 * @access  Private
 */
router.post('/intelligence-profile/colors', protect, async (req, res) => {
  try {
    const websiteUrl = String(req.body?.website_url || req.body?.websiteUrl || '').trim();
    const primaryColor = String(req.body?.primary_color || req.body?.primaryColor || '').trim();
    const secondaryColor = String(req.body?.secondary_color || req.body?.secondaryColor || '').trim();

    const result = await determineBrandColors({
      websiteUrl,
      primaryColor,
      secondaryColor,
      scrapeWebsite: async (url) => deepScrapeWebsite(url, { forceRefresh: true })
    });

    res.json(result);
  } catch (error) {
    console.error('Error resolving brand colors:', error);
    res.status(500).json({
      primary_color: '#111111',
      secondary_color: '#FFCC29',
      source: 'manual',
      confidence: 50,
      reason: 'Brand color detection failed, so default manual colors were used.'
    });
  }
});

/**
 * @route   POST /api/brand-assets/intelligence-profile/past-posts
 * @desc    Add an example past post (caption/image) for style learning
 * @access  Private
 */
router.post('/intelligence-profile/past-posts', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { caption, imageData, platform } = req.body || {};
    const cleanedCaption = String(caption || '').trim();

    if (!cleanedCaption && !imageData) {
      return res.status(400).json({ success: false, message: 'Provide a caption and/or image' });
    }

    let uploadedImage = null;
    if (imageData) {
      uploadedImage = await uploadBase64Image(imageData, 'nebula-brand-past-posts');
      if (!uploadedImage.success) {
        return res.status(500).json({ success: false, message: 'Failed to upload past post image' });
      }
    }

    let profile = await BrandIntelligenceProfile.findOne({ userId });
    if (!profile) {
      profile = new BrandIntelligenceProfile({ userId });
    }

    const sample = normalizePastPost({
      source: 'uploaded',
      platform: platform || 'instagram',
      caption: cleanedCaption,
      imageUrl: uploadedImage?.url || '',
      cloudinaryPublicId: uploadedImage?.publicId || ''
    });

    profile.pastPosts.push(sample);
    if (profile.pastPosts.length > 40) {
      profile.pastPosts = profile.pastPosts.slice(profile.pastPosts.length - 40);
    }
    profile.hasPastPosts = true;
    await profile.save();

    res.status(201).json({
      success: true,
      post: sample,
      profile: buildProfileResponse(profile),
      message: 'Past post sample added'
    });
  } catch (error) {
    console.error('Error adding past post sample:', error);
    res.status(500).json({ success: false, message: 'Failed to add past post sample' });
  }
});

/**
 * @route   DELETE /api/brand-assets/intelligence-profile/past-posts/:postId
 * @desc    Remove one past-post sample
 * @access  Private
 */
router.delete('/intelligence-profile/past-posts/:postId', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const profile = await BrandIntelligenceProfile.findOne({ userId });
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Brand profile not found' });
    }

    const target = profile.pastPosts.id(req.params.postId);
    if (!target) {
      return res.status(404).json({ success: false, message: 'Past post sample not found' });
    }

    if (target.cloudinaryPublicId) {
      try {
        await deleteImage(target.cloudinaryPublicId);
      } catch (cloudErr) {
        console.warn('Failed to delete past post image from cloud:', cloudErr.message);
      }
    }

    target.deleteOne();
    profile.hasPastPosts = Boolean(profile.pastPosts.length);
    await profile.save();

    res.json({
      success: true,
      profile: buildProfileResponse(profile),
      message: 'Past post sample removed'
    });
  } catch (error) {
    console.error('Error removing past post sample:', error);
    res.status(500).json({ success: false, message: 'Failed to remove past post sample' });
  }
});

/**
 * @route   PUT /api/brand-assets/:id
 * @desc    Update a brand asset (name, isPrimary, position, size)
 * @access  Private
 */
router.put('/:id', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { name, isPrimary, defaultPosition, defaultSize } = req.body;
    
    const asset = await BrandAsset.findOne({ _id: req.params.id, user: userId });
    
    if (!asset) {
      return res.status(404).json({ success: false, message: 'Asset not found' });
    }
    
    if (name) asset.name = name.trim();
    if (typeof isPrimary === 'boolean' && asset.type === 'logo') {
      if (isPrimary) {
        await BrandAsset.updateMany(
          { user: userId, type: 'logo', _id: { $ne: asset._id } },
          { isPrimary: false }
        );
      }
      asset.isPrimary = isPrimary;
    }
    if (defaultPosition) asset.defaultPosition = defaultPosition;
    if (defaultSize) asset.defaultSize = defaultSize;
    
    await asset.save();

    if (asset.type === 'logo' && typeof isPrimary === 'boolean') {
      const nextPrimaryLogo = await getPrimaryLogoUrlForUser(userId);
      let profile = await BrandIntelligenceProfile.findOne({ userId });
      if (!profile) {
        profile = new BrandIntelligenceProfile({ userId });
      }
      profile.assets.primaryLogoUrl = String(nextPrimaryLogo || '');
      profile.hasBrandAssets = computeHasBrandAssets(profile);
      await profile.save();
    }
    
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
    const userId = getUserId(req);
    const asset = await BrandAsset.findOne({ _id: req.params.id, user: userId, type: 'logo' });
    
    if (!asset) {
      return res.status(404).json({ success: false, message: 'Logo not found' });
    }
    
    // Set all other logos as non-primary
    await BrandAsset.updateMany(
      { user: userId, type: 'logo', _id: { $ne: asset._id } },
      { isPrimary: false }
    );
    
    asset.isPrimary = true;
    await asset.save();
    
    await BrandIntelligenceProfile.findOneAndUpdate(
      { userId },
      { $set: { 'assets.primaryLogoUrl': String(asset.url || ''), hasBrandAssets: true } },
      { upsert: true, setDefaultsOnInsert: true, new: true }
    );

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
    const userId = getUserId(req);
    const asset = await BrandAsset.findOne({ _id: req.params.id, user: userId });
    
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
    
    if (asset.type === 'logo') {
      const nextPrimaryLogo = await getPrimaryLogoUrlForUser(userId);
      let profile = await BrandIntelligenceProfile.findOne({ userId });
      if (!profile) {
        profile = new BrandIntelligenceProfile({ userId });
      }
      profile.assets.primaryLogoUrl = String(nextPrimaryLogo || '');
      profile.hasBrandAssets = computeHasBrandAssets(profile);
      await profile.save();
    }

    console.log(`🗑️ Brand ${asset.type} deleted for user ${userId}: ${asset.name}`);
    
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
    const userId = getUserId(req);
    let logo = await BrandAsset.findOne({ user: userId, type: 'logo', isPrimary: true });
    
    // If no primary, get the most recent logo
    if (!logo) {
      logo = await BrandAsset.findOne({ user: userId, type: 'logo' })
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
