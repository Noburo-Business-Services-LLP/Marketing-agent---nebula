const Draft = require('../models/Draft');
const ContentCalendar = require('../models/ContentCalendar');
const Campaign = require('../models/Campaign');
const User = require('../models/User');
const { callGemini, parseGeminiJSON, generateCampaignImageNanoBanana } = require('./geminiAI');

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

    const llmResponse = await callGemini(prompt);
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
    try {
      const imageResult = await generateCampaignImageNanoBanana(parsed.imagePrompt || item.creativeConcept, {
        aspectRatio: '1:1',
        brandName: calendar.businessName,
        industry: calendar.businessVertical || '',
        tone: 'professional'
      });
      if (imageResult && imageResult.success) {
        imageUrl = imageResult.imageUrl;
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

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Image generation timed out after 60s')), 60000)
    );

    const imageResult = await Promise.race([
      generateCampaignImageNanoBanana(draft.imagePrompt || draft.caption || 'A creative poster', {
        aspectRatio: job.aspectRatio || '1:1',
        brandName: user?.companyName || 'Brand',
        industry: bp.industry || '',
        tone: bp.tone || 'professional'
      }),
      timeoutPromise
    ]);

    const finalImageUrl = typeof imageResult === 'string' ? imageResult : imageResult?.imageUrl;

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
