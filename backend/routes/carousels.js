const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { checkTrial } = require('../middleware/trialGuard');
const Draft = require('../models/Draft');
const User = require('../models/User');
const BrandAsset = require('../models/BrandAsset');
const BrandIntelligenceProfile = require('../models/BrandIntelligenceProfile');
const { callGemini, parseGeminiJSON, generateCampaignImageNanoBanana } = require('../services/geminiAI');
const { buildPrompt } = require('../services/promptRegistry');
const { buildBrandMemoryBlock } = require('../services/brandMemory');
const { decideCreative } = require('../services/creativeDirector');

/**
 * Carousel generation.
 *
 * A carousel is one post made of several ordered images that tell a single
 * story, so it is planned in one pass and rendered slide by slide. The plan
 * step produces a styleGuide — a visual contract every slide inherits — which
 * is what keeps the set looking like siblings. Without it, independently
 * generated slides drift apart in palette and treatment, which is the usual
 * way a generated carousel gives itself away.
 *
 * Images are generated sequentially rather than in parallel: the user watches
 * them land one at a time, and a partial run still leaves a usable draft.
 */

const MIN_SLIDES = 3;
const MAX_SLIDES = 10;

router.post('/generate-stream', protect, checkTrial, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let draft = null;

  try {
    const {
      title = '',
      brief = '',
      slideCount = 5,
      platforms = ['instagram'],
      tone = 'professional',
      language = 'English',
      aspectRatio = '4:5',
      linkedProduct = null,
      productReferenceImages = [],
      // Optional context, same as single-post: filled in when the brief came
      // from a picked calendar idea, left blank for a freehand carousel.
      contentPillar = '',
      contentType = 'carousel',
      campaignContext = '',
      objective = ''
    } = req.body || {};

    const slides = Math.max(MIN_SLIDES, Math.min(MAX_SLIDES, Number(slideCount) || 5));
    const cleanBrief = String(brief || title || '').trim();
    if (!cleanBrief) {
      send('error', { message: 'Tell me what the carousel is about first.' });
      return res.end();
    }

    // Same sources campaign generation reads: the brand profile carries the
    // palette and typography, the business profile the industry and name, and
    // the logo lives as its own asset record.
    const [user, brandProfile, logoAsset] = await Promise.all([
      User.findById(req.user.id).lean(),
      BrandIntelligenceProfile.findOne({ userId: req.user.id }).lean(),
      BrandAsset.findOne({ user: req.user.id, type: 'logo' })
        .sort({ isPrimary: -1, createdAt: -1 })
        .lean()
    ]);

    const bp = user?.businessProfile || {};
    const brandAssets = brandProfile?.assets || {};
    const brandDisplayName =
      String(brandProfile?.brandName || bp.companyName || bp.name || 'Brand').trim() || 'Brand';
    const industry = bp.industry || '';
    const brandLogo = String(brandAssets.primaryLogoUrl || logoAsset?.url || '').trim() || null;

    send('status', { message: 'Planning the story…' });

    const brandContextBlock = await buildBrandMemoryBlock(req.user.id);
    const planPrompt = await buildPrompt(req.user.id, 'carousel.content', {
      idea: cleanBrief,
      contentPillar,
      contentType,
      campaignContext,
      objective,
      slideCount: slides,
      platforms: (platforms || []).join(', '),
      language: language || 'English',
      brandContextBlock
    });

    const raw = await callGemini(planPrompt);
    const plan = parseGeminiJSON(raw);

    const planned = Array.isArray(plan?.slides) ? plan.slides.slice(0, slides) : [];
    if (planned.length === 0) {
      send('error', { message: 'Could not plan the carousel. Try rewording the brief.' });
      return res.end();
    }

    const styleGuide = String(plan?.styleGuide || '').trim();

    // Saved before any image exists so a dropped connection still leaves the
    // plan recoverable rather than losing the whole run.
    draft = await Draft.create({
      userId: req.user.id,
      title: String(title || cleanBrief).slice(0, 120),
      caption: String(plan?.caption || '').trim(),
      hashtags: Array.isArray(plan?.hashtags) ? plan.hashtags : [],
      platforms,
      tone,
      language,
      aspectRatio,
      sourceType: 'carousel',
      contentType: 'carousel',
      status: 'processing',
      carouselStyleGuide: styleGuide,
      carouselSlides: planned.map((s, i) => ({
        order: Number(s?.order) || i + 1,
        role: String(s?.role || '').trim(),
        headline: String(s?.headline || '').trim(),
        imagePrompt: String(s?.imageDescription || '').trim(),
        imageUrl: ''
      }))
    });

    send('plan', {
      draftId: draft._id,
      styleGuide,
      caption: draft.caption,
      hashtags: draft.hashtags,
      slides: draft.carouselSlides.map((s) => ({
        order: s.order,
        role: s.role,
        headline: s.headline
      }))
    });

    let rendered = 0;
    // Each slide's Creative Director call is told what earlier slides in
    // THIS carousel already decided, so slide 3 can deliberately vary from
    // slides 1-2 instead of inheriting one style fixed before any slide was
    // seen. This replaces the old single styleGuide applied identically to
    // every slide — the specific thing this refactor was asked to fix.
    const decidedSoFar = [];

    for (let i = 0; i < draft.carouselSlides.length; i++) {
      const slide = draft.carouselSlides[i];
      send('generating', {
        order: slide.order,
        message: `Rendering slide ${slide.order} of ${draft.carouselSlides.length}…`
      });

      try {
        const explicitProductImages = [
          linkedProduct?.imageUrl,
          ...(Array.isArray(productReferenceImages) ? productReferenceImages.slice(1) : [])
        ].filter(Boolean);

        const creative = await decideCreative(req.user.id, {
          idea: slide.imagePrompt || slide.headline,
          contentType: 'carousel slide',
          contentPillar: '',
          objective: '',
          platform: (platforms || [])[0] || '',
          campaignContext: `This is slide ${slide.order} of ${draft.carouselSlides.length} in a carousel about: ${cleanBrief}. This slide's role: ${slide.role || 'build'}.`,
          previousCreatives: decidedSoFar
        }, { aspectRatio, language });

        if (creative?.creativeConcept) {
          draft.carouselSlides[i].creativeConcept = creative.creativeConcept;
          draft.carouselSlides[i].visualTreatment = creative.visualTreatment;
          decidedSoFar.push({ concept: creative.creativeConcept, treatment: creative.visualTreatment });
        }

        const chosenProductImages = explicitProductImages.length ? explicitProductImages : (creative?.productImages || []);

        const result = await generateCampaignImageNanoBanana(creative?.finalPrompt || slide.imagePrompt, {
          userId: req.user.id,
          useRawPrompt: Boolean(creative?.finalPrompt),
          aspectRatio,
          brandName: brandDisplayName,
          brandLogo: creative?.logoUrl || brandLogo,
          industry,
          tone,
          targetLanguage: language,
          imageText: creative?.imageText || slide.headline,
          environmentReferenceImage: creative?.environmentImage || null,
          productReferenceImage: chosenProductImages[0] || null,
          productReferenceImages: chosenProductImages.slice(1),
          postIndex: i,
          totalPosts: draft.carouselSlides.length
        });

        // Image generation falls back to an inline base64 data URI when the
        // Cloudinary upload fails. One of those is ~1MB; ten in a single
        // document would approach Mongo's 16MB ceiling and bloat every later
        // read of this draft. Treat it as a failed slide instead.
        const rawUrl = String(result?.imageUrl || '');
        const imageUrl = rawUrl.startsWith('http') ? rawUrl : '';
        if (rawUrl && !imageUrl) {
          console.warn(`[Carousel] slide ${slide.order} returned inline image data, not a URL — dropping it.`);
        }
        draft.carouselSlides[i].imageUrl = imageUrl;
        // Written per slide, not once at the end: a run that dies halfway
        // keeps the slides it already paid for.
        await draft.save();

        if (imageUrl) rendered += 1;
        send('slide', {
          draftId: draft._id,
          order: slide.order,
          role: slide.role,
          headline: slide.headline,
          imageUrl,
          failed: !imageUrl
        });
      } catch (slideErr) {
        console.error(`[Carousel] slide ${slide.order} failed:`, slideErr.message);
        send('slide', {
          draftId: draft._id,
          order: slide.order,
          role: slide.role,
          headline: slide.headline,
          imageUrl: '',
          failed: true
        });
      }
    }

    draft.status = rendered > 0 ? 'draft' : 'failed';
    if (rendered === 0) draft.errorMessage = 'No slides could be rendered.';
    await draft.save();

    send('complete', {
      draftId: draft._id,
      rendered,
      total: draft.carouselSlides.length
    });
    res.end();
  } catch (error) {
    console.error('Carousel generation error:', error);
    if (draft) {
      try {
        draft.status = 'failed';
        draft.errorMessage = error.message || 'Generation failed.';
        await draft.save();
      } catch (_) { /* the stream error matters more than this bookkeeping */ }
    }
    send('error', { message: error.message || 'Something went wrong. Please try again.' });
    res.end();
  }
});

module.exports = router;
