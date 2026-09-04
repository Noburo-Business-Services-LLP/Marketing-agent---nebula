const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { checkTrial, deductCredits, refundCredits } = require('../middleware/trialGuard');
const Draft = require('../models/Draft');
const { generateCampaignImageNanoBanana } = require('../services/geminiAI');
const { planCarousel, renderCarouselSlideImage, assetsToImageOptions } = require('../services/creativeDirector');

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
      objective = ''
    } = req.body || {};

    const cleanBrief = String(brief || title || '').trim();
    if (!cleanBrief) {
      send('error', { message: 'Tell me what the carousel is about first.' });
      return res.end();
    }

    // Deducted once per run, same as a full campaign or video — a carousel
    // renders 3-10 images the same way those do, and previously deducted
    // nothing at all, unlike either of them.
    const creditResult = await deductCredits(req.user.id, 'carousel_generated', 1, 'AI carousel generation');
    if (!creditResult.success) {
      send('error', { message: creditResult.error || 'Insufficient Quarks. Need 7 Quarks for a carousel.' });
      return res.end();
    }

    send('status', { message: 'Planning the story…' });

    // The master-plan prompt has no slide-count field of its own — the
    // Creative Director deciding how many slides a story needs is part of
    // its own design. The Create-tab slide picker is a real product
    // constraint the user actively set, though, so it is passed as context
    // rather than dropped, and the result is clamped to it afterwards.
    const requestedSlides = Math.max(MIN_SLIDES, Math.min(MAX_SLIDES, Number(slideCount) || 5));
    const plan = await planCarousel(req.user.id, {
      idea: cleanBrief,
      contentType,
      contentPillar,
      objective,
      platform: (platforms || [])[0] || '',
      campaignContext: [campaignContext, `Plan this as a ${requestedSlides}-slide carousel.`].filter(Boolean).join(' ')
    });

    if (plan.slides.length === 0) {
      // Nothing was produced — refund, same as the video pipeline does when
      // it fails before any real work happens.
      try {
        await refundCredits(req.user.id, 'carousel_generated', 1, 'Refund: carousel planning failed');
      } catch (refundErr) {
        console.error('⚠️ Failed to refund Quarks after carousel planning error:', refundErr.message);
      }
      send('error', { message: 'Could not plan the carousel. Try rewording the brief.' });
      return res.end();
    }
    if (plan.slides.length > requestedSlides) {
      plan.slides = plan.slides.slice(0, requestedSlides);
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
      language,
      aspectRatio,
      sourceType: 'carousel',
      contentType: 'carousel',
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
    let previousSlideImageUrl = null;

    // Explicitly chosen in Create takes priority over whatever the plan
    // itself selected — a user who picked a product meant that product,
    // whatever the plan decided was relevant.
    const explicitProductImages = [
      linkedProduct?.imageUrl,
      ...(Array.isArray(productReferenceImages) ? productReferenceImages.slice(1) : [])
    ].filter(Boolean);

    for (let i = 0; i < plan.slides.length; i++) {
      const slide = plan.slides[i];
      send('generating', {
        order: slide.order,
        message: `Rendering slide ${slide.order} of ${plan.slides.length}…`
      });

      try {
        const finalPrompt = await renderCarouselSlideImage(req.user.id, plan, i);
        const { productImages, environmentImage, logoUrl } = assetsToImageOptions([
          ...slide.requiredAssets,
          ...slide.optionalAssets
        ]);
        const chosenProductImages = explicitProductImages.length ? explicitProductImages : productImages;

        const result = await generateCampaignImageNanoBanana(finalPrompt, {
          userId: req.user.id,
          useRawPrompt: true,
          aspectRatio,
          tone,
          targetLanguage: language,
          imageText: slide.imageText,
          brandLogo: logoUrl,
          environmentReferenceImage: environmentImage,
          previousSlideImage: previousSlideImageUrl,
          productReferenceImage: chosenProductImages[0] || null,
          productReferenceImages: chosenProductImages.slice(1),
          postIndex: i,
          totalPosts: plan.slides.length
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
        // Feeds the NEXT slide's call — a slide with no image (failed
        // render) is skipped as a reference rather than passing along an
        // empty string, so continuity just carries from the last one that
        // actually rendered.
        if (imageUrl) previousSlideImageUrl = imageUrl;
        // Written per slide, not once at the end: a run that dies halfway
        // keeps the slides it already paid for.
        await draft.save();

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
    } else {
      // Failed before any draft existed — planning itself threw, so nothing
      // was produced. Once a draft exists, slides may already have rendered,
      // so the charge stays — same flat-per-run model as campaigns and video.
      try {
        await refundCredits(req.user.id, 'carousel_generated', 1, 'Refund: carousel generation failed before any slide rendered');
      } catch (refundErr) {
        console.error('⚠️ Failed to refund Quarks after carousel error:', refundErr.message);
      }
    }
    send('error', { message: error.message || 'Something went wrong. Please try again.' });
    res.end();
  }
});

module.exports = router;
