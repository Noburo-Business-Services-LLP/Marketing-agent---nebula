require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const sanitizeHtml = require('sanitize-html');
const path = require('path');
const fs = require('fs');

// ============================================
// Process-level crash logging (prevents silent 502s)
// ============================================
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// ============================================
// Environment Validation (Fail Fast)
// ============================================
const requiredEnvVars = ['GEMINI_API_KEY'];
const optionalEnvVars = ['GROK_API_KEY', 'MONGODB_URI', 'JWT_SECRET', 'SES_AWS_ACCESS_KEY_ID', 'SES_AWS_SECRET_ACCESS_KEY', 'SES_SENDER_EMAIL'];

console.log('\n🔍 Validating environment...');
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    // Don't exit - use fallback for Gemini
  } else {
    console.log(`✅ ${envVar}: configured`);
  }
}
for (const envVar of optionalEnvVars) {
  if (process.env[envVar]) {
    console.log(`✅ ${envVar}: configured`);
  } else {
    console.log(`⚠️  ${envVar}: not set (optional)`);
  }
}
console.log('');

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
// Security: Trust Proxy (for Render / Cloudflare)
// ============================================
app.set('trust proxy', 1);

// ============================================
// Security: Helmet — Secure HTTP Headers
// ============================================
app.use(helmet({
  contentSecurityPolicy: false, // Disabled — frontend is served separately
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
  console.log(`[CORS] Extra origins from CORS_ALLOWED_ORIGINS env: ${extraOrigins.join(', ')}`);
}

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, same-origin requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`⛔ CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// ============================================
// Security: Rate Limiting
// ============================================
// General API rate limit — 500 requests per 15 minutes per IP
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => {
    const url = String(req.originalUrl || '');
    if (req.method !== 'GET') return false;
    return (
      url.startsWith('/api/notifications') ||
      url.startsWith('/api/credits') ||
      url.startsWith('/api/video-generation/jobs/')
    );
  }
});

// Auth rate limit — 20 requests per 15 minutes (login, register, OTP)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later.' }
});

// AI generation rate limit — 100 requests per 15 minutes (campaigns can generate 14+ posts per run)
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI generation requests, please try again later.' }
});

// Social media posting rate limit — 30 requests per 15 minutes
const socialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many social media requests, please try again later.' }
});

// Health check endpoint (exempt from rate limiting)
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// More detailed health check for debugging production 502s (does not expose secrets)
app.get('/api/health/details', (req, res) => {
  let ffmpegPath = null;
  let ffprobePath = null;

  try {
    // Optional dependency check (installed in backend/package.json)
    ffmpegPath = require('ffmpeg-static');
  } catch (_) { }

  try {
    ffprobePath = require('ffprobe-static')?.path || null;
  } catch (_) { }

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
app.use('/api', generalLimiter);

// Raw body for Razorpay webhook signature verification (must come before express.json)
app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));

// Request size limits. Most routes only ever receive small text, so they get 1 MB; only the routes that take pictures
// (sent as text) get a bigger allowance. A huge body is refused before it is read into memory.
const BIG_BODY_PREFIXES = [
  '/api/campaigns', '/api/carousels', '/api/create-assist', '/api/drafts', '/api/brand-assets', '/api/video-generation', '/api/hero-video',
  '/api/products', '/api/ideas', '/api/content', '/api/social', '/api/ads', '/api/ad-campaigns', '/api/chat',
  '/api/blueprint', '/api/brand', '/api/auth/update-profile', '/api/auth/complete-onboarding', '/api/photoshoot/upload'
];
const smallJson = express.json({ limit: '1mb' });
const bigJson = express.json({ limit: '40mb' });
const smallForm = express.urlencoded({ extended: true, limit: '1mb' });
const bigForm = express.urlencoded({ extended: true, limit: '40mb' });
const wantsBigBody = (req) => BIG_BODY_PREFIXES.some((p) => req.path === p || req.path.startsWith(`${p}/`));
app.use((req, res, next) => (wantsBigBody(req) ? bigJson : smallJson)(req, res, next));
app.use((req, res, next) => (wantsBigBody(req) ? bigForm : smallForm)(req, res, next));

// ============================================
// Security: NoSQL Injection Prevention
// ============================================
app.use(mongoSanitize());

// ============================================
// Security: HTTP Parameter Pollution Prevention
// ============================================
app.use(hpp());

// ============================================
// Security: XSS Prevention — sanitize all string inputs
// ============================================
app.use((req, res, next) => {
  if (req.body) {
    const sanitize = (obj) => {
      for (const key in obj) {
        if (typeof obj[key] === 'string') {
          obj[key] = sanitizeHtml(obj[key], { allowedTags: [], allowedAttributes: {} });
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          sanitize(obj[key]);
        }
      }
    };
    sanitize(req.body);
  }
  next();
});

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

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
    } catch (_) {}
  });
  next();
});

// Home summary cache: a write that succeeded clears the signed-in account's cached Home numbers (60 s cache).
const homeCacheWatch = require('./routes/home').watch;
app.use('/api', homeCacheWatch);

// Routes - Admin (no trial/credit guard)
app.use('/api/admin', authLimiter, adminRoutes);
app.use('/api/csm', csmRoutes);
app.use('/api/staff', staffRoutes);

// Routes - Core (with specific rate limiters on sensitive routes)
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/social/inbox', socialInboxRoutes);
app.use('/api/social', socialLimiter, socialRoutes);
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
app.use('/api/ai-memory', aiMemoryRoutes);
app.use('/api/influencers', influencerRoutes);
app.use('/api/collaborations', collaborationRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/drafts', draftLocalizeRoutes);
app.use('/api/drafts', draftRoutes);
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
app.use('/audio', express.static(path.join(__dirname, 'tone-audio')));
app.use('/generated-media', express.static(path.join(__dirname, 'storage', 'ai-videos')));

// Serve static files from React frontend build
app.use(express.static(path.join(__dirname, 'public')));

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
  res.sendFile(indexFile);
});

// API 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  // A malformed id in a link or request is the caller's mistake, not a server fault.
  const status = err?.name === 'CastError' ? 400 : Number(err?.statusCode || err?.status || 500);
  // The real message goes to the log only. Customers never see raw system errors.
  const message = status === 413
    ? 'That file or request is too large.'
    : status >= 500
      ? 'Something went wrong. Please try again.'
      : err?.name === 'CastError' ? 'That request is not valid.' : String(err?.message || 'Request could not be completed.');
  const isApiRequest = req.path.startsWith('/api');

  console.error('Server Error:', {
    status,
    method: req.method,
    path: req.path,
    message: String(err?.message || message),
    stack: err?.stack
  });

  // Always return JSON for API requests (prevents HTML error pages breaking JSON parsing).
  if (isApiRequest) {
    return res.status(status).json({
      success: false,
      message,
      errorCode: status >= 500 ? undefined : (err?.code || err?.name || undefined),
      error: process.env.NODE_ENV === 'development' ? (err?.stack || String(err)) : undefined
    });
  }

  return res.status(status).json({
    success: false,
    message
  });
});

// ============================================
// Production Environment Health Validation
// ============================================
const validateProductionEnvironment = async () => {
  console.log('\n🏥 Running Production Environment Health Checks...');
  
  // 1. Validate Fal.ai API key
  const falKey = process.env.FAL_KEY;
  if (falKey) {
    console.log(`   ✅ FAL_KEY is configured (Length: ${falKey.length})`);
  } else {
    console.warn(`   ⚠️  FAL_KEY is NOT configured. Fal.ai video generation will fail.`);
  }

  // 2. Validate FFmpeg
  let resolvedFfmpeg = null;
  try {
    resolvedFfmpeg = require('ffmpeg-static');
    console.log(`   ✅ ffmpeg-static resolved path: ${resolvedFfmpeg}`);
  } catch (err) {
    console.warn(`   ⚠️  ffmpeg-static require failed, checking system path...`);
  }

  if (!resolvedFfmpeg) {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    try {
      const { spawnSync } = require('child_process');
      const res = spawnSync(whichCmd, ['ffmpeg'], { windowsHide: true });
      if (res.status === 0 && res.stdout) {
        resolvedFfmpeg = String(res.stdout).trim().split(/\r?\n/)[0];
        console.log(`   ✅ System ffmpeg resolved: ${resolvedFfmpeg}`);
      }
    } catch (_) {}
  }

  if (resolvedFfmpeg && fs.existsSync(resolvedFfmpeg)) {
    try {
      const { spawnSync } = require('child_process');
      const ver = spawnSync(resolvedFfmpeg, ['-version'], { windowsHide: true });
      if (ver.status === 0) {
        const firstLine = String(ver.stdout).split('\n')[0];
        console.log(`   ✅ FFmpeg is accessible and working: ${firstLine}`);
      } else {
        console.error(`   ❌ FFmpeg found but failed to run with status ${ver.status}`);
      }
    } catch (err) {
      console.error(`   ❌ Failed to run FFmpeg:`, err.message);
    }
  } else {
    console.error(`   ❌ FFmpeg was NOT found on this system! Video merging will fail.`);
  }

  // 3. Validate FFprobe
  let resolvedFfprobe = null;
  try {
    resolvedFfprobe = require('ffprobe-static')?.path;
    if (resolvedFfprobe) console.log(`   ✅ ffprobe-static resolved path: ${resolvedFfprobe}`);
  } catch (err) {
    console.warn(`   ⚠️  ffprobe-static require failed, checking system path...`);
  }

  if (!resolvedFfprobe) {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    try {
      const { spawnSync } = require('child_process');
      const res = spawnSync(whichCmd, ['ffprobe'], { windowsHide: true });
      if (res.status === 0 && res.stdout) {
        resolvedFfprobe = String(res.stdout).trim().split(/\r?\n/)[0];
        console.log(`   ✅ System ffprobe resolved: ${resolvedFfprobe}`);
      }
    } catch (_) {}
  }

  if (resolvedFfprobe && fs.existsSync(resolvedFfprobe)) {
    try {
      const { spawnSync } = require('child_process');
      const ver = spawnSync(resolvedFfprobe, ['-version'], { windowsHide: true });
      if (ver.status === 0) {
        const firstLine = String(ver.stdout).split('\n')[0];
        console.log(`   ✅ FFprobe is accessible and working: ${firstLine}`);
      } else {
        console.error(`   ❌ FFprobe found but failed to run with status ${ver.status}`);
      }
    } catch (err) {
      console.error(`   ❌ Failed to run FFprobe:`, err.message);
    }
  } else {
    console.error(`   ❌ FFprobe was NOT found on this system! Subtitles/audio timing analysis may fail.`);
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
      console.log(`   ✅ Storage directory exists and is writeable: ${dir}`);
    } catch (err) {
      console.error(`   ❌ Storage directory error for ${dir}:`, err.message);
    }
  }
  console.log('🏥 Environment Health Checks Completed.\n');
};

// Database connection and server start
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  // Run environment health checks at boot
  await validateProductionEnvironment().catch((err) => {
    console.error('⚠️  Failed running startup health checks:', err.message);
  });

  let mongoConnected = false;
  try {
    console.log('Connecting to MongoDB...');
    let retries = 5;
    while (retries > 0) {
      try {
        await mongoose.connect(process.env.MONGODB_URI, {
          // Atlas/network hiccups can cause fast failures right in the middle
          // of scheduling/publishing. Give Mongoose more time to pick a server.
          serverSelectionTimeoutMS: 30000,
          socketTimeoutMS: 45000,
          connectTimeoutMS: 30000,
        });
        console.log('✅ MongoDB connected successfully');
        mongoConnected = true;
        break;
      } catch (err) {
        retries -= 1;
        console.warn(`⚠️  MongoDB connection failed. Retries left: ${retries}. Waiting 5 seconds...`);
        if (retries === 0) throw err;
        await new Promise(res => setTimeout(res, 5000));
      }
    }

    // Start persistent video generation queue worker
    try {
      const { videoGenerationQueue } = require('./services/videoGenerationQueue');
      videoGenerationQueue.startWorker();
    } catch (queueError) {
      console.warn('⚠️  Video generation queue worker failed to start:', queueError.message);
    }

    // Start notification scheduler for campaign reminders
    try {
      notificationScheduler.start();
    } catch (schedulerError) {
      console.warn('⚠️  Notification scheduler failed to start:', schedulerError.message);
    }

    // Start analytics snapshot scheduler (every 12 hours)
    try {
      snapshotScheduler.start();
    } catch (schedulerError) {
      console.warn('⚠️  Snapshot scheduler failed to start:', schedulerError.message);
    }

    // Start campaign scheduler for due scheduled posts
    try {
      startCampaignScheduler();
    } catch (schedulerError) {
      console.warn('Campaign scheduler failed to start:', schedulerError.message);
    }

    // Start Gravity Smart Calendar scheduler for approved auto mode
    try {
      startContentCalendarScheduler();
    } catch (schedulerError) {
      console.warn('Content calendar scheduler failed to start:', schedulerError.message);
    }

    // Pick up photoshoots a restart left half-made (off with ENABLE_PHOTOSHOOT_RESUME=off)
    try {
      require('./services/photoshoot').startPhotoshootResume();
    } catch (schedulerError) {
      console.warn('Photoshoot resume failed to start:', schedulerError.message);
    }

    // Pick up weekly posts a restart left half-made (off with ENABLE_WEEK_RECOVERY=off)
    try {
      require('./services/week/weekRecovery').startWeekRecovery();
    } catch (schedulerError) {
      console.warn('Weekly post recovery failed to start:', schedulerError.message);
    }

    // Start automatic performance-tracking scheduler (24h/3d/7d/2w/1m checks)
    try {
      startPerformanceTrackerScheduler();
    } catch (schedulerError) {
      console.warn('Performance tracker scheduler failed to start:', schedulerError.message);
    }

    // Monthly invoices for managed clients who have automatic invoices on (hourly check)
    try {
      require('./services/billingScheduler').startBillingScheduler();
    } catch (schedulerError) {
      console.warn('Billing scheduler failed to start:', schedulerError.message);
    }

    // Owner is emailed once when social profiles reach the alert level (counted from our own accounts, checked hourly)
    try {
      const watch = require('./services/ayrshareProfileWatch');
      const run = () => watch.check({ User: require('./models/User'), alert: watch.opsAlert(require('./services/opsAlerts')), store: watch.modelStore(require('./models/OpsState')) })
        .catch((e) => console.warn('Profile watch failed:', e.message));
      setTimeout(run, 60 * 1000).unref();
      setInterval(run, 60 * 60 * 1000).unref();
    } catch (watchError) {
      console.warn('Profile watch failed to start:', watchError.message);
    }

    // Accounts that asked to be deleted are erased once their 14 days are over
    try {
      require('./services/accountDeletion').startAccountPurge();
    } catch (schedulerError) {
      console.warn('Account purge failed to start:', schedulerError.message);
    }

    // A reminder email three days before each monthly plan charge
    try {
      require('./services/renewalReminders').startRenewalReminders();
    } catch (schedulerError) {
      console.warn('Renewal reminders failed to start:', schedulerError.message);
    }

    // Drafts left "creating" by a restart or a lost connection are closed, and their Quarks returned
    try {
      require('./services/staleDrafts').startStaleDraftReaper();
    } catch (reaperError) {
      console.warn('Unfinished-draft cleanup failed to start:', reaperError.message);
    }

    // The plan runs live in this process, so after a restart every queued or processing one is dead: end them now.
    try {
      require('./services/plan/planService').reapOnBoot()
        .then((r) => { if (r && r.reaped) console.log(`[plan] ended ${r.reaped} plan run(s) a restart interrupted`); })
        .catch((e) => console.warn('[plan] could not end interrupted plan runs:', e && e.message));
    } catch (reapError) {
      console.warn('Plan run cleanup failed to start:', reapError.message);
    }

    // Weekly competitor snapshots: capped scraper reads. OFF unless ENABLE_COMPETITOR_TRACKER is exactly "on" (the owner sets it in the production secret)
    try {
      require('./services/competitors/tracker').startCompetitorTracker();
    } catch (schedulerError) {
      console.warn('Competitor tracker failed to start:', schedulerError.message);
    }

    // Weekly comment scoring (a small model reads each account's own comments and messages). OFF unless ENABLE_LISTENING is exactly "on"
    try {
      require('./services/listening/scorer').startListeningScorer();
    } catch (schedulerError) {
      console.warn('Comment scoring failed to start:', schedulerError.message);
    }

    // The plan each paying account gets from its profile: monthly refresh, retries for a failed first plan
    try {
      require('./services/plan/planScheduler').startPlanScheduler();
    } catch (schedulerError) {
      console.warn('Plan scheduler failed to start:', schedulerError.message);
    }

    // Start weekly AI memory distillation scheduler
    try {
      startMemoryDistillationScheduler();
    } catch (schedulerError) {
      console.warn('Memory distillation scheduler failed to start:', schedulerError.message);
    }

    // Initialize OTP email service
    try {
      const otpService = require('./services/otpService');
      otpService.initialize();
    } catch (otpError) {
      console.warn('⚠️  OTP service failed to initialize:', otpError.message);
    }
  } catch (error) {
    console.warn('⚠️  MongoDB not available:', error.message);
    if (process.env.NODE_ENV === 'production') {
      console.error('❌ MongoDB connection is required in production. Exiting.');
      process.exit(1);
    }
    console.warn('   Server will start in demo mode (no database persistence)');
  }

  const server = app.listen(PORT, () => {
    console.log(`✅ Gravity API server running on http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health`);
    if (!mongoConnected) {
      console.log('   ⚠️  Running in DEMO MODE (MongoDB unavailable)');
    }
  });

  initializeSocketHub(server, allowedOrigins);

  // Memory leak hunting — logs heap + handles every 5 min as [MEM] in stdout.
  // Temporary diagnostic, remove once the leak is identified and fixed.
  try { require('./utils/memoryWatchdog').start(); } catch (e) {
    console.warn('memoryWatchdog failed to start:', e.message);
  }

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use. Stop the other process or set PORT to a different value.`);
      process.exit(1);
    }
    console.error('Server listen error:', err);
    process.exit(1);
  });
};

// Handle MongoDB connection events
mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  notificationScheduler.stop();
  snapshotScheduler.stop();
  await mongoose.connection.close();
  process.exit(0);
});

startServer();
