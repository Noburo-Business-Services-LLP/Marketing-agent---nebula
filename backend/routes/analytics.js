/**
 * Analytics Routes
 * Import and analyze marketing analytics
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const AnalyticsSnapshot = require('../models/AnalyticsSnapshot');
const User = require('../models/User');
const { analyzeMetrics, generateWithLLM } = require('../services/llmRouter');
const { getPostAnalytics, getSocialAnalyticsDetailed } = require('../services/socialMediaAPI');

/**
 * Helper: Get user's Ayrshare profile key
 */
async function getProfileKey(userId) {
  const user = await User.findById(userId);
  return user?.ayrshare?.profileKey || null;
}

// ============================================
// AYRSHARE POST ANALYTICS
// ============================================

/**
 * POST /api/analytics/post-analytics
 * Get analytics for a specific Ayrshare post
 * Body: { postId, platforms }
 */
router.post('/post-analytics', protect, async (req, res) => {
  try {
    const profileKey = await getProfileKey(req.user.userId || req.user.id);
    const { postId, platforms } = req.body;

    if (!postId) {
      return res.status(400).json({ success: false, error: 'Post ID is required' });
    }

    // Use provided platforms; if none, let Ayrshare use whatever platforms the post was sent to
    // by NOT sending platforms param at all (Ayrshare auto-detects)
    let platformList = platforms;
    if (!platformList || platformList.length === 0) {
      platformList = null; // null = let Ayrshare auto-detect from post history
    }

    console.log('Post analytics request - postId:', postId, 'platforms:', platformList || 'auto-detect');
    const result = await getPostAnalytics(postId, platformList, profileKey);

    if (!result.success) {
      console.log('Post analytics failed:', result.error);
      return res.status(400).json({ success: false, error: result.error || 'Failed to get post analytics' });
    }

    console.log('Post analytics result keys:', JSON.stringify(result.data).substring(0, 500));
    res.json({ success: true, analytics: result.data });
  } catch (error) {
    console.error('Post analytics error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/analytics/social-analytics
 * Get account-level social analytics (followers, demographics, etc.)
 * Body: { platforms, quarters }
 */
router.post('/social-analytics', protect, async (req, res) => {
  try {
    const profileKey = await getProfileKey(req.user.userId || req.user.id);
    const { platforms } = req.body;

    // Use user's actual connected platforms if not specified
    let platformList = platforms;
    if (!platformList || platformList.length === 0) {
      const User = require('../models/User');
      const user = await User.findById(req.user.userId || req.user.id);
      const connected = user?.ayrshare?.connectedAccounts || [];
      platformList = connected.length > 0 ? connected : ['instagram', 'facebook'];
    }

    console.log('Social analytics request for platforms:', platformList);

    const result = await getSocialAnalyticsDetailed(
      profileKey,
      platformList
    );

    if (!result.success) {
      console.log('Social analytics failed:', result.error);
      return res.status(400).json({ success: false, error: result.error || 'Failed to get social analytics' });
    }

    res.json({ success: true, analytics: result.data });
  } catch (error) {
    console.error('Social analytics error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/analytics/daily-analytics
 * Get daily time-series analytics data
 * Body: { platforms }
 */
router.post('/daily-analytics', protect, async (req, res) => {
  try {
    const profileKey = await getProfileKey(req.user.userId || req.user.id);
    const { platforms } = req.body;

    // Note: Ayrshare's /analytics/social doesn't natively support daily time-series.
    // We return the standard analytics data and the frontend handles display.
    const result = await getSocialAnalyticsDetailed(
      profileKey,
      platforms || ['instagram', 'facebook']
    );

    if (!result.success) {
      // Return empty analytics instead of an error - daily breakdown is optional
      return res.json({ success: true, analytics: {} });
    }

    res.json({ success: true, analytics: result.data });
  } catch (error) {
    console.error('Daily analytics error:', error);
    // Don't 500 for optional daily data - return empty
    res.json({ success: true, analytics: {} });
  }
});

/**
 * POST /api/analytics/import/csv
 * Import analytics from CSV data
 */
router.post('/import/csv', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { data, dateRange, sourceName = 'CSV Import' } = req.body;
    
    if (!data || !dateRange) {
      return res.status(400).json({
        success: false,
        error: 'Data and date range are required'
      });
    }
    
    // Parse CSV data (expecting array of objects)
    const rows = Array.isArray(data) ? data : [];
    
    // Calculate aggregated metrics
    const metrics = {
      traffic: {
        sessions: sum(rows, 'sessions'),
        users: sum(rows, 'users'),
        newUsers: sum(rows, 'new_users') || sum(rows, 'newUsers'),
        pageViews: sum(rows, 'page_views') || sum(rows, 'pageViews'),
        bounceRate: avg(rows, 'bounce_rate') || avg(rows, 'bounceRate')
      },
      engagement: {
        likes: sum(rows, 'likes'),
        comments: sum(rows, 'comments'),
        shares: sum(rows, 'shares'),
        clicks: sum(rows, 'clicks'),
        impressions: sum(rows, 'impressions'),
        reach: sum(rows, 'reach')
      },
      conversions: {
        totalConversions: sum(rows, 'conversions'),
        leads: sum(rows, 'leads'),
        sales: sum(rows, 'sales'),
        signups: sum(rows, 'signups')
      },
      revenue: {
        totalRevenue: sum(rows, 'revenue'),
        transactions: sum(rows, 'transactions')
      },
      advertising: {
        totalSpend: sum(rows, 'spend') || sum(rows, 'cost'),
        impressions: sum(rows, 'ad_impressions') || sum(rows, 'impressions'),
        clicks: sum(rows, 'ad_clicks') || sum(rows, 'clicks'),
        conversions: sum(rows, 'ad_conversions') || sum(rows, 'conversions')
      }
    };
    
    // Calculate computed KPIs
    const kpis = computeKPIs(metrics);
    
    // Create analytics snapshot
    const snapshot = new AnalyticsSnapshot({
      userId,
      source: {
        type: 'csv_import',
        name: sourceName,
        importedAt: new Date()
      },
      dateRange: {
        start: new Date(dateRange.start),
        end: new Date(dateRange.end)
      },
      traffic: metrics.traffic,
      engagement: metrics.engagement,
      conversions: metrics.conversions,
      revenue: metrics.revenue,
      advertising: metrics.advertising,
      kpis,
      rawData: rows.slice(0, 100), // Store first 100 rows
      processingStatus: 'completed'
    });
    
    await snapshot.save();
    
    // Generate insights asynchronously
    generateInsightsAsync(snapshot._id).catch(err => {
      console.error('Insight generation failed:', err);
    });
    
    res.status(201).json({
      success: true,
      snapshot: {
        id: snapshot._id,
        dateRange: snapshot.dateRange,
        kpis: snapshot.kpis,
        processingStatus: snapshot.processingStatus
      },
      message: 'Analytics imported. Generating insights...'
    });
    
  } catch (error) {
    console.error('CSV import error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/analytics/import/manual
 * Manually input analytics metrics
 */
router.post('/import/manual', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { metrics, dateRange } = req.body;
    
    if (!dateRange) {
      return res.status(400).json({
        success: false,
        error: 'Date range is required'
      });
    }
    
    const kpis = computeKPIs(metrics);
    
    const snapshot = new AnalyticsSnapshot({
      userId,
      source: {
        type: 'manual',
        name: 'Manual Entry',
        importedAt: new Date()
      },
      dateRange: {
        start: new Date(dateRange.start),
        end: new Date(dateRange.end)
      },
      ...metrics,
      kpis,
      processingStatus: 'completed'
    });
    
    await snapshot.save();
    
    // Generate insights
    generateInsightsAsync(snapshot._id).catch(err => {
      console.error('Insight generation failed:', err);
    });
    
    res.status(201).json({
      success: true,
      snapshot: {
        id: snapshot._id,
        dateRange: snapshot.dateRange,
        kpis: snapshot.kpis
      }
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Generate AI insights for analytics
 */
async function generateInsightsAsync(snapshotId) {
  const snapshot = await AnalyticsSnapshot.findById(snapshotId);
  if (!snapshot) return;
  
  try {
    snapshot.processingStatus = 'processing';
    await snapshot.save();
    
    const metricsForAnalysis = {
      traffic: snapshot.traffic,
      engagement: snapshot.engagement,
      conversions: snapshot.conversions,
      revenue: snapshot.revenue,
      advertising: snapshot.advertising,
      kpis: snapshot.kpis,
      dateRange: snapshot.dateRange
    };
    
    const analysis = await analyzeMetrics(metricsForAnalysis);
    
    // Process insights from Gemini
    const insights = (analysis.insights?.insights || []).map(i => ({
      type: i.type || 'observation',
      title: i.title || i,
      description: i.description || '',
      metric: i.metric || '',
      priority: i.priority || 'medium',
      generatedBy: 'gemini',
      generatedAt: new Date()
    }));
    
    // Process actions from Grok
    const actions = (analysis.actions?.actions || []).map(a => ({
      title: typeof a === 'string' ? a : a.title || a.action,
      description: typeof a === 'object' ? a.description : '',
      expectedImpact: typeof a === 'object' ? a.impact : 'Medium',
      effort: typeof a === 'object' ? a.effort : 'medium',
      priority: 1,
      status: 'pending'
    }));
    
    snapshot.insights = insights;
    snapshot.suggestedActions = actions;
    snapshot.processingStatus = 'completed';
    await snapshot.save();
    
  } catch (error) {
    console.error('Insight generation error:', error);
    snapshot.processingStatus = 'failed';
    snapshot.processingError = error.message;
    await snapshot.save();
  }
}

/**
 * Compute KPIs from metrics
 */
function computeKPIs(metrics) {
  const kpis = {};
  
  // CTR (Click-through rate)
  if (metrics.engagement?.impressions && metrics.engagement?.clicks) {
    kpis.ctr = (metrics.engagement.clicks / metrics.engagement.impressions * 100).toFixed(2);
  } else if (metrics.advertising?.impressions && metrics.advertising?.clicks) {
    kpis.ctr = (metrics.advertising.clicks / metrics.advertising.impressions * 100).toFixed(2);
  }
  
  // Conversion Rate
  if (metrics.traffic?.sessions && metrics.conversions?.totalConversions) {
    kpis.conversionRate = (metrics.conversions.totalConversions / metrics.traffic.sessions * 100).toFixed(2);
  }
  
  // CAC (Customer Acquisition Cost)
  if (metrics.advertising?.totalSpend && metrics.conversions?.totalConversions) {
    kpis.cac = (metrics.advertising.totalSpend / metrics.conversions.totalConversions).toFixed(2);
  }
  
  // ROAS (Return on Ad Spend)
  if (metrics.advertising?.totalSpend && metrics.revenue?.totalRevenue) {
    kpis.roas = (metrics.revenue.totalRevenue / metrics.advertising.totalSpend).toFixed(2);
  }
  
  // Engagement Rate
  if (metrics.engagement?.impressions) {
    const totalEngagement = (metrics.engagement.likes || 0) + 
                           (metrics.engagement.comments || 0) + 
                           (metrics.engagement.shares || 0);
    kpis.engagementRate = (totalEngagement / metrics.engagement.impressions * 100).toFixed(2);
  }
  
  // CPC (Cost per Click)
  if (metrics.advertising?.totalSpend && metrics.advertising?.clicks) {
    kpis.cpc = (metrics.advertising.totalSpend / metrics.advertising.clicks).toFixed(2);
  }
  
  // CPM (Cost per Mille)
  if (metrics.advertising?.totalSpend && metrics.advertising?.impressions) {
    kpis.cpm = (metrics.advertising.totalSpend / metrics.advertising.impressions * 1000).toFixed(2);
  }
  
  return kpis;
}

/**
 * Helper functions
 */
function sum(rows, field) {
  return rows.reduce((acc, row) => acc + (parseFloat(row[field]) || 0), 0);
}

function avg(rows, field) {
  const values = rows.filter(r => r[field] != null);
  if (values.length === 0) return 0;
  return sum(values, field) / values.length;
}

/**
 * GET /api/analytics/snapshots
 * Get all analytics snapshots
 */
router.get('/snapshots', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { limit = 20 } = req.query;
    
    const snapshots = await AnalyticsSnapshot.find({ userId })
      .sort({ 'dateRange.start': -1 })
      .limit(parseInt(limit));
    
    res.json({
      success: true,
      snapshots: snapshots.map(s => ({
        id: s._id,
        source: s.source,
        dateRange: s.dateRange,
        kpis: s.kpis,
        processingStatus: s.processingStatus,
        insightCount: s.insights?.length || 0,
        actionCount: s.suggestedActions?.length || 0,
        createdAt: s.createdAt
      }))
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/analytics/:id
 * Get single analytics snapshot with insights
 */
router.get('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const snapshot = await AnalyticsSnapshot.findOne({ _id: req.params.id, userId });
    
    if (!snapshot) {
      return res.status(404).json({ success: false, error: 'Analytics snapshot not found' });
    }
    
    res.json({
      success: true,
      snapshot,
      generatedBy: {
        insights: 'gemini',
        actions: 'grok'
      }
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/analytics/:id/regenerate-insights
 * Regenerate insights for a snapshot
 */
router.post('/:id/regenerate-insights', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const snapshot = await AnalyticsSnapshot.findOne({ _id: req.params.id, userId });
    
    if (!snapshot) {
      return res.status(404).json({ success: false, error: 'Analytics snapshot not found' });
    }
    
    snapshot.processingStatus = 'pending';
    await snapshot.save();
    
    generateInsightsAsync(snapshot._id).catch(err => {
      console.error('Insight regeneration failed:', err);
    });
    
    res.json({
      success: true,
      message: 'Regenerating insights...'
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/analytics/:id/actions/:actionIndex
 * Update action status
 */
router.put('/:id/actions/:actionIndex', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { status } = req.body;
    const actionIndex = parseInt(req.params.actionIndex);
    
    const snapshot = await AnalyticsSnapshot.findOne({ _id: req.params.id, userId });
    
    if (!snapshot) {
      return res.status(404).json({ success: false, error: 'Analytics snapshot not found' });
    }
    
    if (actionIndex < 0 || actionIndex >= snapshot.suggestedActions.length) {
      return res.status(400).json({ success: false, error: 'Invalid action index' });
    }
    
    snapshot.suggestedActions[actionIndex].status = status;
    await snapshot.save();
    
    res.json({
      success: true,
      action: snapshot.suggestedActions[actionIndex]
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/analytics/:id
 * Delete analytics snapshot
 */
router.delete('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    const result = await AnalyticsSnapshot.findOneAndDelete({ _id: req.params.id, userId });
    
    if (!result) {
      return res.status(404).json({ success: false, error: 'Analytics snapshot not found' });
    }
    
    res.json({ success: true, message: 'Analytics snapshot deleted' });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/analytics/summary
 * Get aggregated analytics summary across all snapshots
 */
router.get('/summary', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { days = 30 } = req.query;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    
    const snapshots = await AnalyticsSnapshot.find({
      userId,
      'dateRange.start': { $gte: startDate }
    });
    
    // Aggregate metrics
    const summary = {
      totalSessions: 0,
      totalImpressions: 0,
      totalClicks: 0,
      totalConversions: 0,
      totalSpend: 0,
      totalRevenue: 0,
      avgCTR: 0,
      avgConversionRate: 0,
      snapshotCount: snapshots.length
    };
    
    for (const s of snapshots) {
      summary.totalSessions += s.traffic?.sessions || 0;
      summary.totalImpressions += s.engagement?.impressions || s.advertising?.impressions || 0;
      summary.totalClicks += s.engagement?.clicks || s.advertising?.clicks || 0;
      summary.totalConversions += s.conversions?.totalConversions || 0;
      summary.totalSpend += s.advertising?.totalSpend || 0;
      summary.totalRevenue += s.revenue?.totalRevenue || 0;
    }
    
    if (summary.totalImpressions > 0) {
      summary.avgCTR = (summary.totalClicks / summary.totalImpressions * 100).toFixed(2);
    }
    if (summary.totalSessions > 0) {
      summary.avgConversionRate = (summary.totalConversions / summary.totalSessions * 100).toFixed(2);
    }
    
    res.json({
      success: true,
      summary,
      dateRange: {
        start: startDate,
        end: new Date()
      }
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
