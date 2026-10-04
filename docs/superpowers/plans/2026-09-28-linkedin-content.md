# LinkedIn Long-Form Content Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give LinkedIn real structural treatment in Gravity's content generation — long-form, 5-part-structured posts instead of a reflowed short caption — via one shared per-platform rules module, a per-post rewrite of the existing multi-platform campaign prompt, and a new dedicated LinkedIn authoring tab with opt-in (not automatic) image generation.

**Architecture:** Three independently shippable pieces sharing one new rules module (`backend/services/platformContentRules.js`): (1) migrate every existing ad hoc per-platform caption-rule call site in `geminiAI.js` onto it; (2) inject real per-post platform rules into the existing `campaign.content` prompt (one LLM call still generates the whole campaign; image generation is untouched); (3) a new `linkedin` mode in Create, backed by a new text-only `POST /api/drafts/generate-linkedin-post` endpoint and a new `linkedin.content` prompt, with "Add image" reusing the existing `retry-image` endpoint.

**Tech Stack:** Node/Express backend, React/Vite/TS frontend (established elsewhere in this repo — see `nebulaa-gravity-local-setup` project context). No test runner exists in either package (`backend/package.json` has no `test` script, no jest/mocha config, no existing test files) — verification steps in this plan use small throwaway `node -e`/script checks for pure functions, `curl` for endpoints, and live browser checks via the project's dev-server preview for frontend, matching how prior work on this repo (the Gravity light-mode plan) was verified.

**Spec:** [docs/superpowers/specs/2026-09-28-linkedin-content-design.md](../specs/2026-09-28-linkedin-content-design.md)

## Global Constraints

- X/Twitter: STRICT 280 characters including hashtags, exactly 4 hashtags, no line breaks.
- Instagram: up to 2200 chars but 150-300 ideal, exactly 4 hashtags, hook in first line, generous emoji.
- Facebook: 100-250 chars ideal, exactly 4 hashtags, moderate emoji, conversational.
- LinkedIn: 150-300+ words (longer when real numbers/case-studies genuinely support it), 1-2 emoji max, 3-5 hashtags lowercase, the 5-part structure (Bold Hook → Context/Why It Matters → Breakdown/Insight → Analysis/POV → CTA), closes on a genuine question or observation — NOT the reference prompt's "always ride trending news," invented "mass-scale figures," or emoji-per-section habits (see spec's "Reconciling the reference prompt" section).
- No new Draft schema fields. `imageUrl` already defaults to `''` and every existing Draft-rendering path already treats that as "no image" — confirmed in `frontend/pages/GravityCreate.tsx` and `frontend/pages/GravityApprove.tsx`.
- No changes to the Ayrshare connect flow, `AYRSHARE_PLATFORM_MAP`, or the per-slot image-sharing logic in `backend/routes/campaigns.js`'s campaign-image loop.
- New LinkedIn-tab text generation is credit-metered via the existing `campaign_text` cost in `backend/config/apiCosts.js` (a caption-only cost already defined there) — no new cost constant.
- `PromptStudio.tsx` (mounted in `GravityCreate.tsx`) auto-lists any prompt registered in `promptRegistry.js`'s `PROMPTS` map — no new frontend prompt-editing UI required for `linkedin.content`.

## Review Focus

- Existing non-LinkedIn campaigns (Instagram/Facebook/X only) must generate unchanged in length and tone after Task 3 rewrites `campaign.content`'s platform-adaptation section — a regression here would break every campaign, not just LinkedIn ones.
- A campaign slot scheduling LinkedIn alongside an image-first platform must still produce exactly one shared image for that slot — the spec is explicit that image generation is untouched; a tempting shortcut is to special-case LinkedIn in the image loop, which the spec forbids.
- `getPlatformRules()` called with an unrecognized or missing platform string (a typo, a future platform, `undefined`) must fall back sensibly rather than throwing and aborting generation — mirrors the old `getPlatformCaptionRules`'s existing fallback-to-`instagram` behavior.
- `POST /api/drafts/generate-linkedin-post` must fail closed on insufficient credits: no LLM call made, no draft created, 403 returned — matches every other metered generation endpoint in `drafts.js`.
- GravityApprove's new "Add image" empty state must only show for a draft that finished with no image by design (`status` is a completed state, not `'processing'` or `'failed'`) — showing it during real in-flight generation would look like a bug, and hiding the real failure state behind it would too.

---

### Task 1: Shared platform content-rules module

**Files:**
- Create: `backend/services/platformContentRules.js`
- Modify: `backend/services/geminiAI.js` (delete `getPlatformCaptionRules`, lines 358-367; update its two call sites at the current lines 444 and 640; update `generateRivalPost`'s inline platform ternary block, current lines ~2147-2150)
- Test: `backend/scripts/verify-platform-rules.js` (throwaway verification script, not a permanent test file — delete after Step 4 confirms output)

**Interfaces:**
- Produces: `getPlatformRules(platform: string) -> { platform: string, structure: 'long-form' | 'short-form' | 'micro', lengthGuidance: string, hardCharLimit: number | null, emojiGuidance: string, hashtagCount: string, promptBlock: string }`, exported as `module.exports = { getPlatformRules }`. Unrecognized platform input falls back to the `instagram` entry (case-insensitive match on `platform.toLowerCase()`, mirroring the deleted function's own fallback).

- [ ] **Step 1: Write `backend/services/platformContentRules.js`**

```js
const RULES = {
  x: {
    platform: 'x',
    structure: 'micro',
    lengthGuidance: 'STRICT 280 characters including hashtags',
    hardCharLimit: 280,
    emojiGuidance: 'none — single impactful statement',
    hashtagCount: '4',
    promptBlock:
      '- STRICT 280 character limit (including hashtags). Keep it punchy and concise.\n' +
      '- Use exactly 4 hashtags, placed at the end.\n' +
      '- No line breaks or long paragraphs — single impactful statement.'
  },
  instagram: {
    platform: 'instagram',
    structure: 'short-form',
    lengthGuidance: 'up to 2200 characters but 150-300 ideal',
    hardCharLimit: null,
    emojiGuidance: 'generous',
    hashtagCount: '4',
    promptBlock:
      '- Caption can be up to 2200 characters but keep it engaging (150-300 chars ideal for feed).\n' +
      '- Use exactly 4 relevant hashtags.\n' +
      '- Include line breaks for readability.\n' +
      '- Start with a hook in the first line (visible before "more").\n' +
      '- Use emojis generously.'
  },
  facebook: {
    platform: 'facebook',
    structure: 'short-form',
    lengthGuidance: '100-250 characters ideal',
    hardCharLimit: null,
    emojiGuidance: 'moderate',
    hashtagCount: '4',
    promptBlock:
      '- Medium length (100-250 chars ideal for engagement).\n' +
      '- Conversational and relatable tone.\n' +
      '- Exactly 4 hashtags.\n' +
      '- Include a question or CTA to drive comments.\n' +
      '- Emojis OK but moderate.'
  },
  linkedin: {
    platform: 'linkedin',
    structure: 'long-form',
    lengthGuidance: '150-300+ words — longer when real numbers, a case study or a specific story genuinely support it',
    hardCharLimit: null,
    emojiGuidance: 'minimal — 1-2 max',
    hashtagCount: '3-5',
    promptBlock:
      '- Write 150-300+ words in this 5-part structure:\n' +
      '  1. BOLD HOOK (1-2 lines): a specific, concrete claim or observation — not a question, not a generic statement. No emoji.\n' +
      '  2. CONTEXT (1-2 lines): why this matters right now, briefly.\n' +
      '  3. BREAKDOWN: the substance — real numbers, a specific example, or a case study where the brand context provides one. Short, punchy, one-idea-per-sentence paragraphs. Bold the 2-3 words that matter most in a key sentence.\n' +
      '  4. ANALYSIS / POV: a genuine opinion or contrarian take, not a summary of the breakdown.\n' +
      '  5. CTA: a real question or observation to close on — never "Sign up here" or "link in bio," and never a generic "What do you think?"\n' +
      '- 1-2 emoji maximum across the whole post, never one per section.\n' +
      '- 3-5 hashtags, lowercase preferred.\n' +
      '- Never invent a statistic or case study that is not grounded in the brand context provided — use a real one from Brand Memory, or write the point without a fabricated number.'
  }
};

function getPlatformRules(platform) {
  const key = String(platform || '').toLowerCase();
  const normalized = key === 'twitter' ? 'x' : key;
  return RULES[normalized] || RULES.instagram;
}

module.exports = { getPlatformRules };
```

- [ ] **Step 2: Write the verification script `backend/scripts/verify-platform-rules.js`**

```js
const { getPlatformRules } = require('../services/platformContentRules');

const cases = [
  ['x', 280, 'micro'],
  ['twitter', 280, 'micro'],
  ['instagram', null, 'short-form'],
  ['facebook', null, 'short-form'],
  ['linkedin', null, 'long-form'],
  ['LinkedIn', null, 'long-form'],
  ['pinterest', null, 'short-form'], // unknown -> falls back to instagram
  ['', null, 'short-form']            // empty -> falls back to instagram
];

let failed = 0;
for (const [input, expectedCharLimit, expectedStructure] of cases) {
  const r = getPlatformRules(input);
  const ok = r.hardCharLimit === expectedCharLimit && r.structure === expectedStructure && typeof r.promptBlock === 'string' && r.promptBlock.length > 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} getPlatformRules(${JSON.stringify(input)}) -> structure=${r.structure} hardCharLimit=${r.hardCharLimit}`);
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
```

- [ ] **Step 3: Run the verification script**

Run: `cd backend && node scripts/verify-platform-rules.js`
Expected: every line prints `PASS`, exit code 0.

- [ ] **Step 4: Delete the throwaway verification script**

Run: `rm backend/scripts/verify-platform-rules.js`

- [ ] **Step 5: Migrate `geminiAI.js` call sites**

At the top of `backend/services/geminiAI.js`, add:
```js
const { getPlatformRules } = require('./platformContentRules');
```
Delete the `getPlatformCaptionRules` function (current lines 358-367).
Replace its two call sites:
- Current line 444: `${platformsList.map(p => \`[${p.toUpperCase()}]\n${getPlatformCaptionRules(p)}\`).join('\n\n')}` → same shape, `getPlatformRules(p).promptBlock` in place of `getPlatformCaptionRules(p)`.
- Current line 640: `${getPlatformCaptionRules(platform)}` → `${getPlatformRules(platform).promptBlock}`.

Replace `generateRivalPost`'s inline ternary block (current lines ~2147-2150, the four `${platform === '...' ? '...' : ''}` lines under `5. **OPTIMIZED FOR ${platform.toUpperCase()}**`) with a single line: `${getPlatformRules(platform).promptBlock}`.

- [ ] **Step 6: Manually verify no remaining references**

Run: `cd backend && grep -rn "getPlatformCaptionRules" .  --include="*.js"`
Expected: no output (function fully removed and no dangling call sites).

- [ ] **Step 7: Commit**

```bash
git add backend/services/platformContentRules.js backend/services/geminiAI.js
git commit -m "Add shared per-platform content-rules module, migrate geminiAI.js call sites"
```

---

### Task 2: New `linkedin.content` prompt

**Files:**
- Modify: `backend/services/promptRegistry.js` (add a new entry to the `PROMPTS` object, alongside the existing `'single.content'` entry at line 198)

**Interfaces:**
- Consumes: nothing from Task 1 directly (this task only adds a prompt template string; Task 1's module informs the LinkedIn structure described in prose here, but the template does not `require` it).
- Produces: a registered prompt with id `'linkedin.content'`, variables `{ idea, contentPillar, objective, tone, language, brandContextBlock }`, whose rendered output (once filled and sent to an LLM) is JSON: `{ "caption": string, "hashtags": string[], "imageDescription": string }`. Consumed by Task 4.

- [ ] **Step 1: Add the `'linkedin.content'` entry to `PROMPTS` in `backend/services/promptRegistry.js`**

Insert immediately after the `'single.content'` entry closes (after its trailing `` },`` following the `single.content` template's closing backtick, i.e. right before `'carousel.masterPlan'` if that is the next key — insert as a new top-level key in the same object, following the exact same `{ label, summary, stage, variables, template }` shape every other entry uses):

```js
'linkedin.content': {
  label: 'LinkedIn post',
  summary:
    'Writes a long-form LinkedIn post in five parts — hook, context, breakdown, POV and CTA — grounded in real brand numbers and examples, not invented stats.',
  stage: 'linkedin',
  variables: {
    idea: 'The idea or brief you typed',
    contentPillar: 'Which content pillar this belongs to, if picked from the calendar',
    objective: 'What this post is meant to achieve',
    tone: 'Brand tone',
    language: 'Output language',
    brandContextBlock: 'Real brand data — identity, products, locations, testimonials, metrics — pulled from Brand Memory'
  },
  template: `ROLE:

You are a senior LinkedIn ghostwriter and creative strategist. You write for the account's real brand, not a generic template — every claim must be grounded in this brand's actual context, never an invented statistic or borrowed case study.

==================================================
BRAND INTELLIGENCE
==================================================

WHAT IS ACTUALLY AVAILABLE RIGHT NOW (Gravity's Brand Memory for this account):
{{brandContextBlock}}

Only claim a number, customer story or product detail is real when it is listed above. Everything else describes what Brand Memory can hold, not a guarantee this brand has it yet — if no real number or case study is available, write the point without fabricating one.

==================================================
POST BRIEF
==================================================

Idea:
{{idea}}

Content Pillar:
{{contentPillar}}

Objective:
{{objective}}

Tone:
{{tone}}

Language:
{{language}}
LANGUAGE ENFORCEMENT: Write the entire post, hashtags included, strictly in {{language}}. Do not default to English unless {{language}} is English.

==================================================
STRUCTURE — WRITE EXACTLY THESE FIVE PARTS
==================================================

1. BOLD HOOK (1-2 lines): a specific, concrete claim or observation — not a question, not a generic statement. No emoji here.
2. CONTEXT / WHY IT MATTERS (1-2 lines): brief background or transition line that frames the relevance.
3. BREAKDOWN: the substance. Real numbers, a specific example, or a case study — grounded in the Brand Intelligence above. Short, punchy, one-idea-per-sentence paragraphs. Bold the 2-3 words that matter most in one key sentence using **markdown-style bold** (the platform will render it).
4. ANALYSIS / POV: a genuine opinion or contrarian take — not a restatement of the breakdown.
5. CTA: a real question or observation to close on. Never a generic engagement-bait line ("What's your take?", "Do you agree?"), never a direct conversion CTA ("Sign up here", "link in bio") unless the brief specifically asks for one.

==================================================
VOICE RULES
==================================================

- 150-300+ words total — longer only when the breakdown genuinely has more real substance to cover, never padded.
- 1-2 emoji maximum across the ENTIRE post. Never one per section.
- One-sentence paragraphs for rhythm. No throat-clearing intros — jump straight into the hook.
- An em-dash is fine for a tonal shift; do not overuse it.
- Do not perform authenticity — be specific instead of vague, that is what reads as real.
- Do not chase trending topics or news the brand context does not actually mention.

==================================================
OUTPUT
==================================================

Return ONLY valid JSON (no markdown, no code blocks):
{
  "caption": "The full five-part post, ready to publish, with blank lines between parts",
  "hashtags": ["#tag1", "#tag2", "#tag3"],
  "imageDescription": "A one-sentence visual concept that would pair with this post, for later optional use — not generated automatically"
}
`
},
```

- [ ] **Step 2: Verify the prompt registers and renders**

Run:
```bash
cd backend && node -e "
const { listPrompts, buildPrompt } = require('./services/promptRegistry');
const ids = listPrompts().map(p => p.id);
console.log('registered:', ids.includes('linkedin.content'));
buildPrompt(null, 'linkedin.content', {
  idea: 'We just crossed 500 customers',
  contentPillar: '', objective: 'awareness', tone: 'confident', language: 'English',
  brandContextBlock: 'Brand: Acme Co. 500 paying customers as of this month.'
}).then(t => console.log('renders:', t.includes('500 customers') && t.includes('FIVE PARTS')));
"
```
Expected: `registered: true` and `renders: true`.

- [ ] **Step 3: Commit**

```bash
git add backend/services/promptRegistry.js
git commit -m "Add linkedin.content prompt template"
```

---

### Task 3: Per-post platform rules in the campaign flow

**Files:**
- Modify: `backend/services/promptRegistry.js` (`campaign.content` entry: add `platformAssignmentsBlock` to `variables`, replace the `PLATFORM ADAPTATION` section in the `template`)
- Modify: `backend/routes/campaigns.js` (`generate-campaign-stream` handler: build the new block and pass it into `captionVars`; extend `validateCaptionsSchema` with a LinkedIn length flag)

**Interfaces:**
- Consumes: `getPlatformRules` from Task 1 (`backend/services/platformContentRules.js`).
- Produces: nothing new consumed by later tasks — this task is a leaf.

- [ ] **Step 1: Build `platformAssignmentsBlock` in `backend/routes/campaigns.js`**

Add near the top of the file: `const { getPlatformRules } = require('../services/platformContentRules');`

Immediately after `scheduleDates` is computed (current code: `const scheduleDates = slotDates.map((slot, i) => ({ ...slot, platform: String(platforms[i % platforms.length] || 'instagram').trim().toLowerCase() }));`), add:

```js
const platformAssignmentsBlock = scheduleDates
  .map((slot, i) => {
    const rules = getPlatformRules(slot.platform);
    return `Post ${i + 1} — ${rules.platform.toUpperCase()}:\n${rules.promptBlock}`;
  })
  .join('\n\n');
```

Add `platformAssignmentsBlock` to the `captionVars` object (the object built just before `const captionPrompt = await buildPrompt(...)`).

- [ ] **Step 2: Update `campaign.content`'s template in `backend/services/promptRegistry.js`**

Add `platformAssignmentsBlock: 'Per-post platform rules, one block per post in generation order'` to the `variables` object.

Replace the entire `PLATFORM ADAPTATION` section (currently: a heading followed by two sentences — "When multiple platforms are selected... Do not unnecessarily create different visual concepts simply because the platform changes.") with:

```
==================================================
PLATFORM ADAPTATION — FOLLOW EXACTLY, PER POST
==================================================

Each post below is written for a specific platform. Follow that post's platform rules exactly — length, structure and hashtag count are not optional suggestions, they are requirements. The visual concept may stay consistent across the campaign; the platform rules below govern the CAPTION TEXT ONLY, never the image direction.

{{platformAssignmentsBlock}}

Match each rules block to its post by position — the first block is post 1, the second is post 2, and so on, in the same order as the posts you output below.
```

- [ ] **Step 3: Extend `validateCaptionsSchema` in `backend/routes/campaigns.js` with a LinkedIn length flag**

Inside the existing `posts.forEach((post, i) => { ... })` loop in `validateCaptionsSchema`, after the existing checks, add:

```js
if (platform === 'linkedin') {
  const wordCount = normalizedCaption.split(/\s+/).filter(Boolean).length;
  if (wordCount < 100) {
    errs.push(`Post ${i + 1} (${post.platform}) is only ${wordCount} words — LinkedIn posts should be 150-300+ words`);
  }
}
```

(`platform` and `normalizedCaption` are already in scope at that point in the existing loop — this mirrors the existing checks' style exactly. This is logged only; per the existing code, `maxAttempts = 1` and a validation failure here does not block generation or trigger a retry, matching the spec's "flag, not hard-fail" requirement without any new control-flow.)

- [ ] **Step 4: Manually verify with a live generation**

With the dev servers running (`gravity-backend` on port 5000, `gravity-frontend` on port 3000 per this repo's `.claude/launch.json`), log in, go to Create → Campaign, select platforms `Instagram` and `LinkedIn`, generate a 2-post campaign, and confirm in the backend logs (or the returned drafts) that:
- The Instagram post is short (roughly 150-300 chars).
- The LinkedIn post is long-form (100+ words, ideally 150-300+) and visibly follows the 5-part structure.
- Both posts in the same slot (if scheduled together) share one image, and every post has an image (no post is missing one) — confirming Part 2's "image generation untouched" constraint held.

- [ ] **Step 5: Commit**

```bash
git add backend/services/promptRegistry.js backend/routes/campaigns.js
git commit -m "Inject real per-post platform rules into the campaign generation prompt"
```

---

### Task 4: `POST /api/drafts/generate-linkedin-post` endpoint

**Files:**
- Modify: `backend/routes/drafts.js` (add new route, near `generate-image-bg` for proximity to the pattern it mirrors)

**Interfaces:**
- Consumes: `linkedin.content` prompt from Task 2 (`buildPrompt(userId, 'linkedin.content', vars)`); `getPlatformRules` is not needed directly here (the prompt already encodes LinkedIn's rules).
- Produces: `POST /api/drafts/generate-linkedin-post` — request body `{ idea: string, contentPillar?: string, objective?: string, tone?: string, language?: string }`; success response `{ success: true, caption: string, hashtags: string[], imageDescription: string, creditsRemaining: number }`; failure responses match the existing `generate-image-bg` shape (`{ success: false, message, creditsExhausted?: true }`, HTTP 403 on insufficient credits, 500 on generation failure). Consumed by Task 5.

- [ ] **Step 1: Add required imports to the top of `backend/routes/drafts.js`**

```js
const { buildPrompt } = require('../services/promptRegistry');
const { buildBrandMemoryBlock } = require('../services/brandMemory');
const { callTextLLM } = require('../services/openAI');
const { parseGeminiJSON } = require('../services/geminiAI');
```

- [ ] **Step 2: Add the route, placed directly before `router.post('/generate-image-bg', ...)`**

```js
// Text-only LinkedIn post generation — no image call. Mirrors
// generate-image-bg's credit-deduct/refund-on-failure shape, but meters
// as campaign_text (caption-only cost) since no image model runs here.
router.post('/generate-linkedin-post', protect, checkTrial, async (req, res) => {
  let creditsDeducted = false;
  try {
    const userId = req.user.userId || req.user.id;
    const { idea, contentPillar, objective, tone, language } = req.body;

    if (!String(idea || '').trim()) {
      return res.status(400).json({ success: false, message: 'Give it an idea or brief first.' });
    }

    const creditResult = await deductCredits(userId, 'campaign_text', 1, 'AI LinkedIn post generation');
    if (!creditResult.success) {
      return res.status(403).json({
        success: false,
        creditsExhausted: true,
        message: creditResult.error || `Insufficient Quarks. Need ${CREDIT_COSTS.campaign_text} Quarks to generate a LinkedIn post.`
      });
    }
    creditsDeducted = true;

    const brandContextBlock = await buildBrandMemoryBlock(userId);
    const prompt = await buildPrompt(userId, 'linkedin.content', {
      idea: idea.trim(),
      contentPillar: contentPillar || '',
      objective: objective || '',
      tone: tone || '',
      language: language || 'English',
      brandContextBlock
    });

    const raw = await callTextLLM(prompt, { jsonMode: true, maxTokens: 2000 });
    const parsed = parseGeminiJSON(raw);

    if (!parsed?.caption) {
      throw new Error('Generation did not return a caption');
    }

    res.json({
      success: true,
      caption: parsed.caption,
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
      imageDescription: parsed.imageDescription || '',
      creditsRemaining: creditResult.creditsRemaining
    });
  } catch (error) {
    console.error('Generate LinkedIn post error:', error);
    if (creditsDeducted) {
      try {
        await refundCredits(req.user.userId || req.user.id, 'campaign_text', 1, 'Refund: LinkedIn post generation failed');
      } catch (refundErr) {
        console.error('⚠️ Failed to refund Quarks after LinkedIn post generation error:', refundErr.message);
      }
    }
    res.status(500).json({ success: false, message: 'Failed to generate LinkedIn post', error: error.message });
  }
});
```

- [ ] **Step 3: Manually verify with curl** (backend dev server running on port 5000; substitute a real JWT for `$TOKEN`, minted per this repo's established pattern: `node -e "require('dotenv').config(); const jwt = require('jsonwebtoken'); console.log(jwt.sign({ userId: '<a real user id>', id: '<same id>' }, process.env.JWT_SECRET, { expiresIn: '7d' }));"` run from `backend/`)

Run:
```bash
curl -s -X POST http://localhost:5000/api/drafts/generate-linkedin-post \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"idea":"We just crossed 500 customers","objective":"awareness","tone":"confident"}' | python3 -m json.tool
```
Expected: `success: true`, `caption` present and roughly 150+ words, `hashtags` a non-empty array, HTTP 200. Then re-run with an intentionally invalid/expired token and confirm a 401 (existing `protect` middleware behavior, unchanged) rather than a crash.

- [ ] **Step 4: Verify the fail-closed credit path by code inspection**

Re-read the route as written and confirm, line by line: `deductCredits` is called and awaited *before* `buildPrompt`/`callTextLLM` run (so an exhausted account is never charged an LLM call), the `403` branch `return`s immediately without falling through, and the `catch` block's `refundCredits` call is gated on `creditsDeducted` (so a request that never got past the credit check doesn't attempt a refund of credits it never took). This mirrors `generate-image-bg`'s existing shape immediately below this new route in the same file — confirm the two match in this respect.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/drafts.js
git commit -m "Add POST /api/drafts/generate-linkedin-post endpoint"
```

---

### Task 5: New "LinkedIn" tab in Create

**Files:**
- Modify: `frontend/pages/GravityCreate.tsx` (add `'linkedin'` to `CreateMode`, add the 4th tab button, add the LinkedIn form branch, add `handleDraftLinkedInPost`, extend the result-card rendering for image-less LinkedIn results, extend the `PromptStudio` `focus` prop)
- Modify: `frontend/services/api.ts` (add `draftsAPI.generateLinkedInPost`)

**Interfaces:**
- Consumes: `POST /api/drafts/generate-linkedin-post` from Task 4; the existing `POST /api/drafts/save` and `draftsAPI.retryImageGeneration` (both already implemented, no changes).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the API call in `frontend/services/api.ts`**

Add near the other `draftsAPI` methods (alongside `retryImageGeneration` at line ~4384):

```ts
generateLinkedInPost: async (params: {
  idea: string; contentPillar?: string; objective?: string; tone?: string; language?: string;
}): Promise<{ success: boolean; caption: string; hashtags: string[]; imageDescription: string; message?: string }> => {
  return apiCall('/drafts/generate-linkedin-post', {
    method: 'POST',
    body: JSON.stringify(params)
  }, true);
},
```

- [ ] **Step 2: Add `'linkedin'` to `CreateMode` in `frontend/pages/GravityCreate.tsx`**

Current line 36: `type CreateMode = 'campaign' | 'single' | 'carousel';` → `type CreateMode = 'campaign' | 'single' | 'carousel' | 'linkedin';`

- [ ] **Step 3: Add the 4th tab button**

Immediately after the existing "Carousel" button (in the mode-toggle `div`, after the `GalleryHorizontalEnd` button closes), add a fourth button following the exact same conditional-class pattern as the other three:

```tsx
<button
  onClick={() => setMode('linkedin')}
  className={`flex items-center gap-2 h-9 px-5 rounded-full text-[13px] font-semibold transition-colors ${
    mode === 'linkedin' ? 'bg-[var(--gv-surface-3)] text-[var(--gv-text-primary)]' : 'text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-secondary)]'
  }`}
>
  <Linkedin className="w-3.5 h-3.5" />
  LinkedIn
</button>
```

(Import `Linkedin` from `lucide-react` at the top of the file if not already imported — `ConnectSocials.tsx` already imports it from the same package, same icon name.)

- [ ] **Step 4: Write `handleDraftLinkedInPost`**

Add alongside the existing `handleDraftSinglePost` (~line 563):

```tsx
const handleDraftLinkedInPost = async () => {
  setProgressMsg('Writing your LinkedIn post…');
  const res = await draftsAPI.generateLinkedInPost({
    idea: description.trim() || name.trim(),
    contentPillar: ideaContext.contentPillar,
    objective: ideaContext.objective,
    tone,
    language: languageValueFromLabel(language)
  });
  if (!res.success) {
    throw new Error(res.message || 'Failed to generate LinkedIn post.');
  }
  const saved = await draftsAPI.save({
    title: name.trim() || 'Untitled LinkedIn post',
    caption: res.caption,
    hashtags: res.hashtags,
    platforms: ['linkedin'],
    sourceType: 'post',
    contentType: 'post',
    imageUrl: '',
    imagePrompt: res.imageDescription || ''
  });
  setResults([saved.draft]);
  setPostsGenerated(1);
};
```

Wire it into `handleDraft` (current `if (mode === 'carousel') {...} else if (mode === 'single') {...} else {...}` chain): add `else if (mode === 'linkedin') { await handleDraftLinkedInPost(); }` before the final `else`.

Add `mode === 'linkedin' ? 1 : ...` to the existing `expectedCount` ternary (so it reads consistently as one-post-per-run, matching `single`/`carousel`'s existing pattern).

- [ ] **Step 5: Add the LinkedIn mode's form branch**

Find where `mode === 'single'` currently renders its one-line idea input (the existing conditional block near the other `mode ===` branches in the form section, e.g. around the existing `placeholder={mode === 'campaign' ? ... : 'Sunday pour-over ritual'}` area). Add a `mode === 'linkedin'` branch that renders a large `<textarea>` bound to the same `description` state the other modes already use, but with `rows={8}` (long-form input, not a one-liner) and placeholder text like `"We just crossed 500 customers — what that actually took"`. No platform picker is rendered in this branch (LinkedIn is implicit). No aspect-ratio or image-style controls render either (this mode has no image step at generation time).

- [ ] **Step 6: Handle image-less result cards**

In the shared result-card renderer (`results.map((d: any) => { ... })`, current line ~1393), the image box at the top (`<div className="relative bg-black/40" ...>`) currently always renders (showing the real image, a failure state, or `GeneratingFill`). Add a branch: when `mode === 'linkedin' && !img && !processing && !failed`, render a simple "No image yet" placeholder with an **Add image** button instead of `GeneratingFill` (which implies generation is already in progress — wrong here, since none was requested). The button's `onClick` reuses the existing `regenerateImage(d)` function unchanged.

Also: the caption paragraph below the image box (`<p className="text-[12.5px] leading-snug ...">{d.caption || ...}</p>`) has no max-height/line-clamp today, so a 150-300+ word LinkedIn caption already renders in full — no change needed there.

- [ ] **Step 7: Extend the `PromptStudio` `focus` prop**

Current line ~1041: `focus={mode === 'campaign' ? 'campaign.content' : mode === 'carousel' ? 'carousel.content' : 'single.content'}` → add a branch: `focus={mode === 'campaign' ? 'campaign.content' : mode === 'carousel' ? 'carousel.content' : mode === 'linkedin' ? 'linkedin.content' : 'single.content'}`.

- [ ] **Step 8: Manually verify in the browser**

With `gravity-frontend` and `gravity-backend` running, log in, go to Create, click the new "LinkedIn" tab, type an idea, click generate. Confirm:
- A single draft card appears with no image box filled in, showing "No image yet" / Add image, and the full long-form caption text visible.
- Clicking "Add image" starts image generation (spinner/placeholder appears, then resolves to a real image) without erroring.
- Opening PromptStudio while on the LinkedIn tab shows `linkedin.content` as the focused, editable prompt.

- [ ] **Step 9: Commit**

```bash
git add frontend/pages/GravityCreate.tsx frontend/services/api.ts
git commit -m "Add LinkedIn tab to Create: text-first, opt-in image generation"
```

---

### Task 6: "Add image" state in Approve

**Files:**
- Modify: `frontend/pages/GravityApprove.tsx` (grid-view card action row, current ~line 656-662; detail-view preview panel's empty-image branch, current ~line 692-705)

**Interfaces:**
- Consumes: existing `draftsAPI.retryImageGeneration` / `handleRedo` / `handleGridRedo` (all already implemented, unchanged).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Fix the grid-view "Regenerate" button for image-less drafts**

At the grid card's action row (current lines 656-662, the `<button onClick={(e) => handleGridRedo(d, e)} ... title="Regenerate">` with a `RotateCcw` icon): wrap the `title` and visible icon in a condition on `d.imageUrl`. When `!d.imageUrl`, `title` should read `"Add image"`. The icon can stay `RotateCcw` (no new icon import needed) since the action is mechanically identical (`retryImageGeneration`) — only the label is misleading today.

- [ ] **Step 2: Fix the detail-view empty-image branch**

The final `else` branch of the image-preview conditional (current lines ~692-705, the "generating…" spinner state with `Loader2`) currently renders unconditionally whenever there's no `imageUrl` and the status isn't `'failed'` — including for a draft that was never supposed to have an image (a LinkedIn draft saved with `imageUrl: ''` by design). Add a new branch before this one: when `!imageUrl` and `current?.status` is a completed state (i.e., NOT `'processing'`), render a distinct empty state — reuse the existing "Image generation failed" panel's visual structure (same gradient background, centered content) but with copy like "No image yet" / "This post doesn't have an image" and a button labeled **Add image** whose `onClick` calls the existing `handleRedo`. The genuine `status === 'processing'` case keeps rendering the current spinner state unchanged.

- [ ] **Step 3: Fix the `redoDraft` confirm-dialog copy for image-less drafts**

In `redoDraft` (current lines ~286-298), the confirm dialog text ("This costs N Quarks and replaces the current image." / title "Regenerate this image?") assumes an image already exists. Branch on `draft?.imageUrl`: when absent, use "This costs N Quarks and adds an image to this post." / title "Add an image?" instead. Keep the existing cost-bearing branch (`cost > 0 ? ... : ...`) exactly as-is, just parameterize the "replaces"/"adds" and "Regenerate"/"Add" wording on whether `draft.imageUrl` is present.

- [ ] **Step 4: Manually verify in the browser**

With a LinkedIn draft saved via Task 5 (no image), open Approve. Confirm:
- The grid card shows "Add image" (not "Regenerate") as the button's tooltip/title for that draft.
- Opening the draft's detail view shows the new "No image yet" empty state, not an infinite "generating…" spinner.
- Clicking "Add image" (either surface) shows the correct confirm-dialog copy, then successfully generates and displays an image.
- A normal (non-LinkedIn, has-image) draft is unaffected — grid button still says "Regenerate," detail view still shows the image or the real failure/generating states as before.

- [ ] **Step 5: Commit**

```bash
git add frontend/pages/GravityApprove.tsx
git commit -m "Add distinct 'Add image' state for drafts saved without one"
```

---

## Final Verification

- Run through Task 3's Step 4 scenario again end-to-end (mixed-platform campaign) to confirm nothing in Tasks 4-6 regressed it.
- Confirm a plain Instagram-only campaign (no LinkedIn involved at all) still generates and approves normally — the full existing flow, untouched by any of this plan's changes, should show zero behavior difference.
- Confirm `backend/scripts/` has no leftover throwaway script from Task 1 (`git status` should show it was never committed, or is absent).
