/**
 * Social Media API Service
 * Integrates Ayrshare and Apify for real-time social media data
 */

const https = require('https');
const http = require('http');

// API Configuration
const AYRSHARE_API_KEY = process.env.AYRSHARE_API_KEY;
const APIFY_API_KEY = process.env.APIFY_API_KEY;

// Cache for API responses
const apiCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Generic HTTP request helper
 */
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      timeout: options.timeout || 30000
    };
    
    const req = protocol.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    
    req.end();
  });
}

/**
 * Get cached response or null
 */
function getCached(key) {
  const cached = apiCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  apiCache.delete(key);
  return null;
}

/**
 * Set cache
 */
function setCache(key, data) {
  apiCache.set(key, { data, timestamp: Date.now() });
}

// ============================================
// AYRSHARE API - Social Media Management
// ============================================

/**
 * Post content to social media via Ayrshare
 */
async function postToSocialMedia(platforms, content, options = {}) {
  if (!AYRSHARE_API_KEY) {
    console.warn('Ayrshare API key not configured');
    return { success: false, error: 'API not configured' };
  }

  try {
    // Build headers - include Profile-Key if provided for user-specific accounts
    const headers = {
      'Authorization': `Bearer ${AYRSHARE_API_KEY}`
    };
    
    // If profileKey is provided, add it to headers for user-specific posting
    if (options.profileKey) {
      headers['Profile-Key'] = options.profileKey;
      console.log('Using Profile-Key for posting:', options.profileKey.substring(0, 20) + '...');
    }
    
    const response = await makeRequest('https://api.ayrshare.com/api/post', {
      method: 'POST',
      headers: headers,
      timeout: 120000, // 2 minutes timeout for posts with media
      body: {
        post: content,
        platforms: platforms, // ['instagram', 'twitter', 'facebook', 'linkedin']
        mediaUrls: options.mediaUrls || [],
        scheduleDate: options.scheduleDate || null, // ISO date string for scheduling
        shortenLinks: options.shortenLinks || true
      }
    });

    console.log('Ayrshare post response:', response.status);
    console.log('Ayrshare FULL response:', JSON.stringify(response.data, null, 2));
    
    // Log full error details if there's an error
    if (response.data?.errors) {
      console.log('Ayrshare errors (full):', JSON.stringify(response.data.errors, null, 2));
    }
    if (response.data?.posts) {
      console.log('Ayrshare posts details:', JSON.stringify(response.data.posts, null, 2));
    }
    
    return { success: response.status === 200, data: response.data };
  } catch (error) {
    console.error('Ayrshare post error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get analytics from Ayrshare
 */
async function getAyrshareAnalytics(platforms = ['instagram', 'twitter', 'facebook']) {
  if (!AYRSHARE_API_KEY) {
    return { success: false, error: 'API not configured' };
  }

  const cacheKey = `ayrshare_analytics_${platforms.join('_')}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const response = await makeRequest(`https://api.ayrshare.com/api/analytics/social?platforms=${platforms.join(',')}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${AYRSHARE_API_KEY}`
      }
    });

    const result = { success: response.status === 200, data: response.data };
    if (result.success) setCache(cacheKey, result);
    return result;
  } catch (error) {
    console.error('Ayrshare analytics error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get social analytics with user's profile key (for followers, following, posts)
 * @param {string} profileKey - The user's Ayrshare Profile Key
 * @param {string[]} platforms - Array of platforms to get analytics for
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
async function getUserSocialAnalytics(profileKey, platforms = ['instagram', 'facebook', 'twitter', 'linkedin']) {
  if (!AYRSHARE_API_KEY) {
    return { success: false, error: 'API not configured' };
  }

  try {
    const headers = {
      'Authorization': `Bearer ${AYRSHARE_API_KEY}`,
      'Content-Type': 'application/json'
    };
    
    if (profileKey) {
      headers['Profile-Key'] = profileKey;
    }
    
    // Ayrshare social analytics endpoint uses POST method - use longer timeout
    const response = await makeRequest('https://api.ayrshare.com/api/analytics/social', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ platforms }),
      timeout: 60000 // 60 second timeout for analytics
    });

    console.log('Ayrshare social analytics response:', response.status, JSON.stringify(response.data).substring(0, 500));
    
    return { 
      success: response.status === 200, 
      data: response.data 
    };
  } catch (error) {
    console.error('Ayrshare user social analytics error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get posting history from Ayrshare
 */
async function getPostHistory(options = {}) {
  if (!AYRSHARE_API_KEY) {
    return { success: false, error: 'API not configured' };
  }

  try {
    const headers = {
      'Authorization': `Bearer ${AYRSHARE_API_KEY}`
    };
    if (options.profileKey) {
      headers['Profile-Key'] = options.profileKey;
    }

    const response = await makeRequest('https://api.ayrshare.com/api/history', {
      method: 'GET',
      headers
    });

    return { success: response.status === 200, data: response.data };
  } catch (error) {
    console.error('Ayrshare history error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get status of a specific post from Ayrshare by post ID
 * Returns actual posting status from Ayrshare (not our DB)
 */
async function getPostStatus(postId, options = {}) {
  if (!AYRSHARE_API_KEY) {
    return { success: false, error: 'API not configured' };
  }
  if (!postId) {
    return { success: false, error: 'No post ID provided' };
  }

  try {
    const headers = {
      'Authorization': `Bearer ${AYRSHARE_API_KEY}`
    };
    if (options.profileKey) {
      headers['Profile-Key'] = options.profileKey;
    }

    const response = await makeRequest(`https://api.ayrshare.com/api/post/${postId}`, {
      method: 'GET',
      headers
    });

    console.log(`📡 Ayrshare post status for ${postId}:`, JSON.stringify(response.data, null, 2));
    return { success: response.status === 200, data: response.data };
  } catch (error) {
    console.error('Ayrshare post status error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete a scheduled post
 */
async function deletePost(postId) {
  if (!AYRSHARE_API_KEY) {
    return { success: false, error: 'API not configured' };
  }

  try {
    const response = await makeRequest(`https://api.ayrshare.com/api/post/${postId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${AYRSHARE_API_KEY}`
      }
    });

    return { success: response.status === 200, data: response.data };
  } catch (error) {
    console.error('Ayrshare delete error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get user profile and connected social accounts from Ayrshare
 */
async function getAyrshareProfile() {
  if (!AYRSHARE_API_KEY) {
    return { success: false, error: 'API not configured' };
  }

  try {
    const response = await makeRequest('https://api.ayrshare.com/api/user', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${AYRSHARE_API_KEY}`
      }
    });

    return { 
      success: response.status === 200, 
      data: response.data,
      profiles: response.data?.activeSocialAccounts || []
    };
  } catch (error) {
    console.error('Ayrshare profile error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Generate Ayrshare connect URL for a specific platform
 * This opens Ayrshare's OAuth flow for the platform
 */
function getAyrshareConnectUrl(platform, redirectUrl) {
  try {
    // Ayrshare dashboard URL for connecting accounts
    const baseUrl = 'https://api.ayrshare.com/social-accounts';
    const connectUrl = `${baseUrl}?platform=${platform.toLowerCase()}&redirect=${encodeURIComponent(redirectUrl || '')}`;
    return { success: true, connectUrl };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Create a new Ayrshare User Profile
 * Required for Business Plan integration - each user needs their own profile
 * @param {string} title - Unique title for the profile (e.g., user's email or company name)
 * @param {object} options - Optional settings (disableSocial, hideTopHeader, etc.)
 * @returns {Promise<{success: boolean, profileKey?: string, refId?: string, error?: string}>}
 */
async function createAyrshareProfile(title, options = {}) {
  if (!AYRSHARE_API_KEY) {
    console.warn('Ayrshare API key not configured');
    return { success: false, error: 'API not configured' };
  }

  try {
    const body = {
      title: title,
      ...options
    };

    const response = await makeRequest('https://api.ayrshare.com/api/profiles', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AYRSHARE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: body
    });

    console.log('Ayrshare create profile response:', response.status, response.data);

    if (response.status === 200 && response.data?.status === 'success') {
      return {
        success: true,
        profileKey: response.data.profileKey,
        refId: response.data.refId,
        title: response.data.title
      };
    } else {
      return {
        success: false,
        error: response.data?.message || 'Failed to create Ayrshare profile',
        code: response.data?.code
      };
    }
  } catch (error) {
    console.error('Ayrshare create profile error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Generate JWT for Ayrshare Single Sign-On
 * This creates a secure URL that redirects users to Ayrshare's social linking page
 * @param {string} profileKey - The user's Ayrshare Profile Key
 * @param {object} options - Optional settings (redirect URL, logout, allowedSocial)
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
async function generateAyrshareJWT(profileKey, options = {}) {
  const domain = process.env.AYRSHARE_DOMAIN;
  const privateKey = process.env.AYRSHARE_PRIVATE_KEY;
  
  if (!AYRSHARE_API_KEY) {
    console.warn('Ayrshare API key not configured');
    return { success: false, error: 'API not configured' };
  }

  if (!domain || !privateKey) {
    console.warn('Ayrshare domain or private key not configured');
    return { success: false, error: 'Ayrshare Business Plan credentials not configured (domain/privateKey)' };
  }

  if (!profileKey) {
    return { success: false, error: 'Profile key is required' };
  }

  try {
    // Build request body for Business Plan JWT SSO
    const body = {
      domain: domain,
      privateKey: privateKey,
      profileKey: profileKey
    };
    
    // Add optional parameters
    if (options.redirect) {
      body.redirect = options.redirect;
    }
    if (options.logout) {
      body.logout = true;
    }
    // Filter to only show specific social platforms
    if (options.allowedSocial && Array.isArray(options.allowedSocial)) {
      body.allowedSocial = options.allowedSocial;
    }

    console.log('Generating Ayrshare JWT for profileKey:', profileKey, 'domain:', domain);

    const response = await makeRequest('https://api.ayrshare.com/api/profiles/generateJWT', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AYRSHARE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: body
    });

    console.log('Ayrshare generate JWT response:', response.status, response.data);

    if (response.status === 200 && response.data?.url) {
      return {
        success: true,
        url: response.data.url
      };
    } else {
      return {
        success: false,
        error: response.data?.message || response.data?.error || 'Failed to generate JWT URL'
      };
    }
  } catch (error) {
    console.error('Ayrshare generate JWT error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get User Profile details from Ayrshare (with Profile Key)
 * @param {string} profileKey - The user's Ayrshare Profile Key
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
async function getAyrshareUserProfile(profileKey) {
  if (!AYRSHARE_API_KEY) {
    return { success: false, error: 'API not configured' };
  }

  try {
    const response = await makeRequest('https://api.ayrshare.com/api/user', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${AYRSHARE_API_KEY}`,
        'Profile-Key': profileKey
      }
    });

    if (response.status === 200) {
      return {
        success: true,
        data: response.data,
        activeSocialAccounts: response.data?.activeSocialAccounts || []
      };
    } else {
      return {
        success: false,
        error: response.data?.message || 'Failed to get user profile'
      };
    }
  } catch (error) {
    console.error('Ayrshare get user profile error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete an Ayrshare User Profile
 * @param {string} profileKey - The user's Ayrshare Profile Key
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteAyrshareProfile(profileKey) {
  if (!AYRSHARE_API_KEY) {
    return { success: false, error: 'API not configured' };
  }

  try {
    const response = await makeRequest('https://api.ayrshare.com/api/profiles', {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${AYRSHARE_API_KEY}`,
        'Profile-Key': profileKey
      }
    });

    return {
      success: response.status === 200,
      error: response.status !== 200 ? (response.data?.message || 'Failed to delete profile') : undefined
    };
  } catch (error) {
    console.error('Ayrshare delete profile error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// APIFY API - Web Scraping
// ============================================

/**
 * Run an Apify actor and get results
 */
async function runApifyActor(actorId, input, options = {}) {
  if (!APIFY_API_KEY) {
    console.warn('Apify API key not configured');
    return { success: false, error: 'API not configured' };
  }

  try {
    // Start the actor run
    const runResponse = await makeRequest(
      `https://api.apify.com/v2/acts/${actorId}/runs?token=${APIFY_API_KEY}`,
      {
        method: 'POST',
        body: input,
        timeout: 60000
      }
    );

    if (runResponse.status !== 201) {
      return { success: false, error: 'Failed to start actor', data: runResponse.data };
    }

    const runId = runResponse.data.data?.id;
    if (!runId) {
      return { success: false, error: 'No run ID returned' };
    }

    // Wait for the run to complete (with timeout)
    const maxWait = options.maxWait || 120000; // 2 minutes for reliable scraping
    const pollInterval = 3000; // 3 seconds
    let elapsed = 0;

    while (elapsed < maxWait) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      elapsed += pollInterval;

      const statusResponse = await makeRequest(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_KEY}`
      );

      const status = statusResponse.data?.data?.status;
      if (status === 'SUCCEEDED') {
        // Get the results
        const datasetId = statusResponse.data?.data?.defaultDatasetId;
        if (datasetId) {
          const resultsResponse = await makeRequest(
            `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}`
          );
          return { success: true, data: resultsResponse.data };
        }
        return { success: true, data: [] };
      } else if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
        return { success: false, error: `Actor run ${status}` };
      }
    }

    return { success: false, error: 'Actor run timeout' };
  } catch (error) {
    console.error('Apify actor error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Scrape Instagram profile using Apify
 */
async function scrapeInstagramProfile(username) {
  const cacheKey = `instagram_profile_${username}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const result = await runApifyActor('apify~instagram-profile-scraper', {
    usernames: [username.replace('@', '')],
    resultsLimit: 12
  });

  if (result.success) setCache(cacheKey, result);
  return result;
}

/**
 * Scrape Instagram posts using Apify
 */
async function scrapeInstagramPosts(username, limit = 10) {
  const cacheKey = `instagram_posts_${username}_${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const result = await runApifyActor('apify~instagram-post-scraper', {
    username: username.replace('@', ''),
    resultsLimit: limit
  });

  if (result.success) setCache(cacheKey, result);
  return result;
}

/**
 * Scrape Twitter/X profile using Apify
 */
async function scrapeTwitterProfile(username) {
  const cacheKey = `twitter_profile_${username}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const result = await runApifyActor('apify~twitter-scraper', {
    searchTerms: [`from:${username.replace('@', '')}`],
    maxTweets: 20,
    addUserInfo: true
  });

  if (result.success) setCache(cacheKey, result);
  return result;
}

/**
 * Scrape TikTok profile using Apify
 */
async function scrapeTikTokProfile(username) {
  const cacheKey = `tiktok_profile_${username}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const result = await runApifyActor('clockworks~tiktok-scraper', {
    profiles: [username.replace('@', '')],
    resultsPerPage: 10
  });

  if (result.success) setCache(cacheKey, result);
  return result;
}

/**
 * Scrape competitor social media data
 */
async function scrapeCompetitor(competitorName, platforms = ['instagram']) {
  const results = {};
  
  for (const platform of platforms) {
    try {
      switch (platform.toLowerCase()) {
        case 'instagram':
          results.instagram = await scrapeInstagramPosts(competitorName, 5);
          break;
        case 'twitter':
        case 'x':
          results.twitter = await scrapeTwitterProfile(competitorName);
          break;
        case 'tiktok':
          results.tiktok = await scrapeTikTokProfile(competitorName);
          break;
        default:
          console.log(`Platform ${platform} not supported for scraping`);
      }
    } catch (error) {
      console.error(`Error scraping ${platform}:`, error);
      results[platform] = { success: false, error: error.message };
    }
  }
  
  return results;
}

/**
 * Search Instagram for a business/brand by name using Apify
 * Returns the best matching username with posts
 */
async function searchInstagramByName(businessName) {
  const cacheKey = `instagram_search_${businessName.toLowerCase().replace(/\s+/g, '_')}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    console.log(`  🔍 Instagram search for: "${businessName}"`);
    const result = await runApifyActor('apify~instagram-scraper', {
      search: businessName,
      searchType: 'user',
      resultsLimit: 5,
      searchLimit: 5
    }, { maxWait: 60000 });

    if (result?.success && result?.data?.length > 0) {
      // Filter to profiles that are likely the real business
      const nameWords = businessName.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      
      // Score each result by how well it matches
      const scored = result.data
        .filter(p => p.username || p.ownerUsername)
        .map(p => {
          const username = (p.username || p.ownerUsername || '').toLowerCase();
          const fullName = (p.fullName || p.ownerFullName || '').toLowerCase();
          const bio = (p.biography || '').toLowerCase();
          let score = 0;
          
          // Full name match is strongest signal
          if (fullName.includes(businessName.toLowerCase())) score += 10;
          
          // Individual word matches
          for (const word of nameWords) {
            if (username.includes(word)) score += 3;
            if (fullName.includes(word)) score += 2;
            if (bio.includes(word)) score += 1;
          }
          
          // Verified accounts get a boost
          if (p.verified || p.isVerified) score += 5;
          
          // Higher follower count = more likely the real one
          const followers = p.followersCount || p.followers || 0;
          if (followers > 10000) score += 3;
          if (followers > 1000) score += 1;
          
          return { username, fullName, score, followers, profile: p };
        })
        .filter(s => s.score >= 3)
        .sort((a, b) => b.score - a.score);

      if (scored.length > 0) {
        const best = scored[0];
        console.log(`  ✅ Search found @${best.username} (${best.fullName}, score: ${best.score}, followers: ${best.followers})`);
        const searchResult = { success: true, username: best.username, fullName: best.fullName, score: best.score };
        setCache(cacheKey, searchResult);
        return searchResult;
      }
    }
    
    console.log(`  ⚠️ Instagram search returned no good matches for "${businessName}"`);
    return { success: false, error: 'No matching profile found' };
  } catch (error) {
    console.error(`  ❌ Instagram search error for "${businessName}":`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Fetch REAL competitor posts from social media using Apify
 * This fetches actual posts from competitor Instagram/Twitter/TikTok accounts
 */
async function fetchRealCompetitorPosts(competitorHandles, options = {}) {
  if (!APIFY_API_KEY) {
    console.warn('Apify API key not configured - cannot fetch real posts');
    return { success: false, error: 'Apify API not configured', posts: [] };
  }

  const allPosts = [];
  const limit = options.limit || 5;
  
  console.log('Fetching REAL competitor posts for:', competitorHandles);

  for (const competitor of competitorHandles) {
    const { name, instagram, twitter, tiktok, facebook, linkedin } = competitor;
    
    // Try Instagram first (most reliable with Apify)
    if (instagram) {
      try {
        console.log(`Scraping Instagram for ${name}: @${instagram}`);
        const cacheKey = `real_ig_posts_${instagram}_${limit}`;
        const cached = getCached(cacheKey);
        
        if (cached && cached.posts) {
          allPosts.push(...cached.posts);
          console.log(`Using cached Instagram posts for ${instagram}`);
        } else {
          // Use Apify Instagram Profile Scraper
          const result = await runApifyActor('apify~instagram-profile-scraper', {
            usernames: [instagram.replace('@', '')],
            resultsLimit: limit
          }, { timeout: 60000 });
          
          if (result.success && result.data && result.data.length > 0) {
            const profile = result.data[0];
            const threeMonthsAgo = Date.now() - (30 * 24 * 60 * 60 * 1000); // 1 month filter
            
            const posts = (profile.latestPosts || profile.posts || [])
              .map((post, idx) => {
                // Extract timestamp from all possible Apify fields
                let rawTs = null;
                if (post.timestamp) rawTs = post.timestamp;
                else if (post.takenAt) rawTs = post.takenAt;
                else if (post.takenAtTimestamp && !isNaN(post.takenAtTimestamp)) rawTs = post.takenAtTimestamp * 1000;
                else if (post.taken_at_timestamp && !isNaN(post.taken_at_timestamp)) rawTs = post.taken_at_timestamp * 1000;
                else if (post.date) rawTs = post.date;

                if (!rawTs) return null; // Skip posts with no timestamp

                const timeInfo = formatPostDate(rawTs);
                if (isNaN(timeInfo.timestamp) || timeInfo.timestamp < threeMonthsAgo) return null; // Skip old/invalid

                return {
                  id: `real_ig_${instagram}_${idx}_${Date.now()}`,
                  competitorName: name,
                  competitorLogo: name?.charAt(0)?.toUpperCase() || 'C',
                  content: post.caption || post.text || post.description || 'No caption',
                  platform: 'instagram',
                  likes: post.likesCount || post.likes || 0,
                  comments: post.commentsCount || post.comments || 0,
                  sentiment: analyzeSentiment(post.caption || ''),
                  postType: detectPostType(post.caption || ''),
                  postedAt: timeInfo.displayString,
                  postedAtTimestamp: timeInfo.timestamp,
                  postUrl: post.url || `https://instagram.com/p/${post.shortCode || post.id}`,
                  imageUrl: post.displayUrl || post.imageUrl || null,
                  isReal: true
                };
              })
              .filter(Boolean) // Remove nulls (no timestamp or too old)
              .slice(0, limit);
            
            allPosts.push(...posts);
            setCache(cacheKey, { posts });
            console.log(`Fetched ${posts.length} real Instagram posts for ${instagram}`);
          }
        }
      } catch (error) {
        console.error(`Instagram scrape error for ${instagram}:`, error.message);
      }
    }
    
    // Try Twitter/X
    if (twitter) {
      try {
        console.log(`Scraping Twitter for ${name}: @${twitter}`);
        const cacheKey = `real_tw_posts_${twitter}_${limit}`;
        const cached = getCached(cacheKey);
        
        if (cached && cached.posts) {
          allPosts.push(...cached.posts);
        } else {
          const result = await runApifyActor('apify~twitter-scraper', {
            searchTerms: [`from:${twitter.replace('@', '')}`],
            maxTweets: limit,
            addUserInfo: true
          }, { timeout: 60000 });
          
          if (result.success && result.data && result.data.length > 0) {
            const threeMonthsAgo = Date.now() - (30 * 24 * 60 * 60 * 1000); // 1 month filter
            
            const posts = result.data
              .map((tweet, idx) => {
                const timeInfo = formatPostDate(tweet.created_at);
                if (!timeInfo || timeInfo.timestamp < threeMonthsAgo) return null;
                return {
                  id: `real_tw_${twitter}_${idx}_${Date.now()}`,
                  competitorName: name,
                  competitorLogo: name?.charAt(0)?.toUpperCase() || 'C',
                  content: tweet.text || tweet.full_text || 'No content',
                  platform: 'twitter',
                  likes: tweet.favorite_count || tweet.likes || 0,
                  comments: tweet.reply_count || tweet.replies || 0,
                  retweets: tweet.retweet_count || 0,
                  sentiment: analyzeSentiment(tweet.text || ''),
                  postType: detectPostType(tweet.text || ''),
                  postedAt: timeInfo.displayString,
                  postedAtTimestamp: timeInfo.timestamp,
                  postUrl: tweet.url || `https://twitter.com/${twitter}/status/${tweet.id_str || tweet.id}`,
                  isReal: true
                };
              })
              .filter(Boolean)
              .slice(0, limit);
            
            allPosts.push(...posts);
            console.log(`Fetched ${posts.length} real Twitter posts for ${twitter}`);
          }
        }
      } catch (error) {
        console.error(`Twitter scrape error for ${twitter}:`, error.message);
      }
    }
    
    // Try TikTok
    if (tiktok) {
      try {
        console.log(`Scraping TikTok for ${name}: @${tiktok}`);
        const cacheKey = `real_tt_posts_${tiktok}_${limit}`;
        const cached = getCached(cacheKey);
        
        if (cached && cached.posts) {
          allPosts.push(...cached.posts);
        } else {
          const result = await runApifyActor('clockworks~tiktok-scraper', {
            profiles: [tiktok.replace('@', '')],
            resultsPerPage: limit
          }, { timeout: 60000 });
          
          if (result.success && result.data && result.data.length > 0) {
            const threeMonthsAgo = Date.now() - (30 * 24 * 60 * 60 * 1000); // 1 month filter
            
            const posts = result.data
              .map((video, idx) => {
                const timeInfo = formatPostDate(video.createTime * 1000);
                if (!timeInfo || timeInfo.timestamp < threeMonthsAgo) return null;
                return {
                  id: `real_tt_${tiktok}_${idx}_${Date.now()}`,
                  competitorName: name,
                  competitorLogo: name?.charAt(0)?.toUpperCase() || 'C',
                  content: video.text || video.desc || video.description || 'No description',
                  platform: 'tiktok',
                  likes: video.diggCount || video.likes || 0,
                  comments: video.commentCount || video.comments || 0,
                  views: video.playCount || video.views || 0,
                  sentiment: analyzeSentiment(video.text || video.desc || ''),
                  postType: 'video',
                  postedAt: timeInfo.displayString,
                  postedAtTimestamp: timeInfo.timestamp,
                  postUrl: video.webVideoUrl || `https://tiktok.com/@${tiktok}/video/${video.id}`,
                  isReal: true
                };
              })
              .filter(Boolean)
              .slice(0, limit);
            
            allPosts.push(...posts);
            setCache(cacheKey, { posts });
            console.log(`Fetched ${posts.length} real TikTok posts for ${tiktok}`);
          }
        }
      } catch (error) {
        console.error(`TikTok scrape error for ${tiktok}:`, error.message);
      }
    }
  }
  
  // Sort by most recent (using postedAtTimestamp for accurate sorting)
  allPosts.sort((a, b) => {
    const timestampA = a.postedAtTimestamp || 0;
    const timestampB = b.postedAtTimestamp || 0;
    return timestampB - timestampA; // Most recent first
  });
  
  return { 
    success: allPosts.length > 0, 
    posts: allPosts,
    count: allPosts.length,
    source: 'apify_real_scrape'
  };
}

/**
 * Analyze sentiment of text (simple implementation)
 */
function analyzeSentiment(text) {
  if (!text) return 'neutral';
  const lower = text.toLowerCase();
  const positiveWords = ['amazing', 'love', 'great', 'awesome', 'excited', 'happy', 'best', 'fantastic', 'wonderful', '🎉', '❤️', '🔥', '💪', '✨'];
  const negativeWords = ['bad', 'terrible', 'hate', 'awful', 'disappointed', 'worst', 'sad', 'angry', 'fail', '😢', '😡'];
  
  let score = 0;
  positiveWords.forEach(word => { if (lower.includes(word)) score++; });
  negativeWords.forEach(word => { if (lower.includes(word)) score--; });
  
  if (score > 0) return 'positive';
  if (score < 0) return 'negative';
  return 'neutral';
}

/**
 * Detect post type from content
 */
function detectPostType(text) {
  if (!text) return 'general';
  const lower = text.toLowerCase();
  
  if (lower.includes('sale') || lower.includes('off') || lower.includes('discount') || lower.includes('shop')) return 'promotional';
  if (lower.includes('tip') || lower.includes('how to') || lower.includes('learn') || lower.includes('guide')) return 'educational';
  if (lower.includes('?') || lower.includes('what do you') || lower.includes('tell us')) return 'engagement';
  if (lower.includes('announce') || lower.includes('launch') || lower.includes('introducing') || lower.includes('new')) return 'announcement';
  return 'general';
}

/**
 * Format post date to relative time and return both display string and timestamp
 */
function formatPostDate(timestamp) {
  if (!timestamp) return null; // No fallback — caller must skip this post
  
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return null; // Invalid date — skip
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  let displayString;
  if (diffMins < 60) displayString = `${diffMins}m ago`;
  else if (diffHours < 24) displayString = `${diffHours}h ago`;
  else if (diffDays === 1) displayString = '1d ago';
  else if (diffDays < 7) displayString = `${diffDays}d ago`;
  else if (diffDays < 30) displayString = `${Math.floor(diffDays / 7)}w ago`;
  else displayString = date.toLocaleDateString();
  
  return { displayString, timestamp: date.getTime() };
}



// ============================================
// COMBINED FUNCTIONS
// ============================================

/**
 * Get comprehensive competitor analysis
 */
async function getCompetitorAnalysis(competitorName, platforms = ['instagram']) {
  const analysis = {
    competitorName,
    platforms: {},
    fetchedAt: new Date().toISOString()
  };

  // Scrape social media data
  const scraped = await scrapeCompetitor(competitorName, platforms);
  
  for (const [platform, data] of Object.entries(scraped)) {
    if (data.success && data.data) {
      analysis.platforms[platform] = {
        posts: Array.isArray(data.data) ? data.data.slice(0, 5) : [],
        success: true
      };
    } else {
      analysis.platforms[platform] = { success: false, error: data.error };
    }
  }

  return analysis;
}



/**
 * Check API configuration status
 */
function getAPIStatus() {
  return {
    ayrshare: {
      configured: !!AYRSHARE_API_KEY,
      features: ['post', 'schedule', 'analytics', 'history']
    },
    apify: {
      configured: !!APIFY_API_KEY,
      features: ['instagram-scraping', 'twitter-scraping', 'tiktok-scraping']
    },
    searchapi: {
      configured: false,
      features: []
    }
  };
}

// ============================================
// INFLUENCER DISCOVERY - Real Scraping
// ============================================

/**
 * Search for influencers on Instagram by hashtag/keyword
 */
async function searchInstagramInfluencers(keyword, options = {}) {
  if (!APIFY_API_KEY) {
    console.warn('Apify API key not configured');
    return { success: false, error: 'API not configured', influencers: [] };
  }

  const limit = options.limit || 20;
  const cacheKey = `ig_influencers_${keyword}_${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  console.log(`Searching Instagram influencers for keyword: ${keyword}`);

  try {
    // Use Instagram Hashtag Scraper to find relevant posts/profiles
    const result = await runApifyActor('apify~instagram-hashtag-scraper', {
      hashtags: [keyword.replace('#', '').replace(/\s+/g, '')],
      resultsLimit: limit * 2, // Get more to filter for quality
      resultsType: 'posts'
    }, { maxWait: 90000 });

    if (!result.success || !result.data || result.data.length === 0) {
      console.log('No Instagram results, trying profile search');
      return { success: false, error: 'No results found', influencers: [] };
    }

    // Extract unique usernames from posts
    const seenUsernames = new Set();
    const influencerProfiles = [];

    for (const post of result.data) {
      const username = post.ownerUsername || post.owner?.username;
      if (!username || seenUsernames.has(username)) continue;
      seenUsernames.add(username);

      // Only include accounts with decent engagement
      const likes = post.likesCount || post.likes || 0;
      const comments = post.commentsCount || post.comments || 0;
      
      if (likes >= 100 || comments >= 10) {
        influencerProfiles.push({
          platform: 'instagram',
          username: username,
          handle: `@${username}`,
          name: post.ownerFullName || post.owner?.fullName || username,
          profileImage: post.ownerProfilePicUrl || post.owner?.profilePicUrl || null,
          bio: post.owner?.biography || '',
          followerCount: post.owner?.followersCount || estimateFollowersFromEngagement(likes, comments),
          followingCount: post.owner?.followingCount || 0,
          postsCount: post.owner?.postsCount || 0,
          engagementRate: calculateEngagementRate(likes, comments, post.owner?.followersCount),
          avgLikes: likes,
          avgComments: comments,
          isVerified: post.owner?.isVerified || false,
          latestPost: {
            caption: post.caption || '',
            likes: likes,
            comments: comments,
            timestamp: post.timestamp || post.takenAt
          },
          profileUrl: `https://instagram.com/${username}`,
          scrapedAt: new Date().toISOString()
        });
      }

      if (influencerProfiles.length >= limit) break;
    }

    const response = { success: true, influencers: influencerProfiles, source: 'instagram_hashtag' };
    setCache(cacheKey, response);
    return response;
  } catch (error) {
    console.error('Instagram influencer search error:', error);
    return { success: false, error: error.message, influencers: [] };
  }
}

/**
 * Search for influencers on TikTok by keyword
 */
async function searchTikTokInfluencers(keyword, options = {}) {
  if (!APIFY_API_KEY) {
    return { success: false, error: 'API not configured', influencers: [] };
  }

  const limit = options.limit || 20;
  const cacheKey = `tt_influencers_${keyword}_${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  console.log(`Searching TikTok influencers for keyword: ${keyword}`);

  try {
    const result = await runApifyActor('clockworks~tiktok-scraper', {
      hashtags: [keyword.replace('#', '').replace(/\s+/g, '')],
      resultsPerPage: limit * 2
    }, { maxWait: 90000 });

    if (!result.success || !result.data || result.data.length === 0) {
      return { success: false, error: 'No results found', influencers: [] };
    }

    const seenUsernames = new Set();
    const influencerProfiles = [];

    for (const video of result.data) {
      const author = video.authorMeta || video.author || {};
      const username = author.name || author.uniqueId;
      if (!username || seenUsernames.has(username)) continue;
      seenUsernames.add(username);

      const likes = video.diggCount || video.likes || 0;
      const comments = video.commentCount || video.comments || 0;
      const views = video.playCount || video.views || 0;

      if (views >= 1000 || likes >= 100) {
        influencerProfiles.push({
          platform: 'tiktok',
          username: username,
          handle: `@${username}`,
          name: author.nickName || author.nickname || username,
          profileImage: author.avatar || author.avatarThumb || null,
          bio: author.signature || '',
          followerCount: author.fans || author.followers || estimateFollowersFromEngagement(likes, comments),
          followingCount: author.following || 0,
          engagementRate: views > 0 ? ((likes + comments) / views * 100).toFixed(2) : 0,
          avgLikes: likes,
          avgComments: comments,
          avgViews: views,
          isVerified: author.verified || false,
          latestPost: {
            description: video.text || video.desc || '',
            likes: likes,
            comments: comments,
            views: views,
            timestamp: video.createTime ? video.createTime * 1000 : null
          },
          profileUrl: `https://tiktok.com/@${username}`,
          scrapedAt: new Date().toISOString()
        });
      }

      if (influencerProfiles.length >= limit) break;
    }

    const response = { success: true, influencers: influencerProfiles, source: 'tiktok_hashtag' };
    setCache(cacheKey, response);
    return response;
  } catch (error) {
    console.error('TikTok influencer search error:', error);
    return { success: false, error: error.message, influencers: [] };
  }
}

/**
 * Search for influencers on Twitter/X
 */
async function searchTwitterInfluencers(keyword, options = {}) {
  if (!APIFY_API_KEY) {
    return { success: false, error: 'API not configured', influencers: [] };
  }

  const limit = options.limit || 20;
  const cacheKey = `tw_influencers_${keyword}_${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  console.log(`Searching Twitter influencers for keyword: ${keyword}`);

  try {
    const result = await runApifyActor('apidojo/tweet-scraper', {
      searchTerms: [`${keyword} influencer`],
      maxItems: limit * 3,
      sort: 'Top'
    }, { maxWait: 120000 });

    if (!result.success || !result.data || result.data.length === 0) {
      return { success: false, error: 'No results found', influencers: [] };
    }

    const seenUsernames = new Set();
    const influencerProfiles = [];

    for (const tweet of result.data) {
      const user = tweet.user || tweet.author || {};
      const username = user.screen_name || user.username;
      if (!username || seenUsernames.has(username)) continue;
      seenUsernames.add(username);

      const followers = user.followers_count || user.followers || 0;
      const likes = tweet.favorite_count || tweet.likes || 0;
      const retweets = tweet.retweet_count || 0;

      if (followers >= 1000 || likes >= 50) {
        influencerProfiles.push({
          platform: 'twitter',
          username: username,
          handle: `@${username}`,
          name: user.name || username,
          profileImage: user.profile_image_url_https || user.profileImageUrl || null,
          bio: user.description || '',
          followerCount: followers,
          followingCount: user.friends_count || user.following || 0,
          postsCount: user.statuses_count || 0,
          engagementRate: followers > 0 ? ((likes + retweets) / followers * 100).toFixed(2) : 0,
          avgLikes: likes,
          avgRetweets: retweets,
          isVerified: user.verified || false,
          latestPost: {
            text: tweet.text || tweet.full_text || '',
            likes: likes,
            retweets: retweets,
            timestamp: tweet.created_at
          },
          profileUrl: `https://twitter.com/${username}`,
          scrapedAt: new Date().toISOString()
        });
      }

      if (influencerProfiles.length >= limit) break;
    }

    const response = { success: true, influencers: influencerProfiles, source: 'twitter_search' };
    setCache(cacheKey, response);
    return response;
  } catch (error) {
    console.error('Twitter influencer search error:', error);
    return { success: false, error: error.message, influencers: [] };
  }
}

/**
 * Search for influencers on YouTube
 */
async function searchYouTubeInfluencers(keyword, options = {}) {
  if (!APIFY_API_KEY) {
    return { success: false, error: 'API not configured', influencers: [] };
  }

  const limit = options.limit || 20;
  const cacheKey = `yt_influencers_${keyword}_${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  console.log(`Searching YouTube influencers for keyword: ${keyword}`);

  try {
    const result = await runApifyActor('streamers~youtube-channel-scraper', {
      searchKeywords: [keyword],
      maxResults: limit
    }, { maxWait: 90000 });

    if (!result.success || !result.data || result.data.length === 0) {
      return { success: false, error: 'No results found', influencers: [] };
    }

    const influencerProfiles = result.data.slice(0, limit).map(channel => ({
      platform: 'youtube',
      username: channel.channelId || channel.id,
      handle: channel.channelUrl || channel.url,
      name: channel.channelName || channel.title || 'Unknown',
      profileImage: channel.avatar || channel.thumbnail || null,
      bio: channel.description || '',
      followerCount: channel.subscriberCount || channel.subscribers || 0,
      videosCount: channel.videoCount || channel.videos || 0,
      viewsCount: channel.viewCount || channel.totalViews || 0,
      engagementRate: 0, // Hard to calculate for YouTube
      avgViews: channel.avgViews || 0,
      isVerified: channel.isVerified || false,
      profileUrl: channel.channelUrl || `https://youtube.com/channel/${channel.channelId}`,
      scrapedAt: new Date().toISOString()
    }));

    const response = { success: true, influencers: influencerProfiles, source: 'youtube_search' };
    setCache(cacheKey, response);
    return response;
  } catch (error) {
    console.error('YouTube influencer search error:', error);
    return { success: false, error: error.message, influencers: [] };
  }
}

/**
 * Search for influencers on LinkedIn by keyword
 * Uses Apify LinkedIn scraper
 */
async function searchLinkedInInfluencers(keyword, options = {}) {
  if (!APIFY_API_KEY) {
    return { success: false, error: 'API not configured', influencers: [] };
  }

  const limit = options.limit || 10;
  const cacheKey = `li_influencers_${keyword}_${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  console.log(`Searching LinkedIn influencers for keyword: ${keyword}`);

  try {
    // Use LinkedIn profile search
    const result = await runApifyActor('anchor~linkedin-people-search', {
      searchUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keyword + ' influencer')}&origin=GLOBAL_SEARCH_HEADER`,
      maxProfiles: limit
    }, { maxWait: 120000 });

    if (!result.success || !result.data || result.data.length === 0) {
      console.log('LinkedIn search returned no results');
      return { success: false, error: 'No results found', influencers: [] };
    }

    const influencerProfiles = result.data.slice(0, limit).map(profile => ({
      platform: 'linkedin',
      username: profile.publicIdentifier || profile.profileUrl?.split('/in/')[1]?.replace('/', '') || 'unknown',
      handle: profile.publicIdentifier || 'unknown',
      name: profile.fullName || profile.firstName + ' ' + profile.lastName || 'Unknown',
      profileImage: profile.profilePicture || profile.avatar || null,
      bio: profile.headline || profile.summary || '',
      followerCount: profile.connectionsCount || profile.followers || 0,
      engagementRate: 0,
      isVerified: false,
      jobTitle: profile.headline || '',
      company: profile.companyName || '',
      profileUrl: profile.profileUrl || `https://linkedin.com/in/${profile.publicIdentifier}`,
      scrapedAt: new Date().toISOString()
    }));

    const response = { success: true, influencers: influencerProfiles, source: 'linkedin_search' };
    setCache(cacheKey, response);
    return response;
  } catch (error) {
    console.error('LinkedIn influencer search error:', error);
    return { success: false, error: error.message, influencers: [] };
  }
}

/**
 * Search for Facebook pages/influencers by keyword
 */
async function searchFacebookInfluencers(keyword, options = {}) {
  if (!APIFY_API_KEY) {
    return { success: false, error: 'API not configured', influencers: [] };
  }

  const limit = options.limit || 10;
  const cacheKey = `fb_influencers_${keyword}_${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  console.log(`Searching Facebook influencers for keyword: ${keyword}`);

  try {
    const result = await runApifyActor('apify~facebook-pages-scraper', {
      searchQueries: [keyword],
      maxPages: limit
    }, { maxWait: 120000 });

    if (!result.success || !result.data || result.data.length === 0) {
      console.log('Facebook search returned no results');
      return { success: false, error: 'No results found', influencers: [] };
    }

    const influencerProfiles = result.data.slice(0, limit).map(page => ({
      platform: 'facebook',
      username: page.pageId || page.id || 'unknown',
      handle: page.name || page.title || 'unknown',
      name: page.name || page.title || 'Unknown',
      profileImage: page.profilePicture || page.logo || null,
      bio: page.about || page.description || '',
      followerCount: page.likes || page.followers || 0,
      engagementRate: 0,
      isVerified: page.isVerified || false,
      category: page.category || '',
      profileUrl: page.url || page.pageUrl || `https://facebook.com/${page.pageId}`,
      scrapedAt: new Date().toISOString()
    }));

    const response = { success: true, influencers: influencerProfiles, source: 'facebook_search' };
    setCache(cacheKey, response);
    return response;
  } catch (error) {
    console.error('Facebook influencer search error:', error);
    return { success: false, error: error.message, influencers: [] };
  }
}

/**
 * Discover influencers across multiple platforms based on brand profile
 * Uses REAL-TIME scraping via Apify - NO predefined database
 * Scrapes actual social media platforms for live data
 */
async function discoverInfluencers(brandProfile, options = {}) {
  const { industry, niche, targetAudience, targetRegion, name: brandName } = brandProfile;
  const platforms = options.platforms || ['instagram', 'twitter', 'youtube', 'linkedin', 'facebook'];
  const limit = options.limit || 15;
  
  console.log('🔍 Starting REAL-TIME influencer discovery via Apify for:', { industry, niche, brandName });
  console.log('📡 Platforms to search:', platforms);

  if (!APIFY_API_KEY) {
    return {
      success: false,
      error: 'Apify API key not configured. Please add APIFY_API_KEY to environment.',
      influencers: []
    };
  }

  // Build search keywords from brand profile
  const keywords = buildInfluencerSearchKeywords(brandProfile);
  console.log('🔑 Search keywords:', keywords);

  if (keywords.length === 0) {
    return {
      success: false,
      error: 'No search keywords could be generated from brand profile',
      influencers: []
    };
  }

  let allInfluencers = [];
  const errors = [];
  const successfulPlatforms = [];

  // Search each platform in parallel for speed
  const searchPromises = [];

  // Instagram search
  if (platforms.includes('instagram')) {
    searchPromises.push(
      (async () => {
        console.log('📸 Searching Instagram...');
        for (const keyword of keywords.slice(0, 2)) {
          const result = await searchInstagramInfluencers(keyword, { limit: Math.ceil(limit / 2) });
          if (result.success && result.influencers?.length > 0) {
            console.log(`✅ Instagram: Found ${result.influencers.length} influencers for "${keyword}"`);
            allInfluencers.push(...result.influencers);
            successfulPlatforms.push('instagram');
            return;
          }
        }
        console.log('❌ Instagram: No results');
        errors.push('Instagram search returned no results');
      })()
    );
  }

  // Twitter search
  if (platforms.includes('twitter')) {
    searchPromises.push(
      (async () => {
        console.log('🐦 Searching Twitter...');
        for (const keyword of keywords.slice(0, 2)) {
          const result = await searchTwitterInfluencers(keyword, { limit: Math.ceil(limit / 2) });
          if (result.success && result.influencers?.length > 0) {
            console.log(`✅ Twitter: Found ${result.influencers.length} influencers for "${keyword}"`);
            allInfluencers.push(...result.influencers);
            successfulPlatforms.push('twitter');
            return;
          }
        }
        console.log('❌ Twitter: No results');
        errors.push('Twitter search returned no results');
      })()
    );
  }

  // YouTube search
  if (platforms.includes('youtube')) {
    searchPromises.push(
      (async () => {
        console.log('📺 Searching YouTube...');
        for (const keyword of keywords.slice(0, 2)) {
          const result = await searchYouTubeInfluencers(keyword, { limit: Math.ceil(limit / 2) });
          if (result.success && result.influencers?.length > 0) {
            console.log(`✅ YouTube: Found ${result.influencers.length} influencers for "${keyword}"`);
            allInfluencers.push(...result.influencers);
            successfulPlatforms.push('youtube');
            return;
          }
        }
        console.log('❌ YouTube: No results');
        errors.push('YouTube search returned no results');
      })()
    );
  }

  // LinkedIn search  
  if (platforms.includes('linkedin')) {
    searchPromises.push(
      (async () => {
        console.log('💼 Searching LinkedIn...');
        for (const keyword of keywords.slice(0, 1)) {
          const result = await searchLinkedInInfluencers(keyword, { limit: Math.ceil(limit / 3) });
          if (result.success && result.influencers?.length > 0) {
            console.log(`✅ LinkedIn: Found ${result.influencers.length} influencers for "${keyword}"`);
            allInfluencers.push(...result.influencers);
            successfulPlatforms.push('linkedin');
            return;
          }
        }
        console.log('❌ LinkedIn: No results');
        errors.push('LinkedIn search returned no results');
      })()
    );
  }

  // Facebook search
  if (platforms.includes('facebook')) {
    searchPromises.push(
      (async () => {
        console.log('📘 Searching Facebook...');
        for (const keyword of keywords.slice(0, 1)) {
          const result = await searchFacebookInfluencers(keyword, { limit: Math.ceil(limit / 3) });
          if (result.success && result.influencers?.length > 0) {
            console.log(`✅ Facebook: Found ${result.influencers.length} influencers for "${keyword}"`);
            allInfluencers.push(...result.influencers);
            successfulPlatforms.push('facebook');
            return;
          }
        }
        console.log('❌ Facebook: No results');
        errors.push('Facebook search returned no results');
      })()
    );
  }

  // Wait for all platform searches to complete
  await Promise.allSettled(searchPromises);

  // Dedupe by username+platform
  const seenKeys = new Set();
  let uniqueInfluencers = allInfluencers.filter(inf => {
    const key = `${inf.platform}_${inf.username}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  // If Apify returned no results, log a warning
  if (uniqueInfluencers.length === 0) {
    console.log('\n⚠️ Apify returned no influencer results for the given criteria');
  }

  // Sort by follower count (highest first) and limit
  const sortedInfluencers = uniqueInfluencers
    .sort((a, b) => (b.followerCount || 0) - (a.followerCount || 0))
    .slice(0, limit);

  console.log(`\n🎯 Discovery complete: Found ${sortedInfluencers.length} unique influencers from ${successfulPlatforms.length} platforms`);

  return {
    success: sortedInfluencers.length > 0,
    influencers: sortedInfluencers,
    totalFound: sortedInfluencers.length,
    platforms: [...new Set(successfulPlatforms)],
    searchKeywords: keywords,
    errors: errors.length > 0 ? errors : undefined,
    discoveredAt: new Date().toISOString(),
    source: 'real-time-apify-scraping'
  };
}

/**
 * Build search keywords based on brand profile
 * Optimized for finding LARGE, RELEVANT influencers
 */
function buildInfluencerSearchKeywords(brandProfile) {
  const keywords = [];
  const { industry, niche, targetAudience, products, services, marketingGoals, name } = brandProfile;

  // Add industry-based keywords - FOCUSED on finding BIG influencers
  if (industry) {
    const industryLower = industry.toLowerCase();
    
    // Industry-specific influencer keywords - prioritize high-follower niches
    const industryKeywords = {
      'ecommerce': ['top fashion influencer', 'lifestyle blogger 100k', 'product reviewer verified', 'shopping haul creator'],
      'saas': ['tech startup founder', 'software CEO', 'SaaS influencer', 'tech entrepreneur'],
      'fashion': ['fashion model verified', 'celebrity stylist', 'fashion week influencer', 'style icon'],
      'beauty': ['celebrity makeup artist', 'beauty guru verified', 'skincare expert', 'beauty brand founder'],
      'fitness': ['celebrity trainer', 'fitness model verified', 'gym owner influencer', 'bodybuilding champion'],
      'food': ['celebrity chef', 'michelin star chef', 'food network star', 'restaurant owner influencer'],
      'travel': ['luxury travel blogger', 'travel photographer verified', 'adventure influencer', 'world traveler'],
      'tech': ['tech CEO', 'silicon valley influencer', 'gadget reviewer verified', 'tech founder'],
      'gaming': ['pro gamer', 'esports champion', 'gaming youtuber verified', 'twitch partner'],
      'education': ['education entrepreneur', 'online course creator', 'edtech founder', 'professor influencer'],
      'finance': ['wealth advisor', 'investment banker influencer', 'finance CEO', 'crypto whale'],
      'healthcare': ['celebrity doctor', 'medical influencer verified', 'wellness founder', 'health entrepreneur'],
      'sports': ['professional athlete', 'olympic athlete', 'sports commentator', 'fitness celebrity'],
      'construction': ['celebrity architect', 'interior design celebrity', 'luxury home builder', 'real estate mogul', 'property developer', 'home renovation expert', 'architectural designer'],
      'real estate': ['luxury realtor celebrity', 'real estate investor millionaire', 'property mogul', 'mansion tour creator', 'real estate entrepreneur'],
      'service': ['business mogul', 'entrepreneur verified', 'CEO influencer', 'industry leader'],
      'luxury': ['billionaire lifestyle', 'luxury brand ambassador', 'affluent influencer', 'high society influencer', 'luxury car collector']
    };

    // Find matching keywords - collect from multiple matching categories
    for (const [key, values] of Object.entries(industryKeywords)) {
      if (industryLower.includes(key)) {
        keywords.push(...values);
      }
    }
    
    // If no specific match, use high-profile generic keywords
    if (keywords.length === 0) {
      keywords.push('business mogul', 'entrepreneur verified', 'industry leader', 'CEO influencer');
    }
  }

  // For construction specifically, add India-focused keywords if relevant
  if (industry && industry.toLowerCase().includes('construction')) {
    keywords.push('indian architect', 'india interior designer', 'luxury villa india', 'south indian architect');
  }

  // Extract meaningful words from niche for targeted search
  if (niche && typeof niche === 'string') {
    const nicheWords = niche
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !['focus', 'with', 'that', 'this', 'from', 'have', 'been', 'their', 'building'].includes(word.toLowerCase()))
      .slice(0, 2);
    
    nicheWords.forEach(word => {
      keywords.push(`${word.toLowerCase()} expert verified`);
    });
  }

  // Add luxury/HNI focused keywords if targeting affluent audience
  if (targetAudience && typeof targetAudience === 'string') {
    const taLower = targetAudience.toLowerCase();
    if (taLower.includes('hni') || taLower.includes('high-net-worth') || taLower.includes('luxury') || taLower.includes('affluent')) {
      keywords.push('luxury lifestyle influencer', 'millionaire lifestyle', 'high net worth influencer', 'affluent living');
    }
    if (taLower.includes('home') || taLower.includes('villa') || taLower.includes('property')) {
      keywords.push('luxury home tour', 'mansion tour', 'dream home builder', 'celebrity home designer');
    }
    if (taLower.includes('nri') || taLower.includes('overseas')) {
      keywords.push('NRI influencer', 'indian diaspora lifestyle', 'overseas indian entrepreneur');
    }
  }

  // Remove duplicates and prioritize specific searches
  const uniqueKeywords = [...new Set(keywords)];
  
  // Sort by specificity (longer keywords first - they're usually more specific)
  uniqueKeywords.sort((a, b) => b.length - a.length);
  
  console.log('🎯 Generated search keywords:', uniqueKeywords.slice(0, 8));
  
  return uniqueKeywords.slice(0, 8);
}

/**
 * Estimate followers from engagement metrics
 */
function estimateFollowersFromEngagement(likes, comments) {
  // Rough estimation: assuming 3-5% engagement rate
  const engagementRate = 0.04; // 4%
  return Math.round((likes + comments) / engagementRate);
}

/**
 * Calculate engagement rate
 */
function calculateEngagementRate(likes, comments, followers) {
  if (!followers || followers === 0) {
    return 0;
  }
  return (((likes + comments) / followers) * 100).toFixed(2);
}

// ============================================
// AYRSHARE POST-LEVEL ANALYTICS
// ============================================

/**
 * Get analytics for a specific post (by Ayrshare post ID)
 * @param {string} postId - Ayrshare post ID
 * @param {string[]} platforms - Platforms to get analytics for
 * @param {string} profileKey - User's Ayrshare profile key
 */
async function getPostAnalytics(postId, platforms = null, profileKey = null) {
  if (!AYRSHARE_API_KEY) {
    return { success: false, error: 'API not configured' };
  }

  try {
    const headers = {
      'Authorization': `Bearer ${AYRSHARE_API_KEY}`,
      'Content-Type': 'application/json'
    };
    if (profileKey) headers['Profile-Key'] = profileKey;

    // Build body: only include platforms if explicitly provided
    // If null/empty, Ayrshare auto-detects from the post's actual platforms
    const body = { id: postId };
    if (platforms && Array.isArray(platforms) && platforms.length > 0) {
      body.platforms = platforms;
    }

    const response = await makeRequest('https://api.ayrshare.com/api/analytics/post', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      timeout: 60000
    });

    console.log('Ayrshare post analytics response:', response.status, JSON.stringify(response.data).substring(0, 1000));
    return { success: response.status === 200, data: response.data };
  } catch (error) {
    console.error('Ayrshare post analytics error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get detailed social / account-level analytics (with daily, quarters support)
 * @param {string} profileKey - User's Ayrshare profile key
 * @param {string[]} platforms - Platforms to get analytics for
 * @param {object} options - { daily: boolean, quarters: number }
 */
async function getSocialAnalyticsDetailed(profileKey, platforms = ['instagram', 'facebook'], options = {}) {
  if (!AYRSHARE_API_KEY) {
    return { success: false, error: 'API not configured' };
  }

  try {
    const headers = {
      'Authorization': `Bearer ${AYRSHARE_API_KEY}`,
      'Content-Type': 'application/json'
    };
    if (profileKey) headers['Profile-Key'] = profileKey;

    const body = { platforms };

    const response = await makeRequest('https://api.ayrshare.com/api/analytics/social', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      timeout: 60000
    });

    console.log('Ayrshare detailed social analytics response:', response.status, 'for platforms:', platforms);
    if (response.status !== 200) {
      console.log('Ayrshare analytics error response:', JSON.stringify(response.data).substring(0, 500));
    }
    return { success: response.status === 200, data: response.data };
  } catch (error) {
    console.error('Ayrshare detailed social analytics error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// AYRSHARE ADS / BOOST API
// ============================================

/**
 * Get Facebook/Instagram ad accounts
 */
async function getAdAccounts(profileKey = null) {
  if (!AYRSHARE_API_KEY) {
    return { success: false, error: 'API not configured' };
  }

  try {
    const headers = {
      'Authorization': `Bearer ${AYRSHARE_API_KEY}`
    };
    if (profileKey) headers['Profile-Key'] = profileKey;

    const response = await makeRequest('https://api.ayrshare.com/api/ads/facebook/accounts', {
      method: 'GET',
      headers,
      timeout: 30000
    });

    console.log('Ayrshare ad accounts response:', response.status, JSON.stringify(response.data).substring(0, 500));
    return { success: response.status === 200, data: response.data };
  } catch (error) {
    console.error('Ayrshare get ad accounts error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Boost a post on Facebook/Instagram
 * @param {object} params - All Ayrshare boost params (flat, matching their API)
 */
async function boostPost(profileKey, params = {}) {
  if (!AYRSHARE_API_KEY) {
    return { success: false, error: 'API not configured' };
  }

  try {
    const headers = {
      'Authorization': `Bearer ${AYRSHARE_API_KEY}`,
      'Content-Type': 'application/json'
    };
    if (profileKey) headers['Profile-Key'] = profileKey;

    // Build the body matching Ayrshare's flat API schema
    const body = {
      postId: params.postId,
      accountId: params.adAccountId,
      adName: params.adName || `Gravity Boost - ${params.postId}`,
      goal: params.goal || 'engagement',
      budget: params.dailyBudget || params.budget || 1,
      bidAmount: params.bidAmount || 1,
      status: params.status || 'active',
      locations: params.locations || { countries: ['US'] },
    };

    // Dates (omit endDate for ongoing ads)
    if (params.startDate) body.startDate = params.startDate;
    if (params.endDate) body.endDate = params.endDate;

    // Excluded locations
    if (params.excludedLocations) body.excludedLocations = params.excludedLocations;

    // Targeting — flat params as Ayrshare expects
    if (params.minAge) body.minAge = params.minAge;
    if (params.maxAge && params.maxAge !== 65) body.maxAge = params.maxAge;
    if (params.gender && params.gender !== 'all') body.gender = params.gender;
    if (params.interests && Array.isArray(params.interests) && params.interests.length > 0) {
      body.interests = params.interests.map(i => typeof i === 'object' ? i.id : i);
    }

    // Special Ad Categories (housing, finance, employment, politics)
    if (params.specialAdCategories && Array.isArray(params.specialAdCategories) && params.specialAdCategories.length > 0) {
      body.specialAdCategories = params.specialAdCategories;
    }

    // Facebook Pixel tracking
    if (params.tracking && params.tracking.pixelId) {
      body.tracking = { pixelId: params.tracking.pixelId };
    }

    // UTM tags
    if (params.urlTags && Array.isArray(params.urlTags) && params.urlTags.length > 0) {
      body.urlTags = params.urlTags;
    }

    // DSA compliance (EU)
    if (params.dsaBeneficiary) body.dsaBeneficiary = params.dsaBeneficiary;
    if (params.dsaPayor) body.dsaPayor = params.dsaPayor;

    // Legacy support: handle old nested targeting format
    if (params.targeting) {
      if (params.targeting.age_min) body.minAge = body.minAge || params.targeting.age_min;
      if (params.targeting.age_max) body.maxAge = body.maxAge || params.targeting.age_max;
      if (params.targeting.gender) body.gender = body.gender || params.targeting.gender;
      if (params.targeting.interests && Array.isArray(params.targeting.interests)) {
        body.interests = body.interests || params.targeting.interests.map(i => typeof i === 'object' ? i.id : i);
      }
      if (params.targeting.locations) body.locations = params.targeting.locations;
    }

    console.log('Ayrshare boost request body:', JSON.stringify(body, null, 2));

    const response = await makeRequest('https://api.ayrshare.com/api/ads/facebook/boost', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      timeout: 60000
    });

    console.log('Ayrshare boost response:', response.status, JSON.stringify(response.data));
    if (response.status !== 200) {
      // Extract the most descriptive error — prefer details over generic message
      const rd = response.data;
      const detail = rd?.details || '';
      const msg = rd?.message || rd?.error || '';
      const errMsg = (typeof rd === 'string' ? rd : null)
        || (detail ? (msg ? `${msg} — ${detail}` : detail) : msg)
        || (rd?.errors ? JSON.stringify(rd.errors) : null)
        || `Ayrshare returned status ${response.status}`;
      return { success: false, error: errMsg, data: response.data };
    }
    return { success: true, data: response.data };
  } catch (error) {
    console.error('Ayrshare boost post error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get all boosted ads
 */
async function getBoostedAds(profileKey = null, params = {}) {
  if (!AYRSHARE_API_KEY) {
    return { success: false, error: 'API not configured' };
  }

  try {
    const headers = {
      'Authorization': `Bearer ${AYRSHARE_API_KEY}`
    };
    if (profileKey) headers['Profile-Key'] = profileKey;

    // Ayrshare requires at least one of: accountId, adId, fbPostId, postId
    // If none provided, fetch ad accounts first and query each
    let accountIds = [];
    if (params.accountId) {
      accountIds = [params.accountId];
    } else {
      const accountsResult = await getAdAccounts(profileKey);
      if (accountsResult.success && accountsResult.data?.adAccounts) {
        accountIds = accountsResult.data.adAccounts.map(a => a.id || a.accountId);
      }
    }

    if (accountIds.length === 0) {
      return { success: true, data: { ads: [], count: 0 } };
    }

    // Fetch ads for each account and merge
    let allAds = [];
    for (const accId of accountIds) {
      let url = `https://api.ayrshare.com/api/ads/facebook/ads?accountId=${accId}`;
      if (params.status) url += `&status=${params.status}`;
      if (params.limit) url += `&limit=${params.limit}`;

      console.log('Fetching boosted ads for account:', accId, 'URL:', url);

      const response = await makeRequest(url, {
        method: 'GET',
        headers,
        timeout: 30000
      });

      console.log('Boosted ads response for account', accId, ':', response.status, JSON.stringify(response.data).substring(0, 500));

      if (response.status === 200 && response.data?.ads) {
        allAds = allAds.concat(response.data.ads);
      }
    }

    return { success: true, data: { ads: allAds, count: allAds.length } };
  } catch (error) {
    console.error('Ayrshare get boosted ads error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get ad spend history
 */
async function getAdHistory(profileKey = null, params = {}) {
  if (!AYRSHARE_API_KEY) {
    return { success: false, error: 'API not configured' };
  }

  try {
    const headers = {
      'Authorization': `Bearer ${AYRSHARE_API_KEY}`
    };
    if (profileKey) headers['Profile-Key'] = profileKey;

    let url = 'https://api.ayrshare.com/api/ads/facebook/history';
    const queryParams = [];
    if (params.startDate) queryParams.push(`startDate=${params.startDate}`);
    if (params.endDate) queryParams.push(`endDate=${params.endDate}`);
    if (queryParams.length) url += '?' + queryParams.join('&');

    const response = await makeRequest(url, {
      method: 'GET',
      headers,
      timeout: 30000
    });

    return { success: response.status === 200, data: response.data };
  } catch (error) {
    console.error('Ayrshare get ad history error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Search interests for ad targeting
 */
async function getAdInterests(profileKey = null, query = '') {
  if (!AYRSHARE_API_KEY) {
    return { success: false, error: 'API not configured' };
  }

  try {
    const headers = {
      'Authorization': `Bearer ${AYRSHARE_API_KEY}`
    };
    if (profileKey) headers['Profile-Key'] = profileKey;

    const response = await makeRequest(`https://api.ayrshare.com/api/ads/facebook/interests?search=${encodeURIComponent(query)}`, {
      method: 'GET',
      headers,
      timeout: 30000
    });

    return { success: response.status === 200, data: response.data };
  } catch (error) {
    console.error('Ayrshare get ad interests error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Update/pause/resume an ad
 * @param {string} adId - The ad ID to update
 * @param {object} params - { status: 'PAUSED' | 'ACTIVE', dailyBudget, endDate }
 */
async function updateAd(profileKey, adId, params = {}) {
  if (!AYRSHARE_API_KEY) {
    return { success: false, error: 'API not configured' };
  }

  try {
    const headers = {
      'Authorization': `Bearer ${AYRSHARE_API_KEY}`,
      'Content-Type': 'application/json'
    };
    if (profileKey) headers['Profile-Key'] = profileKey;

    const body = { adId, ...params };

    const response = await makeRequest('https://api.ayrshare.com/api/ads/facebook/update', {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
      timeout: 30000
    });

    return { success: response.status === 200, data: response.data };
  } catch (error) {
    console.error('Ayrshare update ad error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  // Ayrshare functions
  postToSocialMedia,
  getAyrshareAnalytics,
  getUserSocialAnalytics,
  getPostHistory,
  getPostStatus,
  deletePost,
  getAyrshareProfile,
  getAyrshareConnectUrl,
  // Ayrshare Business Plan functions (profile & JWT)
  createAyrshareProfile,
  generateAyrshareJWT,
  getAyrshareUserProfile,
  deleteAyrshareProfile,
  // Ayrshare Analytics (detailed)
  getPostAnalytics,
  getSocialAnalyticsDetailed,
  // Ayrshare Ads / Boost
  getAdAccounts,
  boostPost,
  getBoostedAds,
  getAdHistory,
  getAdInterests,
  updateAd,
  
  // Apify functions
  runApifyActor,
  scrapeInstagramProfile,
  scrapeInstagramPosts,
  scrapeTwitterProfile,
  scrapeTikTokProfile,
  scrapeCompetitor,
  searchInstagramByName,
  fetchRealCompetitorPosts,
  
  // Influencer Discovery functions (REAL-TIME SCRAPING)
  searchInstagramInfluencers,
  searchTwitterInfluencers,
  searchYouTubeInfluencers,
  searchLinkedInInfluencers,
  searchFacebookInfluencers,
  discoverInfluencers,
  
  // Combined functions
  getCompetitorAnalysis,
  getAPIStatus
};
