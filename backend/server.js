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
const chatRoutes = require('./routes/chat');
const supportRoutes = require('./routes/support');
const dashboardRoutes = require('./routes/dashboard');
const campaignRoutes = require('./routes/campaigns');
const competitorRoutes = require('./routes/competitors');
const reminderRoutes = require('./routes/reminders');
const accountRoutes = require('./routes/accounts');

// New real-data routes
const brandRoutes = require('./routes/brand');
const analyticsRoutes = require('./routes/analytics');

// Reachouts CRM routes - REMOVED

// Notification routes
const notificationRoutes = require('./routes/notifications');

// Brand Assets routes
const brandAssetsRoutes = require('./routes/brandAssets');

// Ads / Boost routes
const adsRoutes = require('./routes/ads');

// Credits / Trial routes
const creditsRoutes = require('./routes/credits');

// Payment / Razorpay routes
const paymentRoutes = require('./routes/payment');

// Trial guard middleware
const { checkTrial } = require('./middleware/trialGuard');

// Content routes
const contentRoutes = require('./routes/content');

// Google Calendar routes
const googleCalendarRoutes = require('./routes/googleCalendar');
const productRoutes = require('./routes/products');

// Notification scheduler service
const notificationScheduler = require('./services/notificationScheduler');
// Analytics snapshot scheduler
const snapshotScheduler = require('./services/snapshotScheduler');

const app = express();

// ============================================
// Security: Trust Proxy (for Render / Cloudflare)
// ============================================
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

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
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'https://marketing-agent-nebula.onrender.com',
  'https://www.marketing-agent-nebula.onrender.com',
  'https://nebulaa.ai',
  'https://www.nebulaa.ai',
  'https://demo.nebulaa.ai',
  'https://www.demo.nebulaa.ai'
];

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
// General API rate limit — 200 requests per 15 minutes per IP
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
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

// Apply general limiter to all API routes
app.use('/api', generalLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

// Routes - Core (with specific rate limiters on sensitive routes)
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/social', socialLimiter, socialRoutes);
app.use('/api/chat', aiLimiter, chatRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/campaigns', aiLimiter, campaignRoutes);
app.use('/api/competitors', competitorRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/accounts', accountRoutes);

// Routes - Real Data Features
app.use('/api/brand', brandRoutes);
app.use('/api/analytics', analyticsRoutes);

// Routes - Reachouts CRM - REMOVED

// Routes - Notifications
app.use('/api/notifications', notificationRoutes);

// Routes - Brand Assets
app.use('/api/brand-assets', brandAssetsRoutes);

// Routes - Ads / Boost
app.use('/api/ads', adsRoutes);

// Routes - Credits / Trial
app.use('/api/credits', creditsRoutes);

// Routes - Payment / Razorpay
app.use('/api/payment', paymentRoutes);

// Routes - Content
app.use('/api/content', contentRoutes);
app.use('/api/google-calendar', googleCalendarRoutes);
app.use('/api/products', productRoutes);

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

// Serve static files from React frontend build
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all handler for React Router - serve index.html for any non-API routes
app.get('*', (req, res, next) => {
  // If it's an API route, pass to 404 handler
  if (req.path.startsWith('/api')) {
    return next();
  }
  // Otherwise serve React app
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
  console.error('Server Error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// Database connection and server start
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  let mongoConnected = false;
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      // Atlas/network hiccups can cause fast failures right in the middle
      // of scheduling/publishing. Give Mongoose more time to pick a server.
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
    });
    console.log('✅ MongoDB connected successfully');
    mongoConnected = true;

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

    // Initialize OTP email service
    try {
      const otpService = require('./services/otpService');
      otpService.initialize();
    } catch (otpError) {
      console.warn('⚠️  OTP service failed to initialize:', otpError.message);
    }
  } catch (error) {
    console.warn('⚠️  MongoDB not available:', error.message);
    console.warn('   Server will start in demo mode (no database persistence)');
  }

  const server = app.listen(PORT, () => {
    console.log(`✅ Gravity API server running on http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health`);
    if (!mongoConnected) {
      console.log('   ⚠️  Running in DEMO MODE (MongoDB unavailable)');
    }
  });

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
