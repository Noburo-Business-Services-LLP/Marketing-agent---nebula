# LinkedIn Content Generation — Design Spec

## Goal

Gravity treats every platform's caption the same way today: image-first, with a short supporting caption whose only platform-awareness is a one-line "respect the platform's behaviour" instruction. LinkedIn needs real, structural difference — long-form text as the primary artifact (hook → context → breakdown → POV → CTA, 150-300+ words, real numbers/case-studies where the customer has them), not a reflowed caption. X needs a hard 280-character cap. Instagram/Facebook keep their current short, hook-first treatment. This spec adds that differentiation, plus a dedicated manual LinkedIn authoring surface, without touching the parts of the pipeline that already work (image generation stays exactly as-is for every other platform, and for LinkedIn posts generated inside a multi-platform campaign).

**Already confirmed working and NOT part of this change:**
- LinkedIn account connection (Ayrshare Business-Plan JWT/SSO flow) — already fully wired, same code path as Instagram/Facebook (`backend/routes/social.js`, `AYRSHARE_PLATFORM_MAP`, `frontend/pages/ConnectSocials.tsx`).
- Prompt customization UI — `PromptStudio.tsx` (mounted in `GravityCreate.tsx`, backed by `GET/PUT /api/prompts` and the `PromptOverride` model) already lets a customer edit any registered prompt by ID. New prompts this spec adds just need to be registered — no new frontend editing surface.

## Architecture

Three independent pieces, each usable on its own:

1. A canonical, shared per-platform content-rules module that every caption-generating function reads from, replacing today's scattered and inconsistent per-platform logic.
2. The existing multi-platform Campaign flow (`campaign.content` prompt) gets real structural per-platform rules injected per post, instead of the current one-line tone hint. Image generation for campaign posts is untouched — LinkedIn posts inside a campaign still get an auto-generated image exactly like today.
3. A new, dedicated "LinkedIn" tab in Create — text-first authoring, image generation is opt-in rather than automatic, using a new long-form `linkedin.content` prompt built on the user-supplied 5-part viral blueprint.

## Global Constraints

- The 5-part LinkedIn structure (Bold Hook → Context/Why It Matters → Breakdown/Insight → Analysis/POV → CTA) is per the reference prompt the user supplied (`Linkedin Content - DK Style VIRAL PROMPT.docx`), adapted to work per-customer (see "LinkedIn voice" below) rather than for one specific person's brand.
- X/Twitter: STRICT 280 characters including hashtags (existing rule in `getPlatformCaptionRules`, carried forward unchanged into the new shared module).
- Instagram: short, hook-first, up to ~300 chars ideal, emoji-friendly (existing rule, carried forward).
- Facebook: conversational, ~100-250 chars ideal, moderate emoji (existing rule, carried forward).
- LinkedIn: 150-300+ words (longer when the idea genuinely supports it — numbers, a case study, a specific story), minimal emoji (existing personas over-use emoji; the reference prompt's "emoji per section" habit is toned down — see "Reconciling the reference prompt" below), the 5-part structure, 3-5 hashtags, a genuine question or observation as the closing line.
- No new Draft schema fields needed — `imageUrl` already defaults to `''`, so a caption-only draft is already representable. `platforms: ['linkedin']`, `sourceType: 'post'`, `contentType: 'post'` cover the new LinkedIn-tab draft shape.
- No changes to the Ayrshare connect flow, `AYRSHARE_PLATFORM_MAP`, or the image-generation pipeline's slot-sharing logic in the Campaign flow.

### Reconciling the reference prompt with Gravity's brand-voice system

The user's reference docx is a generic "viral LinkedIn formula" (bold hooks with big-name drops, an emoji per section, engagement-bait CTAs, "maintain the illusion of authenticity"). Gravity's *existing* content generation (`campaign.content`, `single.content`) is built around a brand's *real* identity — actual products, actual locations, actual differentiators, pulled from Brand Memory, explicitly avoiding generic/AI-cliché output. The user has explicitly chosen the viral-prompt structure over their own separate `dk-content-system` Instagram voice for LinkedIn specifically (that system is unrelated — personal Instagram content, not reused here). The `linkedin.content` prompt therefore:
- Keeps the reference prompt's **structural bones**: 5-part blueprint, punchy one-sentence paragraphs, bolded keywords, an em-dash for tonal shifts, a closing question/observation.
- Replaces **generic virality mechanics** with Gravity's existing Brand Memory grounding: real numbers/stats/case-studies come from the customer's actual Brand Memory (products, testimonials, metrics) the same way `campaign.content` already pulls real assets, not invented "mass-scale figures." "Ride trending topics" and "always ride the news" are dropped — Gravity has no trend-awareness input to act on this with, and this is left as a possible future add-on if it's ever wanted.
- Keeps emoji genuinely minimal (1-2 max, matching the existing per-platform LinkedIn rule already in `getPlatformCaptionRules`) rather than the reference prompt's "emoji per section."

## Part 1: Canonical platform-rules module

**New file:** `backend/services/platformContentRules.js`

Exports one function: `getPlatformRules(platform)` → returns a structured object (not just a prose string, so callers can use the fields programmatically where useful):

```js
{
  platform: 'linkedin',
  structure: 'long-form',       // 'long-form' | 'short-form' | 'micro'
  lengthGuidance: '150-300+ words, longer when real numbers/case-studies support it',
  hardCharLimit: null,           // e.g. 280 for X, null where there's no hard cap
  emojiGuidance: 'minimal — 1-2 max',
  hashtagCount: '3-5',
  promptBlock: `...`             // the full prose block to inject into a caption-generation prompt, e.g. the 5-part LinkedIn structure, X's hard-cap rule, etc.
}
```

This replaces `getPlatformCaptionRules()` in `backend/services/geminiAI.js` (that function is deleted; every call site is updated to `require('./platformContentRules').getPlatformRules(platform).promptBlock` for a drop-in string, or the structured fields where a caller needs `hardCharLimit` etc. directly — e.g. `generateCampaignSuggestions`'s existing X-specific character-limit handling).

**Call sites updated to use the shared module** (all currently have ad hoc or missing platform logic):
- `generateCampaignSuggestions` (`geminiAI.js`) — currently calls the now-deleted `getPlatformCaptionRules`.
- `generateRivalPost` (`geminiAI.js`) — currently has one inline ternary for LinkedIn tone only; gets the full rules block.
- `generatePostFromSuggestion`, `generateEventPost`, `generateABTestVariations`, `generateStrategicContentSuggestions` (`geminiAI.js`) — currently platform-blind; each gets the relevant platform's `promptBlock` injected into its existing prompt construction.
- `campaign.content` and the new `linkedin.content` (`promptRegistry.js`) — see Parts 2 and 3.

## Part 2: Campaign flow — real per-platform structure, same image behavior

**File:** `backend/services/promptRegistry.js`, the `campaign.content` template.

Current "PLATFORM ADAPTATION" section (one paragraph, applies to the whole batch) is replaced with a per-post instruction: for each post in the `posts` array, the model is told which platform it's writing for and given that platform's `promptBlock` from Part 1, inline, before it writes that post's `caption`/`hashtags`/`cta`. This stays a **single JSON call** for the whole campaign (no new LLM round-trips) — the existing "posts" loop in the prompt's OUTPUT section already iterates per-post; each post's platform-specific rules text is interpolated per post via the existing `{{keyMessagesBlock}}`-style templating pattern already used elsewhere in this file.

**Image generation is unchanged.** The per-slot image loop in `backend/routes/campaigns.js` (`generateCampaignImageNanoBanana`, slot-shared across platforms in a mixed slot) keeps running exactly as today for every platform including LinkedIn. A LinkedIn post generated through the Campaign flow gets an image, same as Instagram/Facebook, per the user's explicit choice — the "no auto-image" behavior is exclusive to the new LinkedIn tab (Part 3).

**Length validation:** `campaign.content`'s existing caption-validation step (`validateCaptionsSchema` in `campaigns.js`) gets one new check: for posts where `platform === 'linkedin'`, flag (not hard-fail) captions under ~100 words as likely too short, mirroring the existing template-shape/placeholder checks in the same function. For X, the existing behavior already relies on the model respecting the 280-char instruction; no new hard validation is added here (out of scope — matches current risk level for other platforms).

## Part 3: New LinkedIn tab in Create

**File:** `frontend/pages/GravityCreate.tsx`

`mode` (currently `'campaign' | 'single' | 'carousel'`, line ~172) gains a 4th value: `'linkedin'`. Rendered as a 4th pill alongside the existing three mode-switch buttons (~line 935-965), following the exact same conditional-class pattern already used there.

**LinkedIn mode's form** (replaces the `single` mode's one-line "idea" input for this mode only):
- A large multi-line text area for the content idea/brief — the user can paste a full outline, numbers, or just a topic; the model expands it per the 5-part structure. (Unlike `single`/`campaign` mode, this is not primarily an image-brief input.)
- Platform is fixed to LinkedIn — no platform picker shown (this tab exists specifically so a user doesn't have to fight the multi-platform flow to get a LinkedIn-only, non-auto-image post).
- Existing brand-context inputs already shared across modes (linked product, tone override, language) are reused as-is — no new component needed, same props `single` mode already passes through.
- Generate button produces the long-form text only. No image call happens as part of generation.
- Once generated, the result card shows the full text (scrollable, since 150-300+ words is longer than any existing result card handles today — `GravityCreate.tsx`'s result-card component needs a taller/expandable text region for this mode specifically, everything else about the card — edit, approve, discard — reused unchanged) plus an **"Add image"** button.
- **"Add image"** calls the existing `POST /api/drafts/:id/retry-image` endpoint (already handles "no image yet" as well as "regenerate" — confirmed in `backend/routes/drafts.js`, it just requeues the standard image-generation background job against the draft's existing prompt/caption context). No new backend endpoint needed for this step.

**New backend endpoint:** `POST /api/drafts/generate-linkedin-post`
- Auth via existing `protect` middleware, credit-metered the same way `single.content` generation is today (reuses the existing credit-cost constant for a text-only single post — cheaper than a post+image, since no image model call happens).
- Body: `{ idea, contentPillar?, objective?, tone?, language?, linkedProduct? }` — same shape `single` mode already sends, minus `aspectRatio`/`prompt` (image-specific fields not needed here).
- Calls `buildPrompt(userId, 'linkedin.content', vars)` (new prompt, Part 3 below) → single text LLM call (`callTextLLM`, same helper every other generator already uses) → returns the generated text.
- Frontend then calls the existing generic `POST /api/drafts/save` to persist it as a Draft: `{ title, caption: <generated text>, hashtags, platforms: ['linkedin'], sourceType: 'post', contentType: 'post', imageUrl: '' }` — no schema change, `imageUrl` already defaults to empty.

**New prompt:** `linkedin.content` in `promptRegistry.js`, `stage: 'linkedin'`. Structure: same Brand Intelligence framing `single.content` already uses (real brand data, no invented assets) + the 5-part blueprint from Part 1's `promptBlock`, reconciled per "Reconciling the reference prompt" above. Registering it under a real ID is all that's needed for `PromptStudio` to surface it for editing — same as every other registered prompt.

**GravityApprove.tsx** (the review/approval flow) needs no structural change — it already renders whatever `caption`/`imageUrl` a Draft has, and a draft with `imageUrl: ''` already renders as a text-only card today (confirmed: `imageUrl` defaults to empty and is optional throughout the existing Draft-rendering code). The only addition there is surfacing the same "Add image" action (`retry-image`) for LinkedIn drafts that don't have one yet — a small addition to whatever action-button set Approve already shows per draft, not a new flow.

## Testing

- Unit: `platformContentRules.getPlatformRules()` returns the right `promptBlock`/`hardCharLimit`/etc. for each of `instagram`, `facebook`, `x`/`twitter`, `linkedin`, and falls back sanely for an unknown platform (matches existing `getPlatformCaptionRules`'s fallback-to-instagram behavior).
- Integration: `generate-campaign-stream` with `platforms: ['instagram', 'linkedin']` produces two structurally different captions for the same slot (short vs. long-form) and one shared image for that slot (image behavior unchanged).
- Integration: new `POST /api/drafts/generate-linkedin-post` returns long-form text (150+ words) with no image call made (mock the image-generation function and assert it's never invoked).
- Integration: `POST /api/drafts/save` with `imageUrl: ''` and `platforms: ['linkedin']` persists correctly; `POST /api/drafts/:id/retry-image` against that same draft successfully enqueues an image job (confirms the existing endpoint really does handle the "never had an image" case, not just "regenerate after failure").
- Manual: PromptStudio (`GravityCreate.tsx`, LinkedIn tab) shows `linkedin.content` as an editable prompt and a saved override is actually used on the next generation (matches existing override behavior for `campaign.content`/`single.content`).
