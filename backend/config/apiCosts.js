/**
 * What each AI action actually costs us, and what we therefore charge in Quarks.
 *
 * This file exists because the old Quark prices were invented, not derived:
 * a single image was 5, a whole carousel was 7, and a whole video was 7 —
 * even though a carousel renders one image per slide and a video renders an
 * image AND a Kling clip AND narration per scene. We were charging roughly
 * the same for jobs whose real costs differ by 20x.
 *
 * Everything below flows one way:
 *
 *     PROVIDER_RATES  ->  ACTION_USD  ->  QUARK_COSTS
 *     (what vendors        (cost of      (what the user
 *      charge us)          one unit)      is charged)
 *
 * So correcting a vendor price in one place reprices the product correctly.
 * Nothing downstream hardcodes a Quark number.
 *
 * !! THE RATES BELOW ARE THE PART THAT GOES STALE. !!
 * They are list prices as understood in early 2026 and NOT scraped live.
 * Check them against the actual invoices before a pricing change goes out;
 * every one is annotated with what it is and how it is billed.
 */

// ---------------------------------------------------------------------------
// 1. What the vendors charge us (all USD)
// ---------------------------------------------------------------------------

const PROVIDER_RATES = {
  // OpenAI gpt-4o — per token, so quoted per million.
  gpt4o_input_per_mtok: 2.50,
  gpt4o_output_per_mtok: 10.00,

  // Google Nano Banana Pro (nano-banana-pro-preview) — flat per generated
  // image up to 2K. This is our PRIMARY image model, so it is the one that
  // sets the price; gemini-2.5-flash-image (~$0.039) is only a fallback and
  // charging for the cheap path would underprice the common case.
  nano_banana_pro_per_image: 0.134,

  // fal.ai kling-video/v2.5-turbo/pro — per 5-second clip, which is our
  // default and minimum clip length (KLING_ALLOWED_DURATIONS = [5, 10]).
  // This single line is why video is expensive: it dwarfs everything else.
  kling_turbo_pro_per_5s_clip: 0.35,

  // fal.ai flux-pulid — identity-preserving portrait generation, 28 inference
  // steps at square_hd. generateCharacterSheetFal() fires FOUR of these in
  // parallel (front, side, smiling, neutral half-body) to build one cast
  // member's canonical angles.
  fal_pulid_per_image: 0.045,

  // fal.ai face-swap — applied per scene image when a cast member is in play,
  // to hold the character's identity across shots.
  fal_face_swap_per_call: 0.020,

  // ElevenLabs — billed per character; blended rate across plan tiers.
  elevenlabs_per_1k_chars: 0.18,

  // ElevenLabs Music (/v1/music compose) — billed by track length. One track
  // per video, sized to the whole runtime, not per scene.
  elevenlabs_music_per_30s: 0.12,

  // Serper / scraping for competitor intel — per lookup.
  serper_per_search: 0.001
};

// ---------------------------------------------------------------------------
// 1b. Infrastructure we pay for whether or not a model is involved
// ---------------------------------------------------------------------------
// Not vendor AI spend, but real money per generated asset. Ignoring it is how
// a margin looks healthier on paper than in the bank.
//
// Cloudinary bills a blended credit that covers storage, delivery bandwidth
// and transformations, and video burns it far faster than images do. Video is
// also uploaded THREE times per run in the current pipeline — every scene clip
// (nebula-scene-clips), then the merged cut, then the final render — so a
// 30s reel puts roughly 60MB up before anyone has watched it.
const INFRA = {
  cloudinary_per_gb: 0.35,

  // Rough asset weights. Deliberately generous rather than optimistic.
  mb_per_image: 1.5,
  mb_per_scene_clip: 4.0,
  mb_per_final_video_per_scene: 8.0, // merged + final, both stored
  deliveries_per_asset: 3,           // views/downloads we serve per asset

  // ffmpeg merging runs on our own box (spawn + ffmpeg-static), so it is NOT
  // an API bill — it is server time. A 30s reel is a couple of minutes of CPU;
  // amortised against a modest always-on instance this is small, but it is not
  // zero and it scales with scene count.
  ffmpeg_compute_per_scene: 0.001,
  ffmpeg_compute_per_video: 0.004
};

const gbCost = (mb) => (mb / 1024) * INFRA.cloudinary_per_gb;
// Stored once, then served `deliveries_per_asset` times.
const assetCost = (mb) => gbCost(mb * (1 + INFRA.deliveries_per_asset));

// Rough token shapes of our own prompts. These are estimates of OUR prompts,
// not vendor numbers, and they are deliberately generous: underestimating
// token counts is how you end up with a margin that quietly isn't there.
const TOKENS = {
  creative_director: { in: 2500, out: 900 },  // the "what should this say" pass
  art_director:      { in: 1800, out: 600 },  // the "how should this look" pass
  caption_only:      { in: 1500, out: 700 },
  chat_turn:         { in: 1200, out: 400 },
  scene_script:      { in: 2000, out: 800 },  // per scene, video pipeline
  story_skeleton:    { in: 3000, out: 1600 }  // once per video: story + shot list
};

const gpt4o = (shape) =>
  (shape.in * PROVIDER_RATES.gpt4o_input_per_mtok / 1e6) +
  (shape.out * PROVIDER_RATES.gpt4o_output_per_mtok / 1e6);

const image = PROVIDER_RATES.nano_banana_pro_per_image;

// ---------------------------------------------------------------------------
// 2. What one unit of each action costs us
// ---------------------------------------------------------------------------
// "One unit" is deliberately the smallest billable thing, because that is what
// scales: one SLIDE of a carousel, one SCENE of a video, one POST of a
// campaign. Pricing the whole job as a unit was the original bug.
//
// Video is the exception that proves the rule: it has BOTH a per-video cost
// and a per-scene cost, so it gets two entries. Folding the fixed part into
// the per-scene rate would overcharge long videos and undercharge short ones.

const ACTION_USD = {
  // --- images and text -----------------------------------------------------

  // Two text passes (creative director + art director) then one image.
  image_generated: gpt4o(TOKENS.creative_director) + gpt4o(TOKENS.art_director) + image + assetCost(INFRA.mb_per_image),

  // Editing re-runs the image model, which is ~92% of the cost of generating.
  // An edit is NOT meaningfully cheaper than a generation, which is exactly
  // what the old 3-vs-5 split got wrong.
  image_edit: gpt4o(TOKENS.art_director) + image + assetCost(INFRA.mb_per_image),
  refine_image: gpt4o(TOKENS.art_director) + image + assetCost(INFRA.mb_per_image),

  // Text-only: ideas and captions, no image model.
  campaign_text: gpt4o(TOKENS.caption_only),
  chat_message: gpt4o(TOKENS.chat_turn),

  // Per POST of a campaign. The campaign's shared visual plan is one call
  // amortised across the run, so it is a rounding error per post.
  campaign_full: gpt4o(TOKENS.caption_only) + gpt4o(TOKENS.art_director) + image + assetCost(INFRA.mb_per_image),

  // Per SLIDE of a carousel. Same shape: one master plan for the deck
  // (amortised over ~5 slides) plus per-slide execution and one image.
  carousel_generated: gpt4o(TOKENS.art_director) + image + (gpt4o(TOKENS.creative_director) / 5) + assetCost(INFRA.mb_per_image),

  // --- video: fixed, once per run -----------------------------------------
  // Everything a video pays for exactly once no matter how long it is. This
  // was missing entirely from the first pass of this model, which priced a
  // video as nothing but its scenes.
  video_base:
    (4 * PROVIDER_RATES.fal_pulid_per_image) +          // character sheet: 4 canonical angles
    PROVIDER_RATES.elevenlabs_music_per_30s +           // one score for the whole runtime
    image +                                             // thumbnail (Nano Banana)
    gpt4o(TOKENS.story_skeleton) +                      // story + shot list
    assetCost(INFRA.mb_per_image * 5) +                 // thumbnail + 4 sheet portraits
    INFRA.ffmpeg_compute_per_video,

  // --- video: per scene ----------------------------------------------------
  // By far our most expensive unit: every scene is a full image generation
  // PLUS an identity pass PLUS a Kling clip PLUS narration, and its clip is
  // stored and served twice over (as a scene clip and inside the final cut).
  video_generated:
    image +
    PROVIDER_RATES.fal_face_swap_per_call +
    PROVIDER_RATES.kling_turbo_pro_per_5s_clip +
    gpt4o(TOKENS.scene_script) +
    (150 / 1000) * PROVIDER_RATES.elevenlabs_per_1k_chars + // ~150 chars narration/scene
    assetCost(INFRA.mb_per_scene_clip + INFRA.mb_per_final_video_per_scene) +
    assetCost(INFRA.mb_per_image) +
    INFRA.ffmpeg_compute_per_scene,

  // --- the "smart post" flows ---------------------------------------------
  // A normal post plus an extra context/research pass over rivals, strategy
  // or event data.
  rival_post: gpt4o(TOKENS.creative_director) + gpt4o(TOKENS.art_director) + image + gpt4o(TOKENS.caption_only) + assetCost(INFRA.mb_per_image),
  strategic_post: gpt4o(TOKENS.creative_director) + gpt4o(TOKENS.art_director) + image + gpt4o(TOKENS.caption_only) + assetCost(INFRA.mb_per_image),
  event_post: gpt4o(TOKENS.creative_director) + gpt4o(TOKENS.art_director) + image + gpt4o(TOKENS.caption_only) + assetCost(INFRA.mb_per_image),

  competitor_scrape: PROVIDER_RATES.serper_per_search
};

// ---------------------------------------------------------------------------
// 3. Cost -> price
// ---------------------------------------------------------------------------

// Gross margin multiplier on raw spend, per action.
//
// The default 2.5x means the bill is 40% of Quark revenue, leaving the rest
// for the things this model still does not itemise (Ayrshare, servers,
// monitoring) and — the expensive part — generations that fail and get
// refunded, which is spend with zero revenue against it.
//
// Video carries more because its failure profile is worse in both directions:
// a Kling clip fails or comes back unusable far more often than an image does,
// and each miss costs several times what an image miss costs. The old model
// (see the original ai_feature_costs sheet) used a flat 2.2x across the board,
// but that sheet had no video in it at all — every line was an image or a
// text call.
const MARGIN = { default: 2.5, video_base: 3.2, video_generated: 3.2 };
const marginFor = (action) => MARGIN[action] || MARGIN.default;

// What one Quark is worth.
//
// A Quark meters the MACHINE — API spend plus infrastructure, with margin on
// top. It deliberately does NOT price the CSM who drives the tool: their time
// scales with delivered items, while Quarks scale with attempts, and a currency
// that tries to be both is wrong for both. Human cost is priced per deliverable
// instead (see DELIVERED below).
//
// $0.02 rather than the $0.08 this model started with. At $0.08 five actions
// priced in fractions (0.25 chat, 4.5 carousel, 5.5 rival post) and no credit
// system in this market does that — Higgsfield, Magnific, OpenArt and Runway
// are all whole numbers. At $0.02 every price is an integer and the monthly
// allowances land in the same shape the market uses.
//
// MIGRATION: this multiplies every price by 4, so existing balances must be
// multiplied by 4 too or they silently lose 75% of their purchasing power.
const USD_PER_QUARK = 0.02;

// For turning USD costs into the INR we actually price in. The original sheet
// used a flat 100, which was a convenient round number rather than a rate.
// This is margin-dominated anyway — a 10% FX move shifts gross margin by
// about 3 points, not by anything structural.
const INR_PER_USD = 88;

// Prices are what people read off a table, so every one is a whole number
// with a floor of 1 — the market convention (Higgsfield, Magnific, OpenArt,
// Runway all bill in integers) and the reason the denomination moved to $0.02.
// The floor matters: chat costs $0.007, which rounds to zero, and "free" is a
// pricing decision that should be made deliberately rather than fall out of a
// rounding rule.
function toQuarks(usd, action) {
  return Math.max(1, Math.round((usd * marginFor(action)) / USD_PER_QUARK));
}

const QUARK_COSTS = Object.fromEntries(
  Object.entries(ACTION_USD).map(([action, usd]) => [action, toQuarks(usd, action)])
);

// Competitor intel stays free on purpose: it is the hook that gets people to
// look at the product, it costs a tenth of a cent, and it is the one action
// where a price tag would cost us more in signups than it earns.
QUARK_COSTS.competitor_scrape = 0;

// What one unit MEANS, so the UI can say "5 per slide" instead of a bare "5"
// next to the word "Carousel" — the exact ambiguity that made the old price
// table read as a lie.
const ACTION_UNITS = {
  image_generated: 'per image',
  image_edit: 'per edit',
  refine_image: 'per refine',
  campaign_text: 'per post',
  campaign_full: 'per post',
  carousel_generated: 'per slide',
  video_base: 'per video',
  video_generated: 'per scene',
  chat_message: 'per message',
  rival_post: 'per post',
  strategic_post: 'per post',
  event_post: 'per post',
  competitor_scrape: 'free'
};

// ---------------------------------------------------------------------------
// 3b. The cost that dwarfs all of the above: people
// ---------------------------------------------------------------------------
// Gravity is sold as a managed service. A CSM sits in the tool, briefs it,
// reviews what comes back, regenerates what missed, writes and fixes captions,
// schedules and publishes. That person is cost of goods sold, not overhead —
// their hours scale directly with delivered output — and they cost multiples
// of the API bill.
//
// Ignoring them is how a 60%-gross-margin model turns out to be lossmaking.
//
// RETRY_FACTOR is separate and important: Quarks meter GENERATIONS, but a CSM's
// time is spent per DELIVERED item. Three attempts at one post costs 3x the
// machine and roughly 1x the human, because the reviewing IS the working.
const LABOUR = {
  // Real figure from the business, not an estimate: CSMs are paid 25k/month.
  csm_monthly_inr: 25000,

  // 10am-6pm, 5 days a week. ~22 working days => 176 hours gross.
  // 85% of that is production work; the rest is client calls, strategy,
  // reporting and the ordinary friction of a working day.
  gross_hours_per_month: 176,
  production_ratio: 0.85,

  // Minutes of ACTIVE CSM attention per delivered item — briefing, reviewing,
  // tweaking, scheduling. This is not wall-clock: generation runs on a
  // background queue, so waiting is only CSM time if they sit and watch it.
  // See PIPELINE_SECONDS for what the machine takes.
  minutes_per: {
    // BEFORE Gravity — what the team actually does today.
    before: { image_post: 15, reel: 180 },
    // AFTER — the calendar is pre-filled and the ideas are already there, so
    // the work becomes review-and-approve rather than create-from-scratch.
    after:  { image_post: 3, reel: 25 }
  },

  // Hours per CUSTOMER per month that have nothing to do with volume: calls,
  // approvals, strategy, reporting. This is what actually caps a CSM's book
  // once Gravity has collapsed the production time — at 4.7 production hours
  // per customer, account management becomes the binding constraint, not the
  // work itself.
  account_mgmt_hours_per_customer: 2
};

LABOUR.productive_hours_per_month = LABOUR.gross_hours_per_month * LABOUR.production_ratio;
LABOUR.hourly_inr = LABOUR.csm_monthly_inr / LABOUR.productive_hours_per_month;
LABOUR.hourly_usd = LABOUR.hourly_inr / INR_PER_USD;
const labourUsd = (minutes) => (minutes / 60) * LABOUR.hourly_usd;

// ---------------------------------------------------------------------------
// 3c. How long the machine actually takes
// ---------------------------------------------------------------------------
// Wall-clock, which is what decides whether a CSM can run jobs in parallel or
// sits watching a spinner.
//
// image_ready is MEASURED: median span from draft creation to image present,
// across 46 real drafts in the dev database (p25 41s, p75 154s).
// The rest are vendor-documented or structural.
const PIPELINE_SECONDS = {
  image_ready: 89,        // measured, median

  kling_clip: 160,        // fal.ai documented average for v2.5 turbo pro,
                          // and flat regardless of clip length
  story_skeleton: 20,
  character_sheet: 30,    // 4 pulid portraits, fired in parallel
  scene_image: 40,        // per batch of SCENE_IMAGE_CONCURRENCY
  music: 30,
  narration: 20,
  ffmpeg_merge: 90,
  thumbnail: 15,
  uploads: 60,

  // THE BOTTLENECK. Mirrors SCENE_IMAGE_CONCURRENCY (3) and
  // SCENE_CLIP_CONCURRENCY (1) in videoGenerationPipeline.js. Clips run ONE
  // AT A TIME, so a 5-scene reel spends 5 x 160s = 13 minutes just queueing
  // Kling — the single largest block of wall-clock in the product, and it is
  // set by an env var (AI_VIDEO_SCENE_CLIP_CONCURRENCY), not by a vendor limit.
  scene_image_concurrency: 3,
  scene_clip_concurrency: 1
};

function videoWallClockSeconds(scenes = 5, clipConcurrency = PIPELINE_SECONDS.scene_clip_concurrency) {
  const P = PIPELINE_SECONDS;
  const imageBatches = Math.ceil(scenes / P.scene_image_concurrency);
  const clipBatches = Math.ceil(scenes / clipConcurrency);
  return P.story_skeleton + P.character_sheet +
         (imageBatches * P.scene_image) +
         (clipBatches * P.kling_clip) +
         P.narration + P.ffmpeg_merge + P.thumbnail + P.uploads;
  // music composes in parallel with the scene work, so it is not on the path
}

// How many generations it takes to land one deliverable we ship.
//
// image: 1.2 — MEASURED. Across 340 image-producing generations in the dev
// database (excluding this session's test transactions) there were 59
// edit/refine operations, i.e. 0.17 retries per generation. Rounded up to 1.2
// because dev usage is lighter than a CSM working to a client brief.
//
// This replaces a guess of 1.6, which overstated machine cost by ~30%. Worth
// re-measuring against production once real CSM volume exists.
//
// video_scene: 1.5 — STILL A GUESS. There are zero completed video generations
// in the database to measure, so this is judgement: scene re-rolls are more
// common than image retries because a clip can be technically fine and still
// not cut together. It is the largest remaining invented number in this file.
const RETRY_FACTOR = { image: 1.2, carousel: 1.2, video_scene: 1.5 };

// Separately from retries: 20% of campaign_full generations were REFUNDED in
// the same dataset (30 of 151), against 0% for image_generated. That is a
// reliability problem on the campaign path, not a pricing input — it is not
// modelled here, but it should be fixed rather than priced around.
const OBSERVED_CAMPAIGN_FAILURE_RATE = 0.20;

// True cost of one SHIPPED deliverable — machine (including the attempts that
// did not make it) plus the human who drove it.
const DELIVERED = {
  image_post: {
    machine: ACTION_USD.image_generated * RETRY_FACTOR.image,
    labour: labourUsd(LABOUR.minutes_per.after.image_post)
  },
  carousel_8: {
    machine: ACTION_USD.carousel_generated * 8 * RETRY_FACTOR.carousel,
    labour: labourUsd(25)
  },
  reel_5_scene: {
    // Setup happens once even across re-rolls; the scenes are what get redone.
    machine: ACTION_USD.video_base + (ACTION_USD.video_generated * 5 * RETRY_FACTOR.video_scene),
    labour: labourUsd(LABOUR.minutes_per.after.reel)
  }
};
for (const d of Object.values(DELIVERED)) {
  d.total = d.machine + d.labour;
  d.labourShare = d.labour / d.total;
}

// Markup on the FULL delivered cost. Agencies run 50-60% gross margin on
// service work; pure SaaS runs 75-85%. An AI-native managed service should
// sit between, and 2.5x (60%) is the target this model prices to.
const SERVICE_MARKUP = 2.5;
for (const d of Object.values(DELIVERED)) {
  d.price_usd = d.total * SERVICE_MARKUP;
  d.price_inr = d.price_usd * INR_PER_USD;
}

// ---------------------------------------------------------------------------
// 4. Plans
// ---------------------------------------------------------------------------
// A plan is a monthly price, a set of deliverables we commit to, and a Quark
// allowance sized to cover those deliverables PLUS the retries a managed
// service actually needs. The allowance is the cost ceiling, not a value meter:
// it is what stops one runaway account from eating a month's margin.

// Safety margin on top of EXPECTED burn. The retry factors are averages, so
// without this roughly half of all months would hit the ceiling.
const ALLOWANCE_SAFETY = 1.15;

const PLANS = {
  managed_10k: {
    inr: 10000,
    label: 'Managed — 10k',
    commits: { image_generated: 60, reels: 4, scenesPerReel: 5 }
    // `quarks` is DERIVED below, never written here. It used to be a literal,
    // and when USD_PER_QUARK moved from $0.08 to $0.02 the literal stayed put
    // and silently became a quarter of the allowance it was meant to be.
  }
};

for (const [name, plan] of Object.entries(PLANS)) {
  const c = plan.commits;

  // What the deliverables cost if every generation landed first time.
  plan.committedQuarks =
    (c.image_generated || 0) * QUARK_COSTS.image_generated +
    (c.reels || 0) * (QUARK_COSTS.video_base + (c.scenesPerReel || 0) * QUARK_COSTS.video_generated);

  // What they actually cost, because generations do not land first time.
  // Sizing the allowance off committedQuarks was wrong: it granted 5,500
  // against a real burn of 6,180, so a CSM doing nothing unusual would hit
  // the ceiling before month end. Video setup is NOT retried — the character
  // sheet and music survive a scene re-roll — so only the scenes carry the
  // video retry factor.
  plan.expectedQuarks = Math.round(
    (c.image_generated || 0) * QUARK_COSTS.image_generated * RETRY_FACTOR.image +
    (c.reels || 0) * (
      QUARK_COSTS.video_base +
      (c.scenesPerReel || 0) * QUARK_COSTS.video_generated * RETRY_FACTOR.video_scene
    )
  );

  // A round number, chosen rather than derived — 5,000 is what a paid account
  // gets. The derived figure (expectedQuarks x safety) is kept alongside it so
  // the check below still bites if costs ever rise past what 5,000 covers.
  plan.derivedQuarks = Math.round((plan.expectedQuarks * ALLOWANCE_SAFETY) / 100) * 100;
  plan.quarks = 5000;

  if (plan.quarks < plan.expectedQuarks) {
    throw new Error(
      `Plan "${name}" grants ${plan.quarks} Quarks against an expected burn of ` +
      `${plan.expectedQuarks}. Raise the grant or cut the commitments.`
    );
  }
}

module.exports = {
  PROVIDER_RATES, INFRA, ACTION_USD, QUARK_COSTS, ACTION_UNITS,
  MARGIN, marginFor, USD_PER_QUARK, INR_PER_USD, PLANS,
  LABOUR, RETRY_FACTOR, OBSERVED_CAMPAIGN_FAILURE_RATE, DELIVERED, SERVICE_MARKUP,
  PIPELINE_SECONDS, videoWallClockSeconds
};
