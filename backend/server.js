require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
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
const dashboardRoutes = require('./routes/dashboard');
const campaignRoutes = require('./routes/campaigns');
const competitorRoutes = require('./routes/competitors');
const influencerRoutes = require('./routes/influencers');
const reminderRoutes = require('./routes/reminders');

// New real-data routes
const brandRoutes = require('./routes/brand');
const trendRoutes = require('./routes/trends');
const contentRoutes = require('./routes/content');
const campaignBuilderRoutes = require('./routes/campaignBuilder');
const analyticsRoutes = require('./routes/analytics');

// Reachouts CRM routes - REMOVED

// Notification routes
const notificationRoutes = require('./routes/notifications');

// Notification scheduler service
const notificationScheduler = require('./services/notificationScheduler');

const app = express();

// CORS configuration for production and development
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'https://marketing-agent-nebula.onrender.com',
  'https://www.marketing-agent-nebula.onrender.com'
];

// In production on Render, trust proxy for proper HTTPS handling
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, same-origin requests)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else if (process.env.NODE_ENV === 'production') {
      // In production, be more permissive for Render deployment
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Routes - Core
app.use('/api/auth', authRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/competitors', competitorRoutes);
app.use('/api/influencers', influencerRoutes);
app.use('/api/reminders', reminderRoutes);

// Routes - Real Data Features
app.use('/api/brand', brandRoutes);
app.use('/api/trends', trendRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/campaign-builder', campaignBuilderRoutes);
app.use('/api/analytics', analyticsRoutes);

// Routes - Reachouts CRM - REMOVED

// Routes - Notifications
app.use('/api/notifications', notificationRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Gravity API is running',
    timestamp: new Date().toISOString()
  });
});

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
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ MongoDB connected successfully');
    mongoConnected = true;

    // Start notification scheduler for campaign reminders
    try {
      notificationScheduler.start();
    } catch (schedulerError) {
      console.warn('⚠️  Notification scheduler failed to start:', schedulerError.message);
    }
  } catch (error) {
    console.warn('⚠️  MongoDB not available:', error.message);
    console.warn('   Server will start in demo mode (no database persistence)');
  }

  app.listen(PORT, () => {
    console.log(`✅ Gravity API server running on http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health`);
    if (!mongoConnected) {
      console.log('   ⚠️  Running in DEMO MODE (MongoDB unavailable)');
    }
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
  await mongoose.connection.close();
  process.exit(0);
});

startServer();
