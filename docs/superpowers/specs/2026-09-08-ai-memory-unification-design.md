# AI Memory Unification — Design

## Problem

Nebulaa Gravity has a fully-built AI memory/learning system — `AIBrandMemory`,
`AICampaignHistory`, `AIVideoMemory`, `AIContentPerformance`, plus the
services that write and read them (`aiMemoryService.js`,
`aiCampaignLearning.js`, `aiVideoLearning.js`, `aiPerformanceTracker.js`,
`aiContextBuilder.js`). On paper it's a real feedback loop: generate →
remember → track published performance → learn winning patterns → feed them
back into future prompts.

In practice it is wired only into the legacy "classic" pages — `Campaigns.tsx`
(`/analytics-classic`), Products, and the old video generator — none of which
are in the active sidebar navigation. The actual product the user runs
day-to-day (GravityCreate, GravityApprove, the Smart Calendar, GravityInsights,
`backgroundQueue.js`, `creativeDirector.js`, `contentCalendarService.js`) uses
a separate, simpler, non-learning context assembler (`brandMemory.js` →
`buildBrandMemoryBlock()`) that reads static profile/product/asset data only.
It never reads from or writes to the memory system at all.

Confirmed against the live dev account (user `69ac31a91233351e41fe0945`,
Nebulaa.ai):

| | Count |
|---|---|
| Real Drafts generated via Gravity (actual usage) | 56 |
| `AIContentPerformance` records (performance ever learned from) | 0 |
| `AICampaignHistory` / `AIVideoMemory` (legacy page leftovers) | 8 / 11 |

Performance tracking currently only fires when a user manually opens a
specific post's analytics on the legacy Campaigns page and triggers
`POST /api/analytics/post-analytics` — nothing pulls it automatically. The
periodic analytics scheduler (`snapshotScheduler.js`, every 12h) only pulls
account-level aggregate stats for the dashboard, never per-post metrics, and
never touches the memory models.

Additionally, the AI Memory page (`frontend/pages/AIMemory.tsx`) surfaces raw
counts and a "top 8 by score" dump — which the user experiences as cluttered
and illegible, independent of the wiring problem.

## Goals

1. Real Gravity generations (post/campaign/carousel/reel/calendar item) get
   remembered, the same way legacy generations already do.
2. Published posts get their performance tracked automatically — no manual
   per-post click required.
3. Winning patterns (copy, hashtags, CTAs, and — from prompt text, see
   "Design/visual learning" below — visual style) feed back into future
   generation prompts.
4. What the system has "learned" is legible: a small, curated, human-readable
   set of notes — not a growing pile of raw records — the same way a
   `MEMORY.md` file is legible where a raw event log isn't.
5. The legacy pages keep working unchanged; this design adds Gravity as a
   second writer/reader into the same underlying models, and does not touch
   the legacy write paths.

## Non-goals (v1)

- Vision-model analysis of the actual rendered images (only prompt-text-based
  visual pattern learning is in scope — see below). Flagged explicitly as a
  future enhancement.
- Migrating or rewiring the legacy Campaigns/Products/VideoGeneration pages
  onto a new shared write path. They keep calling
  `rememberCampaignGeneration`/`rememberVideoGeneration`/`trackPerformance`
  exactly as they do today.
- Cross-account or cross-organization learning. Memory stays scoped to
  `{organizationId, userId}` exactly as the existing models already do.

## Design/visual learning (text-based, v1)

The system cannot currently analyze a rendered image's actual pixels. What it
does have, per generated post, is the resolved image/video prompt text
(`imagePromptResolved` / `creativeConcept` / `visualTreatment`) and the format
(poster/carousel/reel/story) — real design intent, described in words, already
stored per generation. The distillation step (below) includes this text
alongside captions/hashtags/CTAs when summarizing winners vs. losers, so
patterns like "illustration style outperforms photo-realistic" or "single-subject
posters outperform busy scenes" can be extracted the same way copy patterns
are. This requires no new API capability.

**Future enhancement (explicitly out of scope for this design):** a
vision-model pass over actual winning images to extract objective visual
descriptors (palette, composition, presence of people) rather than trusting
prompt text, which can drift from what the model actually rendered.

## Architecture

Two layers:

**Layer 1 — Evidence.** The existing models, unchanged in shape:
`AICampaignHistory`, `AIVideoMemory` (what was generated),
`AIContentPerformance` (how a specific published post performed). Gravity's
generation paths become a second writer into these, fire-and-forget,
alongside the legacy pages' existing writes.

**Layer 2 — Curated memory notes (new).** A capped, human-readable list of
plain-English notes on `AIBrandMemory`:

```js
learnedNotes: [{
  text: String,        // "Carousel posts about pricing outperform single posters"
  category: String,    // 'copy' | 'hashtags' | 'cta' | 'visual' | 'timing' | 'format'
  sourceIds: [ObjectId], // AIContentPerformance docs this note was derived from
  confidence: Number,   // 0-1, informal — more/stronger evidence = higher
  createdAt: Date,
  updatedAt: Date
}]
```

Written by a periodic LLM distillation pass, not on every generation. This is
the layer that's actually read into prompts and shown on the AI Memory page —
never the raw Layer 1 log directly.

## Components

### 1. Remember hooks (write, Layer 1)

Fire-and-forget calls added at Gravity's three generation points, reusing the
existing functions unchanged:

- `backgroundQueue.js` — after a successful single-post or campaign image job
  completes, call `rememberCampaignGeneration({...})`.
- `backgroundQueue.js` reel/video path (if/when reels route through here) or
  wherever reel generation currently completes — call
  `rememberVideoGeneration({...})`.
- `contentCalendarService.js`'s `createDraftsForItem()` — call
  `rememberCampaignGeneration({...})` for the calendar-originated draft.

Each call is wrapped so a failure is logged and swallowed, never surfaced to
the user or allowed to fail the generation itself — matching
`rememberCampaignGeneration`'s own existing internal try/catch, and the
"deliberately not awaited" pattern already used for calendar cover generation.

### 2. Performance tracker job (write, Layer 1)

New scheduled job, `services/performanceTracker.js` (or similar), separate
from `snapshotScheduler.js` (that one is tuned for 12h account-level dashboard
aggregates; this one is per-post and event-driven off publish time).

Checkpoints: 24h, 3 days, 7 days, 2 weeks, 1 month after `publishedAt`, then
stop — no further checks past 1 month.

Needs a way to track which checkpoints have already run per post, to avoid
re-checking the same window twice. Add to `Campaign`:

```js
performanceChecks: [{
  checkpoint: String,  // '24h' | '3d' | '7d' | '2w' | '1m'
  checkedAt: Date
}]
```

Each scheduler tick (e.g. hourly): find `Campaign` docs with `status: 'posted'`
and a `socialPostId`/`socialPostIds`, compute which checkpoints are now due
(elapsed time since `publishedAt` has passed the checkpoint's threshold and it
isn't in `performanceChecks` yet), cap the batch size per run to bound
Ayrshare API cost, call `getPostAnalytics` per due post, then
`trackPerformance` with the result (existing function, unchanged) and record
the checkpoint as done.

### 3. Distillation job (Layer 1 → Layer 2)

New weekly scheduled job, plus a manual trigger from the AI Memory page's
"Refresh" button (already exists in the UI, currently just re-fetches — will
also invoke this job on demand).

Skips entirely if there's no new `AIContentPerformance` evidence since the
last distillation run (bound LLM cost — no pointless re-summarization).

Otherwise: pulls recent `AIContentPerformance` docs (winners: tier `high`/
`winner`; losers: tier `low`, for contrast), joined to their source
`AICampaignHistory`/`AIVideoMemory` for caption/hashtag/CTA/prompt text and
format. Sends this to an LLM with instructions to produce an updated
`learnedNotes` list — replacing/merging with the existing list, not just
appending forever (stale or contradicted notes get dropped, not accumulated).

### 4. Read path (Layer 2 → generation prompts)

`brandMemory.js`'s `buildBrandMemoryBlock()` gains a new section reading
`AIBrandMemory.learnedNotes` (top ~10 by recency/confidence, capped text
length), appended after the existing brand-facts sections ("BRAND IDENTITY",
"PRODUCTS AND SERVICES", etc.) as something like:

```
WHAT'S WORKED BEFORE (learned from published post performance)
- Carousel posts about pricing outperform single posters
- ...
```

Since every real Gravity generation path already calls this one function, no
other call site needs to change.

### 5. AI Memory page (frontend)

`frontend/pages/AIMemory.tsx` replaces the stat-card-heavy layout with:

- The curated notes list, grouped by category, each editable inline and
  deletable (a user correcting or removing a wrong note — same trust model as
  editing a memory file).
- A small status line: "Based on N tracked posts · last updated <date>".
- A "Refresh now" button that triggers the distillation job on demand
  (replacing its current behavior of just re-fetching the same stale data).

The existing links to campaign/video history and performance stay as
secondary/detail views (Layer 1 access for anyone who wants the raw log), not
the primary view.

## Data flow (one full cycle)

```
Generate (Gravity) → remember (Layer 1, fire-and-forget)
  → publish → Campaign.socialPostId stored
    → tracker checks at 24h/3d/7d/2w/1m → AIContentPerformance written (Layer 1)
      → weekly distillation reads recent Layer 1 → updates learnedNotes (Layer 2)
        → next generation's buildBrandMemoryBlock() reads Layer 2
          → AI Memory page shows Layer 2
```

## Error handling & cost control

- All Layer 1 writes from Gravity are fire-and-forget with caught/logged
  errors — memory failures never block generation or publishing.
- The tracker job caps posts checked per run to bound Ayrshare API calls.
- The distillation job no-ops when there's no new evidence since its last
  run, bounding LLM cost.
- `buildBrandMemoryBlock()`'s new section degrades gracefully (empty/omitted)
  if `AIBrandMemory` doesn't exist yet or has no notes — matches its existing
  "state emptiness honestly" pattern for other categories.

## Testing / verification plan

Live-verify each piece against the real dev account, the same way the
calendar fix was verified:

1. Generate a real post through Gravity; confirm an `AICampaignHistory`
   record appears for it.
2. Manually backdate a test `Campaign`'s `publishedAt` to cross a checkpoint
   threshold, run the tracker job once, confirm `AIContentPerformance` gets
   written and the checkpoint is recorded.
3. Seed a few `AIContentPerformance` winners/losers, run the distillation job
   once, confirm `learnedNotes` reads as sensible, grounded text (not
   hallucinated).
4. Generate a fresh post and confirm its prompt actually contains the new
   "WHAT'S WORKED BEFORE" section with real note text.
5. Load the AI Memory page and confirm it shows the curated notes, not the
   old stat cards; confirm edit/delete on a note persists; confirm "Refresh
   now" triggers distillation.

## Open questions for implementation planning

- Exact LLM prompt for the distillation pass (what counts as "enough
  evidence" to write a note, how many notes to cap the list at) — left to the
  implementation plan rather than pinned here.
- Whether `performanceChecks` lives on `Campaign` directly or a separate
  lightweight tracking collection — small enough to decide during
  implementation.
