# Complete API Cost Map — Every User Action → Actual API Cost

> Generated from full source-code audit of all 17 route files + 2 service files.

## Pricing Reference

| API | Model / Service | Pricing |
|-----|-----------------|---------|
| **Gemini** | `gemini-3-pro-preview` (text) | $0.000002/input token, $0.000012/output token |
| **Gemini** | `gemini-2.0-flash` (vision) | Same token pricing (cheaper model, smaller prompts) |
| **Gemini** | `nano-banana-pro-preview` (image gen) | Free preview / pricing TBD (currently no charge) |
| **Grok** | `grok-beta` via X.AI | Falls back to Gemini if key missing; assume Gemini pricing |
| **Imagen 4 Ultra** | `imagen-4.0-ultra-generate-001` | **$0.06/image** |
| **Imagen 3 Fast** | `imagen-3.0-fast-generate-001` | **$0.02/image** (1st fallback) |
| **Imagen 3 Standard** | `imagen-3.0-generate-001` | **$0.04/image** (2nd fallback) |
| **Apify** | Instagram scraper (PPR) | **$0.0026/result** |
| **Apify** | Website Content Crawler | **~$0.50/run** (5 pages) |
| **Cloudinary** | Image upload/transform | **~$0.001/upload** |
| **Ayrshare** | Social media management | **$599/mo flat** (all calls included) |

### Token Cost Shorthand

For Gemini text calls, estimated cost per call:

| maxOutputTokens | Typical Input | Estimated Cost |
|-----------------|---------------|----------------|
| 200 | ~500 tokens | $0.003 |
| 400 | ~500 tokens | $0.006 |
| 500 | ~800 tokens | $0.008 |
| 1000 | ~1000 tokens | $0.014 |
| 1500 | ~1500 tokens | $0.021 |
| 2000 | ~1500 tokens | $0.027 |
| 2048 | ~2000 tokens | $0.029 |
| 4000 | ~2000 tokens | $0.052 |
| 4096 | ~2000 tokens | $0.053 |
| 8192 (default) | ~2000 tokens | $0.102 |
| 16384 | ~3000 tokens | $0.203 |

---

## 1. DASHBOARD (`/api/dashboard`)

### `GET /overview` — Load Dashboard
**User Action:** Open dashboard page

| API Call | Model | maxTokens | Details | Cost |
|----------|-------|-----------|---------|------|
| 1× Gemini | `gemini-3-pro-preview` | 8192 | `generateDashboardInsights()` | ~$0.10 |
| 1× Ayrshare | `getAyrshareUserProfile` | — | Get connected accounts | Flat fee |
| 1× Apify (conditional) | Instagram scraper | resultsLimit: 12 | `fetchRealCompetitorPosts()` — only if competitors exist | ~$0.03 |
| 1× Gemini (fallback) | `gemini-3-pro-preview` | 2000 | `generateCompetitorActivity()` — if Apify fails | ~$0.03 |
| 1× Gemini (conditional) | `gemini-3-pro-preview` | 8192 | `autoDiscoverCompetitorsForUser()` — only if 0 competitors | ~$0.10 |

**Total per load: ~$0.10–$0.23** (depends on competitor state + Apify success)

---

### `GET /campaign-suggestions` — AI Campaign Cards
**User Action:** View suggested campaigns on dashboard

| API Call | Model | maxTokens | Details | Cost |
|----------|-------|-----------|---------|------|
| 1× Gemini | `gemini-3-pro-preview` | **16384** | `generateCampaignSuggestions()` — generates 6 campaigns | ~$0.20 |
| Up to 6× Imagen 4 Ultra | `imagen-4.0-ultra-generate-001` | — | One image per campaign via `getRelevantImage()` | 6 × $0.06 = **$0.36** |
| Up to 6× Cloudinary | Upload | — | Upload each generated image | 6 × $0.001 = $0.006 |

**Total: ~$0.57** (cached after first generation)

---

### `GET /campaign-suggestions-stream` — SSE Campaign Stream
**User Action:** Stream-load campaigns one by one

| API Call | Model | maxTokens | Details | Cost |
|----------|-------|-----------|---------|------|
| N× Gemini | `gemini-3-pro-preview` | **1024** | `generateSingleCampaign()` × N (default 6) | 6 × $0.015 = $0.09 |
| N× Imagen 4 Ultra | `imagen-4.0-ultra-generate-001` | — | One image per campaign | 6 × $0.06 = **$0.36** |
| N× Cloudinary | Upload | — | Upload each image | 6 × $0.001 = $0.006 |

**Total: ~$0.46** per stream (not cached, `skipCache: true`)

---

### `POST /refresh` — Force Refresh Dashboard
**User Action:** Click refresh button

| API Call | Model | maxTokens | Cost |
|----------|-------|-----------|------|
| 1× Gemini | `gemini-3-pro-preview` | 8192 | ~$0.10 |

---

### `POST /synopsis` — Section Synopsis
**User Action:** Click "AI Synopsis" on any dashboard section

| API Call | Model | maxTokens | Cost |
|----------|-------|-----------|------|
| 1× Gemini | `gemini-3-pro-preview` | **400** | ~$0.006 |

---

### `POST /generate-rival-post` — Counter Competitor Post
**User Action:** Click "Generate Rival Post" on competitor activity

| API Call | Model | maxTokens | Details | Cost |
|----------|-------|-----------|---------|------|
| 1× Gemini | `gemini-3-pro-preview` | **1500** | Caption + hashtags | ~$0.02 |
| 1× Imagen 4 Ultra | `imagen-4.0-ultra-generate-001` | — | Generated image | $0.06 |
| 1× Cloudinary | Upload | — | | $0.001 |

**Total: ~$0.08**

---

### `POST /generate-event-post` — Holiday/Event Post
**User Action:** Click event card → "Generate Post"

| API Call | Model | maxTokens | Details | Cost |
|----------|-------|-----------|---------|------|
| 1× Gemini | `gemini-3-pro-preview` | **2048** | Caption, hashtags, image prompt | ~$0.03 |
| 1× Imagen 4 Ultra | `imagen-4.0-ultra-generate-001` | — | `generateImageFromCustomPrompt()` | $0.06 |
| 1× Cloudinary | Upload | — | | $0.001 |

**Total: ~$0.09**

---

### `POST /refresh-competitor-posts` — Refresh Competitor Posts
**User Action:** Click refresh on competitor section

| API Call | Details | Cost |
|----------|---------|------|
| N× Apify | `fetchRealCompetitorPosts()` per competitor (up to 10), limit: 5 per | N × ~$0.013 |

**Total: ~$0.07–$0.13** (5–10 competitors)

---

### `GET /strategic-advisor` — Strategic Content Suggestions
**User Action:** Open Strategic Advisor tab

| API Call | Model | maxTokens | Cost |
|----------|-------|-----------|------|
| 1× Gemini | `gemini-3-pro-preview` | **4096** | ~$0.05 |

---

### `POST /strategic-advisor/generate-post` — Generate From Suggestion
**User Action:** Click "Generate Post" on a suggestion

| API Call | Model | maxTokens | Details | Cost |
|----------|-------|-----------|---------|------|
| 1× Gemini | `gemini-3-pro-preview` | **2048** | `generatePostFromSuggestion()` | ~$0.03 |
| 1× Imagen 4 Ultra | `imagen-4.0-ultra-generate-001` | — | Image from generated prompt | $0.06 |
| 1× Cloudinary | Upload | — | | $0.001 |

**Total: ~$0.09**

---

### `POST /strategic-advisor/refine-image` — Refine Generated Image
**User Action:** Click "Refine" on a generated image

| API Call | Model | Details | Cost |
|----------|-------|---------|------|
| 1× Imagen 4 Ultra | `imagen-4.0-ultra-generate-001` | `refineImageWithPrompt()` | $0.06 |
| 1× Cloudinary | Upload | | $0.001 |

**Total: ~$0.06**

---

### `GET /social-followers` — Follower Bar Chart
**User Action:** Dashboard auto-loads follower counts

| API Call | Details | Cost |
|----------|---------|------|
| 1× Ayrshare | `getAyrshareUserProfile()` | Flat fee |
| 1× Ayrshare | `getUserSocialAnalytics()` | Flat fee |

**Total: $0 (flat fee)**

---

### `POST /post-to-social` — Post from Dashboard
**User Action:** Post to social media

| API Call | Details | Cost |
|----------|---------|------|
| 1× Ayrshare | `postToSocialMedia()` | Flat fee |

---

### `GET /social-analytics` — Dashboard Social Analytics

| API Call | Details | Cost |
|----------|---------|------|
| 1× Ayrshare | `getAyrshareAnalytics()` | Flat fee |

---

### `GET /real-time-competitor/:name` — Real-Time Competitor

| API Call | Details | Cost |
|----------|---------|------|
| 1× Apify | `getCompetitorAnalysis()` | ~$0.03 |

---

## 2. CAMPAIGNS (`/api/campaigns`)

### `POST /generate` — Generate Campaign Caption
**User Action:** Click "Generate" in campaign creator

| API Call | Model | maxTokens | Cost |
|----------|-------|-----------|------|
| 1× Gemini | `gemini-3-pro-preview` | **1500** | ~$0.02 |

---

### `POST /:id/enhance` — AI Enhance Campaign
**User Action:** Click "Enhance with AI"

| API Call | Model | maxTokens | Cost |
|----------|-------|-----------|------|
| 1× Gemini | `gemini-3-pro-preview` | **1000** | ~$0.014 |

---

### `POST /:id/publish` — Publish Campaign
**User Action:** Click "Publish" or "Schedule"

| API Call | Details | Cost |
|----------|---------|------|
| 1× Ayrshare | `postToSocialMedia()` | Flat fee |
| 1× Cloudinary (conditional) | Only if image is base64 (needs upload first) | $0.001 |

---

### `POST /generate-campaign-posts` — Generate Full Campaign (Multi-Post)
**User Action:** Click "Generate Campaign Posts" with N posts

| API Call | Model | maxTokens | Details | Cost |
|----------|-------|-----------|---------|------|
| 1× Gemini | `gemini-3-pro-preview` | **4000** | Generate all post captions at once | ~$0.05 |
| N× Imagen 4 Ultra | `imagen-4.0-ultra-generate-001` | — | One image per post (max 20) | N × $0.06 |
| N× Cloudinary | Upload | — | Upload each image | N × $0.001 |
| 1× Cloudinary (conditional) | Logo upload | If logo provided | $0.001 |
| N× Cloudinary (conditional) | Logo overlay | If logo provided | N × $0.001 |

**Example: 10 posts = $0.05 + $0.60 + $0.01 + $0.01 = ~$0.67**
**Example: 20 posts = $0.05 + $1.20 + $0.02 + $0.02 = ~$1.29**

---

### `POST /regenerate-post-image` — Regenerate Single Image
**User Action:** Click "Regenerate Image" on a post

| API Call | Details | Cost |
|----------|---------|------|
| 1× Imagen 4 Ultra | Generate new image | $0.06 |
| 1× Cloudinary | Upload | $0.001 |
| 1× Cloudinary (conditional) | Logo overlay if enabled | $0.001 |

**Total: ~$0.06**

---

### `POST /edit-post-image` — Edit Existing Image
**User Action:** Edit an image with text instructions

| API Call | Details | Cost |
|----------|---------|------|
| 1× Imagen 4 Ultra | Generate edited image | $0.06 |
| 1× Cloudinary | Upload | $0.001 |

**Total: ~$0.06**

---

### `POST /generate-caption` — Caption From Image
**User Action:** Upload image → auto-generate caption

| API Call | Model | maxTokens | Cost |
|----------|-------|-----------|------|
| 1× Gemini Vision | **`gemini-2.0-flash`** | **500** | ~$0.008 |

---

### `POST /template-poster` — Generate Poster from Template
**User Action:** Upload template → generate poster

| API Call | Model | Details | Cost |
|----------|-------|---------|------|
| 1× Gemini | `nano-banana-pro-preview` | `generateTemplatePoster()` | Free (preview) |
| 1× Cloudinary | Upload result | | $0.001 |
| 1× Gemini Vision (conditional) | `gemini-2.0-flash` | `detectLogoInImage()` if logo overlay enabled | ~$0.008 |
| 1× Cloudinary (conditional) | Logo overlay | | $0.001 |

**Total: ~$0.001–$0.01**

---

### `POST /template-poster/edit` — Edit Generated Poster
**User Action:** Give text instructions to edit poster

| API Call | Model | Details | Cost |
|----------|-------|---------|------|
| 1× Gemini | `nano-banana-pro-preview` | `editTemplatePoster()` (up to 3 retries) | Free (preview) |
| 1× Cloudinary | Upload | | $0.001 |

**Total: ~$0.001**

---

### `POST /template-poster/from-reference` — Poster From Reference
**User Action:** Upload reference image → generate new poster in same style

| API Call | Model | Cost |
|----------|-------|------|
| 1× Gemini | `nano-banana-pro-preview` | Free (preview) |
| 1× Cloudinary | Upload | $0.001 |

**Total: ~$0.001**

---

### `POST /template-poster/batch` — Batch Poster Generation
**User Action:** Generate multiple posters at once (max 10)

| API Call | Details | Cost |
|----------|---------|------|
| N× Gemini | `nano-banana-pro-preview` × N | Free (preview) |
| N× Cloudinary | Upload × N | N × $0.001 |

**Total: ~$0.01** (for 10 posters)

---

### `POST /process-aspect-ratio` — Resize Image
**User Action:** Change aspect ratio of an image

| API Call | Cost |
|----------|------|
| 1× Cloudinary upload + transform | $0.001 |

---

### `GET /:id/analytics` — Campaign Analytics

| API Call | Cost |
|----------|------|
| 1× Ayrshare `getAyrshareAnalytics()` | Flat fee |

---

### `GET /:id/verify-status` — Verify Post Status

| API Call | Cost |
|----------|------|
| 1× Ayrshare `getPostStatus()` | Flat fee |

---

### `GET /` — List Campaigns (with status verification)

| API Call | Details | Cost |
|----------|---------|------|
| N× Ayrshare | `getPostStatus()` for each past-due scheduled campaign | Flat fee |

---

## 3. CONTENT (`/api/content`)

### `POST /generate` — Generate Content Suite
**User Action:** Click "Generate Content"

| # | API Call | Provider | maxTokens | Cost |
|---|----------|----------|-----------|------|
| 1 | `generatePostVariants()` | Grok → Gemini fallback | 4096 | ~$0.05 |
| 2 | `generateLongForm()` | Gemini | 8192 | ~$0.10 |
| 3 | `generateHashtags()` | Gemini | 8192 | ~$0.10 |
| 4 | `checkCompliance()` | Gemini | 8192 | ~$0.10 |

**Total: 4 LLM calls = ~$0.35**

---

### `POST /:id/regenerate` — Regenerate Content
**User Action:** Click "Regenerate"

| API Call | Provider | maxTokens | Cost |
|----------|----------|-----------|------|
| 1× `generateWithLLM()` | Grok → Gemini fallback | 4096 | ~$0.05 |

---

### `POST /:id/compliance-check` — Check Compliance
**User Action:** Click "Check Compliance"

| API Call | Provider | maxTokens | Cost |
|----------|----------|-----------|------|
| 1× `checkCompliance()` | Gemini | 8192 | ~$0.10 |

---

## 4. ANALYTICS (`/api/analytics`)

### `POST /post-analytics` — Post-Level Analytics

| API Call | Cost |
|----------|------|
| 1× Ayrshare `getPostAnalytics()` | Flat fee |

---

### `POST /social-analytics` — Social Analytics

| API Call | Cost |
|----------|------|
| 1× Ayrshare `getSocialAnalyticsDetailed()` | Flat fee |

---

### `POST /daily-analytics` — Daily Analytics

| API Call | Cost |
|----------|------|
| 1× Ayrshare `getSocialAnalyticsDetailed()` | Flat fee |

---

### `POST /import/csv` or `POST /import/manual` — Import Analytics Data
**User Action:** Upload CSV or enter manual analytics

| # | API Call | Provider | Details | Cost |
|---|----------|----------|---------|------|
| 1 | (async) `analyzeMetrics()` → insights | Gemini | 8192 tokens | ~$0.10 |
| 2 | (async) `analyzeMetrics()` → actions | Grok | 4096 tokens | ~$0.05 |

**Total: 2 LLM calls = ~$0.15** (async, runs in background)

---

### `POST /:id/regenerate-insights` — Regenerate Insights
**User Action:** Click "Regenerate Insights"

Same as import: **~$0.15** (2 LLM calls)

---

## 5. COMPETITORS (`/api/competitors`)

### `POST /auto-discover` — Auto-Discover Competitors
**User Action:** Click "Discover Competitors"

| # | API Call | Model | maxTokens | Cost |
|---|----------|-------|-----------|------|
| 1 | Gemini | `gemini-3-pro-preview` | **4000**, skipCache | ~$0.05 |
| 2 | Background: N× Apify | Instagram scraper | Per competitor (up to 5) | 5 × ~$0.03 = $0.15 |

**Total: ~$0.20** (includes background scraping)

---

### `POST /` — Add Competitor (with Website)
**User Action:** Add competitor with website URL

| # | API Call | Details | Cost |
|---|----------|---------|------|
| 1 | Web scrape (basic HTTP or Apify fallback) | `scrapeWebsite()` / `scrapeWebsiteWithApify()` | $0–$0.50 |
| 2 | 1× Gemini | Analyze scraped content, 8192 tokens | ~$0.10 |

**Total: ~$0.10–$0.60**

---

### `GET /real/:id` — Real-Time Competitor Data
**User Action:** Click "Fetch Real Data" on a competitor

| API Call | Details | Cost |
|----------|---------|------|
| 1× Apify | `scrapeInstagramProfile()` (resultsLimit: 12) | ~$0.03 |

---

### `POST /scrape-by-type` — Scrape Competitors by Type
**User Action:** Click scrape button for regional/national/global tab

| API Call | Details | Cost |
|----------|---------|------|
| Up to 7× Apify | `findInstagramProfile()` per competitor | 7 × ~$0.03–0.08 = **$0.21–$0.56** |

Each `findInstagramProfile()` may make 1–4 Apify calls (profile + search + variations).

---

### `POST /scrape-all` — Scrape All Competitors
**User Action:** Click "Scrape All"

| API Call | Details | Cost |
|----------|---------|------|
| Up to 5× Apify | `scrapeInstagramProfile()` per competitor | 5 × ~$0.03 = **$0.15** |

---

### `POST /:id/refresh-posts` — Refresh Single Competitor Posts
**User Action:** Click refresh on a specific competitor

| API Call | Cost |
|----------|------|
| 1× Apify `scrapeInstagramProfile()` | ~$0.03 |

---

### `POST /seed-sample` — Generate Sample Competitors
**User Action:** Auto-seed sample data (first visit)

| API Call | Model | maxTokens | Cost |
|----------|-------|-----------|------|
| 1× Gemini | `gemini-3-pro-preview` | 2000 | ~$0.027 |

---

### `POST /analyze` — AI Competitor Analysis
**User Action:** Click "Analyze" on a competitor

| API Call | Model | maxTokens | Cost |
|----------|-------|-----------|------|
| 1× Gemini | `gemini-3-pro-preview` | 1000 | ~$0.014 |

---

### `POST /trending` — Industry Trending Posts
**User Action:** View trending tab

| API Call | Details | Cost |
|----------|---------|------|
| Apify (if configured) | `fetchIndustryTrendingPosts()` | ~$0.03 |

---

## 6. INFLUENCERS (`/api/influencers`)

### `POST /discover` — Discover Influencers
**User Action:** Click "Discover Influencers"

| API Call | Model | maxTokens | Details | Cost |
|----------|-------|-----------|---------|------|
| 1× Gemini | `gemini-3-pro-preview` | **2000**, skipCache | `rankInfluencersForBusiness()` on curated DB | ~$0.027 |

**No image generation. No Apify. Pure Gemini text.**

---

## 7. TRENDS (`/api/trends`)

### `GET /discover` — Discover Trends
**User Action:** Open Trends page

| # | API Call | Provider | maxTokens | Cost |
|---|----------|----------|-----------|------|
| 1 | `clusterTopics()` | Gemini | 8192 | ~$0.10 |
| 2 | `brainstormIdeas()` | Grok → Gemini fallback | 4096 | ~$0.05 |
| 3 | `generateWithLLM()` for weekPlan | Gemini | 8192 | ~$0.10 |

**Total: 3 LLM calls = ~$0.25**

---

### `POST /:id/content-ideas` — Generate Ideas for Trend
**User Action:** Click "Generate Ideas" on a trend

| API Call | Provider | maxTokens | Cost |
|----------|----------|-----------|------|
| 1× `brainstormIdeas()` | Grok → Gemini fallback | 4096 | ~$0.05 |

---

## 8. BRAND (`/api/brand`)

### `POST /intake` — Analyze Brand Website
**User Action:** Submit brand URL during onboarding

| # | API Call | Details | Cost |
|---|----------|---------|------|
| 1 | Web scrape | Basic HTTP (free) or Apify fallback ($0.50) | $0–$0.50 |
| 2 | 1× Gemini | `analyzeBrand()` via llmRouter, 8192 tokens | ~$0.10 |

**Total: ~$0.10–$0.60**

---

### `POST /quick-analyze` — Quick Website Analysis (Onboarding)
**User Action:** Enter website URL during onboarding

| # | API Call | Details | Cost |
|---|----------|---------|------|
| 1 | Deep scrape | `deepScrapeWebsite()` — basic HTTP + Apify fallback | $0–$0.50 |
| 2 | 1× Gemini | `generateWithLLM()` — massive analysis prompt, 8192 tokens | ~$0.10 |

**Total: ~$0.10–$0.60**

---

### `POST /:id/refresh` — Re-Analyze Brand
**User Action:** Click "Refresh" on brand profile

| # | API Call | Details | Cost |
|---|----------|---------|------|
| 1 | Apify website crawler | `scrapeWebsiteWithApify()` — up to 5 pages | ~$0.50 |
| 2 | 1× Gemini | Analysis | ~$0.10 |

**Total: ~$0.60**

---

## 9. CHAT (`/api/chat`)

### `POST /message` — Send Chat Message
**User Action:** Type message in chatbot

| API Call | Model | maxTokens | Cost |
|----------|-------|-----------|------|
| 1× Gemini | `gemini-3-pro-preview` | **500** | ~$0.008 |

---

### `GET /suggestions` — Chat Suggestions
**User Action:** Open chatbot (auto-loads suggestions)

| API Call | Model | maxTokens | Cost |
|----------|-------|-----------|------|
| 1× Gemini | `gemini-3-pro-preview` | **200** | ~$0.003 |

---

## 10. A/B TESTING (`/api/abtest`)

### `POST /create` — Create A/B Test
**User Action:** Click "Create A/B Test"

| API Call | Model | maxTokens | Cost |
|----------|-------|-----------|------|
| 1× Gemini | `gemini-3-pro-preview` | **8192** | ~$0.10 |

---

### `POST /:id/analyze` — Analyze A/B Variations
**User Action:** Click "Analyze" on A/B test

| API Call | Model | maxTokens | Cost |
|----------|-------|-----------|------|
| 1× Gemini | `gemini-3-pro-preview` | **8192** | ~$0.10 |

---

### `POST /:id/select-winner` — AI Select Winner
**User Action:** Click "AI Pick Winner"

| API Call | Model | maxTokens | Cost |
|----------|-------|-----------|------|
| 1× Gemini | `gemini-3-pro-preview` | **8192** | ~$0.10 |

---

### `POST /:id/regenerate/:variationId` — Regenerate Variation
**User Action:** Click "Regenerate" on a variation

| API Call | Model | maxTokens | Cost |
|----------|-------|-----------|------|
| 1× Gemini | `gemini-3-pro-preview` | **8192** | ~$0.10 |

---

## 11. GOALS (`/api/goals`)

### `GET /:id/insights` — Goal AI Insights
**User Action:** View goal detail page

| API Call | Model | maxTokens | Cost |
|----------|-------|-----------|------|
| 1× Gemini | `gemini-3-pro-preview` | **8192**, skipCache | ~$0.10 |

---

### `GET /summary/all` — Goal Recommendations
**User Action:** View goals summary page

| API Call | Model | maxTokens | Cost |
|----------|-------|-----------|------|
| 1× Gemini | `gemini-3-pro-preview` | **8192**, skipCache | ~$0.10 |

---

## 12. CAMPAIGN BUILDER (`/api/campaign-builder`)

### `POST /generate` — Generate Full Campaign Plan
**User Action:** Click "Generate Campaign Plan"

| # | API Call | Provider | maxTokens | Details | Cost |
|---|----------|----------|-----------|---------|------|
| 1 | `generateCampaignPlan()` | Gemini | 8192 | Strategy + calendar | ~$0.10 |
| 2 | `brainstormIdeas()` | Grok → Gemini fallback | 4096 | 5 creative concepts | ~$0.05 |

**Total: 2 LLM calls = ~$0.15**

---

### `POST /:id/regenerate` — Regenerate Section
**User Action:** Click "Regenerate Creatives"

| API Call | Provider | maxTokens | Cost |
|----------|----------|-----------|------|
| 1× `brainstormIdeas()` | Grok → Gemini fallback | 4096 | ~$0.05 |

---

## 13. ADS (`/api/ads`)

### All Routes — Ad Management
**User Actions:** Get ad accounts, boost post, get boosted ads, update ad, get ad history, get ad interests

| API Call | Cost |
|----------|------|
| All Ayrshare only | Flat fee ($599/mo) |

**No LLM calls. $0 per-action cost.**

---

## 14. SOCIAL (`/api/social`)

### All Routes — Social Media Connection & Posting
**User Actions:** Connect accounts, post content, get analytics, disconnect

| API Call | Cost |
|----------|------|
| All Ayrshare + OAuth (free) | Flat fee |

**No LLM calls. $0 per-action cost.**

---

## 15. BRAND ASSETS (`/api/brand-assets`)

### `POST /upload` — Upload Brand Asset
**User Action:** Upload logo/image

| API Call | Cost |
|----------|------|
| 1× Cloudinary upload | $0.001 |

---

## 16. ONBOARDING TOUR (`/api/onboarding-tour`)

All routes are DB-only. **$0 API cost.**

---

## 17. NOTIFICATIONS (`/api/notifications`), REMINDERS (`/api/reminders`), AUTH (`/api/auth`)

All routes are DB-only. **$0 API cost.**

---

## Cost Summary by Feature Area

| Feature | Cheapest Action | Most Expensive Action | Typical Session Cost |
|---------|----------------|----------------------|---------------------|
| **Dashboard Load** | $0.10 (cached) | $0.23 (first visit, no competitors) | $0.10–$0.20 |
| **Campaign Suggestions** | $0.57 (cached) | $0.57 (first gen) | $0.00 (cached) or $0.57 |
| **Campaign Stream** | $0.46 | $0.46 | $0.46 |
| **Generate Campaign Posts (10)** | $0.67 | $1.29 (20 posts) | $0.67 |
| **Content Generation** | $0.35 | $0.35 | $0.35 |
| **Competitor Discovery** | $0.20 | $0.76 (with scraping) | $0.20 |
| **Competitor Scraping (all)** | $0.15 | $0.56 (by type, 7 competitors) | $0.15 |
| **Trend Discovery** | $0.25 | $0.25 | $0.25 |
| **Brand Analysis** | $0.10 | $0.60 (with Apify) | $0.10–$0.60 |
| **Chat Message** | $0.008 | $0.008 | $0.008 |
| **A/B Test (full cycle)** | $0.30 | $0.40 | $0.30 |
| **Goals (all insights)** | $0.10 | $0.20 | $0.10 |
| **Campaign Builder Plan** | $0.15 | $0.15 | $0.15 |
| **Rival/Event Post** | $0.08 | $0.09 | $0.08 |
| **Poster Generation** | $0.001 | $0.01 | $0.001 |
| **Ads/Social/Auth** | $0 (flat fee) | $0 (flat fee) | $0 |

---

## Worst-Case "Power User" Session Cost

A user who opens the app and uses every feature:

| Action | Cost |
|--------|------|
| Dashboard load (first visit) | $0.23 |
| Campaign suggestions (first gen) | $0.57 |
| Generate 10-post campaign | $0.67 |
| Generate content | $0.35 |
| Discover competitors | $0.20 |
| Scrape 5 competitors | $0.15 |
| Discover trends | $0.25 |
| Brand analysis | $0.60 |
| 5 chat messages | $0.04 |
| A/B test (create + analyze + winner) | $0.30 |
| Goal insights (2 goals) | $0.20 |
| Campaign builder plan | $0.15 |
| Event + rival post | $0.17 |
| Strategic advisor + generate post | $0.14 |
| **TOTAL** | **~$4.02** |

Plus monthly fixed: **Ayrshare $599/mo**

---

## Key Insights

1. **Image generation dominates cost**: Imagen 4 Ultra at $0.06/image is the biggest per-action expense. A 20-post campaign costs $1.20 in images alone.

2. **Campaign suggestions are expensive**: The non-streaming version costs ~$0.57 (1 big Gemini call + 6 Imagen calls). Caching mitigates this.

3. **`skipCache: true` routes drain money**: `generateSingleCampaign`, `selectABTestWinner`, `analyzeGoalProgress`, `generateGoalRecommendations`, and all A/B test functions skip the 5-minute response cache.

4. **Grok always falls back to Gemini**: If `GROK_API_KEY` is not set, every "Grok" call becomes a Gemini call. No cost difference if using Gemini pricing.

5. **Apify is pay-per-result**: Instagram scraping at $0.0026/result with `resultsLimit: 12` = ~$0.03/scrape. Competitor discovery can trigger 5–7 scrapes in one action.

6. **Poster generation is nearly free**: `nano-banana-pro-preview` is currently a free preview model with no per-call charge. Only Cloudinary upload costs apply.

7. **Ayrshare is fixed cost**: All social posting, scheduling, analytics, ad boosting = $599/mo regardless of usage volume.

8. **The `callGemini()` built-in retry** retries up to 3× on failure — tripling token cost in worst case. The `generateWithLLM()` JSON retry adds one extra call on parse failure.

9. **Template poster editing retries up to 3×** on overload errors, each retry consumes another `nano-banana-pro-preview` call (currently free).

10. **Website scraping uses Apify as fallback**: `deepScrapeWebsite()` first tries basic HTTP for free. If that fails (JS-rendered sites), it falls back to Apify Website Content Crawler at ~$0.50/run.
