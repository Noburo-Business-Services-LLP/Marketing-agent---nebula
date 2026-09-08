const Draft = require('../models/Draft');
const ContentCalendar = require('../models/ContentCalendar');
const Campaign = require('../models/Campaign');
const User = require('../models/User');
const { parseGeminiJSON, generateCampaignImageNanoBanana, generatePosterFromReference } = require('./geminiAI');
const { callTextLLM } = require('./openAI');
const { uploadBase64Image } = require('./imageUploader');
const { buildPrompt } = require('./promptRegistry');
const { buildBrandMemoryBlock, getPrimaryLogoAsset } = require('./brandMemory');
// Lazy to avoid a load-order cycle: contentCalendarService lazily requires
// this module too, when auto-generation runs.
const { normalizeLanguage } = require('./contentCalendarService');
const { decideCreative, getRecentCreativeHistory } = require('./creativeDirector');
const { overlayBrandLogoIfPresent } = require('./logoOverlay');

const queue = [];
let processing = false;

/**
 * Generate content for a single calendar item
 */
async function generateSingleCalendarItem(calendar, item, weekNumber) {
  try {
    console.log(`[BackgroundQueue] Generating content for item Day ${item.day} (${item.headline || item._id})`);

    // Determine sourceType early for processing draft
    let sourceType = 'post';
    const formatLower = String(item.format || '').toLowerCase();
    if (formatLower.includes('reel') || formatLower.includes('video')) {
      sourceType = 'reel';
    } else if (formatLower.includes('campaign')) {
      sourceType = 'campaign';
    }

    // Pre-create processing draft
    const draft = new Draft({
      userId: calendar.userId,
      title: item.headline || `Weekly Generated Day ${item.day}`,
      status: 'processing',
      sourceType,
      contentCalendarId: calendar._id,
      calendarWeek: weekNumber,
      calendarDay: item.day,
      generationProgress: {
        step: 'Generating content',
        progress: 0
      }
    });
    await draft.save();

    // 1. Generate text details using LLM (Gemini)
    const prompt = `You are an expert Social Media Copywriter and Brand Strategist.
Based on the following content calendar item, generate a social media post:
Headline: ${item.headline}
Creative Concept: ${item.creativeConcept}
CTA: ${item.cta}
Objective: ${item.objective}
Format: ${item.format}
Business Name: ${calendar.businessName}
Niche: ${calendar.niche}
Language: ${calendar.language}

Return ONLY a JSON object (no markdown, no backticks, no code blocks):
{
  "caption": "Your highly engaging caption",
  "hashtags": ["tag1", "tag2", "tag3"],
  "imagePrompt": "Detailed prompt for generating the image"
}`;

    const llmResponse = await callTextLLM(prompt, { jsonMode: true, maxTokens: 2000 });
    let parsed = { caption: item.headline, hashtags: [], imagePrompt: item.creativeConcept };
    try {
      parsed = parseGeminiJSON(llmResponse);
    } catch (e) {
      console.error('[BackgroundQueue] Failed to parse JSON from Gemini response, using fallback text');
    }

    draft.generationProgress = { step: 'Generating Image', progress: 50 };
    await draft.save();

    // 2. Generate Image using Nano Banana Pro
    let imageUrl = '';
    let calendarPromptUsed = '';
    try {
      const imageResult = await generateCampaignImageNanoBanana(parsed.imagePrompt || item.creativeConcept, {
        userId: calendar.userId,
        aspectRatio: '1:1',
        brandName: calendar.businessName,
        industry: calendar.businessVertical || '',
        tone: 'professional'
      });
      if (imageResult && imageResult.success) {
        imageUrl = imageResult.imageUrl;
        calendarPromptUsed = imageResult.promptUsed || '';
      }
    } catch (imgErr) {
      console.error('[BackgroundQueue] Image generation failed:', imgErr.message);
    }

    // 3. Update Draft record
    draft.caption = parsed.caption || '';
    draft.hashtags = parsed.hashtags || [];
    draft.cta = item.cta || '';
    draft.imageUrl = imageUrl;
    draft.imagePrompt = parsed.imagePrompt || item.creativeConcept || '';
    // Same for the Smart Calendar path — these are the auto-generated posts,
    // so being able to see their prompt matters most here.
    if (calendarPromptUsed) draft.imagePromptResolved = calendarPromptUsed;
    draft.platforms = ['instagram'];
    draft.language = calendar.language || 'English';
    draft.objective = item.objective || 'awareness';
    draft.status = 'completed';
    draft.creative = {
      type: sourceType === 'reel' ? 'reel' : 'image',
      textContent: parsed.caption || '',
      captions: parsed.caption || '',
      imageUrls: imageUrl ? [imageUrl] : [],
      hashtags: parsed.hashtags || [],
      callToAction: item.cta || ''
    };
    draft.generationProgress = { step: 'Completed', progress: 100 };
    await draft.save();

    // 4. Create Campaign record for sync
    const campaign = new Campaign({
      userId: calendar.userId,
      name: item.headline || `Weekly Generated Day ${item.day}`,
      objective: item.objective || 'awareness',
      platforms: ['instagram'],
      status: 'draft',
      aiGenerated: true,
      creative: {
        type: sourceType === 'reel' ? 'reel' : 'image',
        textContent: parsed.caption || '',
        captions: parsed.caption || '',
        imageUrls: imageUrl ? [imageUrl] : [],
        hashtags: parsed.hashtags || [],
        callToAction: item.cta || ''
      },
      scheduling: {
        startDate: new Date(),
        frequency: 'once'
      }
    });
    await campaign.save();

    // 5. Update calendar item
    item.generatedDraftId = draft._id;
    item.generatedCampaignId = campaign._id;
    item.status = 'generated';
    
    console.log(`[BackgroundQueue] Generated item Day ${item.day} successfully: Draft ID ${draft._id}`);
    return { draft, campaign };
  } catch (error) {
    console.error(`[BackgroundQueue] Error generating item Day ${item.day}:`, error.message);
    throw error;
  }
}

/**
 * Background loop processor
 */
async function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;

  const job = queue.shift();
  try {
    if (job.type === 'generate_campaign_image' || job.type === 'generate_post_image') {
      await processDraftImageGenerationJob(job);
    } else {
      const { calendarId, weekNumber } = job;
      console.log(`[BackgroundQueue] Starting weekly job for Calendar ${calendarId}, Week ${weekNumber}`);

      const calendar = await ContentCalendar.findById(calendarId);
      if (!calendar) {
        console.error(`[BackgroundQueue] Calendar not found: ${calendarId}`);
        processing = false;
        setTimeout(processQueue, 1000);
        return;
      }

      const week = calendar.weeks.find(w => w.weekNumber === weekNumber);
      if (!week || !week.items || week.items.length === 0) {
        console.error(`[BackgroundQueue] Week ${weekNumber} items not found in calendar`);
        processing = false;
        setTimeout(processQueue, 1000);
        return;
      }

      for (const item of week.items) {
        // Skip if already generated, scheduled, or published
        if (item.status === 'scheduled' || item.status === 'published' || item.status === 'generated') {
          continue;
        }

        try {
          await generateSingleCalendarItem(calendar, item, weekNumber);
          await calendar.save();
        } catch (err) {
          console.error(`[BackgroundQueue] Failed to process calendar item:`, err.message);
        }
      }

      calendar.lastAutoRunAt = new Date();
      await calendar.save();
      console.log(`[BackgroundQueue] Completed weekly job for Calendar ${calendarId}, Week ${weekNumber}`);
    }
  } catch (error) {
    console.error('[BackgroundQueue] Job error:', error.message);
  } finally {
    processing = false;
    setTimeout(processQueue, 1000);
  }
}

async function processDraftImageGenerationJob(job) {
  const { draftId } = job;
  console.log(`[BackgroundQueue] Processing image generation for Draft ${draftId}`);
  
  try {
    const draft = await Draft.findById(draftId);
    if (!draft) {
      console.error(`[BackgroundQueue] Draft not found: ${draftId}`);
      return;
    }

    const user = await User.findById(draft.userId);
    const bp = user?.businessProfile || {};

    // generateCampaignImageNanoBanana retries once on a fallback model when the
    // primary is busy, and each of the two calls carries its own 120s internal
    // timeout — so their combined worst case comfortably exceeds the 60s this
    // used to allow. That made single-post generation fail under exactly the
    // "high demand" conditions the fallback exists to recover from — the race
    // outside always lost before the retry inside had a chance to land.
    const IMAGE_JOB_TIMEOUT_MS = 220_000;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Image generation timed out after ${IMAGE_JOB_TIMEOUT_MS / 1000}s`)), IMAGE_JOB_TIMEOUT_MS)
    );

    // If the user uploaded a reference/inspiration image, use Nano Banana's
    // image-to-image path so the generated poster mirrors the reference's
    // style, composition, and layout. Otherwise, plain text-to-image.
    const hasReference = typeof job.referenceImage === 'string' && job.referenceImage.trim().length > 0;
    // "Regenerate with this exact prompt" — the user edited the resolved
    // prompt shown on the draft and wants THIS text run, not a fresh
    // Creative Director decision. Takes priority over both other paths:
    // whatever concept the model would invent, the user has already
    // supplied a specific replacement for it.
    const hasPromptOverride = typeof job.promptOverride === 'string' && job.promptOverride.trim().length > 0;
    let imageResult;

    if (hasPromptOverride) {
      const primaryLogo = await getPrimaryLogoAsset(draft.userId);
      imageResult = await Promise.race([
        generateCampaignImageNanoBanana(job.promptOverride.trim(), {
          userId: draft.userId,
          useRawPrompt: true,
          aspectRatio: job.aspectRatio || '1:1',
          brandName: user?.companyName || 'Brand',
          industry: bp.industry || '',
          tone: bp.tone || 'professional',
          targetLanguage: normalizeLanguage(bp.contentLanguage),
          imageText: draft.imageText || '',
          logoReservedPosition: primaryLogo?.url ? primaryLogo.position : null
        }),
        timeoutPromise
      ]);
      if (imageResult?.imageUrl && primaryLogo?.url) {
        imageResult.imageUrl = await overlayBrandLogoIfPresent(imageResult.imageUrl, {
          logoUrl: primaryLogo.url,
          position: primaryLogo.position,
          size: primaryLogo.size
        });
      }
      // The prompt that produced THIS image is now the edited one — record
      // it as such, so the next time someone opens this draft they see what
      // actually made the picture in front of them, not the original.
      if (imageResult?.imageUrl) draft.imagePromptResolved = job.promptOverride.trim();
    } else if (hasReference) {
      // generatePosterFromReference expects: (referenceBase64, contentString, options)
      // and returns { success, imageBase64, error } — raw base64, NOT a URL.
      // So we upload the returned base64 to Cloudinary and hand back a { imageUrl }
      // shape the downstream code expects.
      const contentString = [
        draft.imagePrompt || draft.caption || 'A creative poster',
        user?.companyName ? `Brand: ${user.companyName}` : '',
        bp.industry ? `Industry: ${bp.industry}` : ''
      ].filter(Boolean).join('\n');

      const genRes = await Promise.race([
        generatePosterFromReference(job.referenceImage, contentString, {
          aspectRatio: job.aspectRatio || '1:1',
          tone: bp.tone || 'professional'
        }),
        timeoutPromise
      ]);

      if (!genRes?.success || !genRes?.imageBase64) {
        throw new Error(genRes?.error || 'Nano Banana returned no image data for reference generation');
      }

      const upload = await uploadBase64Image(genRes.imageBase64, 'nebula-poster-from-reference');
      if (!upload?.success || !upload?.url) {
        throw new Error(upload?.error || 'Cloudinary upload failed after reference-image generation');
      }
      imageResult = { imageUrl: upload.url };
    } else {
      // Write the actual copy and image brief before rendering anything. The
      // idea typed in Create is a one-liner; it is not what should become the
      // caption or drive the image, only the seed for a real content-writing
      // pass — the same two-step shape campaigns already use.
      let contentPrompt = null;
      try {
        const brandContextBlock = await buildBrandMemoryBlock(draft.userId);
        const planPrompt = await buildPrompt(draft.userId, 'single.content', {
          idea: draft.imagePrompt || draft.caption || '',
          contentPillar: job.contentPillar || '',
          contentType: job.contentType || 'post',
          campaignContext: job.campaignContext || '',
          objective: job.objective || '',
          platform: (job.platforms || draft.platforms || [])[0] || '',
          language: normalizeLanguage(bp.contentLanguage),
          brandContextBlock
        });
        const raw = await callTextLLM(planPrompt, { jsonMode: true, maxTokens: 2000 });
        contentPrompt = parseGeminiJSON(raw);
      } catch (err) {
        console.error('[BackgroundQueue] Content-writing pass failed, using the raw idea instead:', err.message);
      }

      const imageDescription = String(contentPrompt?.imageDescription || '').trim() || draft.imagePrompt || draft.caption || 'A creative poster';

      // Only overwrite what the content pass actually produced — a failed or
      // partial result should not blank out what the user already had.
      if (contentPrompt?.caption) {
        draft.caption = contentPrompt.caption;
        if (!draft.creative) draft.creative = {};
        draft.creative.textContent = contentPrompt.caption;
        draft.creative.captions = contentPrompt.caption;
        draft.markModified('creative');
      }
      if (Array.isArray(contentPrompt?.hashtags) && contentPrompt.hashtags.length) {
        draft.hashtags = contentPrompt.hashtags;
      }
      // What the visual should actually be is a separate decision from what
      // the post says. The Creative Director makes it — reading the brand's
      // full asset library once, choosing only what this specific idea
      // needs — then the Art Director turns that into the final instruction.
      // The image model receives ONLY that instruction and the specific
      // asset URLs chosen for it, never the brand context or this decision
      // prompt itself.
      let creative = null;
      try {
        creative = await decideCreative(draft.userId, {
          idea: imageDescription,
          contentType: job.contentType || 'post',
          contentPillar: job.contentPillar || '',
          objective: job.objective || '',
          platform: (job.platforms || draft.platforms || [])[0] || '',
          campaignContext: job.campaignContext || '',
          previousCreatives: await getRecentCreativeHistory(draft.userId)
        }, {
          aspectRatio: job.aspectRatio || '1:1',
          language: normalizeLanguage(bp.contentLanguage)
        });
      } catch (err) {
        console.error('[BackgroundQueue] Creative Director pass failed, falling back to the plain image description:', err.message);
      }

      if (creative?.creativeConcept) {
        draft.creativeConcept = creative.creativeConcept;
        draft.visualTreatment = creative.visualTreatment;
      }
      // The Creative Director's own imageText supersedes single.content's —
      // it was chosen alongside the actual visual, not written blind.
      if (creative?.imageText) draft.imageText = creative.imageText;

      // Explicitly selected images take priority over the Creative Director's
      // own picks — a user who picked a product in Create meant that product,
      // whatever the model decides is relevant.
      const explicitProductImages = [
        job.linkedProduct?.imageUrl,
        ...(Array.isArray(job.productReferenceImages) ? job.productReferenceImages.slice(1) : [])
      ].filter(Boolean);
      const chosenProductImages = explicitProductImages.length ? explicitProductImages : (creative?.productImages || []);

      // Always composited for a standalone post, independent of whatever
      // the Creative Director chose to select as a "required asset" for
      // this specific idea — a single post is the brand's own content and
      // should always carry its logo, not carry it only when an LLM's
      // per-post judgment happened to ask for it. (Carousels and campaigns
      // keep that judgment — a logo on every one of ten slides is clutter —
      // this "always" is scoped to single posts only.)
      //
      // Fetched BEFORE generation, not after, so the model can be told where
      // the real logo will land and keep that corner clear — without this,
      // the model's own headline placement and the overlay's position
      // collided whenever both defaulted to the same corner.
      const primaryLogo = await getPrimaryLogoAsset(draft.userId);

      // No brandLogo reference here on purpose — a generative model
      // redraws anything it's shown, including logos (softened, recolored,
      // sometimes with the wordmark dropped). The logo is composited
      // pixel-exact afterward instead; see overlayBrandLogoIfPresent below.
      imageResult = await Promise.race([
        generateCampaignImageNanoBanana(creative?.finalPrompt || imageDescription, {
          userId: draft.userId,
          useRawPrompt: Boolean(creative?.finalPrompt),
          aspectRatio: job.aspectRatio || '1:1',
          brandName: user?.companyName || 'Brand',
          industry: bp.industry || '',
          tone: bp.tone || 'professional',
          targetLanguage: normalizeLanguage(bp.contentLanguage),
          imageText: draft.imageText || '',
          environmentReferenceImage: creative?.environmentImage || null,
          productReferenceImage: chosenProductImages[0] || null,
          productReferenceImages: chosenProductImages.slice(1),
          logoReservedPosition: primaryLogo?.url ? primaryLogo.position : null
        }),
        timeoutPromise
      ]);

      if (imageResult?.imageUrl && primaryLogo?.url) {
        imageResult.imageUrl = await overlayBrandLogoIfPresent(imageResult.imageUrl, {
          logoUrl: primaryLogo.url,
          position: primaryLogo.position,
          size: primaryLogo.size
        });
      }
    }

    const finalImageUrl = typeof imageResult === 'string' ? imageResult : imageResult?.imageUrl;
    // Keep the exact prompt that produced this image, for the UI to show.
    if (typeof imageResult === 'object' && imageResult?.promptUsed) {
      draft.imagePromptResolved = imageResult.promptUsed;
    }

    if (finalImageUrl) {
      draft.imageUrl = finalImageUrl;
      draft.status = 'completed';
      draft.errorMessage = '';
      
      // Update creative field if it exists
      if (!draft.creative) draft.creative = {};
      draft.creative = {
        ...draft.creative,
        imageUrls: [finalImageUrl]
      };
      draft.markModified('creative');
      
      await draft.save();

      // Remember this generation in the AI Memory system (Layer 1 evidence).
      // Fire-and-forget — a memory-write failure must never fail the
      // generation the user is waiting on.
      try {
        const { rememberCampaignGeneration } = require('./aiMemoryService');
        rememberCampaignGeneration({
          userId: draft.userId,
          campaignId: draft.campaignId || null,
          action: draft.contentType === 'campaign' ? 'campaign_generation' : 'post_generation',
          campaignName: draft.title || '',
          objective: draft.objective || '',
          platform: (draft.platforms || [])[0] || 'instagram',
          platforms: draft.platforms || [],
          tone: draft.tone || '',
          language: draft.language || 'English',
          prompt: draft.imagePromptResolved || draft.imagePrompt || '',
          generatedCaptions: draft.caption ? [draft.caption] : [],
          hashtags: draft.hashtags || [],
          cta: draft.cta || '',
          imagePrompts: draft.imagePromptResolved ? [draft.imagePromptResolved] : [],
          generatedImages: [finalImageUrl]
        }).catch((err) => console.warn('[BackgroundQueue] AI memory write failed (non-fatal):', err.message));
      } catch (memErr) {
        console.warn('[BackgroundQueue] AI memory write failed (non-fatal):', memErr.message);
      }

      console.log(`[BackgroundQueue] Image generated successfully for Draft ${draftId}: ${finalImageUrl}`);
    } else {
      throw new Error(imageResult?.error || 'Failed to generate image URL');
    }
  } catch (error) {
    console.error(`[BackgroundQueue] Error in background image generation for Draft ${draftId}:`, error);
    try {
      await Draft.findByIdAndUpdate(draftId, {
        $set: {
          status: 'failed',
          errorMessage: error.message || 'Unknown error during image generation'
        }
      });
    } catch (dbErr) {
      console.error(`[BackgroundQueue] Failed to update draft status to failed:`, dbErr);
    }
  }
}

/**
 * Enqueue a new background weekly generation job
 */
function enqueue(job) {
  queue.push(job);
  console.log(`[BackgroundQueue] Enqueued job: Type=${job.type || 'weekly_calendar'}, DraftId=${job.draftId || 'N/A'}. Queue length: ${queue.length}`);
  processQueue();
}

module.exports = {
  enqueue,
  generateSingleCalendarItem
};
