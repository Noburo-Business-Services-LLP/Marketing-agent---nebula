require('dotenv').config();
const express = require('express');
const logger = require('./utils/logger');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const { createRateLimits, trustProxySetting } = require('./middleware/rateLimits');
const { mongoConnectOptions } = require('./config/mongoOptions');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const path = require('path');
const fs = require('fs');

// ============================================
// Crash policy (A6, utils/crashPolicy.js): an unhandled rejection is logged as one structured line; known-safe ones
// (a client hung up, a busy hasher) keep running, any other sets exit code 1 and stops the process after a short grace
// period (UNHANDLED_REJECTION_POLICY=log switches that off). An uncaught exception stops new connections, gives open
// requests up to 10 s and exits 1. The task supervisor starts a fresh process. SIGTERM keeps its own drain (below).
// ============================================
const crash = require('./utils/crashPolicy').createCrashHandlers({
  // Both are declared further down; a crash before they exist simply has no server to drain.
  getServer: () => { try { return httpServer; } catch (_) { return null; } },
  onStop: () => { try { health.markShuttingDown(); } catch (_) { /* not created yet */ } }
});
process.on('unhandledRejection', crash.onUnhandledRejection);
process.on('uncaughtException', crash.onUncaughtException);

// ============================================
// Environment Validation (Fail Fast)
// ============================================
const requiredEnvVars = ['GEMINI_API_KEY'];
const optionalEnvVars = ['GROK_API_KEY', 'MONGODB_URI', 'JWT_SECRET', 'SES_AWS_ACCESS_KEY_ID', 'SES_AWS_SECRET_ACCESS_KEY', 'SES_SENDER_EMAIL'];

// Start-up check (B7, utils/bootEnv.js): no JWT_SECRET anywhere, or in production a short JWT_SECRET, no MONGODB_URI
// or no HASH_PEPPER, stops the server with a clear message. Loading the app without starting it (scripts, tests:
// NEBULAA_SERVER_NO_START=1) only prints the problems.
{
  const boot = require('./utils/bootEnv').validateBootEnv(process.env);
  for (const w of boot.warnings) logger.warn(`⚠️  ${w}`);
  for (const e of boot.errors) logger.error(`❌ ${e}`);
  if (!boot.ok && process.env.NEBULAA_SERVER_NO_START !== '1') {
    logger.error('❌ The server cannot start with this configuration. Fix the values above and start it again.');
    process.exit(1);
  }
}

logger.info('\n🔍 Validating environment...');
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`❌ Missing required environment variable: ${envVar}`);
    // Don't exit - use fallback for Gemini
  } else {
    logger.info(`✅ ${envVar}: configured`);
  }
}
for (const envVar of optionalEnvVars) {
  if (process.env[envVar]) {
    logger.info(`✅ ${envVar}: configured`);
  } else {
    logger.info(`⚠️  ${envVar}: not set (optional)`);
  }
}
logger.info('');

// ============================================
// Route Imports
// ============================================
const authRoutes = require('./routes/auth');
const socialRoutes = require('./routes/social');
const socialInboxRoutes = require('./routes/socialInboxRoutes');
const chatRoutes = require('./routes/chat');
const supportRoutes = require('./routes/support');
const dashboardRoutes = require('./routes/dashboard');
const campaignRoutes = require('./routes/campaigns');
const competitorRoutes = require('./routes/competitors');
const reminderRoutes = require('./routes/reminders');
const accountRoutes = require('./routes/accounts');
const adCampaignRoutes = require('./routes/adCampaigns');
const seoRoutes = require('./routes/seoRoutes');
const draftRoutes = require('./routes/drafts');
const draftLocalizeRoutes = require('./routes/draftLocalize');

// New real-data routes
const brandRoutes = require('./routes/brand');
const analyticsRoutes = require('./routes/analytics');

// Reachouts CRM routes - REMOVED

// Notification routes
const notificationRoutes = require('./routes/notifications');

// Brand Assets routes
const brandAssetsRoutes = require('./routes/brandAssets');
const ideasRoutes = require('./routes/ideas');

// Ads / Boost routes
const adsRoutes = require('./routes/ads');

// Credits / Trial routes
const creditsRoutes = require('./routes/credits');

// Payment / Razorpay routes
const paymentRoutes = require('./routes/payment');

// Trial guard middleware
const { checkTrial } = require('./middleware/trialGuard');
const { protect } = require('./middleware/auth');
const { requireFeature } = require('./middleware/requireFeature');

// Content routes
const contentRoutes = require('./routes/content');
const contentCalendarRoutes = require('./routes/contentCalendar');

// Google Calendar routes
const googleCalendarRoutes = require('./routes/googleCalendar');
const productRoutes = require('./routes/products');
const promptRoutes = require('./routes/prompts');
const carouselRoutes = require('./routes/carousels');
const createAssistRoutes = require('./routes/createAssist');
const videoGenerationRoutes = require('./routes/videoGeneration');
const heroVideoRoutes = require('./routes/heroVideo');
const blueprintRoutes = require('./routes/blueprint');
const aiMemoryRoutes = require('./routes/aiMemory');
const influencerRoutes = require('./routes/influencerRoutes');
const collaborationRoutes = require('./routes/collaborationRoutes');
const submissionRoutes = require('./routes/submissionRoutes');
const videoStylePromptRoutes = require('./routes/api-video-style-prompts');
const influencerAnalyticsRoutes = require('./routes/analyticsRoutes');

// Admin routes
const adminRoutes = require('./routes/admin');
const csmRoutes = require('./routes/csm');
const staffRoutes = require('./routes/staff');

// Event tracking utility
const trackEvent = require('./utils/trackEvent');

// Notification scheduler service
const notificationScheduler = require('./services/notificationScheduler');
// Analytics snapshot scheduler
const snapshotScheduler = require('./services/snapshotScheduler');
const { startCampaignScheduler } = require('./services/campaignScheduler');
const { startContentCalendarScheduler } = require('./services/contentCalendarService');
const { startPerformanceTrackerScheduler } = require('./services/performanceTracker');
const { startMemoryDistillationScheduler } = require('./services/memoryDistillation');
const { initializeSocketHub } = require('./services/socketHub');

const app = express();

// ============================================
// Security: Trust Proxy. Production runs behind the AWS load balancer: one hop (TRUST_PROXY_HOPS, default 1; set 2 if
// a second proxy such as the frontend nginx sits in front). req.ip is then the real client address for the limits.
// ============================================
app.set('trust proxy', trustProxySetting(process.env));

// ============================================
// Security: Helmet — Secure HTTP Headers
// ============================================
app.use(helmet({
  // REPORT-ONLY: browsers report what it would block to /api/csp-report, nothing is blocked yet (config/csp.js; the
  // same policy is in nginx.conf for the static app). Enforce once the reports are clean (security-hardening.md).
  contentSecurityPolicy: require('./config/csp').helmetCsp(),
  crossOriginEmbedderPolicy: false, // Allow loading external images/resources
  // Default `same-origin` blocks dev (e.g. localhost:3000 loading 127.0.0.1:5000 `/audio/*.mp3`) and some CDN setups.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ============================================
// Security: CORS — Locked to Allowed Origins
// ============================================
// Baseline hardcoded whitelist — always allowed.
const BASE_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5173',
  'https://marketing-agent-nebula.onrender.com',
  'https://www.marketing-agent-nebula.onrender.com',
  'https://nebulaa.ai',
  'https://www.nebulaa.ai',
  'https://demo.nebulaa.ai',
  'https://www.demo.nebulaa.ai',
  'https://main.nebulaa.ai',
  'https://www.main.nebulaa.ai',
  // Production app (prod branch) and the test environment. Both were missing,
  // so gravity rejected requests from its own frontend with
  // "Not allowed by CORS" and served a 500 for its JS bundle.
  'https://gravity.nebulaa.ai',
  'https://www.gravity.nebulaa.ai',
  'https://test.nebulaa.ai',
  'https://www.test.nebulaa.ai',
  // AWS ALB (prod frontend) — HTTP + HTTPS for when TLS cert is added later
  'http://stratschool-prod-alb-59606506.ap-south-1.elb.amazonaws.com',
  'https://stratschool-prod-alb-59606506.ap-south-1.elb.amazonaws.com'
];

// Additional origins from env var. Comma-separated. Set
// CORS_ALLOWED_ORIGINS in .env or Fargate task-def to whitelist
// extra URLs at runtime without a code change or image rebuild.
// Example: CORS_ALLOWED_ORIGINS=https://foo.example.com,https://bar.example.com
const extraOrigins = String(process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([...BASE_ALLOWED_ORIGINS, ...extraOrigins]));
if (extraOrigins.length > 0) {
  logger.info(`[CORS] Extra origins from CORS_ALLOWED_ORIGINS env: ${extraOrigins.join(', ')}`);
}

// A refused browser origin gets 403 { success:false, message:'Origin not allowed' } on /api (middleware/corsPolicy.js), not a 500.
const corsPolicy = require('./middleware/corsPolicy');
app.use(corsPolicy.rejectDisallowedOrigin(allowedOrigins));
app.use(cors(corsPolicy.corsOptions(allowedOrigins)));

// Compression (A8): gzip for JSON and text over 1 KB; never for text/event-stream (the inbox stream). Before every route.
app.use(require('./middleware/compression').createCompression());

// Request logging (first thing after CORS, so refused and rate-limited requests are logged too): one compact pino-http line per request (method, URL without any token= value, status, ms). Headers are
// never logged; LOG_LEVEL sets the level; the load balancer's health and ready probes stay out at the default level.
app.use(require('./middleware/requestLogger').createRequestLogger());

// ============================================
// Security: Rate Limiting
// ============================================
// General (per address), credential routes only (per address and account, plus an address cap), social (per user,
// plus an address cap) and AI (per address). See middleware/rateLimits.js.
const limits = createRateLimits();
// Shared per-user limits for paid AI, scraping, uploads and ad spend; most are applied inside the route files.
const L = require('./middleware/limits');
const aiLimiter = limits.ai;

// Health (the load balancer's path, exempt from rate limiting): 200 only when MongoDB is connected and answers a ping
// (kept 5 s), 503 when it is not or while the task shuts down. /api/ready is the readiness probe. services/healthCheck.js
const health = require('./services/healthCheck').createHealth();
app.get('/api/health', health.health);
app.get('/api/ready', health.ready);

// More detailed health check for debugging production 502s (does not expose secrets)
app.get('/api/health/details', (req, res) => {
  let ffmpegPath = null;
  let ffprobePath = null;

  try {
    // Optional dependency check (installed in backend/package.json)
    ffmpegPath = require('ffmpeg-static');
  } catch (err) { logger.debug('health details: ffmpeg-static not installed: %s', err && err.message); }

  try {
    ffprobePath = require('ffprobe-static')?.path || null;
  } catch (err) { logger.debug('health details: ffprobe-static not installed: %s', err && err.message); }

  const safeExists = (p) => {
    if (!p || typeof p !== 'string') return false;
    try {
      return fs.existsSync(p);
    } catch (_) {
      return false;
    }
  };

  const mongoState = mongoose.connection?.readyState ?? 0;
  const mongoStates = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  return res.status(200).json({
    status: 'ok',
    checks: {
      // The address the request limits see (trust proxy = TRUST_PROXY_HOPS): check it is your own, not the load balancer's.
      client: {
        ip: req.ip,
        forwardedHops: String(req.headers['x-forwarded-for'] || '').split(',').filter((x) => x.trim()).length
      },
      mongo: {
        readyState: mongoState,
        state: mongoStates[mongoState] || 'unknown'
      },
      ffmpeg: {
        path: ffmpegPath,
        exists: safeExists(ffmpegPath)
      },
      ffprobe: {
        path: ffprobePath,
        exists: safeExists(ffprobePath)
      },
      aiVideo: {
        mediaDownloadTimeoutMs: Number.parseInt(String(process.env.AI_VIDEO_MEDIA_DOWNLOAD_TIMEOUT_MS || ''), 10) || null,
        mediaMaxDownloadBytes: Number.parseInt(String(process.env.AI_VIDEO_MEDIA_MAX_DOWNLOAD_BYTES || ''), 10) || null,
        ffmpegTimeoutMs: Number.parseInt(String(process.env.AI_VIDEO_FFMPEG_TIMEOUT_MS || ''), 10) || null
      }
    }
  });
});

// Apply general limiter to all API routes
app.use('/api', limits.general);

// Raw body for Razorpay webhook signature verification (must come before express.json)
app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));

// Request size limits (docs/superpowers/ops/security-hardening.md). Most routes only ever receive small text: 1 MB.
// MEDIUM (10 MB): routes that may carry one picture as text (a logo, an avatar, the picture being edited).
// BIG (40 MB): routes that take several pictures or files as text (campaign images, scenes, reference photos, files
// to read). A huge body is refused (413) before it is read into memory. Multipart uploads (drafts/upload-media,
// products/bulk-import) go through multer with their own caps, streamed to a temporary file.
const BIG_BODY_PREFIXES = [
  '/api/campaigns', '/api/carousels', '/api/create-assist', '/api/drafts', '/api/brand-assets', '/api/video-generation', '/api/hero-video',
  '/api/products', '/api/ideas', '/api/social', '/api/photoshoot/upload'
];
const MEDIUM_BODY_PREFIXES = ['/api/content', '/api/blueprint', '/api/auth/update-profile', '/api/auth/complete-onboarding'];
const smallJson = express.json({ limit: '1mb' });
const mediumJson = express.json({ limit: '10mb' });
const bigJson = express.json({ limit: '40mb' });
const smallForm = express.urlencoded({ extended: true, limit: '1mb' });
const mediumForm = express.urlencoded({ extended: true, limit: '10mb' });
const bigForm = express.urlencoded({ extended: true, limit: '40mb' });
const matches = (list) => (req) => list.some((p) => req.path === p || req.path.startsWith(`${p}/`));
const wantsBigBody = matches(BIG_BODY_PREFIXES);
const wantsMediumBody = matches(MEDIUM_BODY_PREFIXES);
app.use((req, res, next) => (wantsBigBody(req) ? bigJson : wantsMediumBody(req) ? mediumJson : smallJson)(req, res, next));
app.use((req, res, next) => (wantsBigBody(req) ? bigForm : wantsMediumBody(req) ? mediumForm : smallForm)(req, res, next));

// Content-Security-Policy violation reports (report-only policy): counts only, per-address limit, 16 KB at most.
const cspReporter = require('./services/cspReport').createCspReporter();
app.post('/api/csp-report', L.cspReport, express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '16kb' }), cspReporter.handler);

// A short answer time for ordinary routes (30 s, ROUTE_TIMEOUT_MS); generation, upload and stream routes are excluded
// (services/serverTimeouts.js, LONG_ROUTE_PREFIXES).
app.use('/api', require('./services/serverTimeouts').routeTimeout());

// ============================================
// Security: NoSQL Injection Prevention
// ============================================
// `?status[$ne]=x` is refused with 400 before any handler can copy an operator into a filter (middleware/queryGuard.js).
app.use(require('./middleware/queryGuard').queryGuard);
app.use(mongoSanitize());

// ============================================
// Security: HTTP Parameter Pollution Prevention
// ============================================
app.use(hpp());

// ============================================
// XSS: text is stored exactly as typed. There is no global input rewriter any more (it turned "&" into "&amp;",
// scanned every body before validation and stalled on big ones). Each route validates its own fields; text is escaped
// where it is shown: React escapes everything on screen, and every HTML email escapes the text it puts in
// (utils/escapeHtml.js). See docs/superpowers/ops/performance-week1.md.
// ============================================


// ============================================
// Feature Event Tracking — fire-and-forget, non-breaking
// ============================================
const FEATURE_ROUTE_MAP = [
  { method: 'GET',  pattern: /^\/api\/dashboard\/overview/,       feature: 'dashboard_viewed',        module: 'dashboard' },
  { method: 'POST', pattern: /^\/api\/campaigns$/,                 feature: 'campaign_created',        module: 'campaigns' },
  { method: 'POST', pattern: /^\/api\/campaigns\/.*\/posts/,       feature: 'post_generated',          module: 'campaigns' },
  { method: 'POST', pattern: /^\/api\/social\/post/,               feature: 'post_published',          module: 'social' },
  { method: 'GET',  pattern: /^\/api\/competitors/,                feature: 'competitor_viewed',       module: 'competitors' },
  { method: 'POST', pattern: /^\/api\/competitors/,                feature: 'competitor_added',        module: 'competitors' },
  { method: 'GET',  pattern: /^\/api\/brand-assets/,               feature: 'brand_assets_viewed',     module: 'brand' },
  { method: 'POST', pattern: /^\/api\/brand-assets/,               feature: 'brand_assets_extracted',  module: 'brand' },
  { method: 'GET',  pattern: /^\/api\/analytics/,                  feature: 'analytics_viewed',        module: 'analytics' },
  { method: 'POST', pattern: /^\/api\/social\/connect/,            feature: 'social_connected',        module: 'social' },
  { method: 'POST', pattern: /^\/api\/chat/,                       feature: 'chat_used',               module: 'chat' },
  { method: 'PUT',  pattern: /^\/api\/brand/,                      feature: 'brand_profile_updated',   module: 'brand' },
  { method: 'GET',  pattern: /^\/api\/campaigns/,                  feature: 'campaigns_viewed',        module: 'campaigns' },
  { method: 'POST', pattern: /^\/api\/blueprint$/,                 feature: 'blueprint_started',       module: 'blueprint' },
];

app.use((req, res, next) => {
  res.on('finish', () => {
    try {
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user?._id) {
        const match = FEATURE_ROUTE_MAP.find(
          m => m.method === req.method && m.pattern.test(req.path)
        );
        if (match) {
          trackEvent(req.user._id, match.feature, {
            feature_module: match.module,
            status: 'success',
          });
        }
      }
    } catch (err) { logger.debug('feature event tracking: %s', err && err.message); }
  });
  next();
});

// Home summary cache: a write that succeeded clears the signed-in account's cached Home numbers (60 s cache).
const homeCacheWatch = require('./routes/home').watch;
app.use('/api', homeCacheWatch);

// Routes - Admin (no trial/credit guard)
app.use('/api/admin', limits.credentialAll, adminRoutes);
app.use('/api/csm', csmRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/metrics', require('./routes/metrics')); // staff only: event-loop lag and memory (load tests)

// Routes - Core (with specific rate limiters on sensitive routes)
app.use('/api/auth', limits.credential, authRoutes);
// The inbox is mounted before /api/social, so it gets the social limiter here (it used to escape it). The provider
// webhooks are not user calls: they have their own per-address limiter in the route file (middleware/limits.js).
app.use('/api/social/inbox', L.exceptInboxWebhooks(limits.social), socialInboxRoutes);
app.use('/api/social', limits.social, socialRoutes);
app.use('/api/chat', aiLimiter, chatRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/campaigns', aiLimiter, campaignRoutes);
app.use('/api/competitors/insights', require('./routes/competitorInsights'));
app.use('/api/competitors/best-posts', require('./routes/competitorBestPosts'));
app.use('/api/competitors', competitorRoutes);
app.use('/api/listening', require('./routes/listening'));
app.use('/api/reminders', reminderRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/ad-campaigns', adCampaignRoutes);
app.use('/api/seo', aiLimiter, seoRoutes);

// Routes - Real Data Features
app.use('/api/brand', brandRoutes);
app.use('/api/analytics', influencerAnalyticsRoutes);
app.use('/api/analytics', analyticsRoutes);

// Routes - Reachouts CRM - REMOVED

// Routes - Notifications
app.use('/api/notifications', notificationRoutes);

// Routes - Brand Assets
app.use('/api/brand-assets', brandAssetsRoutes);
app.use('/api/ideas', ideasRoutes);

// Routes - Ads / Boost
app.use('/api/ads', adsRoutes);

// Routes - Credits / Trial
app.use('/api/credits', creditsRoutes);

// Routes - Payment / Razorpay
app.use('/api/payment', paymentRoutes);

// Routes - Content
app.use('/api/content', contentRoutes);
app.use('/api/content-calendar', contentCalendarRoutes);
app.use('/api/google-calendar', googleCalendarRoutes);
app.use('/api/products', productRoutes);
app.use('/api/prompts', promptRoutes);
app.use('/api/carousels', carouselRoutes);
app.use('/api/create-assist', createAssistRoutes);
// Video generation has its own per-route limiters (job polling must not trip AI limiter).
// Scheduling a video post calls an outside service; gated here so the Kling route file stays untouched.
app.post('/api/video-generation/schedulePost', protect, requireFeature('schedule'));
// Video generation costs real money: on a brand-new free account it opens once the business is set up or a payment is made.
// Every POST is gated except the cheap ones below (saving, cancelling, favourites, adding the logo).
const CHEAP_VIDEO_POSTS = /^\/(favourite-audio|favourite-voice|updateEnvironment|applySceneLogo|createDraft|schedulePost|jobs\/[^/]+\/cancel)\/?$/;
app.use('/api/video-generation', protect, requireFeature('video', { when: (req) => req.method === 'POST' && !CHEAP_VIDEO_POSTS.test(req.path) }));
app.use('/api/video-generation', videoGenerationRoutes);
// Posting or scheduling a finished Hero video follows the same Publish add-on rule as posts (owner decision 8).
app.post('/api/hero-video/jobs/:jobId/publish', protect, requireFeature('publish'));
app.use('/api/hero-video', protect, requireFeature('video', { when: (req) => req.method === 'POST' && /^\/(concepts|plan|generate)\/?$/.test(req.path) }));
app.use('/api/hero-video', heroVideoRoutes);
// Download your data, delete your account, undo that, and agree to the current terms.
app.use('/api/account', require('./routes/account'));
// An agency's client brands: list, add, rename and open.
app.use('/api/agency', require('./routes/agency'));
// The single Videos flow (Gemini Omni): idea, concept, one clip, changes.
app.use('/api/videos', protect, requireFeature('video', { when: (req) => req.method === 'POST' && /^\/(create|[a-f0-9]{24}\/change)\/?$/.test(req.path) }));
app.use('/api/videos', require('./routes/studioVideos'));
app.use('/api/blueprint', blueprintRoutes);
app.use('/api/plan', require('./routes/plan'));
app.use('/api/home', require('./routes/home'));
// Home drafts from a competitor's stored post (a post in response, a witty comment to copy). Off unless ENABLE_COMPETITOR_DRAFTS=on.
app.use('/api/home', require('./routes/homeDrafts'));
// Photoshoot studio: packs of product photos (off unless ENABLE_PHOTOSHOOT=on; docs/superpowers/ops/photoshoot.md)
app.use('/api/photoshoot', require('./routes/photoshoot'));
app.use('/api/week', require('./routes/week'));
app.use('/api/setup', require('./routes/week').setupRouter);
app.use('/api/tour', require('./routes/tour'));
// What Nebulaa learned, by source (code only, no model call; docs/superpowers/ops/brand-memory.md)
app.use('/api/ai-memory', require('./routes/aiMemoryLearned'));
app.use('/api/ai-memory', aiMemoryRoutes);
app.use('/api/influencers', influencerRoutes);
app.use('/api/collaborations', collaborationRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/drafts', draftLocalizeRoutes);
app.use('/api/drafts', draftRoutes);
// The video prompt builder: login required and capped in the route; the AI limiter in front (it was public and uncapped).
app.use(['/api/generateVideoStylePrompts', '/api/generateSceneDescriptions'], aiLimiter);
app.use('/api', videoStylePromptRoutes);

// Health check endpoint (handled before rate limiter above)

// Demo dashboard endpoint (no auth, for UI testing)
app.get('/api/demo/dashboard', (req, res) => {
  res.json({
    success: true,
    data: {
      totalCampaigns: 3,
      budgetSpent: 370,
      connectedAccounts: 2,
      brandScore: {
        score: 68,
        breakdown: [
          { reason: 'connected_accounts', value: 12, details: '2 connected' },
          { reason: 'active_campaigns', value: 8, details: '2 active/scheduled' },
          { reason: 'engagement', value: 20, details: 'ctr approx 5.20%' },
          { reason: 'ad_spend', value: 10, details: 'spent $120' },
          { reason: 'profile_completeness', value: 18, details: 'profile fields' }
        ]
      },
      suggestedActions: [
        { title: 'Boost top-performing post', description: 'Allocate $50 to boost last Facebook post which has high CTR.', effort: 'low', confidence: 0.88 },
        { title: 'Post LinkedIn article', description: 'Publish a thought leadership article summarizing product benefits.', effort: 'medium', confidence: 0.72 },
        { title: 'Create 3 Instagram reels', description: 'Produce short reels focused on product use-cases.', effort: 'high', confidence: 0.66 }
      ],
      competitorPosts: [
        { competitorName: 'Competitor A', source: 'instagram', content: 'Launching new summer collection', postedAt: '2025-12-08T03:30:00Z' },
        { competitorName: 'Competitor B', source: 'linkedin', content: 'How we improved ROI by 30%', postedAt: '2025-12-09T10:00:00Z' }
      ],
      campaigns: [
        { _id: 'cmp_1', title: 'Holiday Promo - Instagram Reels', status: 'scheduled', platforms: ['instagram'], budget: 250, scheduledAt: '2025-12-17T08:30:00Z' },
        { _id: 'cmp_2', title: 'LinkedIn Thought Leadership', status: 'scheduled', platforms: ['linkedin'], budget: 0, scheduledAt: '2025-12-18T05:30:00Z' },
        { _id: 'cmp_3', title: 'Facebook Boost - New Product', status: 'posted', platforms: ['facebook'], budget: 120, postedAt: '2025-12-14T04:30:00Z', metrics: { impressions: 1500, clicks: 80, spend: 120 } }
      ],
      drafts: [
        { id: 'draft_1', title: 'Draft: Awareness Campaign', ageHours: 48 }
      ]
    }
  });
});

// Reel tone MP3s MUST be registered before `public` static, or a stray `public/audio/*`
// from a frontend build could shadow these and break previews (wrong/empty file → silent UI).
// Files live at backend/tone-audio/*.mp3 → /audio/<file>.mp3
// Files made for users are served with `Content-Security-Policy: sandbox`, nosniff and a Content-Disposition, so a
// file can never run script on this origin even if one slipped through (middleware/userFileHeaders.js).
const { userFileHeaders } = require('./middleware/userFileHeaders');
app.use('/audio', express.static(path.join(__dirname, 'tone-audio'), { setHeaders: userFileHeaders }));
app.use('/generated-media', express.static(path.join(__dirname, 'storage', 'ai-videos'), { setHeaders: userFileHeaders }));

// Serve static files from React frontend build
// Hashed files in public/assets are cached for a year (immutable), index.html is always revalidated (middleware/staticCache.js).
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: require('./middleware/staticCache').setStaticHeaders }));

// Catch-all handler for React Router - serve index.html for any non-API routes
app.get('*', (req, res, next) => {
  // If it's an API route, pass to 404 handler
  if (req.path.startsWith('/api')) {
    return next();
  }
  // The web app is served by its own container. A frontend build left in `public` (this server used to carry one)
  // must never be shown as if it were the product, so this only serves a build that is really there.
  const indexFile = path.join(__dirname, 'public', 'index.html');
  if (!require('fs').existsSync(indexFile)) {
    return res.status(404).json({ success: false, message: 'This address serves the Nebulaa API only.' });
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(indexFile);
});

// API 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found'
  });
});

// Global error handler: the caller's mistakes are 4xx with plain words (validation 400, too large 413),
// server faults a plain 500; the real message goes to the log only.
app.use(require('./middleware/errorHandler').errorHandler);

// ============================================
// Production Environment Health Validation
// ============================================
const validateProductionEnvironment = async () => {
  logger.info('\n🏥 Running Production Environment Health Checks...');
  
  // 1. Validate Fal.ai API key
  const falKey = process.env.FAL_KEY;
  if (falKey) {
    logger.info(`   ✅ FAL_KEY is configured (Length: ${falKey.length})`);
  } else {
    logger.warn(`   ⚠️  FAL_KEY is NOT configured. Fal.ai video generation will fail.`);
  }

  // 2. Validate FFmpeg
  let resolvedFfmpeg = null;
  try {
    resolvedFfmpeg = require('ffmpeg-static');
    logger.info(`   ✅ ffmpeg-static resolved path: ${resolvedFfmpeg}`);
  } catch (err) {
    logger.warn(`   ⚠️  ffmpeg-static require failed, checking system path...`);
  }

  if (!resolvedFfmpeg) {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    try {
      const { spawnSync } = require('child_process');
      const res = spawnSync(whichCmd, ['ffmpeg'], { windowsHide: true });
      if (res.status === 0 && res.stdout) {
        resolvedFfmpeg = String(res.stdout).trim().split(/\r?\n/)[0];
        logger.info(`   ✅ System ffmpeg resolved: ${resolvedFfmpeg}`);
      }
    } catch (err) { logger.debug('start-up: system ffmpeg lookup failed: %s', err && err.message); }
  }

  if (resolvedFfmpeg && fs.existsSync(resolvedFfmpeg)) {
    try {
      const { spawnSync } = require('child_process');
      const ver = spawnSync(resolvedFfmpeg, ['-version'], { windowsHide: true });
      if (ver.status === 0) {
        const firstLine = String(ver.stdout).split('\n')[0];
        logger.info(`   ✅ FFmpeg is accessible and working: ${firstLine}`);
      } else {
        logger.error(`   ❌ FFmpeg found but failed to run with status ${ver.status}`);
      }
    } catch (err) {
      logger.error(`   ❌ Failed to run FFmpeg:`, err.message);
    }
  } else {
    logger.error(`   ❌ FFmpeg was NOT found on this system! Video merging will fail.`);
  }

  // 3. Validate FFprobe
  let resolvedFfprobe = null;
  try {
    resolvedFfprobe = require('ffprobe-static')?.path;
    if (resolvedFfprobe) logger.info(`   ✅ ffprobe-static resolved path: ${resolvedFfprobe}`);
  } catch (err) {
    logger.warn(`   ⚠️  ffprobe-static require failed, checking system path...`);
  }

  if (!resolvedFfprobe) {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    try {
      const { spawnSync } = require('child_process');
      const res = spawnSync(whichCmd, ['ffprobe'], { windowsHide: true });
      if (res.status === 0 && res.stdout) {
        resolvedFfprobe = String(res.stdout).trim().split(/\r?\n/)[0];
        logger.info(`   ✅ System ffprobe resolved: ${resolvedFfprobe}`);
      }
    } catch (err) { logger.debug('start-up: system ffprobe lookup failed: %s', err && err.message); }
  }

  if (resolvedFfprobe && fs.existsSync(resolvedFfprobe)) {
    try {
      const { spawnSync } = require('child_process');
      const ver = spawnSync(resolvedFfprobe, ['-version'], { windowsHide: true });
      if (ver.status === 0) {
        const firstLine = String(ver.stdout).split('\n')[0];
        logger.info(`   ✅ FFprobe is accessible and working: ${firstLine}`);
      } else {
        logger.error(`   ❌ FFprobe found but failed to run with status ${ver.status}`);
      }
    } catch (err) {
      logger.error(`   ❌ Failed to run FFprobe:`, err.message);
    }
  } else {
    logger.error(`   ❌ FFprobe was NOT found on this system! Subtitles/audio timing analysis may fail.`);
  }

  // 4. Validate Storage Directories and Permissions
  const storagePaths = [
    path.join(__dirname, 'storage'),
    path.join(__dirname, 'storage', 'ai-videos'),
    path.join(__dirname, 'temp'),
  ];

  for (const dir of storagePaths) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      // Test write and delete permissions
      const testFile = path.join(dir, '.write-test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      logger.info(`   ✅ Storage directory exists and is writeable: ${dir}`);
    } catch (err) {
      logger.error(`   ❌ Storage directory error for ${dir}:`, err.message);
    }
  }
  logger.info('🏥 Environment Health Checks Completed.\n');
};

// ============================================
// Background jobs (schedulers, sweeps, queue consumers, loops). EVERY starter goes in here: a web-only task
// (RUN_BACKGROUND=0) never calls this, the worker (RUN_BACKGROUND=1) and the single task (not set) call it once after
// MongoDB is connected. Guard test: tests/runBackground.test.js. docs/superpowers/ops/ecs-web-worker.md
// ============================================
const backgroundRole = require('./services/backgroundRole');

function startBackgroundJobs() {
  // JOB CONSUMERS (RUN_JOB_CONSUMERS, default RUN_BACKGROUND): the generation queues. Safe on every worker task: each
  // job is claimed by one atomic update with this worker's id and a lease (E9, docs/superpowers/ops/generation-parallelism.md).
  if (backgroundRole.runsJobConsumers()) {
    // Start persistent video generation queue worker (per-worker slots PROVIDER_SLOTS_IMAGE / _VIDEO, CPU_SLOTS)
    try {
      const { videoGenerationQueue } = require('./services/videoGenerationQueue');
      videoGenerationQueue.startWorker();
    } catch (queueError) {
      logger.warn('⚠️  Video generation queue worker failed to start:', queueError.message);
    }

    // Campaign image jobs stored by any task (async regenerate): claimed and run here, PROVIDER_SLOTS_IMAGE at once
    // (default 2), per account 2 running and 5 waiting. Off with ENABLE_IMAGE_JOB_RUNNER=off
    try {
      require('./services/imageJobQueue').startImageJobRunner();
    } catch (queueError) {
      logger.warn('Image job runner failed to start:', queueError.message);
    }

    // Queue numbers to CloudWatch: OFF unless QUEUE_METRICS_CLOUDWATCH=on
    try {
      require('./services/queueMetricsEmitter').startQueueMetricsEmitter();
    } catch (metricsError) {
      logger.warn('Queue metrics emitter failed to start:', metricsError.message);
    }
  }

  // SCHEDULERS (RUN_SCHEDULERS, default RUN_BACKGROUND): everything below. Every tick takes a lease, so several worker
  // tasks may run them; a task can still opt out (a consumer-only worker).
  if (!backgroundRole.runsSchedulers()) return;

  // Start notification scheduler for campaign reminders
  try {
    notificationScheduler.start();
  } catch (schedulerError) {
    logger.warn('⚠️  Notification scheduler failed to start:', schedulerError.message);
  }

  // Start analytics snapshot scheduler (every 12 hours)
  try {
    snapshotScheduler.start();
  } catch (schedulerError) {
    logger.warn('⚠️  Snapshot scheduler failed to start:', schedulerError.message);
  }

  // Start campaign scheduler for due scheduled posts
  try {
    startCampaignScheduler();
  } catch (schedulerError) {
    logger.warn('Campaign scheduler failed to start:', schedulerError.message);
  }

  // Posts scheduled on Ayrshare whose time has passed: ask Ayrshare whether they went out (bounded, single runner,
  // every 5 minutes; this used to run inside GET /api/campaigns). Off with ENABLE_CAMPAIGN_STATUS_SYNC=off
  try {
    require('./services/campaignStatusSync').startCampaignStatusSync();
  } catch (schedulerError) {
    logger.warn('Campaign status sync failed to start:', schedulerError.message);
  }

  // Start Gravity Smart Calendar scheduler for approved auto mode
  try {
    startContentCalendarScheduler();
  } catch (schedulerError) {
    logger.warn('Content calendar scheduler failed to start:', schedulerError.message);
  }

  // Pick up photoshoots a restart left half-made (off with ENABLE_PHOTOSHOOT_RESUME=off)
  try {
    require('./services/photoshoot').startPhotoshootResume();
  } catch (schedulerError) {
    logger.warn('Photoshoot resume failed to start:', schedulerError.message);
  }

  // Close Videos a restart left processing (refunding only what was charged) and finish interrupted refunds
  // (off with ENABLE_STUDIO_VIDEO_SWEEP=off)
  try {
    require('./routes/studioVideos').startStudioVideoSweep();
  } catch (schedulerError) {
    logger.warn('Videos sweep failed to start:', schedulerError.message);
  }

  // Close Home drafts a restart left open (refunding their Quarks) and retry refunds that did not land
  // (off with ENABLE_HOME_DRAFTS_SWEEP=off)
  try {
    require('./services/homeDrafts').startHomeDraftsSweep();
  } catch (schedulerError) {
    logger.warn('Home drafts sweep failed to start:', schedulerError.message);
  }

  // Remove items that have been in the Bin for more than 14 days, with their stored files (off with ENABLE_BIN_PURGE=off)
  try {
    require('./services/binPurge').startBinPurge();
  } catch (schedulerError) {
    logger.warn('Bin purge failed to start:', schedulerError.message);
  }

  // Pick up weekly posts a restart left half-made (off with ENABLE_WEEK_RECOVERY=off)
  try {
    require('./services/week/weekRecovery').startWeekRecovery();
  } catch (schedulerError) {
    logger.warn('Weekly post recovery failed to start:', schedulerError.message);
  }

  // Start automatic performance-tracking scheduler (24h/3d/7d/2w/1m checks)
  try {
    startPerformanceTrackerScheduler();
  } catch (schedulerError) {
    logger.warn('Performance tracker scheduler failed to start:', schedulerError.message);
  }

  // Monthly invoices for managed clients who have automatic invoices on (hourly check)
  try {
    require('./services/billingScheduler').startBillingScheduler();
  } catch (schedulerError) {
    logger.warn('Billing scheduler failed to start:', schedulerError.message);
  }

  // Owner is emailed once when social profiles reach the alert level (counted from our own accounts, checked hourly)
  try {
    const watch = require('./services/ayrshareProfileWatch');
    // Through a lease (services/leaseLock.js) so only one server sends the alert email.
    const run = () => require('./services/leaseLock').withLease('scheduler:profile-watch', 10 * 60 * 1000, () => watch.check({ User: require('./models/User'), alert: watch.opsAlert(require('./services/opsAlerts')), store: watch.modelStore(require('./models/OpsState')) }))
      .catch((e) => logger.warn('Profile watch failed:', e.message));
    setTimeout(run, 60 * 1000).unref();
    setInterval(run, 60 * 60 * 1000).unref();
  } catch (watchError) {
    logger.warn('Profile watch failed to start:', watchError.message);
  }

  // Accounts that asked to be deleted are erased once their 14 days are over
  try {
    require('./services/accountDeletion').startAccountPurge();
  } catch (schedulerError) {
    logger.warn('Account purge failed to start:', schedulerError.message);
  }

  // A reminder email three days before each monthly plan charge
  try {
    require('./services/renewalReminders').startRenewalReminders();
  } catch (schedulerError) {
    logger.warn('Renewal reminders failed to start:', schedulerError.message);
  }

  // Drafts left "creating" by a restart or a lost connection are closed, and their Quarks returned
  try {
    require('./services/staleDrafts').startStaleDraftReaper();
  } catch (reaperError) {
    logger.warn('Unfinished-draft cleanup failed to start:', reaperError.message);
  }

  // Plan runs a restart interrupted are ended (all of them in a single process; only stale ones in a web/worker split).
  try {
    require('./services/plan/planService').reapOnBoot()
      .then((r) => { if (r && r.reaped) logger.info(`[plan] ended ${r.reaped} plan run(s) a restart interrupted`); })
      .catch((e) => logger.warn('[plan] could not end interrupted plan runs:', e && e.message));
  } catch (reapError) {
    logger.warn('Plan run cleanup failed to start:', reapError.message);
  }

  // Weekly competitor snapshots: capped scraper reads. OFF unless ENABLE_COMPETITOR_TRACKER is exactly "on" (the owner sets it in the production secret)
  try {
    require('./services/competitors/tracker').startCompetitorTracker();
  } catch (schedulerError) {
    logger.warn('Competitor tracker failed to start:', schedulerError.message);
  }

  // Weekly comment scoring (a small model reads each account's own comments and messages). OFF unless ENABLE_LISTENING is exactly "on"
  try {
    require('./services/listening/scorer').startListeningScorer();
  } catch (schedulerError) {
    logger.warn('Comment scoring failed to start:', schedulerError.message);
  }

  // The plan each paying account gets from its profile: monthly refresh, retries for a failed first plan
  try {
    require('./services/plan/planScheduler').startPlanScheduler();
  } catch (schedulerError) {
    logger.warn('Plan scheduler failed to start:', schedulerError.message);
  }

  // What Nebulaa learned: daily bounded refresh from the six sources plus change triggers (code only, no model call;
  // on by default, off with ENABLE_MEMORY_REFRESH=off)
  try {
    require('./services/brandMemory/runner').startBrandMemoryJob();
  } catch (schedulerError) {
    logger.warn('Brand memory refresh failed to start:', schedulerError.message);
  }

  // Start weekly AI memory distillation scheduler
  try {
    startMemoryDistillationScheduler();
  } catch (schedulerError) {
    logger.warn('Memory distillation scheduler failed to start:', schedulerError.message);
  }
}

// Database connection and server start
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  // Run environment health checks at boot
  await validateProductionEnvironment().catch((err) => {
    logger.error('⚠️  Failed running startup health checks:', err.message);
  });

  let mongoConnected = false;
  try {
    logger.info('Connecting to MongoDB...');
    let retries = 5;
    while (retries > 0) {
      try {
        // Pool and timeouts from config/mongoOptions.js (MONGO_MAX_POOL_SIZE default 20 per task, MONGO_MIN_POOL_SIZE 2).
        await mongoose.connect(process.env.MONGODB_URI, mongoConnectOptions());
        logger.info('✅ MongoDB connected successfully');
        mongoConnected = true;
        break;
      } catch (err) {
        retries -= 1;
        logger.warn(`⚠️  MongoDB connection failed. Retries left: ${retries}. Waiting 5 seconds...`);
        if (retries === 0) throw err;
        await new Promise(res => setTimeout(res, 5000));
      }
    }

    // Schedulers, sweeps, queue consumers and loops: only where background jobs run (RUN_BACKGROUND, default on).
    // A web-only task (RUN_BACKGROUND=0) serves every request and leaves this work to the worker task.
    logger.info(backgroundRole.describe());
    if (backgroundRole.runsBackground() || backgroundRole.runsJobConsumers()) startBackgroundJobs();

    // Initialize OTP email service
    try {
      const otpService = require('./services/otpService');
      otpService.initialize();
    } catch (otpError) {
      logger.warn('⚠️  OTP service failed to initialize:', otpError.message);
    }
  } catch (error) {
    logger.warn('⚠️  MongoDB not available:', error.message);
    if (process.env.NODE_ENV === 'production') {
      logger.error('❌ MongoDB connection is required in production. Exiting.');
      process.exit(1);
    }
    logger.warn('   Server will start in demo mode (no database persistence)');
  }

  const server = app.listen(PORT, () => {
    logger.info(`✅ Gravity API server running on http://localhost:${PORT}`);
    logger.info(`   Health check: http://localhost:${PORT}/api/health`);
    if (!mongoConnected) {
      logger.info('   ⚠️  Running in DEMO MODE (MongoDB unavailable)');
    }
  });

  httpServer = server;
  // keep-alive 65 s (above the load balancer's 60 s), headers 66 s, whole request SERVER_REQUEST_TIMEOUT_MS (300 s).
  require('./services/serverTimeouts').applyServerTimeouts(server);
  initializeSocketHub(server, allowedOrigins);

  // Memory leak hunting — logs heap + handles every 5 min as [MEM] in stdout.
  // Temporary diagnostic, remove once the leak is identified and fixed.
  try { require('./utils/memoryWatchdog').start(); } catch (e) {
    logger.warn('memoryWatchdog failed to start:', e.message);
  }

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      logger.error(`❌ Port ${PORT} is already in use. Stop the other process or set PORT to a different value.`);
      process.exit(1);
    }
    logger.error('Server listen error:', err);
    process.exit(1);
  });
};

// Handle MongoDB connection events
mongoose.connection.on('disconnected', () => {
  logger.info('MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  logger.error('MongoDB connection error:', err);
});

// Graceful shutdown. ECS stops a task with SIGTERM: health and ready answer 503 at once (the load balancer stops sending
// new requests), the server stops accepting connections, and the process ends when open requests finish, at most
// SHUTDOWN_DRAIN_MS later (default 20 s; keep it below the task's stopTimeout, see docs/superpowers/ops/ecs-web-worker.md).
let httpServer = null;
const shutdownDrainMs = () => {
  const n = Number.parseInt(String(process.env.SHUTDOWN_DRAIN_MS || ''), 10);
  return Number.isFinite(n) ? Math.max(1000, Math.min(115000, n)) : 20000;
};
process.on('SIGTERM', () => {
  const drainMs = shutdownDrainMs();
  logger.info(`SIGTERM received: finishing open requests (at most ${Math.round(drainMs / 1000)} s), then stopping.`);
  health.markShuttingDown();
  // Job consumers stop claiming at once, let running jobs finish within JOB_SHUTDOWN_GRACE_MS (default drain - 5 s),
  // then hand back (or fail and refund) what is still running, BEFORE the database connection closes.
  const jobsStopped = require('./services/jobConsumersShutdown').stopJobConsumers().catch((e) => logger.warn('Job consumers did not stop cleanly:', e && e.message));
  const stop = () => jobsStopped.then(() => mongoose.connection.close()).catch(() => {}).finally(() => process.exit(0));
  setTimeout(() => process.exit(0), drainMs).unref();
  if (httpServer) httpServer.close(stop); else stop();
});

process.on('SIGINT', async () => {
  health.markShuttingDown();
  logger.info('\nShutting down gracefully...');
  notificationScheduler.stop();
  snapshotScheduler.stop();
  await mongoose.connection.close();
  process.exit(0);
});

// scripts/bench-local.js loads the app without connecting, listening or starting any scheduler.
module.exports = { app };
if (process.env.NEBULAA_SERVER_NO_START !== '1') startServer();
