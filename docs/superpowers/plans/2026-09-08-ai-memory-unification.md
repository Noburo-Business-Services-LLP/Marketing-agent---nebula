# AI Memory Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing AI Memory system (currently wired only into the legacy Campaigns/Products/VideoGeneration pages) real for the actual Gravity pipeline — real generations get remembered, published posts get performance-tracked automatically, and a small curated set of learned notes feeds back into future generation prompts and the AI Memory page.

**Architecture:** Two layers. Layer 1 (unchanged models `AICampaignHistory`/`AIVideoMemory`/`AIContentPerformance`) gets Gravity as a second writer, fire-and-forget, alongside the legacy pages' existing writes. Layer 2 (new `AIBrandMemory.learnedNotes`) is a capped, human-readable, LLM-distilled summary of Layer 1 — the only thing read into generation prompts or shown on the AI Memory page.

**Tech Stack:** Node/Express, Mongoose, existing `callTextLLM`/`parseGeminiJSON` for the LLM distillation call, existing `getPostAnalytics` (Ayrshare) for performance data. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-08-ai-memory-unification-design.md`

**Testing approach — deviation from the standard TDD template below:** this codebase has no test runner configured (no `jest`/`mocha` in `package.json`, no `*.test.js` files anywhere). The established verification pattern for this whole project, used consistently in every recent change, is: `node --check` for syntax, then a live smoke test against the real dev database — mint a JWT, call the real endpoint or function, inspect the real DB state, clean up test data afterward. Every task below follows that pattern instead of writing Jest tests. Do not introduce a test framework as part of this plan.

## Global Constraints

- The legacy Campaigns/Products/VideoGeneration pages and their existing calls into `aiMemoryService.js`/`aiCampaignLearning.js`/`aiVideoLearning.js`/`aiPerformanceTracker.js` must not be modified or touched — this plan only adds Gravity as a second writer/reader into the same models.
- All new writes into the memory system from Gravity's generation paths are fire-and-forget: wrapped in `try/catch` (or `.catch()`), logged on failure, and never allowed to block or fail the generation/publish flow they're attached to.
- The LLM distillation call MUST request a fixed, named top-level JSON key (e.g. `{"notes": [...]}`), never a bare array — `OpenAI`'s `response_format: json_object` mode forces a top-level object, and asking for a bare array causes the model to invent an inconsistent wrapper key across calls. This exact bug was found and fixed in the Smart Calendar's generation this session (see `backend/services/contentCalendarService.js`'s `CONTENT_CALENDAR_PROMPT`) — do not reintroduce it here.
- New scheduled jobs follow the existing `startXScheduler({ intervalMs, logger })` closure pattern from `backend/services/contentCalendarService.js` (returns a stop function), registered in `backend/server-main.js` inside a `try/catch` alongside the other schedulers, not the class-based pattern from `snapshotScheduler.js`.
- Every new scheduled job supports a kill switch via an environment variable, matching `AYRSHARE_SNAPSHOT_ENABLED` and `ENABLE_CONTENT_CALENDAR_SCHEDULER`'s existing convention.

---

## Task 1: Add `learnedNotes` to the `AIBrandMemory` model

**Files:**
- Modify: `backend/models/AIBrandMemory.js`

**Interfaces:**
- Produces: `AIBrandMemory.learnedNotes` — array of `{ _id, text: String, category: String, sourceIds: [ObjectId], confidence: Number, createdAt: Date, updatedAt: Date }`. `AIBrandMemory.learnedNotesUpdatedAt` — `Date | null`, the last time the distillation job ran (successfully or as a no-op skip is NOT recorded here — only an actual write updates it).

- [ ] **Step 1: Add the field to the schema**

In `backend/models/AIBrandMemory.js`, add this field to `aiBrandMemorySchema`, right after the existing `inventoryPatterns` field (before `rawProfile`):

```js
    // Layer 2 of the memory system: a small, curated, human-readable set of
    // notes distilled from real published-post performance (AIContentPerformance)
    // by the weekly distillation job. This — never the raw performance log —
    // is what gets read into generation prompts and shown on the AI Memory
    // page. See docs/superpowers/specs/2026-09-08-ai-memory-unification-design.md.
    learnedNotes: [
      {
        text: { type: String, required: true, trim: true },
        category: {
          type: String,
          enum: ['copy', 'hashtags', 'cta', 'visual', 'timing', 'format'],
          default: 'copy'
        },
        sourceIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AIContentPerformance' }],
        confidence: { type: Number, default: 0.5, min: 0, max: 1 },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now }
      }
    ],
    learnedNotesUpdatedAt: { type: Date, default: null },
```

- [ ] **Step 2: Verify the file is syntactically valid**

Run: `cd backend && node --check models/AIBrandMemory.js`
Expected: no output (success).

- [ ] **Step 3: Verify the schema loads and the field is usable**

Run this from `backend/`, with the DNS workaround this project's environment needs (see below) if `dns.resolveSrv` fails for you — check first with a plain `node -e "require('dotenv').config(); require('mongoose').connect(process.env.MONGODB_URI).then(()=>console.log('ok')).catch(e=>console.log('FAIL',e.message))"`; if that fails with `querySrv EBADRESP`, prepend `require('dns').setServers(['8.8.8.8','1.1.1.1']);` to every script below before the `mongoose.connect` call.

```bash
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const AIBrandMemory = require('./models/AIBrandMemory');
  const doc = new AIBrandMemory({
    organizationId: 'test-org-verify-task1',
    userId: new mongoose.Types.ObjectId(),
    learnedNotes: [{ text: 'Test note', category: 'copy', confidence: 0.7 }]
  });
  await doc.validate();
  console.log('Valid. learnedNotes[0]:', JSON.stringify(doc.learnedNotes[0]));
  process.exit(0);
})();
"
```

Expected: prints the note object with a `_id`, no validation error.

- [ ] **Step 4: Commit**

```bash
git add backend/models/AIBrandMemory.js
git commit -m "$(cat <<'EOF'
Add learnedNotes field to AIBrandMemory for the curated memory layer

Layer 2 of the AI Memory unification design — a small, human-readable
set of notes distilled from real performance data, distinct from the
raw evidence log models. See docs/superpowers/specs/2026-09-08-ai-memory-unification-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `performanceChecks` to the `Campaign` model

**Files:**
- Modify: `backend/models/Campaign.js`

**Interfaces:**
- Produces: `Campaign.performanceChecks` — array of `{ checkpoint: '24h'|'3d'|'7d'|'2w'|'1m', checkedAt: Date }`, tracking which tiered performance checks have already run for this campaign so the tracker job never re-checks the same window twice.

- [ ] **Step 1: Add the field to the schema**

In `backend/models/Campaign.js`, add this field right after `publishFailureCount`/`publishAutoCancelled` (before `publishHash`):

```js
  // Which tiered performance checkpoints (see services/performanceTracker.js)
  // have already run for this post. Prevents re-checking the same window
  // twice and lets the tracker know when it's done (5 entries = stop).
  performanceChecks: [
    {
      checkpoint: { type: String, enum: ['24h', '3d', '7d', '2w', '1m'], required: true },
      checkedAt: { type: Date, default: Date.now }
    }
  ],
```

- [ ] **Step 2: Verify syntax**

Run: `cd backend && node --check models/Campaign.js`
Expected: no output.

- [ ] **Step 3: Verify the schema loads and validates**

```bash
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Campaign = require('./models/Campaign');
  const doc = new Campaign({
    userId: new mongoose.Types.ObjectId(),
    name: 'Test campaign verify task2',
    performanceChecks: [{ checkpoint: '24h' }]
  });
  await doc.validate();
  console.log('Valid. performanceChecks[0]:', JSON.stringify(doc.performanceChecks[0]));
  process.exit(0);
})();
"
```

Expected: prints the checkpoint object with a `_id` and `checkedAt`, no validation error.

- [ ] **Step 4: Commit**

```bash
git add backend/models/Campaign.js
git commit -m "$(cat <<'EOF'
Add performanceChecks to Campaign for tiered automatic performance tracking

Tracks which of the 24h/3d/7d/2w/1m post-publish checkpoints have
already run for a given campaign, so the new performance tracker job
(added in a later task) never double-checks the same window.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Remember hook — single-post/campaign image generation

**Files:**
- Modify: `backend/services/backgroundQueue.js:453` (inside `processDraftImageGenerationJob`, right after `await draft.save();` and before the `console.log` that follows it)

**Interfaces:**
- Consumes: `rememberCampaignGeneration(payload)` from `backend/services/aiMemoryService.js` (existing, unchanged) — accepts `{ userId, campaignId, action, campaignName, objective, platform, platforms, tone, language, prompt, generatedCaptions, hashtags, cta, imagePrompts, generatedImages }` and more; every field is optional except it resolves `userId` internally via `payload.userId || payload.user`. Returns a Promise; already internally wrapped in try/catch, never throws.
- Produces: nothing new — this task is a caller, not a new export.

This is the path GravityCreate, DraftPreviewModal's Regenerate, and GravityApprove's Regenerate all funnel through (`job.type === 'generate_campaign_image' || job.type === 'generate_post_image'`).

- [ ] **Step 1: Add the fire-and-forget remember call**

In `backend/services/backgroundQueue.js`, find this exact block (around line 440-454):

```js
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
```

Replace it with (the only change is the new block inserted between `await draft.save();` and the `console.log`):

```js
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
```

- [ ] **Step 2: Verify syntax**

Run: `cd backend && node --check services/backgroundQueue.js`
Expected: no output.

- [ ] **Step 3: Live-verify against the real dev account**

Restart the dev server (see this project's established pattern: if `node -e "dns.resolveSrv(...)"` fails locally, run the server via `node -e "require('dns').setServers(['8.8.8.8','1.1.1.1']); require('./server.js');"` from `backend/` instead of `node server.js`). Then:

```bash
# Mint a JWT for a real test user (adjust the query to pick a real dev user)
node -e "
require('dotenv').config();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('./models/User');
  const user = await User.findOne({}).sort({ createdAt: -1 });
  console.log('USERID:' + user._id);
  console.log('TOKEN:' + jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' }));
  process.exit(0);
})();
" > /tmp/task3_creds.txt
TOKEN=$(grep TOKEN: /tmp/task3_creds.txt | cut -d: -f2-)

# Generate a real test post
curl -s -X POST http://localhost:5000/api/drafts/generate-image-bg \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"campaignContext":"A simple test post for AI memory verification","contentType":"post","platforms":["instagram"]}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['draftId'])" > /tmp/task3_draft_id.txt

# Wait ~30-40s for it to complete (poll status), then check AICampaignHistory got a new record
DRAFT_ID=$(cat /tmp/task3_draft_id.txt)
sleep 40
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Draft = require('./models/Draft');
  const AICampaignHistory = require('./models/AICampaignHistory');
  const draft = await Draft.findById('$DRAFT_ID').lean();
  console.log('Draft status:', draft.status);
  const mem = await AICampaignHistory.findOne({ userId: draft.userId }).sort({ createdAt: -1 }).lean();
  console.log('Most recent AICampaignHistory createdAt:', mem?.createdAt);
  console.log('Matches this draft\\'s generatedImages:', mem?.generatedImages?.includes(draft.imageUrl));
  process.exit(0);
})();
"
```

Expected: `Draft status: completed`, and the most recent `AICampaignHistory` record's `generatedImages` includes this draft's `imageUrl` (confirms the hook fired for this exact generation, not a stale unrelated record).

- [ ] **Step 4: Clean up test artifacts**

```bash
DRAFT_ID=$(cat /tmp/task3_draft_id.txt)
TOKEN=$(grep TOKEN: /tmp/task3_creds.txt | cut -d: -f2-)
curl -s -X DELETE "http://localhost:5000/api/drafts/$DRAFT_ID" -H "Authorization: Bearer $TOKEN"
rm -f /tmp/task3_creds.txt /tmp/task3_draft_id.txt
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/backgroundQueue.js
git commit -m "$(cat <<'EOF'
Remember single-post and campaign image generations in AI Memory

The Gravity single-post/campaign image pipeline (GravityCreate,
DraftPreviewModal, GravityApprove's Regenerate) never wrote into the
AI Memory system — only the legacy Campaigns page did. Adds a
fire-and-forget rememberCampaignGeneration() call right after a draft's
image finishes generating, reusing the existing unchanged function.

Verified live: generated a real test post, confirmed a fresh
AICampaignHistory record appeared with this exact draft's imageUrl.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Remember hook — Smart Calendar item generation

**Files:**
- Modify: `backend/services/backgroundQueue.js:145` (inside `generateSingleCalendarItem`, right after `await campaign.save();` and before `item.status = 'generated';`)

**Interfaces:**
- Consumes: same `rememberCampaignGeneration(payload)` as Task 3.

This is the path the Smart Calendar's "Generate Week Content" button and the calendar's own auto-generation scheduler (`processAutoGeneration` in `contentCalendarService.js`) both funnel through.

- [ ] **Step 1: Add the fire-and-forget remember call**

In `backend/services/backgroundQueue.js`, find this exact block:

```js
    await campaign.save();

    // 5. Update calendar item
    item.generatedDraftId = draft._id;
```

Replace it with:

```js
    await campaign.save();

    // Remember this generation in the AI Memory system (Layer 1 evidence).
    // Fire-and-forget, same as the single-post path above.
    try {
      const { rememberCampaignGeneration } = require('./aiMemoryService');
      rememberCampaignGeneration({
        userId: calendar.userId,
        campaignId: campaign._id,
        action: 'calendar_generation',
        campaignName: item.headline || '',
        objective: item.objective || '',
        platform: 'instagram',
        platforms: ['instagram'],
        tone: 'professional',
        language: calendar.language || 'English',
        prompt: calendarPromptUsed || parsed.imagePrompt || item.creativeConcept || '',
        generatedCaptions: parsed.caption ? [parsed.caption] : [],
        hashtags: parsed.hashtags || [],
        cta: item.cta || '',
        imagePrompts: (calendarPromptUsed || parsed.imagePrompt) ? [calendarPromptUsed || parsed.imagePrompt] : [],
        generatedImages: imageUrl ? [imageUrl] : []
      }).catch((err) => console.warn('[BackgroundQueue] AI memory write failed (non-fatal):', err.message));
    } catch (memErr) {
      console.warn('[BackgroundQueue] AI memory write failed (non-fatal):', memErr.message);
    }

    // 5. Update calendar item
    item.generatedDraftId = draft._id;
```

- [ ] **Step 2: Verify syntax**

Run: `cd backend && node --check services/backgroundQueue.js`
Expected: no output.

- [ ] **Step 3: Live-verify against the real dev account**

```bash
node -e "
require('dotenv').config();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('./models/User');
  const user = await User.findOne({}).sort({ createdAt: -1 });
  console.log('TOKEN:' + jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' }));
  process.exit(0);
})();
" > /tmp/task4_creds.txt
TOKEN=$(grep TOKEN: /tmp/task4_creds.txt | cut -d: -f2-)

# Get (or create) the current month's calendar, then trigger week generation
curl -s http://localhost:5000/api/content-calendar -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['calendar']['_id'])" > /tmp/task4_cal_id.txt
CAL_ID=$(cat /tmp/task4_cal_id.txt)

curl -s -X POST "http://localhost:5000/api/content-calendar/$CAL_ID/auto-generate-week" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"weekNumber":1}'

sleep 60

node -e "
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const AICampaignHistory = require('./models/AICampaignHistory');
  const recent = await AICampaignHistory.find({ action: 'calendar_generation' }).sort({ createdAt: -1 }).limit(3).lean();
  console.log('Recent calendar_generation records:', recent.length);
  recent.forEach(r => console.log('-', r.createdAt, r.campaignName, 'images:', r.generatedImages?.length));
  process.exit(0);
})();
"
```

Expected: at least one `AICampaignHistory` record with `action: 'calendar_generation'` and a `createdAt` from within the last couple minutes.

- [ ] **Step 4: Clean up**

```bash
rm -f /tmp/task4_creds.txt /tmp/task4_cal_id.txt
```

(No need to delete the generated calendar drafts — they're real content for the test account, consistent with how this project has handled calendar verification all along.)

- [ ] **Step 5: Commit**

```bash
git add backend/services/backgroundQueue.js
git commit -m "$(cat <<'EOF'
Remember Smart Calendar item generations in AI Memory

Same gap as the single-post path: calendar-generated content (via
"Generate Week Content" or the calendar's auto-generation scheduler)
never wrote into AI Memory. Adds the same fire-and-forget
rememberCampaignGeneration() call used in the single-post path.

Verified live: triggered week generation on the current month's
calendar, confirmed a fresh AICampaignHistory record with
action: 'calendar_generation' appeared.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Remember hook — reel/video generation

**Files:**
- Modify: `backend/services/videoGenerationQueue.js:493` (inside `_runJob`, right after the `Draft.updateMany(...)` call for `create_video_pipeline`/`merge_video`, still inside that `if (jobType === ...)` block's `try`)

**Interfaces:**
- Consumes: `rememberVideoGeneration(payload)` from `backend/services/aiMemoryService.js` (existing, unchanged) — accepts `{ userId, campaignId, jobId, action, prompt, script, captions, hashtags, cta, scenePrompts, sceneData, language, duration, generatedVideos, generatedImages }`; internally wrapped in try/catch, never throws.

- [ ] **Step 1: Add the fire-and-forget remember call**

In `backend/services/videoGenerationQueue.js`, find this exact block:

```js
      if (jobType === 'create_video_pipeline' || jobType === 'merge_video') {
        try {
          const Draft = require('../models/Draft');
          const finalUrl = result?.videoUrl || result?.url || result?.finalVideoUrl || result?.merge?.finalVideoUrl;
          await Draft.updateMany(
            { 'generationProgress.jobId': jobId },
            { 
              $set: { 
                status: 'completed', 
                imageUrl: finalUrl,
                'creative.videoUrl': finalUrl
              } 
            }
          );
        } catch (err) {
          console.error(`⚠️ Failed to update Draft status to completed for job ${jobId}:`, err.message);
        }
      }
```

Replace it with:

```js
      if (jobType === 'create_video_pipeline' || jobType === 'merge_video') {
        try {
          const Draft = require('../models/Draft');
          const finalUrl = result?.videoUrl || result?.url || result?.finalVideoUrl || result?.merge?.finalVideoUrl;
          await Draft.updateMany(
            { 'generationProgress.jobId': jobId },
            { 
              $set: { 
                status: 'completed', 
                imageUrl: finalUrl,
                'creative.videoUrl': finalUrl
              } 
            }
          );

          // Remember this generation in the AI Memory system (Layer 1
          // evidence). Fire-and-forget — must never fail the video job.
          if (jobDoc.userId && finalUrl) {
            try {
              const { rememberVideoGeneration } = require('./aiMemoryService');
              const rawPayload = jobDoc.payload?.payload || {};
              rememberVideoGeneration({
                userId: jobDoc.userId,
                jobId,
                action: 'reel_generation',
                prompt: rawPayload.script || rawPayload.prompt || '',
                script: rawPayload.script || '',
                captions: rawPayload.captions || [],
                hashtags: rawPayload.hashtags || [],
                cta: rawPayload.cta || '',
                scenePrompts: rawPayload.scenePrompts || [],
                language: rawPayload.language || 'English',
                duration: rawPayload.durationSeconds || null,
                generatedVideos: [finalUrl]
              }).catch((err) => console.warn('[VideoQueue] AI memory write failed (non-fatal):', err.message));
            } catch (memErr) {
              console.warn('[VideoQueue] AI memory write failed (non-fatal):', memErr.message);
            }
          }
        } catch (err) {
          console.error(`⚠️ Failed to update Draft status to completed for job ${jobId}:`, err.message);
        }
      }
```

- [ ] **Step 2: Verify syntax**

Run: `cd backend && node --check services/videoGenerationQueue.js`
Expected: no output.

- [ ] **Step 3: Live-verify against the real dev account**

Reel generation is slow and costs real Quarks (video credits), so verify this one directly against the DB rather than running a full reel end-to-end: confirm the code path is reachable and correctly shaped by checking the most recent real `create_video_pipeline`/`merge_video` job that already completed (from prior testing this session or the user's own usage), and confirm re-running the hook logic against it (without actually re-enqueuing a paid job) produces a well-formed payload:

```bash
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const VideoJob = require('./models/VideoJob');
  const job = await VideoJob.findOne({ 'metadata.jobType': { \$in: ['create_video_pipeline', 'merge_video'] }, status: 'completed' }).sort({ completedAt: -1 }).lean();
  if (!job) { console.log('No completed video job found in dev DB to verify against — skip live check, syntax check from Step 2 stands.'); process.exit(0); }
  console.log('Found job:', job.jobId, 'userId:', job.userId);
  const rawPayload = job.payload?.payload || {};
  console.log('Would remember with script:', (rawPayload.script || rawPayload.prompt || '').slice(0, 80));
  process.exit(0);
})();
"
```

If a real completed job exists in the dev DB, confirm the printed payload fields look sensible (non-empty script/prompt where the original job had one). If none exists, the syntax check from Step 2 is the verification for this task — do not spend real video credits solely to test this hook.

- [ ] **Step 4: Commit**

```bash
git add backend/services/videoGenerationQueue.js
git commit -m "$(cat <<'EOF'
Remember reel/video generations in AI Memory

Same gap as the image paths: Gravity's reel pipeline
(create_video_pipeline/merge_video) never wrote into AI Memory. Adds
a fire-and-forget rememberVideoGeneration() call right after a video
job's Draft records are marked completed.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Performance tracker job (automatic tiered tracking)

**Files:**
- Create: `backend/services/performanceTracker.js`
- Modify: `backend/server-main.js` (register the scheduler)

**Interfaces:**
- Consumes: `getPostAnalytics(postId, platforms, profileKey)` from `backend/services/socialMediaAPI.js` (existing). `trackPerformance(payload)` from `backend/services/aiMemoryService.js` (existing).
- Produces: `startPerformanceTrackerScheduler({ intervalMs, logger })` — starts the job, returns a stop function. `runPerformanceTrackerOnce()` — runs one pass immediately, returned for the manual/test path and reused by the scheduler internally.

- [ ] **Step 1: Write the new file**

Create `backend/services/performanceTracker.js`:

```js
/**
 * Automatic tiered performance tracking.
 *
 * Every real publish (backend/routes/drafts.js's /:id/publish, and the
 * legacy publish paths) already stores a Campaign with socialPostId /
 * socialPostIds and publishedAt. Performance used to only get tracked when
 * a user manually opened a specific post's analytics on the legacy
 * Campaigns page — nothing pulled it automatically, so real Gravity usage
 * never fed the learning loop. This walks published campaigns and checks
 * each one at 24h, 3 days, 7 days, 2 weeks, and 1 month after publish, then
 * stops — matching how engagement actually accrues instead of polling
 * forever.
 */

const Campaign = require('../models/Campaign');
const User = require('../models/User');
const { getPostAnalytics } = require('./socialMediaAPI');
const { trackPerformance } = require('./aiMemoryService');

const CHECKPOINTS = [
  { key: '24h', ms: 24 * 60 * 60 * 1000 },
  { key: '3d', ms: 3 * 24 * 60 * 60 * 1000 },
  { key: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: '2w', ms: 14 * 24 * 60 * 60 * 1000 },
  { key: '1m', ms: 30 * 24 * 60 * 60 * 1000 }
];

// Bounds Ayrshare API calls per run regardless of how many posts have
// accumulated — a backlog is worked off over several runs, not one spike.
const MAX_CHECKS_PER_RUN = 25;

/** Which checkpoint (if any) is due for this campaign right now. */
function dueCheckpoint(campaign, now = new Date()) {
  if (!campaign.publishedAt) return null;
  const elapsed = now.getTime() - new Date(campaign.publishedAt).getTime();
  const done = new Set((campaign.performanceChecks || []).map((c) => c.checkpoint));
  for (const cp of CHECKPOINTS) {
    if (done.has(cp.key)) continue;
    if (elapsed >= cp.ms) return cp.key;
    break; // checkpoints are in ascending order — none later can be due either
  }
  return null;
}

/** postId + platform pairs to check for a campaign, from whichever of
 * socialPostId/socialPostIds/facebookPostId/instagramPostId is populated. */
function postTargets(campaign) {
  const targets = [];
  if (campaign.socialPostIds && typeof campaign.socialPostIds === 'object') {
    for (const [platform, postId] of Object.entries(campaign.socialPostIds)) {
      if (postId) targets.push({ platform, postId: String(postId) });
    }
  }
  if (!targets.length && campaign.socialPostId) {
    targets.push({ platform: (campaign.platforms || [])[0] || 'instagram', postId: campaign.socialPostId });
  }
  return targets;
}

async function runPerformanceTrackerOnce({ now = new Date(), limit = MAX_CHECKS_PER_RUN } = {}) {
  // Only campaigns that are actually published and haven't exhausted every
  // checkpoint yet are candidates — cheap enough to filter the rest in
  // JS after a narrow Mongo query rather than encoding the checkpoint math
  // itself into the query.
  const candidates = await Campaign.find({
    status: 'posted',
    publishedAt: { $ne: null, $lte: new Date(now.getTime() - CHECKPOINTS[0].ms) },
    $expr: { $lt: [{ $size: { $ifNull: ['$performanceChecks', []] } }, CHECKPOINTS.length] }
  }).limit(limit * 3).lean(); // headroom: not every candidate has a checkpoint due right now

  let checked = 0;
  for (const campaign of candidates) {
    if (checked >= limit) break;
    const checkpoint = dueCheckpoint(campaign, now);
    if (!checkpoint) continue;

    const targets = postTargets(campaign);
    if (!targets.length) continue;

    const user = await User.findById(campaign.userId).select('ayrshare businessProfile').lean();
    const profileKey = user?.ayrshare?.profileKey;
    if (!profileKey) continue; // no connected socials — nothing to check

    for (const { platform, postId } of targets) {
      if (checked >= limit) break;
      try {
        const result = await getPostAnalytics(postId, [platform], profileKey);
        if (result.success) {
          await trackPerformance({
            userId: campaign.userId,
            campaignId: campaign._id,
            postId,
            platform,
            contentType: campaign.creative?.type || 'post',
            caption: campaign.creative?.captions || '',
            hashtags: campaign.creative?.hashtags || [],
            cta: campaign.creative?.callToAction || '',
            tone: campaign.tone || '',
            rawAnalytics: result.data,
            publishedAt: campaign.publishedAt
          });
        } else {
          console.warn(`[PerformanceTracker] getPostAnalytics failed for campaign ${campaign._id} (${platform}):`, result.error);
        }
      } catch (err) {
        console.warn(`[PerformanceTracker] Check failed for campaign ${campaign._id} (${platform}):`, err.message);
      }
      checked += 1;
    }

    // Record the checkpoint as done regardless of whether the Ayrshare call
    // succeeded — a transient API failure shouldn't cause this exact window
    // to be retried forever; the next checkpoint will still fire on schedule.
    await Campaign.updateOne(
      { _id: campaign._id },
      { $push: { performanceChecks: { checkpoint, checkedAt: now } } }
    );
  }

  return { checked, candidateCount: candidates.length };
}

function startPerformanceTrackerScheduler({ intervalMs = 60 * 60 * 1000, logger = console } = {}) {
  if (String(process.env.ENABLE_PERFORMANCE_TRACKER || 'true').toLowerCase() === 'false') {
    logger.log('[PerformanceTracker] Scheduler disabled via ENABLE_PERFORMANCE_TRACKER=false');
    return () => {};
  }
  logger.log(`[PerformanceTracker] Scheduler started (interval ${intervalMs}ms)`);
  const timer = setInterval(() => {
    runPerformanceTrackerOnce().catch((err) => logger.error('[PerformanceTracker] Scheduler error:', err));
  }, intervalMs);
  runPerformanceTrackerOnce().catch((err) => logger.error('[PerformanceTracker] Scheduler error:', err));
  return () => clearInterval(timer);
}

module.exports = {
  runPerformanceTrackerOnce,
  startPerformanceTrackerScheduler,
  CHECKPOINTS,
  dueCheckpoint,
  postTargets
};
```

- [ ] **Step 2: Verify syntax**

Run: `cd backend && node --check services/performanceTracker.js`
Expected: no output.

- [ ] **Step 3: Register the scheduler in server-main.js**

In `backend/server-main.js`, find:

```js
const { startContentCalendarScheduler } = require('./services/contentCalendarService');
```

Add right after it:

```js
const { startPerformanceTrackerScheduler } = require('./services/performanceTracker');
```

Then find:

```js
    // Start Gravity Smart Calendar scheduler for approved auto mode
    try {
      startContentCalendarScheduler();
    } catch (schedulerError) {
      console.warn('Content calendar scheduler failed to start:', schedulerError.message);
    }
```

Add right after it:

```js

    // Start automatic performance-tracking scheduler (24h/3d/7d/2w/1m checks)
    try {
      startPerformanceTrackerScheduler();
    } catch (schedulerError) {
      console.warn('Performance tracker scheduler failed to start:', schedulerError.message);
    }
```

- [ ] **Step 4: Verify syntax**

Run: `cd backend && node --check server-main.js`
Expected: no output.

- [ ] **Step 5: Live-verify the checkpoint logic against a real (backdated) campaign**

```bash
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Campaign = require('./models/Campaign');
  const User = require('./models/User');
  const user = await User.findOne({ 'ayrshare.profileKey': { \$exists: true, \$ne: null } }).lean();
  if (!user) { console.log('No user with a connected Ayrshare profile in this dev DB — cannot live-verify the Ayrshare call, but checkpoint math can still be checked (see below).'); }

  // Create a throwaway campaign backdated 25 hours (past the 24h checkpoint)
  const testUserId = user?._id || new mongoose.Types.ObjectId();
  const campaign = await Campaign.create({
    userId: testUserId,
    name: 'perf-tracker-verify',
    status: 'posted',
    publishedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    socialPostId: 'test-post-id-verify',
    platforms: ['instagram'],
    creative: { type: 'image', captions: 'test', hashtags: [], callToAction: '' }
  });
  console.log('Created test campaign:', campaign._id);

  const { dueCheckpoint, runPerformanceTrackerOnce } = require('./services/performanceTracker');
  console.log('dueCheckpoint result (expect 24h):', dueCheckpoint(campaign.toObject()));

  process.stdout.write('TESTCAMPAIGNID:' + campaign._id + '\\n');
  process.exit(0);
})();
" > /tmp/task6_out.txt
cat /tmp/task6_out.txt
CAMPAIGN_ID=$(grep TESTCAMPAIGNID: /tmp/task6_out.txt | cut -d: -f2)
echo "Test campaign: $CAMPAIGN_ID"
```

Expected: `dueCheckpoint result (expect 24h): 24h`. If a user with a connected Ayrshare profile exists, additionally run one real pass and confirm it either records a checkpoint or logs a clear failure (the `postId` is fake, so Ayrshare will legitimately reject it — that's fine, the goal here is confirming the plumbing runs end-to-end, not a real analytics result):

```bash
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const { runPerformanceTrackerOnce } = require('./services/performanceTracker');
  const result = await runPerformanceTrackerOnce({ limit: 5 });
  console.log('Run result:', JSON.stringify(result));
  const Campaign = require('./models/Campaign');
  const campaign = await Campaign.findById('$CAMPAIGN_ID').lean();
  console.log('performanceChecks after run:', JSON.stringify(campaign.performanceChecks));
  process.exit(0);
})();
"
```

Expected: `performanceChecks` now contains a `{ checkpoint: '24h', checkedAt: ... }` entry (recorded regardless of whether the fake postId's Ayrshare call succeeded, per the design).

- [ ] **Step 6: Clean up the test campaign**

```bash
CAMPAIGN_ID=$(grep TESTCAMPAIGNID: /tmp/task6_out.txt | cut -d: -f2)
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Campaign = require('./models/Campaign');
  await Campaign.deleteOne({ _id: '$CAMPAIGN_ID' });
  console.log('Deleted test campaign');
  process.exit(0);
})();
"
rm -f /tmp/task6_out.txt
```

- [ ] **Step 7: Commit**

```bash
git add backend/services/performanceTracker.js backend/server-main.js
git commit -m "$(cat <<'EOF'
Add automatic tiered performance tracking (24h/3d/7d/2w/1m)

Performance tracking used to only fire when a user manually opened a
specific post's analytics on the legacy Campaigns page — nothing
pulled it automatically, so 56 real Gravity drafts had generated zero
AIContentPerformance records. New hourly scheduler walks published
Campaigns and checks each one at 24h, 3 days, 7 days, 2 weeks, and 1
month after publish via the existing getPostAnalytics/trackPerformance
functions, then stops — bounded per run, with a kill switch
(ENABLE_PERFORMANCE_TRACKER=false) matching this project's other
schedulers.

Verified live: backdated a test campaign 25 hours, confirmed
dueCheckpoint() correctly identified the 24h window, ran the tracker
once, confirmed the checkpoint was recorded.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Distillation job (Layer 1 evidence → Layer 2 curated notes)

**Files:**
- Create: `backend/services/memoryDistillation.js`
- Modify: `backend/server-main.js` (register the weekly scheduler)

**Interfaces:**
- Consumes: `callTextLLM(prompt, options)` from `backend/services/openAI.js` (existing — `{ jsonMode: true, maxTokens, temperature, skipCache }`). `parseGeminiJSON(text)` from `backend/services/geminiAI.js` (existing).
- Produces: `distillMemoryForUser(userId, organizationId)` — runs one distillation pass for one account, returns the updated `learnedNotes` array or `null` if skipped (no new evidence). `startMemoryDistillationScheduler({ intervalMs, logger })` — weekly scheduler over all accounts with an `AIBrandMemory` doc, returns a stop function.

- [ ] **Step 1: Write the new file**

Create `backend/services/memoryDistillation.js`:

```js
/**
 * Distills Layer 1 evidence (AIContentPerformance + the AICampaignHistory/
 * AIVideoMemory records it references) into Layer 2: a small, curated,
 * human-readable set of notes on AIBrandMemory.learnedNotes. This is what
 * actually gets read into generation prompts and shown on the AI Memory
 * page — never the raw evidence log directly, the same way a MEMORY.md
 * file is legible where a raw event log isn't.
 *
 * Runs weekly (see startMemoryDistillationScheduler) and on-demand from the
 * AI Memory page's "Refresh now" button. Skips accounts with no new
 * evidence since the last run, to avoid pointless LLM spend.
 */

const AIBrandMemory = require('../models/AIBrandMemory');
const AIContentPerformance = require('../models/AIContentPerformance');
const AICampaignHistory = require('../models/AICampaignHistory');
const AIVideoMemory = require('../models/AIVideoMemory');
const { callTextLLM } = require('./openAI');
const { parseGeminiJSON } = require('./geminiAI');

const WINNER_LIMIT = 20;
const LOSER_LIMIT = 10;
const MAX_NOTES = 12;

const DISTILLATION_PROMPT = `
You are analyzing real social media performance data to extract a SMALL set
of specific, actionable patterns — not a summary of everything, only what
genuinely repeats across multiple posts or stands out clearly.

WINNING POSTS (high performance):
{{WINNERS}}

LOSING POSTS (low performance, for contrast):
{{LOSERS}}

EXISTING NOTES (update or drop these based on the new evidence above; don't
just append to them):
{{EXISTING_NOTES}}

Write up to ${MAX_NOTES} short notes, each a single plain-English sentence
stating a concrete pattern (e.g. "Carousel posts about pricing outperform
single posters", "Posts without a person in frame get more engagement this
quarter", "Illustration-style images outperform photo-realistic ones").
Only include a category "visual" note if the WINNING/LOSING posts' prompt
text actually supports it — do not guess at visual patterns with no textual
evidence. Drop any existing note that is contradicted by the new evidence.
Each note needs a category: one of copy, hashtags, cta, visual, timing,
format. Each note needs a confidence between 0 and 1 based on how much
evidence supports it (one post = low confidence, five+ consistent posts =
high confidence).

Return ONLY a JSON object shaped EXACTLY like this — a top-level object with
one key, "notes", holding the array. Do not use any other key name, and put
nothing else at the top level:
{
  "notes": [
    { "text": "...", "category": "copy", "confidence": 0.7 }
  ]
}
`;

function formatEvidenceForPrompt(performanceRecords) {
  return performanceRecords
    .map((p) => {
      const parts = [
        `- Score ${p.learning?.score ?? '?'} (${p.learning?.tier ?? '?'})`,
        p.caption ? `Caption: "${String(p.caption).slice(0, 200)}"` : '',
        p.hashtags?.length ? `Hashtags: ${p.hashtags.slice(0, 8).join(', ')}` : '',
        p.cta ? `CTA: "${p.cta}"` : '',
        p.contentType ? `Format: ${p.contentType}` : ''
      ].filter(Boolean);
      return parts.join(' | ');
    })
    .join('\n');
}

async function distillMemoryForUser(userId, organizationId) {
  const [winners, losers, brandMemory] = await Promise.all([
    AIContentPerformance.find({ organizationId, userId, 'learning.tier': { $in: ['high', 'winner'] } })
      .sort({ measuredAt: -1 }).limit(WINNER_LIMIT).lean(),
    AIContentPerformance.find({ organizationId, userId, 'learning.tier': 'low' })
      .sort({ measuredAt: -1 }).limit(LOSER_LIMIT).lean(),
    AIBrandMemory.findOne({ organizationId, userId }).lean()
  ]);

  if (!winners.length && !losers.length) return null; // nothing to learn from yet

  // Skip if nothing new has been measured since the last successful run —
  // bounds LLM cost instead of re-summarizing unchanged evidence weekly.
  const newestEvidence = [...winners, ...losers]
    .map((p) => new Date(p.measuredAt).getTime())
    .reduce((max, t) => Math.max(max, t), 0);
  const lastRun = brandMemory?.learnedNotesUpdatedAt ? new Date(brandMemory.learnedNotesUpdatedAt).getTime() : 0;
  if (newestEvidence <= lastRun) return null;

  const existingNotesText = (brandMemory?.learnedNotes || [])
    .map((n) => `- [${n.category}] ${n.text}`)
    .join('\n') || '(none yet)';

  const prompt = DISTILLATION_PROMPT
    .replace('{{WINNERS}}', formatEvidenceForPrompt(winners) || '(none)')
    .replace('{{LOSERS}}', formatEvidenceForPrompt(losers) || '(none)')
    .replace('{{EXISTING_NOTES}}', existingNotesText);

  const response = await callTextLLM(prompt, { jsonMode: true, temperature: 0.4, maxTokens: 2000, skipCache: true });
  const parsed = parseGeminiJSON(response);
  const rawNotes = Array.isArray(parsed?.notes) ? parsed.notes : [];

  const sourceIds = [...winners, ...losers].map((p) => p._id);
  const notes = rawNotes
    .filter((n) => n && typeof n.text === 'string' && n.text.trim())
    .slice(0, MAX_NOTES)
    .map((n) => ({
      text: n.text.trim(),
      category: ['copy', 'hashtags', 'cta', 'visual', 'timing', 'format'].includes(n.category) ? n.category : 'copy',
      sourceIds,
      confidence: Number.isFinite(Number(n.confidence)) ? Math.max(0, Math.min(1, Number(n.confidence))) : 0.5,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

  await AIBrandMemory.findOneAndUpdate(
    { organizationId, userId },
    { $set: { learnedNotes: notes, learnedNotesUpdatedAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return notes;
}

async function runDistillationOnce({ limit = 50 } = {}) {
  // Any account with an AIBrandMemory doc is a candidate — distillMemoryForUser
  // itself no-ops when there's no new evidence, so this doesn't need its own
  // "has this account been active" filter.
  const accounts = await AIBrandMemory.find({}).select('userId organizationId').limit(limit).lean();
  let distilled = 0;
  for (const acct of accounts) {
    try {
      const result = await distillMemoryForUser(acct.userId, acct.organizationId);
      if (result) distilled += 1;
    } catch (err) {
      console.warn(`[MemoryDistillation] Failed for user ${acct.userId}:`, err.message);
    }
  }
  return { accountsChecked: accounts.length, distilled };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function startMemoryDistillationScheduler({ intervalMs = WEEK_MS, logger = console } = {}) {
  if (String(process.env.ENABLE_MEMORY_DISTILLATION || 'true').toLowerCase() === 'false') {
    logger.log('[MemoryDistillation] Scheduler disabled via ENABLE_MEMORY_DISTILLATION=false');
    return () => {};
  }
  logger.log(`[MemoryDistillation] Scheduler started (interval ${intervalMs}ms)`);
  const timer = setInterval(() => {
    runDistillationOnce().catch((err) => logger.error('[MemoryDistillation] Scheduler error:', err));
  }, intervalMs);
  // Deliberately NOT run immediately on startup, unlike the other schedulers
  // — this one costs a real LLM call per account and a week-old server
  // restart shouldn't trigger an immediate re-run for everyone.
  return () => clearInterval(timer);
}

module.exports = {
  distillMemoryForUser,
  runDistillationOnce,
  startMemoryDistillationScheduler
};
```

- [ ] **Step 2: Verify syntax**

Run: `cd backend && node --check services/memoryDistillation.js`
Expected: no output.

- [ ] **Step 3: Register the scheduler in server-main.js**

In `backend/server-main.js`, find the line added in Task 6:

```js
const { startPerformanceTrackerScheduler } = require('./services/performanceTracker');
```

Add right after it:

```js
const { startMemoryDistillationScheduler } = require('./services/memoryDistillation');
```

Then find the block added in Task 6:

```js
    // Start automatic performance-tracking scheduler (24h/3d/7d/2w/1m checks)
    try {
      startPerformanceTrackerScheduler();
    } catch (schedulerError) {
      console.warn('Performance tracker scheduler failed to start:', schedulerError.message);
    }
```

Add right after it:

```js

    // Start weekly AI memory distillation scheduler
    try {
      startMemoryDistillationScheduler();
    } catch (schedulerError) {
      console.warn('Memory distillation scheduler failed to start:', schedulerError.message);
    }
```

- [ ] **Step 4: Verify syntax**

Run: `cd backend && node --check server-main.js`
Expected: no output.

- [ ] **Step 5: Live-verify against the real dev account with seeded evidence**

```bash
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('./models/User');
  const AIContentPerformance = require('./models/AIContentPerformance');
  const { resolveOrganizationId } = require('./services/aiMemoryService');

  const user = await User.findOne({}).sort({ createdAt: -1 }).lean();
  const organizationId = resolveOrganizationId({ user, userId: user._id });

  // Seed a few winners and a loser with a clear, checkable pattern
  const seeds = [
    { caption: 'Our new carousel breaks down pricing tier by tier', hashtags: ['#pricing','#value'], cta: 'Swipe to see plans', contentType: 'carousel', score: 82, tier: 'winner' },
    { caption: 'Another carousel walking through our pricing options', hashtags: ['#pricing'], cta: 'Swipe to compare', contentType: 'carousel', score: 75, tier: 'high' },
    { caption: 'Meet the founder in this candid photo post', hashtags: ['#founder'], cta: 'Learn more', contentType: 'post', score: 8, tier: 'low' }
  ];
  const created = [];
  for (const s of seeds) {
    const doc = await AIContentPerformance.create({
      organizationId, userId: user._id, postId: 'seed-' + Math.random().toString(36).slice(2),
      platform: 'instagram', contentType: s.contentType, caption: s.caption, hashtags: s.hashtags, cta: s.cta,
      learning: { score: s.score, tier: s.tier, learnedAt: new Date() }, measuredAt: new Date()
    });
    created.push(doc._id);
  }
  console.log('Seeded IDs:', created.join(','));
  console.log('USERID:' + user._id);
  console.log('ORGID:' + organizationId);
  process.exit(0);
})();
" > /tmp/task7_seed.txt
cat /tmp/task7_seed.txt
```

```bash
USERID=$(grep USERID: /tmp/task7_seed.txt | cut -d: -f2)
ORGID=$(grep ORGID: /tmp/task7_seed.txt | cut -d: -f2)
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const { distillMemoryForUser } = require('./services/memoryDistillation');
  const notes = await distillMemoryForUser('$USERID', '$ORGID');
  console.log('Distilled notes:', JSON.stringify(notes, null, 2));
  process.exit(0);
})();
"
```

Expected: a non-null array of notes, and at least one note referencing the carousel/pricing pattern the seeded data was designed to surface (confirming the LLM is actually reasoning over the evidence, not returning boilerplate).

- [ ] **Step 6: Clean up seeded test data**

```bash
SEED_IDS=$(grep "Seeded IDs:" /tmp/task7_seed.txt -A0 | sed 's/Seeded IDs: //')
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const AIContentPerformance = require('./models/AIContentPerformance');
  const ids = '$SEED_IDS'.split(',').filter(Boolean);
  const res = await AIContentPerformance.deleteMany({ _id: { \$in: ids } });
  console.log('Deleted', res.deletedCount, 'seeded records');
  const AIBrandMemory = require('./models/AIBrandMemory');
  const USERID = '$(grep USERID: /tmp/task7_seed.txt | cut -d: -f2)';
  await AIBrandMemory.updateOne({ userId: USERID }, { \$set: { learnedNotes: [], learnedNotesUpdatedAt: null } });
  console.log('Reset learnedNotes for test account');
  process.exit(0);
})();
"
rm -f /tmp/task7_seed.txt
```

- [ ] **Step 7: Commit**

```bash
git add backend/services/memoryDistillation.js backend/server-main.js
git commit -m "$(cat <<'EOF'
Add weekly memory distillation job — Layer 1 evidence into curated notes

The raw AIContentPerformance/AICampaignHistory log was never
summarized into anything legible — the AI Memory page just dumped raw
counts and a top-8 list. This adds an LLM distillation pass that reads
recent winning/losing posts and writes a small, capped set of
plain-English notes to AIBrandMemory.learnedNotes (replacing/merging,
not endlessly appending), skipping accounts with no new evidence since
the last run to bound LLM cost. Runs weekly and on-demand (wired to
the AI Memory page's Refresh button in a later task).

Follows the same fixed-wrapper-key JSON contract fix applied to the
Smart Calendar generation earlier this session — the prompt requests
{"notes": [...]} explicitly rather than a bare array, since OpenAI's
JSON mode forces a top-level object regardless.

Verified live: seeded three AIContentPerformance records (two winning
carousel/pricing posts, one losing founder-photo post), ran
distillMemoryForUser() directly, confirmed it produced a note
correctly identifying the carousel/pricing pattern.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Read path — `buildBrandMemoryBlock()` reads learned notes

**Files:**
- Modify: `backend/services/brandMemory.js`

**Interfaces:**
- Consumes: `AIBrandMemory` model (already required elsewhere in the codebase; not currently imported in `brandMemory.js`).
- Produces: no signature change to `buildBrandMemoryBlock(userId)` — same input, same return type (a string). The returned string gains a new section when learned notes exist.

This is the one function every real Gravity generation path already calls (`backgroundQueue.js`'s content-writing pass, `creativeDirector.js`, `contentCalendarService.js` — confirmed earlier this session when calendar generation was wired to it), so no other call site needs to change for the read path to reach every generation.

- [ ] **Step 1: Add the import and the new section**

In `backend/services/brandMemory.js`, find the imports at the top:

```js
const User = require('../models/User');
const Product = require('../models/Product');
const BrandAsset = require('../models/BrandAsset');
const BrandIntelligenceProfile = require('../models/BrandIntelligenceProfile');
```

Add:

```js
const AIBrandMemory = require('../models/AIBrandMemory');
```

Then find the end of `buildBrandMemoryBlock`, specifically this block:

```js
  lines.push('');
  lines.push('PEOPLE (founders, team, customers)');
  lines.push('- Not yet supported in Gravity. Do not depict a specific real founder, team member or customer — if a person is needed, keep them generic and unbranded.');

  return lines.join('\n');
}
```

Replace it with:

```js
  lines.push('');
  lines.push('PEOPLE (founders, team, customers)');
  lines.push('- Not yet supported in Gravity. Do not depict a specific real founder, team member or customer — if a person is needed, keep them generic and unbranded.');

  // Layer 2 of the AI memory system: a small, curated set of patterns
  // distilled from real published-post performance (see
  // services/memoryDistillation.js). Deliberately the ONLY memory-derived
  // content read into generation — never the raw performance log directly.
  const learnedMemory = await AIBrandMemory.findOne({ userId }).select('learnedNotes').lean();
  const notes = (learnedMemory?.learnedNotes || [])
    .slice()
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
    .slice(0, 10);
  if (notes.length) {
    lines.push('');
    lines.push("WHAT'S WORKED BEFORE (learned from published post performance)");
    notes.forEach((n) => lines.push(`- ${n.text}`));
  }

  return lines.join('\n');
}
```

- [ ] **Step 2: Verify syntax**

Run: `cd backend && node --check services/brandMemory.js`
Expected: no output.

- [ ] **Step 3: Live-verify the new section appears when notes exist**

```bash
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('./models/User');
  const AIBrandMemory = require('./models/AIBrandMemory');
  const { resolveOrganizationId } = require('./services/aiMemoryService');
  const user = await User.findOne({}).sort({ createdAt: -1 }).lean();
  const organizationId = resolveOrganizationId({ user, userId: user._id });

  await AIBrandMemory.findOneAndUpdate(
    { organizationId, userId: user._id },
    { \$set: { learnedNotes: [{ text: 'VERIFY-TASK8: carousels about pricing outperform single posters', category: 'format', confidence: 0.8, createdAt: new Date(), updatedAt: new Date() }] } },
    { upsert: true }
  );

  const { buildBrandMemoryBlock } = require('./services/brandMemory');
  const block = await buildBrandMemoryBlock(user._id);
  console.log(block.includes('VERIFY-TASK8') ? 'PASS: note appears in block' : 'FAIL: note missing from block');
  console.log('---');
  console.log(block.split(\"WHAT'S WORKED\")[1] || '(section not found)');
  process.exit(0);
})();
"
```

Expected: `PASS: note appears in block`, and the printed section shows the `WHAT'S WORKED BEFORE` heading followed by the seeded note text.

- [ ] **Step 4: Clean up the seeded note**

```bash
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('./models/User');
  const AIBrandMemory = require('./models/AIBrandMemory');
  const user = await User.findOne({}).sort({ createdAt: -1 }).lean();
  await AIBrandMemory.updateOne({ userId: user._id }, { \$set: { learnedNotes: [] } });
  console.log('Cleared test note');
  process.exit(0);
})();
"
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/brandMemory.js
git commit -m "$(cat <<'EOF'
Read learned patterns into every real generation prompt

buildBrandMemoryBlock() is the one function every Gravity generation
path already calls (single post, campaign, calendar item). Adds a
"WHAT'S WORKED BEFORE" section reading AIBrandMemory.learnedNotes
(Layer 2, from the new distillation job) — the curated notes, never
the raw performance log — so real published-post performance can
finally influence what gets generated next.

Verified live: seeded a test note, confirmed buildBrandMemoryBlock()
includes it in its output; cleared the test note afterward.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Backend API — edit/delete notes and manual distill trigger

**Files:**
- Modify: `backend/routes/aiMemory.js`

**Interfaces:**
- Produces: `PATCH /api/ai-memory/notes/:noteId` (body: `{ text?, category? }`) — edits one learned note. `DELETE /api/ai-memory/notes/:noteId` — removes one learned note. `POST /api/ai-memory/distill` — runs `distillMemoryForUser` for the requesting user immediately, returns the updated notes.

- [ ] **Step 1: Add the three new routes**

In `backend/routes/aiMemory.js`, `AIBrandMemory` is already imported at line 5 (`const AIBrandMemory = require('../models/AIBrandMemory');`) — do not add a duplicate. Add only this new import, alongside the existing ones:

```js
const { distillMemoryForUser } = require('../services/memoryDistillation');
```

Then add these three routes, right after the existing `router.post('/reuse/:type/:id', ...)` block (before `module.exports`):

```js
router.patch('/notes/:noteId', protect, async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const organizationId = resolveOrganizationId({ user: req.user, userId });
    const { text, category } = req.body || {};

    const setFields = {};
    if (typeof text === 'string' && text.trim()) setFields['learnedNotes.$.text'] = text.trim();
    if (['copy', 'hashtags', 'cta', 'visual', 'timing', 'format'].includes(category)) {
      setFields['learnedNotes.$.category'] = category;
    }
    if (!Object.keys(setFields).length) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }
    setFields['learnedNotes.$.updatedAt'] = new Date();

    const updated = await AIBrandMemory.findOneAndUpdate(
      { organizationId, userId, 'learnedNotes._id': req.params.noteId },
      { $set: setFields },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }
    const note = updated.learnedNotes.find((n) => String(n._id) === req.params.noteId);
    res.json({ success: true, note });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update note', error: error.message });
  }
});

router.delete('/notes/:noteId', protect, async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const organizationId = resolveOrganizationId({ user: req.user, userId });
    const updated = await AIBrandMemory.findOneAndUpdate(
      { organizationId, userId },
      { $pull: { learnedNotes: { _id: req.params.noteId } } },
      { new: true }
    ).lean();
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Memory not found' });
    }
    res.json({ success: true, learnedNotes: updated.learnedNotes || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete note', error: error.message });
  }
});

router.post('/distill', protect, async (req, res) => {
  try {
    const userId = userIdFromReq(req);
    const organizationId = resolveOrganizationId({ user: req.user, userId });
    const notes = await distillMemoryForUser(userId, organizationId);
    if (notes === null) {
      const existing = await AIBrandMemory.findOne({ organizationId, userId }).select('learnedNotes learnedNotesUpdatedAt').lean();
      return res.json({
        success: true,
        skipped: true,
        message: 'No new performance data since the last update.',
        learnedNotes: existing?.learnedNotes || [],
        learnedNotesUpdatedAt: existing?.learnedNotesUpdatedAt || null
      });
    }
    res.json({ success: true, skipped: false, learnedNotes: notes });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to refresh memory', error: error.message });
  }
});
```

- [ ] **Step 2: Verify syntax**

Run: `cd backend && node --check routes/aiMemory.js`
Expected: no output.

- [ ] **Step 3: Live-verify all three routes against the real dev account**

```bash
node -e "
require('dotenv').config();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('./models/User');
  const AIBrandMemory = require('./models/AIBrandMemory');
  const { resolveOrganizationId } = require('./services/aiMemoryService');
  const user = await User.findOne({}).sort({ createdAt: -1 }).lean();
  const organizationId = resolveOrganizationId({ user, userId: user._id });
  const mem = await AIBrandMemory.findOneAndUpdate(
    { organizationId, userId: user._id },
    { \$set: { learnedNotes: [{ text: 'ROUTE-TEST original text', category: 'copy', confidence: 0.5, createdAt: new Date(), updatedAt: new Date() }] } },
    { upsert: true, new: true }
  );
  console.log('NOTEID:' + mem.learnedNotes[0]._id);
  console.log('TOKEN:' + jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' }));
  process.exit(0);
})();
" > /tmp/task9_creds.txt
TOKEN=$(grep TOKEN: /tmp/task9_creds.txt | cut -d: -f2-)
NOTE_ID=$(grep NOTEID: /tmp/task9_creds.txt | cut -d: -f2)

echo "--- PATCH ---"
curl -s -X PATCH "http://localhost:5000/api/ai-memory/notes/$NOTE_ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"ROUTE-TEST edited text"}'
echo
echo "--- DELETE ---"
curl -s -X DELETE "http://localhost:5000/api/ai-memory/notes/$NOTE_ID" \
  -H "Authorization: Bearer $TOKEN"
echo
echo "--- POST /distill (expect skipped:true — no new AIContentPerformance evidence was added in this test) ---"
curl -s -X POST "http://localhost:5000/api/ai-memory/distill" \
  -H "Authorization: Bearer $TOKEN"
echo
```

Expected: PATCH response's `note.text` is `"ROUTE-TEST edited text"`; DELETE response's `learnedNotes` array no longer contains that note; POST `/distill` returns `success: true` (with `skipped: true` unless real new evidence happens to exist for this account).

- [ ] **Step 4: Clean up**

```bash
rm -f /tmp/task9_creds.txt
```

(The note was already deleted by the DELETE call above.)

- [ ] **Step 5: Commit**

```bash
git add backend/routes/aiMemory.js
git commit -m "$(cat <<'EOF'
Add edit/delete/distill-now routes for curated AI memory notes

PATCH and DELETE /api/ai-memory/notes/:noteId let a user correct or
remove a learned note directly — the same trust model as editing a
memory file. POST /api/ai-memory/distill triggers an immediate
distillation pass instead of waiting for the weekly schedule, wired to
the AI Memory page's "Refresh now" button in the next task.

Verified live: PATCH'd a seeded note's text, confirmed it changed;
DELETE'd it, confirmed it was removed; called /distill and confirmed
it responds correctly whether or not there's new evidence to act on.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Frontend — AI Memory page redesign

**Files:**
- Modify: `frontend/pages/AIMemory.tsx`
- Modify: `frontend/services/api.ts` (extend `aiMemoryAPI`)

**Interfaces:**
- Consumes: `aiMemoryAPI.getSummary()` (existing, unchanged response shape — `data.brandMemory.learnedNotes` and `data.brandMemory.learnedNotesUpdatedAt` are now populated per Task 1/7/9, no backend response-shape change needed since `/summary` already returns the full `brandMemory` object).
- Produces: `aiMemoryAPI.updateNote(noteId, updates)`, `aiMemoryAPI.deleteNote(noteId)`, `aiMemoryAPI.distillNow()` in `frontend/services/api.ts`.

- [ ] **Step 1: Add the three new API functions**

In `frontend/services/api.ts`, find the end of `aiMemoryAPI`:

```js
export const aiMemoryAPI = {
  getSummary: async (platform?: string): Promise<any> => {
```

Find where this object's closing brace is (search for `reuseMemory` inside it, then the next `};`), and add these three functions right before that closing `};`:

```ts
  updateNote: async (noteId: string, updates: { text?: string; category?: string }): Promise<any> => {
    return apiCall<any>(`/ai-memory/notes/${encodeURIComponent(noteId)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    }, true);
  },

  deleteNote: async (noteId: string): Promise<any> => {
    return apiCall<any>(`/ai-memory/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' }, true);
  },

  distillNow: async (): Promise<any> => {
    return apiCall<any>('/ai-memory/distill', { method: 'POST' }, true);
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep "services/api"`
Expected: no output.

- [ ] **Step 3: Rewrite AIMemory.tsx to show curated notes instead of stat cards**

Replace the entire contents of `frontend/pages/AIMemory.tsx` with:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brain, Pencil, Trash2, RefreshCw, Loader2, ArrowRight, Check, X } from 'lucide-react';
import { aiMemoryAPI } from '../services/api';
import {
  GravityHero,
  GravityEmphasis,
  GravityLabel,
  GravityButton,
} from '../components/gravity';

type LearnedNote = {
  _id: string;
  text: string;
  category: 'copy' | 'hashtags' | 'cta' | 'visual' | 'timing' | 'format';
  confidence: number;
  updatedAt?: string;
  createdAt?: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  copy: 'Copy',
  hashtags: 'Hashtags',
  cta: 'Calls to action',
  visual: 'Visual style',
  timing: 'Timing',
  format: 'Format'
};

const Panel: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <section className={`rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 ${className}`}>{children}</section>
);

const NoteRow: React.FC<{
  note: LearnedNote;
  onSave: (id: string, text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}> = ({ note, onSave, onDelete }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!draft.trim() || draft.trim() === note.text) { setEditing(false); return; }
    setBusy(true);
    try {
      await onSave(note._id, draft.trim());
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-white/[0.05] last:border-b-0">
      <span className="mt-0.5 inline-flex items-center rounded-full border border-[#F5A623]/25 bg-[#F5A623]/[0.08] px-2 py-0.5 text-[10.5px] font-semibold text-[#F5A623] flex-shrink-0">
        {CATEGORY_LABELS[note.category] || note.category}
      </span>
      {editing ? (
        <div className="flex-1 flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="flex-1 px-2.5 py-1.5 rounded-md bg-black/30 border border-white/[0.10] text-[13px] text-[#F5F4F1] outline-none focus:border-[#F5A623]/40"
            autoFocus
          />
          <button onClick={save} disabled={busy} className="p-1.5 rounded-md text-emerald-400 hover:bg-white/[0.06] disabled:opacity-40">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => { setDraft(note.text); setEditing(false); }} className="p-1.5 rounded-md text-white/40 hover:bg-white/[0.06]">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <>
          <p className="flex-1 text-[13px] text-[#F5F4F1] leading-relaxed">{note.text}</p>
          <button onClick={() => setEditing(true)} className="p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/[0.06] flex-shrink-0">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(note._id)} className="p-1.5 rounded-md text-white/40 hover:text-red-400 hover:bg-white/[0.06] flex-shrink-0">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  );
};

const AIMemory: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [distilling, setDistilling] = useState(false);
  const [data, setData] = useState<any>(null);
  const [statusMsg, setStatusMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await aiMemoryAPI.getSummary();
      setData(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const notes: LearnedNote[] = useMemo(() => data?.brandMemory?.learnedNotes || [], [data]);
  const notesUpdatedAt: string | null = data?.brandMemory?.learnedNotesUpdatedAt || null;
  const performanceCount: number = data?.summary?.performanceMemories || 0;

  const saveNote = async (id: string, text: string) => {
    await aiMemoryAPI.updateNote(id, { text });
    await load();
  };

  const deleteNote = async (id: string) => {
    await aiMemoryAPI.deleteNote(id);
    await load();
  };

  const refreshNow = async () => {
    setDistilling(true);
    setStatusMsg('');
    try {
      const res = await aiMemoryAPI.distillNow();
      setStatusMsg(res.skipped ? 'No new performance data since the last update.' : 'Updated with the latest performance data.');
      await load();
    } catch (err: any) {
      setStatusMsg(err?.message || 'Could not refresh.');
    } finally {
      setDistilling(false);
      window.setTimeout(() => setStatusMsg(''), 4000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#F5A623]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <GravityHero
          align="left"
          eyebrow="AI Memory"
          headline={<>What Gravity has <GravityEmphasis>learned</GravityEmphasis></>}
          subcopy="A small, curated set of patterns learned from your real published-post performance — not a raw log."
          className="!mb-0"
        />
        <GravityButton variant="ghost" onClick={refreshNow} disabled={distilling} className="flex-shrink-0">
          {distilling ? <Loader2 className="w-4 h-4 animate-spin text-[#F5A623]" /> : <RefreshCw className="w-4 h-4 text-[#F5A623]" />}
          Refresh now
        </GravityButton>
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-[12.5px] text-white/70">
          {statusMsg}
        </div>
      )}

      <Panel>
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-[#F5A623]" />
            <GravityLabel gold>Learned patterns</GravityLabel>
          </div>
          <span className="text-[11px] text-white/40">
            Based on {performanceCount} tracked post{performanceCount === 1 ? '' : 's'}
            {notesUpdatedAt ? ` · last updated ${new Date(notesUpdatedAt).toLocaleDateString()}` : ''}
          </span>
        </div>
        {notes.length ? (
          <div className="mt-3">
            {notes.map((note) => (
              <NoteRow key={note._id} note={note} onSave={saveNote} onDelete={deleteNote} />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-white/45">
            Nothing learned yet — this fills in once enough published posts have been tracked
            for at least a few days. Try "Refresh now" after some posts have been live for a while.
          </p>
        )}
      </Panel>

      <div className="grid gap-3 md:grid-cols-3">
        {[
          { to: '/ai-history', label: 'Campaign history' },
          { to: '/ai-history?type=video', label: 'Video history' },
          { to: '/ai-performance', label: 'Performance log' },
        ].map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="group flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-4 text-[13.5px] font-semibold text-[#F5F4F1] transition-all hover:bg-white/[0.05] hover:border-white/[0.12]"
          >
            {link.label}
            <ArrowRight className="w-4 h-4 text-white/30 group-hover:text-[#F5A623] transition-colors" />
          </Link>
        ))}
      </div>
    </div>
  );
};

export default AIMemory;
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep "AIMemory.tsx"`
Expected: no output.

- [ ] **Step 5: Live-verify in the browser**

Start the dev server (check `lsof -ti:5000 -sTCP:LISTEN` / the frontend's dev port first — this project has had multiple concurrent sessions sharing dev servers; don't blindly kill a port you don't own). Navigate to `/ai-memory`. Seed a test note the same way Task 9's Step 3 did, reload the page, and confirm:
- The note appears under "Learned patterns" with its category badge.
- Clicking the pencil icon lets you edit the text inline; saving persists (reload the page and confirm it stuck).
- Clicking the trash icon removes it (reload and confirm it's gone).
- "Refresh now" shows a spinner, then a status message, without a page error.

Clean up any test note left over the same way Task 9 did.

- [ ] **Step 6: Commit**

```bash
git add frontend/pages/AIMemory.tsx frontend/services/api.ts
git commit -m "$(cat <<'EOF'
Redesign AI Memory page around curated notes instead of raw stat cards

The old page surfaced raw counts ("8 campaign memories") and a top-8
dump — illegible, and disconnected from what the user actually
generates day to day (confirmed: 56 real Gravity drafts, 0 performance
records, all while this page showed leftover legacy-page stats).
Replaces it with the curated learnedNotes list from the new
distillation job (Task 7) — editable and deletable inline, the same
trust model as correcting a memory file — plus a status line and a
manual "Refresh now" that triggers distillation on demand.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes (completed during plan authoring)

- **Spec coverage:** every component in the spec's "Components" section (remember hooks, performance tracker, distillation job, read path, AI Memory page) maps to a task (3-4, 6, 7, 8, 10 respectively); Task 1/2 are the model prerequisites; Task 9 is the API surface the frontend task needs, factored out since it's independently testable.
- **Placeholder scan:** no TBD/TODO; the one place a step's outcome depends on dev-environment state (Task 5 Step 3's "if a completed video job exists," Task 6 Step 5's "if a user with a connected Ayrshare profile exists") is an honest conditional on real data availability, not a deferred decision — each branch has a concrete, complete action.
- **Type/name consistency:** `rememberCampaignGeneration`/`rememberVideoGeneration`/`trackPerformance` signatures used in Tasks 3/4/5/6 match `aiMemoryService.js`'s actual exports (read directly from the file, not assumed). `learnedNotes`/`learnedNotesUpdatedAt` field names are identical across Tasks 1, 7, 8, 9, 10. `distillMemoryForUser(userId, organizationId)` signature is consistent between Task 7 (definition) and Task 9 (route usage).
