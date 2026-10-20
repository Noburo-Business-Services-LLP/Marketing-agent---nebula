const { priceText } = require('../config/quarkWording');
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
// Per-account cap on work in flight: 2 running + 5 waiting, 429 beyond (services/userJobCap.js).
const { jobCap } = require('../services/userJobCap');
// Shared per-user limits for paid AI, scraping, uploads and ad spend (docs/superpowers/ops/security-hardening.md).
const L = require('../middleware/limits');
const { checkTrial, deductCredits, refundCredits, CREDIT_COSTS } = require('../middleware/trialGuard');
const Draft = require('../models/Draft');
const { generateCampaignImageNanoBanana } = require('../services/geminiAI');
const { planCarousel, renderCarouselSlideImage, assetsToImageOptions } = require('../services/creativeDirector');
const { normalizeLanguage } = require('../services/contentCalendarService');
const { overlayBrandLogoIfPresent } = require('../services/logoOverlay');

/**
 * Carousel generation, in two steps.
 *
 * Step 1 (planCarousel) plans the WHOLE carousel as one experience in a
 * single call: the core idea, the narrative arc, one shared visual world, a
 * swipe mechanism, and a first-draft image prompt for every slide. This
 * replaced an earlier design that decided each slide's visual independently
 * (informed only by a text summary of the slides before it) — that produced
 * slides that shared a topic without actually cohering into one story,
 * which is what this two-step design exists to fix.
 *
 * Step 2 (renderCarouselSlideImage) executes one slide at a time: it does
 * not redesign the concept, only turns that slide's already-decided plan
 * into the final image instruction, with the whole plan available so it can
 * keep this slide consistent with the ones around it.
 *
 * Images still render sequentially, one call at a time: the user watches
 * them land as they finish, and a partial run still leaves a usable draft.
 */

router.post('/generate-stream', protect, L.heavyAi, jobCap('carousel'), checkTrial, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) { /* the browser left; the run carries on and is saved slide by slide */ }
  };
  // A slide can take over a minute with nothing to send, and a proxy closes a quiet connection after 60 seconds.
  const keepAlive = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch (_) { /* gone */ } }, 15000);
  res.on('close', () => clearInterval(keepAlive));

  let draft = null;
  // Declared out here, not inside the try: the outer catch below needs it
  // to refund the right amount, and a variable declared inside a try is not
  // visible in its own catch (the exact bug already fixed once in
  // drafts.js's generate-image-bg this session).
  let requestedSlides = 5;

  try {
    const MIN_SLIDES = 3;
    const MAX_SLIDES = 10;

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
      objective = '',
      // Overrides the logo's own saved default (Brand Assets) for this
      // generation only — set from Create's position picker.
      logoPosition: logoPositionOverride,
      // Design style and saved header/footer chosen in Create (all optional)
      postStyle: postStyleIn,
      postDetails: postDetailsIn,
      headerUrl: headerUrlIn,
      footerUrl: footerUrlIn,
      referenceImage: referenceImageIn,
      theme: themeIn,
      density: densityIn
    } = req.body || {};
    const styleReference = typeof referenceImageIn === 'string' && /^data:image\/(png|jpe?g|webp);base64,/i.test(referenceImageIn) && referenceImageIn.length < 7000000 ? referenceImageIn : undefined;
    const { isPostStyle, normalisePostDetails } = require('../config/postStyles');
    const designStyle = isPostStyle(postStyleIn) && postStyleIn !== 'plain' ? postStyleIn : undefined;
    const designDetails = normalisePostDetails(postDetailsIn);
    const httpsOnly = (u) => (typeof u === 'string' && /^https:\/\//i.test(u.trim()) ? u.trim() : undefined);
    const designHeader = httpsOnly(headerUrlIn);
    const designFooter = httpsOnly(footerUrlIn);
    // First slide carries the headline and offer, the last carries the contact details; the ones between carry the style only.
    const slideDetails = (idx, total) => ({
      ...(idx === 0 ? { headline: designDetails.headline, offer: designDetails.offer, items: designDetails.items.join('\n') } : {}),
      ...(idx === total - 1 ? { phone: designDetails.phone, address: designDetails.address, hours: designDetails.hours, tagline: designDetails.tagline } : {})
    });

    // Accepts both the stored value ("tamil_english_mix") and a display
    // label, same normalizer used for single-post and calendar generation —
    // keeps carousel language handling consistent with the rest of the app
    // instead of adding a fourth, narrower parsing implementation.
    const normalizedLanguage = normalizeLanguage(language);

    const cleanBrief = String(brief || title || '').trim();
    if (!cleanBrief) {
      send('error', { message: 'Tell me what the carousel is about first.' });
      return res.end();
    }

    // The master-plan prompt has no slide-count field of its own — the
    // Creative Director deciding how many slides a story needs is part of
    // its own design. The Create-tab slide picker is a real product
    // constraint the user actively set, though, so it is passed as context
    // rather than dropped, and the result is clamped to it afterwards.
    requestedSlides = Math.max(MIN_SLIDES, Math.min(MAX_SLIDES, Number(slideCount) || 5));

    // Per slide, not flat — a carousel renders one image per slide the same
    // way a campaign renders one per post, and a 10-slide carousel costs
    // real generation work a 3-slide one does not. Charged against what the
    // user actually asked for (the slide picker), known before generation
    // starts, same as campaign charges against its own post count.
    const creditResult = await deductCredits(req.user.id, 'carousel_generated', requestedSlides, 'AI carousel generation');
    if (!creditResult.success) {
      send('error', { message: creditResult.error || `Insufficient Quarks. Need ${priceText(requestedSlides * CREDIT_COSTS.carousel_generated)} for a ${requestedSlides}-slide carousel.` });
      return res.end();
    }

    send('status', { message: 'Planning the story…' });

    const plan = await planCarousel(req.user.id, {
      idea: cleanBrief,
      contentType,
      contentPillar,
      objective,
      platform: (platforms || [])[0] || '',
      campaignContext: campaignContext || '',
      slideCount: requestedSlides,
      language: normalizedLanguage
    });

    if (plan.slides.length === 0) {
      // Nothing was produced — refund, same as the video pipeline does when
      // it fails before any real work happens.
      try {
        await refundCredits(req.user.id, 'carousel_generated', requestedSlides, 'Refund: carousel planning failed');
      } catch (refundErr) {
        console.error('⚠️ Failed to refund Quarks after carousel planning error:', refundErr.message);
      }
      send('error', { message: 'Could not plan the carousel. Try rewording the brief.' });
      return res.end();
    }
    if (plan.slides.length > requestedSlides) {
      // Keep the LAST slide, not just the first N. The master plan reserves
      // its final slide for the payoff/resolution/CTA (see carousel.masterPlan's
      // slide-count budgeting section) — blindly slicing from the front kept
      // exactly the slides that truncation should have dropped, and cut off
      // the one slide the whole plan was building toward.
      const lastSlide = plan.slides[plan.slides.length - 1];
      const keptFront = plan.slides.slice(0, requestedSlides - 1);
      plan.slides = requestedSlides > 1 ? [...keptFront, lastSlide] : [lastSlide];
      // Renumber so `order` stays contiguous after dropping whatever sat in
      // the middle — downstream code (continuity between adjacent slides,
      // the rendered order shown to the user) assumes order matches position.
      plan.slides.forEach((slide, i) => { slide.order = i + 1; });
    }

    // The four master-plan fields combined into one readable summary — the
    // closest existing field to show it in ('plan' below, and anywhere else
    // that already reads carouselStyleGuide).
    const styleGuide = [
      plan.creativeConcept && `Concept: ${plan.creativeConcept}`,
      plan.narrativeApproach && `Narrative: ${plan.narrativeApproach}`,
      plan.visualSystem && `Visual system: ${plan.visualSystem}`,
      plan.swipeMechanism && `Swipe mechanism: ${plan.swipeMechanism}`
    ].filter(Boolean).join('\n\n');

    // Saved before any image exists so a dropped connection still leaves the
    // plan recoverable rather than losing the whole run.
    draft = await Draft.create({
      userId: req.user.id,
      title: String(title || cleanBrief).slice(0, 120),
      caption: plan.caption,
      hashtags: plan.hashtags,
      platforms,
      tone,
      language: normalizedLanguage,
      aspectRatio,
      sourceType: 'carousel',
      contentType: 'carousel',
      origin: 'manual',
      theme: String(themeIn || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      status: 'processing',
      carouselStyleGuide: styleGuide,
      carouselSlides: plan.slides.map((s, i) => ({
        order: s.order || i + 1,
        role: s.role,
        headline: s.storyPurpose,
        storyPurpose: s.storyPurpose,
        imagePrompt: s.imagePrompt,
        imageText: s.imageText,
        creativeConcept: s.creativeConcept,
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
    // The previous slide's own rendered image, chained forward — pixel-level
    // continuity alongside the plan's text-level continuity, so a character
    // or environment the plan says should persist actually looks the same
    // from one slide to the next, not just described the same way.
    // Slide 1 is drawn first and sets the look; the rest are then drawn together, each matched to slide 1.
    let firstSlideImageUrl = null;

    // Explicitly chosen in Create takes priority over whatever the plan
    // itself selected — a user who picked a product meant that product,
    // whatever the plan decided was relevant.
    const explicitProductImages = [
      linkedProduct?.imageUrl,
      ...(Array.isArray(productReferenceImages) ? productReferenceImages.slice(1) : [])
    ].filter(Boolean);

    const renderSlide = async (i) => {
      const slide = plan.slides[i];
      const previousSlideImageUrl = i === 0 ? null : firstSlideImageUrl;
      send('generating', {
        order: slide.order,
        message: `Rendering slide ${slide.order} of ${plan.slides.length}…`
      });

      try {
        const { productImages, environmentImage, logoUrl, logoPosition: resolvedLogoPosition, logoSize } = assetsToImageOptions([
          ...slide.requiredAssets,
          ...slide.optionalAssets
        ]);
        const logoPosition = logoPositionOverride || resolvedLogoPosition;
        const chosenProductImages = explicitProductImages.length ? explicitProductImages : productImages;

        // Default route: the slide's own brief, the series look, the previous slide and the brand facts go
        // straight to the image model (see directImage.js). The older Art Director chain runs only if this fails.
        let result = null;
        if (process.env.IMAGE_MODE !== 'pipeline') {
          try {
            const { generateDirectSeriesImage } = require('../services/directImage');
            const brandUser = await require('../models/User').findById(req.user.id).select('companyName businessProfile').lean();
            const bpDirect = (brandUser && brandUser.businessProfile) || {};
            const direct = await generateDirectSeriesImage({
              brief: [slide.storyPurpose, slide.creativeConcept || slide.imagePrompt].filter(Boolean).join('. '),
              imageText: slide.imageText || '',
              brand: { name: bpDirect.name || (brandUser && brandUser.companyName), industry: bpDirect.industry, location: bpDirect.businessLocation, about: bpDirect.description, website: bpDirect.website },
              language: normalizedLanguage,
              aspectRatio,
              density: ['clean', 'balanced', 'rich'].includes(String(densityIn)) ? String(densityIn) : 'balanced',
              series: { label: `slide ${slide.order} of ${plan.slides.length} in a swipe carousel`, role: slide.role, concept: plan.creativeConcept, visualSystem: plan.visualSystem, mechanism: plan.swipeMechanism },
              logoUrl: logoUrl || undefined,
              overlayLogo: true,
              logoPosition,
              noLogo: !logoUrl,
              productUrls: chosenProductImages,
              environmentUrl: environmentImage || undefined,
              continuityUrl: previousSlideImageUrl || undefined,
              details: slideDetails(i, plan.slides.length),
              designText: designStyle ? require('../config/postStyles').buildStyleDirective(designStyle, slideDetails(i, plan.slides.length), { language: normalizedLanguage }) : '',
              headerUrl: designHeader,
              footerUrl: designFooter
            });
            if (direct && direct.success && direct.imageUrl) {
              result = { imageUrl: direct.imageUrl, model: direct.model, promptUsed: direct.promptUsed };
              console.log(`[Carousel] slide ${slide.order} made by ${direct.model}${direct.checked ? (direct.missing.length || direct.extra.length || (direct.issues || []).length ? ` (checks flagged: ${direct.missing.length} missing numbers, ${direct.extra.length} extra numbers, ${(direct.issues || []).map((i) => i.kind).join('/') || 'no wording issues'})` : ' (numbers and wording verified)') : ''}`);
            } else {
              console.warn(`[Carousel] direct route failed for slide ${slide.order} (${direct && direct.error}); using the older chain`);
            }
          } catch (directErr) {
            console.warn(`[Carousel] direct route threw for slide ${slide.order}; using the older chain:`, directErr.message);
          }
        }

        if (!result) {
        const finalPrompt = await renderCarouselSlideImage(req.user.id, plan, i);
        // No brandLogo reference — the model redraws anything it's shown,
        // logos included. Composited pixel-exact after rendering instead.
        // logoReservedPosition tells it where that composite will land, so
        // it can keep the corner clear instead of putting its own headline
        // there and colliding with the real logo once pasted on top.
        result = await generateCampaignImageNanoBanana(finalPrompt, {
          userId: req.user.id,
          useRawPrompt: true,
          aspectRatio,
          tone,
          targetLanguage: normalizedLanguage,
          imageText: slide.imageText,
          environmentReferenceImage: environmentImage,
          previousSlideImage: previousSlideImageUrl,
          productReferenceImage: chosenProductImages[0] || null,
          productReferenceImages: chosenProductImages.slice(1),
          postIndex: i,
          totalPosts: plan.slides.length,
          logoReservedPosition: logoUrl ? logoPosition : null,
          postStyle: designStyle,
          postDetails: designStyle ? slideDetails(i, plan.slides.length) : undefined,
          headerUrl: designHeader,
          footerUrl: designFooter,
          styleReferenceImage: styleReference
        });
        }

        // Image generation falls back to an inline base64 data URI when the
        // Cloudinary upload fails. One of those is ~1MB; ten in a single
        // document would approach Mongo's 16MB ceiling and bloat every later
        // read of this draft. Treat it as a failed slide instead.
        const rawUrl = String(result?.imageUrl || '');
        let imageUrl = rawUrl.startsWith('http') ? rawUrl : '';
        if (imageUrl && logoUrl) {
          imageUrl = await overlayBrandLogoIfPresent(imageUrl, { logoUrl, position: logoPosition, size: logoSize });
        }
        if (rawUrl && !imageUrl) {
          console.warn(`[Carousel] slide ${slide.order} returned inline image data, not a URL — dropping it.`);
        }
        draft.carouselSlides[i].imageUrl = imageUrl;
        // Slide 1 is the look every other slide is matched to.
        if (i === 0 && imageUrl) firstSlideImageUrl = imageUrl;
        // Written per slide, not once at the end: a run that dies halfway keeps the slides it already paid for.
        // An atomic update, because several slides now finish at the same time.
        await Draft.updateOne({ _id: draft._id, 'carouselSlides.order': slide.order }, { $set: { 'carouselSlides.$.imageUrl': imageUrl } });

        if (imageUrl) rendered += 1;
        send('slide', {
          draftId: draft._id,
          order: slide.order,
          role: slide.role,
          headline: draft.carouselSlides[i].headline,
          imageUrl,
          failed: !imageUrl
        });
      } catch (slideErr) {
        console.error(`[Carousel] slide ${slide.order} failed:`, slideErr.message);
        send('slide', {
          draftId: draft._id,
          order: slide.order,
          role: slide.role,
          headline: draft.carouselSlides[i].headline,
          imageUrl: '',
          failed: true
        });
      }
    };

    // Slide 1 first, then the others together (CAROUSEL_PARALLEL at a time, default 3).
    await renderSlide(0);
    const rest = [];
    for (let i = 1; i < plan.slides.length; i++) rest.push(i);
    const width = Math.max(1, Math.min(6, Number(process.env.CAROUSEL_PARALLEL) || 3));
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(width, rest.length) }, async () => {
      while (cursor < rest.length) {
        const i = rest[cursor];
        cursor += 1;
        await renderSlide(i);
      }
    }));

    draft.status = rendered > 0 ? 'draft' : 'failed';
    if (rendered === 0) draft.errorMessage = 'No slides could be rendered.';
    await Draft.updateOne({ _id: draft._id }, { $set: { status: draft.status, errorMessage: draft.errorMessage || '' } });

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
        await Draft.updateOne({ _id: draft._id }, { $set: { status: 'failed', errorMessage: 'Generation failed.' } });
      } catch (_) { /* the stream error matters more than this bookkeeping */ }
    } else {
      // Failed before any draft existed — planning itself threw, so nothing
      // was produced. Once a draft exists, slides may already have rendered,
      // so the charge stays — same flat-per-run model as campaigns and video.
      try {
        await refundCredits(req.user.id, 'carousel_generated', requestedSlides, 'Refund: carousel generation failed before any slide rendered');
      } catch (refundErr) {
        console.error('⚠️ Failed to refund Quarks after carousel error:', refundErr.message);
      }
    }
    send('error', { message: 'Something went wrong. Please try again.' });
    res.end();
  }
});

module.exports = router;
