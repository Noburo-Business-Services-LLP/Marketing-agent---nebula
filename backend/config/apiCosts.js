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

  // ElevenLabs — billed per character; blended rate across plan tiers.
  elevenlabs_per_1k_chars: 0.18,

  // Serper / scraping for competitor intel — per lookup.
  serper_per_search: 0.001
};

// Rough token shapes of our own prompts. These are estimates of OUR prompts,
// not vendor numbers, and they are deliberately generous: underestimating
// token counts is how you end up with a margin that quietly isn't there.
const TOKENS = {
  creative_director: { in: 2500, out: 900 },  // the "what should this say" pass
  art_director:      { in: 1800, out: 600 },  // the "how should this look" pass
  caption_only:      { in: 1500, out: 700 },
  chat_turn:         { in: 1200, out: 400 },
  scene_script:      { in: 2000, out: 800 }   // per scene, video pipeline
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

const ACTION_USD = {
  // Two text passes (creative director + art director) then one image.
  image_generated: gpt4o(TOKENS.creative_director) + gpt4o(TOKENS.art_director) + image,

  // Editing re-runs the image model, which is ~92% of the cost of generating.
  // An edit is NOT meaningfully cheaper than a generation, which is exactly
  // what the old 3-vs-5 split got wrong.
  image_edit: gpt4o(TOKENS.art_director) + image,
  refine_image: gpt4o(TOKENS.art_director) + image,

  // Text-only: ideas and captions, no image model.
  campaign_text: gpt4o(TOKENS.caption_only),
  chat_message: gpt4o(TOKENS.chat_turn),

  // Per POST of a campaign. The campaign's shared visual plan is one call
  // amortised across the run, so it is a rounding error per post.
  campaign_full: gpt4o(TOKENS.caption_only) + gpt4o(TOKENS.art_director) + image,

  // Per SLIDE of a carousel. Same shape: one master plan for the deck
  // (amortised over ~5 slides) plus per-slide execution and one image.
  carousel_generated: gpt4o(TOKENS.art_director) + image + (gpt4o(TOKENS.creative_director) / 5),

  // Per SCENE of a video, and by far our most expensive unit: every scene is
  // a full image generation PLUS a Kling clip PLUS narration.
  video_generated:
    image +
    PROVIDER_RATES.kling_turbo_pro_per_5s_clip +
    gpt4o(TOKENS.scene_script) +
    (150 / 1000) * PROVIDER_RATES.elevenlabs_per_1k_chars, // ~150 chars narration/scene

  // The three "smart post" flows: a normal post plus an extra context/research
  // pass over rivals, strategy or event data.
  rival_post: gpt4o(TOKENS.creative_director) + gpt4o(TOKENS.art_director) + image + gpt4o(TOKENS.caption_only),
  strategic_post: gpt4o(TOKENS.creative_director) + gpt4o(TOKENS.art_director) + image + gpt4o(TOKENS.caption_only),
  event_post: gpt4o(TOKENS.creative_director) + gpt4o(TOKENS.art_director) + image + gpt4o(TOKENS.caption_only),

  competitor_scrape: PROVIDER_RATES.serper_per_search
};

// ---------------------------------------------------------------------------
// 3. Cost -> price
// ---------------------------------------------------------------------------

// Gross margin multiplier on raw API spend, per action.
//
// The default 2.5x means the API bill is 40% of Quark revenue, leaving the
// rest for infra, storage, Cloudinary and — the expensive part — generations
// that fail and get refunded, which is spend with zero revenue against it.
//
// Video carries more because its failure profile is worse in both directions:
// a Kling clip fails or comes back unusable far more often than an image does,
// and each miss costs 3.3x what an image miss costs. The old model (see the
// original ai_feature_costs sheet) used a flat 2.2x across the board, but that
// sheet had no video in it at all — every line was an image or a text call.
const MARGIN = { default: 2.5, video_generated: 3.2 };
const marginFor = (action) => MARGIN[action] || MARGIN.default;

// What one Quark is worth. Anchored deliberately: at this value a single AI
// image post prices out at almost exactly 5 Quarks, which is what it already
// costs today. That keeps every existing balance, the 100-Quark starting
// grant, and everyone's intuition intact, while letting the genuinely
// mispriced actions (video above all) move to where they should be.
const USD_PER_QUARK = 0.08;

// For turning USD API costs into the INR we actually price in. The original
// sheet used a flat 100, which was a convenient round number rather than a
// rate. This is margin-dominated anyway — a 10% FX move shifts gross margin
// by about 3 points, not by anything structural.
const INR_PER_USD = 88;

// Prices are what users read off a table, so they get rounded to something
// human: quarters under 1, halves under 10, whole numbers above. The 0.25
// floor is load-bearing — chat rounds to 0.22, and without a floor the
// cheapest actions round to literally free, which is a pricing bug that
// looks like a rounding rule.
function toQuarks(usd, action) {
  const raw = (usd * marginFor(action)) / USD_PER_QUARK;
  if (raw < 1) return Math.max(0.25, Math.round(raw * 4) / 4);
  if (raw < 10) return Math.round(raw * 2) / 2;
  return Math.round(raw);
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
  video_generated: 'per scene',
  chat_message: 'per message',
  rival_post: 'per post',
  strategic_post: 'per post',
  event_post: 'per post',
  competitor_scrape: 'free'
};

// ---------------------------------------------------------------------------
// 4. Plans
// ---------------------------------------------------------------------------
// A plan is a monthly price, a set of deliverables we commit to, and a Quark
// allowance sized to cover those deliverables PLUS the retries a managed
// service actually needs. The allowance is the cost ceiling, not a value meter:
// it is what stops one runaway account from eating a month's margin.

const PLANS = {
  managed_10k: {
    inr: 10000,
    label: 'Managed — 10k',
    // What we promise to ship.
    commits: { image_generated: 60, reels: 4, scenesPerReel: 5 },
    // 1,400 lands on two useful numbers at once: ~1.94x the Quarks the
    // committed deliverables consume (so roughly two full attempts at
    // everything), and essentially the entire notional value of the fee
    // (INR 10,000 / $0.08 per Quark = 1,420). We pass the value through and
    // take margin from the multiplier baked into each price, rather than by
    // quietly shorting the allowance.
    //
    // Gross margin at FULL burn, by what they spend it on:
    //   all images  60.6%   plan mix  65.7%   all video  69.3%
    // So 60% is the floor, not the target. A month that runs hot and needs
    // ~1,800 Quarks still clears ~55%, which is the signal to go look at
    // that account rather than a reason to refuse the work.
    quarks: 1400
  }
};

// Sanity: an allowance that cannot cover its own committed deliverables is a
// plan that loses money by design. Cheap to check, so check it at load.
for (const [name, plan] of Object.entries(PLANS)) {
  const committed =
    (plan.commits.image_generated || 0) * QUARK_COSTS.image_generated +
    (plan.commits.reels || 0) * (plan.commits.scenesPerReel || 0) * QUARK_COSTS.video_generated;
  if (plan.quarks < committed) {
    throw new Error(
      `Plan "${name}" grants ${plan.quarks} Quarks but its committed deliverables ` +
      `need ${committed}. Raise the allowance or cut the commitments.`
    );
  }
  plan.committedQuarks = committed;
}

module.exports = {
  PROVIDER_RATES, ACTION_USD, QUARK_COSTS, ACTION_UNITS,
  MARGIN, marginFor, USD_PER_QUARK, INR_PER_USD, PLANS
};
