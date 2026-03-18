/**
 * Analytics Snapshot Scheduler
 * Runs every 12 hours — fetches social analytics for all users with
 * connected Ayrshare accounts and stores a daily snapshot.
 */

const SocialSnapshot = require('../models/SocialSnapshot');
const User = require('../models/User');
const { getAyrshareUserProfile, getUserSocialAnalytics } = require('./socialMediaAPI');

const TWELVE_HOURS = 12 * 60 * 60 * 1000;

class SnapshotScheduler {
  constructor() {
    this.intervalId = null;
    this.running = false;
  }

  start() {
    if (this.intervalId) {
      console.log('⚠️  Snapshot scheduler already running');
      return;
    }
    console.log('📊 Starting analytics snapshot scheduler...');

    // Run once on startup (after 60s delay to let other services initialize)
    setTimeout(() => this.collectSnapshots(), 60000);

    // Then every 12 hours
    this.intervalId = setInterval(() => this.collectSnapshots(), TWELVE_HOURS);
    console.log('✅ Snapshot scheduler started (every 12 hours)');
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('🛑 Snapshot scheduler stopped');
    }
  }

  async collectSnapshots() {
    if (this.running) return;
    this.running = true;

    try {
      // Find all users with Ayrshare profile keys
      const users = await User.find({
        'ayrshare.profileKey': { $exists: true, $ne: null }
      }).select('_id ayrshare.profileKey');

      if (users.length === 0) {
        this.running = false;
        return;
      }

      console.log(`📊 Collecting snapshots for ${users.length} user(s)...`);
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Normalize to start of day

      for (const user of users) {
        try {
          await this.collectForUser(user._id, user.ayrshare.profileKey, today);
        } catch (err) {
          console.error(`📊 Snapshot failed for user ${user._id}:`, err.message);
        }
      }

      console.log('📊 Snapshot collection complete');
    } catch (error) {
      console.error('📊 Snapshot scheduler error:', error.message);
    }

    this.running = false;
  }

  async collectForUser(userId, profileKey, date) {

    // Get connected platforms from Ayrshare
    const userProfile = await getAyrshareUserProfile(profileKey);
    if (!userProfile.success || !userProfile.data?.activeSocialAccounts?.length) return;

    const connectedPlatforms = userProfile.data.activeSocialAccounts;

    // Fetch analytics
    const result = await getUserSocialAnalytics(profileKey, connectedPlatforms);
    if (!result.success || !result.data) return;

    // Extract per-platform metrics — field names vary by platform
    const platforms = {};
    let totalFollowers = 0, totalReach = 0, totalImpressions = 0, totalPosts = 0;

    for (const platform of connectedPlatforms) {
      const raw = result.data[platform];
      if (!raw || typeof raw !== 'object') continue;

      const d = raw.analytics || raw;

      // Followers: varies per platform
      const followers = extractNum(d.followersCount)
        || extractNum(d.followers)       // LinkedIn: nested { totalFollowerCount }
        || extractNum(d.fanCount)
        || extractNum(d.firstDegreeSize)
        || 0;

      // Following
      const following = extractNum(d.followsCount)
        || extractNum(d.followingCount)
        || extractNum(d.following)
        || 0;

      // Posts
      const posts = extractNum(d.mediaCount)
        || extractNum(d.postsCount)
        || extractNum(d.posts)
        || 0;

      // Reach: platform-specific field names
      const reach = extractNum(d.reachCount)                    // Instagram
        || extractNum(d.pagePostsImpressionsUnique)             // Facebook (unique reach)
        || extractNum(d.uniqueImpressionsCount)                 // LinkedIn
        || extractNum(d.reach)
        || 0;

      // Impressions: platform-specific field names
      const impressions = extractNum(d.pagePostsImpressions)    // Facebook
        || extractNum(d.impressionCount)                        // LinkedIn
        || extractNum(d.viewsCount)                             // Instagram (profile views)
        || extractNum(d.impressions)
        || 0;

      // Engagement rate
      let engagementRate = extractNum(d.engagementRate) || extractNum(d.engagement_rate) || 0;
      // LinkedIn returns engagement as decimal (0.10 = 10%), convert to percentage
      if (platform === 'linkedin' && d.engagement !== undefined) {
        engagementRate = extractNum(d.engagement) * 100;
      }
      // Facebook: compute from engagements / impressions
      if (platform === 'facebook' && engagementRate === 0 && d.pagePostEngagements && d.pagePostsImpressions) {
        engagementRate = parseFloat(((d.pagePostEngagements / d.pagePostsImpressions) * 100).toFixed(2));
      }
      // Instagram: compute from (likes + comments) / followers
      if (platform === 'instagram' && engagementRate === 0 && followers > 0) {
        const totalEng = (extractNum(d.likeCount) || 0) + (extractNum(d.commentsCount) || 0);
        engagementRate = parseFloat(((totalEng / followers) * 100).toFixed(2));
      }

      // Likes: platform-specific
      const likes = extractNum(d.likeCount)                     // Instagram, LinkedIn
        || extractNum(d.reactions?.total)                       // Facebook reactions
        || extractNum(d.reactions?.like)
        || extractNum(d.fanCount)
        || 0;

      const metrics = { followers, following, posts, reach, impressions, engagementRate, likes };

      platforms[platform] = metrics;
      totalFollowers += metrics.followers;
      totalReach += metrics.reach;
      totalImpressions += metrics.impressions;
      totalPosts += metrics.posts;
    }

    // Upsert snapshot (update if exists, create if not)
    await SocialSnapshot.findOneAndUpdate(
      { userId, date },
      {
        platforms,
        totals: {
          followers: totalFollowers,
          reach: totalReach,
          impressions: totalImpressions,
          posts: totalPosts,
        }
      },
      { upsert: true, new: true }
    );

    console.log(`📊 Snapshot saved for user ${userId}: ${Object.keys(platforms).length} platforms`);
  }
}

// Helper: extract a numeric value from potentially nested objects (e.g. LinkedIn)
function extractNum(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isFinite(val) ? val : 0;
  if (typeof val === 'object') {
    const n = val.totalFollowerCount ?? val.total ?? val.count;
    if (typeof n === 'number') return n;
    const first = Object.values(val).find(v => typeof v === 'number');
    return typeof first === 'number' ? first : 0;
  }
  const parsed = Number(val);
  return isFinite(parsed) ? parsed : 0;
}

module.exports = new SnapshotScheduler();
