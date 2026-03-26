const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// Import Ayrshare for social media management
const { 
  postToSocialMedia, 
  getAyrshareAnalytics,
  getUserSocialAnalytics,
  getAPIStatus,
  getAyrshareProfile,
  getAyrshareConnectUrl,
  // Ayrshare Business Plan functions
  createAyrshareProfile,
  generateAyrshareJWT,
  getAyrshareUserProfile,
  deleteAyrshareProfile
} = require('../services/socialMediaAPI');

// ============================================
// OAuth Configuration for All Platforms
// ============================================

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const SOCIAL_CONNECT_REWARD = 5; // credits awarded for first-time social connection

/**
 * Award credits for first-time social connection
 * Checks if platform was already connected before rewarding
 */
async function rewardSocialConnect(user, platform) {
  const normalizedPlatform = platform.toLowerCase();
  const alreadyConnected = user.connectedSocials?.some(
    s => s.platform.toLowerCase() === normalizedPlatform ||
         (normalizedPlatform === 'x' && s.platform.toLowerCase() === 'twitter') ||
         (normalizedPlatform === 'twitter' && s.platform.toLowerCase() === 'x')
  );

  if (alreadyConnected) return false;

  // First time connecting this platform — award credits
  user.credits = user.credits || { balance: 0, totalUsed: 0, history: [] };
  user.credits.balance = Number(user.credits.balance || 0) + SOCIAL_CONNECT_REWARD;
  user.credits.history = (user.credits.history || []).slice(-50);
  user.credits.history.push({
    action: `social_connect_${normalizedPlatform}`,
    cost: -SOCIAL_CONNECT_REWARD,
    balanceAfter: user.credits.balance,
    description: `Reward for connecting ${platform}`,
    timestamp: new Date()
  });

  console.log(`🎁 Awarded ${SOCIAL_CONNECT_REWARD} credits to user ${user.email} for connecting ${platform}`);
  return true;
}

// Google/YouTube OAuth
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/social/youtube/callback';

// Meta (Facebook/Instagram) OAuth
const META_APP_ID = process.env.META_APP_ID || process.env.FACEBOOK_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET;
const META_REDIRECT_URI = process.env.META_REDIRECT_URI || 'http://localhost:5000/api/social/meta/callback';

// X (Twitter) OAuth 2.0
const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID;
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET;
const TWITTER_REDIRECT_URI = process.env.TWITTER_REDIRECT_URI || 'http://localhost:5000/api/social/twitter/callback';

// LinkedIn OAuth
const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const LINKEDIN_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:5000/api/social/linkedin/callback';

// Pinterest OAuth
const PINTEREST_CLIENT_ID = process.env.PINTEREST_CLIENT_ID;
const PINTEREST_CLIENT_SECRET = process.env.PINTEREST_CLIENT_SECRET;
const PINTEREST_REDIRECT_URI = process.env.PINTEREST_REDIRECT_URI || 'http://localhost:5000/api/social/pinterest/callback';

// OAuth Scopes
const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');

const META_SCOPES = [
  'public_profile',
  'email',
  'pages_show_list',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_insights'
].join(',');

const TWITTER_SCOPES = [
  'tweet.read',
  'tweet.write',
  'users.read',
  'offline.access'
].join(' ');

const LINKEDIN_SCOPES = [
  'openid',
  'profile',
  'email',
  'w_member_social'
].join(' ');

const PINTEREST_SCOPES = [
  'boards:read',
  'boards:write',
  'pins:read',
  'pins:write',
  'user_accounts:read'
].join(',');

// Store state tokens temporarily (in production, use Redis or similar)
const pendingOAuthStates = new Map();

// Helper to clean old states
function cleanOldStates() {
  for (const [key, value] of pendingOAuthStates.entries()) {
    if (Date.now() - value.createdAt > 10 * 60 * 1000) {
      pendingOAuthStates.delete(key);
    }
  }
}

// Helper to generate state token
function generateStateToken(userId, platform) {
  const state = Buffer.from(JSON.stringify({
    userId,
    platform,
    timestamp: Date.now(),
    random: Math.random().toString(36).substring(7)
  })).toString('base64');
  
  pendingOAuthStates.set(state, {
    userId,
    platform,
    createdAt: Date.now()
  });
  
  cleanOldStates();
  return state;
}

// Check if OAuth is configured for a platform
function isOAuthConfigured(platform) {
  switch(platform.toLowerCase()) {
    case 'youtube':
      return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
    case 'instagram':
    case 'facebook':
      return !!(META_APP_ID && META_APP_SECRET);
    case 'x':
    case 'twitter':
      return !!(TWITTER_CLIENT_ID && TWITTER_CLIENT_SECRET);
    case 'linkedin':
      return !!(LINKEDIN_CLIENT_ID && LINKEDIN_CLIENT_SECRET);
    case 'pinterest':
      return !!(PINTEREST_CLIENT_ID && PINTEREST_CLIENT_SECRET);
    default:
      return false;
  }
}

// Platform to Ayrshare platform name mapping
const AYRSHARE_PLATFORM_MAP = {
  'instagram': 'instagram',
  'facebook': 'facebook',
  'x': 'twitter',
  'twitter': 'twitter',
  'linkedin': 'linkedin',
  'pinterest': 'pinterest',
  'reddit': 'reddit',
  'youtube': 'youtube'
};

// ============================================
// Universal Platform Auth Endpoint
// ============================================

/**
 * GET /api/social/:platform/auth
 * Universal OAuth initiation for any platform
 * Uses Ayrshare JWT/SSO for social account linking (Business Plan)
 * If user doesn't have an Ayrshare profile yet, creates one first
 */
router.get('/:platform/auth', protect, async (req, res) => {
  const { platform } = req.params;
  const platformLower = platform.toLowerCase();
  
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Use Ayrshare JWT/SSO flow for ALL platforms (Business Plan approach)
    // Step 1: Check if user has an Ayrshare profile, if not create one
    let profileKey = user.ayrshare?.profileKey;
    
    if (!profileKey) {
      console.log(`Creating Ayrshare profile for user: ${user.email}`);
      
      // Create a unique title for this user's Ayrshare profile
      const profileTitle = `Nebula-${user._id.toString().slice(-8)}-${user.email.split('@')[0]}`;
      
      // Configure which social networks to show (hide those not relevant)
      const disableSocial = ['gmb', 'snapchat', 'telegram', 'threads']; // Hide less common ones
      
      const createResult = await createAyrshareProfile(profileTitle, {
        hideTopHeader: false,
        topHeader: `Connect Social Accounts for ${user.businessProfile?.name || user.firstName || 'Your Business'}`,
        subHeader: 'Click an icon below to securely connect your social media account',
        disableSocial: disableSocial
      });
      
      if (!createResult.success) {
        // Check if profile already exists (code 146)
        if (createResult.code === 146) {
          console.log('Ayrshare profile already exists, title conflict');
          // Try with a more unique title
          const uniqueTitle = `Nebula-${Date.now()}-${user._id.toString().slice(-6)}`;
          const retryResult = await createAyrshareProfile(uniqueTitle, {
            hideTopHeader: false,
            disableSocial: disableSocial
          });
          
          if (!retryResult.success) {
            return res.status(500).json({
              success: false,
              message: 'Failed to create social linking profile. Please try again.',
              error: retryResult.error
            });
          }
          
          profileKey = retryResult.profileKey;
          user.ayrshare = {
            profileKey: retryResult.profileKey,
            refId: retryResult.refId,
            title: uniqueTitle,
            createdAt: new Date()
          };
        } else {
          return res.status(500).json({
            success: false,
            message: 'Failed to create social linking profile',
            error: createResult.error
          });
        }
      } else {
        profileKey = createResult.profileKey;
        user.ayrshare = {
          profileKey: createResult.profileKey,
          refId: createResult.refId,
          title: profileTitle,
          createdAt: new Date()
        };
      }
      
      await user.save();
      console.log(`Ayrshare profile created for user: ${user.email}, profileKey: ${profileKey?.slice(0, 8)}...`);
    }
    
    // Step 2: Generate JWT URL for SSO to social linking page
    const redirectUrl = `${FRONTEND_URL}/#/connect-socials?${platformLower}=connected`;
    
    // Map platform to Ayrshare's expected format for allowedSocial
    const ayrshareplatform = AYRSHARE_PLATFORM_MAP[platformLower] || platformLower;
    
    const jwtResult = await generateAyrshareJWT(profileKey, {
      redirect: redirectUrl,
      logout: false, // Don't force logout for faster UX
      // Only show the specific platform the user clicked on
      allowedSocial: [ayrshareplatform]
    });
    
    if (!jwtResult.success) {
      console.error('Failed to generate Ayrshare JWT:', jwtResult.error);
      return res.status(500).json({
        success: false,
        message: 'Failed to generate social linking URL',
        error: jwtResult.error
      });
    }
    
    // The JWT URL uses domain + privateKey for Business Plan SSO
    // User will be redirected directly to the social platform's OAuth page
    let authUrl = jwtResult.url;
    
    console.log(`Generated Ayrshare JWT URL for ${platform}:`, authUrl.slice(0, 80) + '...');
    
    return res.json({
      success: true,
      configured: true,
      authUrl: authUrl,
      method: 'ayrshare_jwt',
      message: `Connect your ${platform} account securely`
    });

  } catch (error) {
    console.error(`${platform} auth initiation error:`, error);
    res.status(500).json({
      success: false,
      message: `Failed to initiate ${platform} authentication`
    });
  }
});

// Helper to get setup instructions for each platform
function getSetupInstructions(platform) {
  const instructions = {
    facebook: {
      url: 'https://developers.facebook.com/apps/',
      steps: [
        '1. Go to Facebook Developers Portal',
        '2. Create a new app or select existing',
        '3. Add Facebook Login product',
        '4. Get App ID and App Secret',
        '5. Add META_APP_ID and META_APP_SECRET to .env'
      ]
    },
    instagram: {
      url: 'https://developers.facebook.com/apps/',
      steps: [
        '1. Go to Facebook Developers Portal',
        '2. Create a new app with Instagram API access',
        '3. Add Instagram Basic Display or Instagram Graph API',
        '4. Get App ID and App Secret',
        '5. Add META_APP_ID and META_APP_SECRET to .env'
      ]
    },
    x: {
      url: 'https://developer.twitter.com/en/portal/dashboard',
      steps: [
        '1. Go to Twitter Developer Portal',
        '2. Create a new project and app',
        '3. Enable OAuth 2.0',
        '4. Get Client ID and Client Secret',
        '5. Add TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET to .env'
      ]
    },
    twitter: {
      url: 'https://developer.twitter.com/en/portal/dashboard',
      steps: [
        '1. Go to Twitter Developer Portal',
        '2. Create a new project and app',
        '3. Enable OAuth 2.0',
        '4. Get Client ID and Client Secret',
        '5. Add TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET to .env'
      ]
    },
    linkedin: {
      url: 'https://www.linkedin.com/developers/apps',
      steps: [
        '1. Go to LinkedIn Developers',
        '2. Create a new app',
        '3. Request Sign In with LinkedIn using OpenID Connect',
        '4. Get Client ID and Client Secret',
        '5. Add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET to .env'
      ]
    },
    pinterest: {
      url: 'https://developers.pinterest.com/apps/',
      steps: [
        '1. Go to Pinterest Developers',
        '2. Create a new app',
        '3. Get App ID and App Secret',
        '4. Add PINTEREST_CLIENT_ID and PINTEREST_CLIENT_SECRET to .env'
      ]
    },
    youtube: {
      url: 'https://console.cloud.google.com/',
      steps: [
        '1. Go to Google Cloud Console',
        '2. Create a new project',
        '3. Enable YouTube Data API v3',
        '4. Create OAuth 2.0 credentials',
        '5. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env'
      ]
    }
  };
  
  return instructions[platform.toLowerCase()] || {
    url: '',
    steps: ['Please configure OAuth credentials for this platform']
  };
}

// ============================================
// YouTube OAuth Routes (Legacy - kept for compatibility)
// ============================================

// Initiate YouTube OAuth - returns the authorization URL
router.get('/youtube/auth', protect, (req, res) => {
  try {
    // Generate a random state token for security
    const state = Buffer.from(JSON.stringify({
      userId: req.user._id.toString(),
      timestamp: Date.now(),
      random: Math.random().toString(36).substring(7)
    })).toString('base64');

    // Store the state for verification
    pendingOAuthStates.set(state, {
      userId: req.user._id.toString(),
      createdAt: Date.now()
    });

    // Clean up old states (older than 10 minutes)
    for (const [key, value] of pendingOAuthStates.entries()) {
      if (Date.now() - value.createdAt > 10 * 60 * 1000) {
        pendingOAuthStates.delete(key);
      }
    }

    // Build the Google OAuth URL
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', YOUTUBE_SCOPES);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);

    res.json({
      success: true,
      authUrl: authUrl.toString()
    });
  } catch (error) {
    console.error('YouTube auth initiation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate YouTube authentication'
    });
  }
});

// YouTube OAuth callback - handles the redirect from Google
router.get('/youtube/callback', async (req, res) => {
  const { code, state, error } = req.query;

  // Handle user denial or errors
  if (error) {
    console.log('OAuth error:', error);
    return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=missing_parameters`);
  }

  try {
    // Verify the state token
    const stateData = pendingOAuthStates.get(state);
    if (!stateData) {
      console.log('Invalid or expired state token');
      return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=invalid_state`);
    }

    // Remove used state
    pendingOAuthStates.delete(state);

    const userId = stateData.userId;

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        code: code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error('Token exchange error:', tokenData);
      return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=token_exchange_failed`);
    }

    const { access_token, refresh_token, expires_in } = tokenData;

    // Get YouTube channel info
    const channelResponse = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
      {
        headers: {
          'Authorization': `Bearer ${access_token}`
        }
      }
    );

    const channelData = await channelResponse.json();

    if (!channelData.items || channelData.items.length === 0) {
      console.log('No YouTube channel found for user');
      return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=no_channel`);
    }

    const channel = channelData.items[0];
    const channelInfo = {
      platform: 'YouTube',
      accountId: channel.id,
      accountName: channel.snippet.title,
      accessToken: access_token,
      refreshToken: refresh_token,
      tokenExpiresAt: new Date(Date.now() + expires_in * 1000),
      channelData: {
        title: channel.snippet.title,
        description: channel.snippet.description,
        thumbnailUrl: channel.snippet.thumbnails?.default?.url || '',
        subscriberCount: channel.statistics?.subscriberCount || '0',
        videoCount: channel.statistics?.videoCount || '0',
        viewCount: channel.statistics?.viewCount || '0'
      },
      connectedAt: new Date()
    };

    // Update user's connected socials
    const user = await User.findById(userId);
    if (!user) {
      return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=user_not_found`);
    }

    // Award credits for first-time connection (must check before filter)
    await rewardSocialConnect(user, 'YouTube');

    // Remove existing YouTube connection if any
    user.connectedSocials = user.connectedSocials.filter(s => s.platform !== 'YouTube');

    // Add new connection
    user.connectedSocials.push(channelInfo);
    await user.save();

    console.log(`YouTube connected for user ${userId}: ${channelInfo.accountName}`);

    // Redirect back to frontend with success
    res.redirect(`${FRONTEND_URL}/#/connect-socials?youtube=connected&channel=${encodeURIComponent(channelInfo.accountName)}`);

  } catch (error) {
    console.error('YouTube callback error:', error);
    res.redirect(`${FRONTEND_URL}/#/connect-socials?error=callback_failed`);
  }
});

// Disconnect YouTube
router.post('/youtube/disconnect', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    // Find YouTube connection to potentially revoke token
    const youtubeConnection = user.connectedSocials.find(s => s.platform === 'YouTube');
    
    if (youtubeConnection && youtubeConnection.accessToken) {
      // Try to revoke the token (optional, may fail if token expired)
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${youtubeConnection.accessToken}`, {
          method: 'POST'
        });
      } catch (e) {
        console.log('Token revocation failed (may be expired):', e.message);
      }
    }

    // Remove YouTube from connected socials
    user.connectedSocials = user.connectedSocials.filter(s => s.platform !== 'YouTube');
    await user.save();

    res.json({
      success: true,
      message: 'YouTube disconnected successfully'
    });
  } catch (error) {
    console.error('YouTube disconnect error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to disconnect YouTube'
    });
  }
});

// ============================================
// Meta (Facebook/Instagram) OAuth Callback
// ============================================
router.get('/meta/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=missing_parameters`);
  }

  try {
    const stateData = pendingOAuthStates.get(state);
    if (!stateData) {
      return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=invalid_state`);
    }
    pendingOAuthStates.delete(state);

    const userId = stateData.userId;
    const platform = stateData.platform; // 'facebook' or 'instagram'

    // Exchange code for access token
    const tokenResponse = await fetch(
      `https://graph.facebook.com/v18.0/oauth/access_token?` +
      `client_id=${META_APP_ID}&` +
      `client_secret=${META_APP_SECRET}&` +
      `redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}&` +
      `code=${code}`
    );

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error('Meta token exchange error:', tokenData);
      return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=token_exchange_failed`);
    }

    const { access_token } = tokenData;

    // Get user profile
    const profileResponse = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${access_token}`
    );
    const profile = await profileResponse.json();

    const connectionInfo = {
      platform: platform === 'instagram' ? 'Instagram' : 'Facebook',
      accountId: profile.id,
      accountName: profile.name,
      accessToken: access_token,
      connectedAt: new Date()
    };

    // Update user's connected socials
    const user = await User.findById(userId);
    if (!user) {
      return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=user_not_found`);
    }

    await rewardSocialConnect(user, connectionInfo.platform);
    user.connectedSocials = user.connectedSocials.filter(s => s.platform !== connectionInfo.platform);
    user.connectedSocials.push(connectionInfo);
    await user.save();

    const platformParam = platform === 'instagram' ? 'instagram' : 'facebook';
    res.redirect(`${FRONTEND_URL}/#/connect-socials?${platformParam}=connected&account=${encodeURIComponent(profile.name)}`);

  } catch (error) {
    console.error('Meta callback error:', error);
    res.redirect(`${FRONTEND_URL}/#/connect-socials?error=callback_failed`);
  }
});

// ============================================
// X (Twitter) OAuth 2.0 Callback
// ============================================
router.get('/twitter/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=missing_parameters`);
  }

  try {
    const stateData = pendingOAuthStates.get(state);
    if (!stateData) {
      return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=invalid_state`);
    }
    pendingOAuthStates.delete(state);

    const userId = stateData.userId;

    // Exchange code for access token
    const basicAuth = Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64');
    
    const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: TWITTER_REDIRECT_URI,
        code_verifier: 'challenge'
      })
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error('Twitter token exchange error:', tokenData);
      return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=token_exchange_failed`);
    }

    const { access_token, refresh_token } = tokenData;

    // Get user profile
    const profileResponse = await fetch('https://api.twitter.com/2/users/me?user.fields=profile_image_url,username', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });
    const profileData = await profileResponse.json();
    const profile = profileData.data;

    const connectionInfo = {
      platform: 'X',
      accountId: profile.id,
      accountName: `@${profile.username}`,
      accessToken: access_token,
      refreshToken: refresh_token,
      connectedAt: new Date()
    };

    const user = await User.findById(userId);
    if (!user) {
      return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=user_not_found`);
    }

    await rewardSocialConnect(user, 'X');
    user.connectedSocials = user.connectedSocials.filter(s => s.platform !== 'X' && s.platform !== 'Twitter');
    user.connectedSocials.push(connectionInfo);
    await user.save();

    res.redirect(`${FRONTEND_URL}/#/connect-socials?x=connected&account=${encodeURIComponent(profile.username)}`);

  } catch (error) {
    console.error('Twitter callback error:', error);
    res.redirect(`${FRONTEND_URL}/#/connect-socials?error=callback_failed`);
  }
});

// ============================================
// LinkedIn OAuth Callback
// ============================================
router.get('/linkedin/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=missing_parameters`);
  }

  try {
    const stateData = pendingOAuthStates.get(state);
    if (!stateData) {
      return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=invalid_state`);
    }
    pendingOAuthStates.delete(state);

    const userId = stateData.userId;

    // Exchange code for access token
    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: LINKEDIN_CLIENT_ID,
        client_secret: LINKEDIN_CLIENT_SECRET,
        redirect_uri: LINKEDIN_REDIRECT_URI
      })
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error('LinkedIn token exchange error:', tokenData);
      return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=token_exchange_failed`);
    }

    const { access_token } = tokenData;

    // Get user profile using OpenID Connect
    const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });
    const profile = await profileResponse.json();

    const connectionInfo = {
      platform: 'LinkedIn',
      accountId: profile.sub,
      accountName: profile.name,
      accessToken: access_token,
      connectedAt: new Date()
    };

    const user = await User.findById(userId);
    if (!user) {
      return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=user_not_found`);
    }

    await rewardSocialConnect(user, 'LinkedIn');
    user.connectedSocials = user.connectedSocials.filter(s => s.platform !== 'LinkedIn');
    user.connectedSocials.push(connectionInfo);
    await user.save();

    res.redirect(`${FRONTEND_URL}/#/connect-socials?linkedin=connected&account=${encodeURIComponent(profile.name)}`);

  } catch (error) {
    console.error('LinkedIn callback error:', error);
    res.redirect(`${FRONTEND_URL}/#/connect-socials?error=callback_failed`);
  }
});

// ============================================
// Pinterest OAuth Callback
// ============================================
router.get('/pinterest/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=missing_parameters`);
  }

  try {
    const stateData = pendingOAuthStates.get(state);
    if (!stateData) {
      return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=invalid_state`);
    }
    pendingOAuthStates.delete(state);

    const userId = stateData.userId;

    // Exchange code for access token
    const basicAuth = Buffer.from(`${PINTEREST_CLIENT_ID}:${PINTEREST_CLIENT_SECRET}`).toString('base64');
    
    const tokenResponse = await fetch('https://api.pinterest.com/v5/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: PINTEREST_REDIRECT_URI
      })
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error('Pinterest token exchange error:', tokenData);
      return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=token_exchange_failed`);
    }

    const { access_token } = tokenData;

    // Get user profile
    const profileResponse = await fetch('https://api.pinterest.com/v5/user_account', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });
    const profile = await profileResponse.json();

    const connectionInfo = {
      platform: 'Pinterest',
      accountId: profile.username,
      accountName: profile.username,
      accessToken: access_token,
      connectedAt: new Date()
    };

    const user = await User.findById(userId);
    if (!user) {
      return res.redirect(`${FRONTEND_URL}/#/connect-socials?error=user_not_found`);
    }

    await rewardSocialConnect(user, 'Pinterest');
    user.connectedSocials = user.connectedSocials.filter(s => s.platform !== 'Pinterest');
    user.connectedSocials.push(connectionInfo);
    await user.save();

    res.redirect(`${FRONTEND_URL}/#/connect-socials?pinterest=connected&account=${encodeURIComponent(profile.username)}`);

  } catch (error) {
    console.error('Pinterest callback error:', error);
    res.redirect(`${FRONTEND_URL}/#/connect-socials?error=callback_failed`);
  }
});

// ============================================
// Universal Disconnect Route
// ============================================
router.post('/:platform/disconnect', protect, async (req, res) => {
  try {
    const { platform } = req.params;
    const user = await User.findById(req.user._id);

    // Unlink from Ayrshare first
    if (user.ayrshare?.profileKey) {
      const ayrsharePlatform = AYRSHARE_PLATFORM_MAP[platform.toLowerCase()] || platform.toLowerCase();
      try {
        const response = await fetch('https://app.ayrshare.com/api/profiles/social', {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${process.env.AYRSHARE_API_KEY}`,
            'Content-Type': 'application/json',
            'Profile-Key': user.ayrshare.profileKey
          },
          body: JSON.stringify({ platform: ayrsharePlatform })
        });
        const result = await response.json();
        console.log(`Ayrshare unlink ${ayrsharePlatform}:`, result.status || result);
      } catch (ayrshareErr) {
        console.error(`Ayrshare unlink failed for ${platform}:`, ayrshareErr.message);
      }
    }

    // Handle X/Twitter naming
    const platformsToRemove = platform.toLowerCase() === 'x' || platform.toLowerCase() === 'twitter'
      ? ['X', 'Twitter', 'x', 'twitter']
      : [platform, platform.toLowerCase(), platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase()];

    user.connectedSocials = user.connectedSocials.filter(s =>
      !platformsToRemove.includes(s.platform)
    );
    await user.save();

    res.json({
      success: true,
      message: `${platform} disconnected successfully`
    });
  } catch (error) {
    console.error(`${req.params.platform} disconnect error:`, error);
    res.status(500).json({
      success: false,
      message: `Failed to disconnect ${req.params.platform}`
    });
  }
});

// Get connected socials status
router.get('/status', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    // Build status for all platforms (removed TikTok and Snapchat, renamed Twitter to X)
    const platforms = ['Instagram', 'Facebook', 'X', 'LinkedIn'];
    
    // Get user's Ayrshare connected accounts using their profile key
    let ayrshareAccounts = [];
    let ayrshareDisplayNames = [];
    let socialAnalytics = {};
    
    if (user.ayrshare?.profileKey) {
      try {
        // Use user's specific profile key to get their connected accounts
        const userProfile = await getAyrshareUserProfile(user.ayrshare.profileKey);
        if (userProfile.success) {
          ayrshareAccounts = userProfile.data?.activeSocialAccounts || [];
          ayrshareDisplayNames = userProfile.data?.displayNames || [];
          console.log(`User ${user.email} Ayrshare accounts:`, ayrshareAccounts);
          
          // Fetch social analytics for connected platforms
          if (ayrshareAccounts.length > 0) {
            try {
              const analyticsResult = await getUserSocialAnalytics(user.ayrshare.profileKey, ayrshareAccounts);
              if (analyticsResult.success && analyticsResult.data) {
                socialAnalytics = analyticsResult.data;
                console.log('Social analytics fetched:', Object.keys(socialAnalytics));
              }
            } catch (analyticsError) {
              console.log('Could not fetch social analytics:', analyticsError.message);
            }
          }
        }
      } catch (e) {
        console.log('Ayrshare user profile check failed:', e.message);
      }
    } else {
      // Fallback to primary profile check for backwards compatibility
      try {
        const ayrshareProfile = await getAyrshareProfile();
        if (ayrshareProfile.success) {
          ayrshareAccounts = ayrshareProfile.data?.activeSocialAccounts || [];
          ayrshareDisplayNames = ayrshareProfile.data?.displayNames || [];
        }
      } catch (e) {
        console.log('Ayrshare profile check failed:', e.message);
      }
    }
    
    const connections = platforms.map(platform => {
      // Handle legacy Twitter connections as X
      const searchPlatform = platform === 'X' ? ['X', 'Twitter'] : [platform];
      const connection = user.connectedSocials.find(s => searchPlatform.includes(s.platform));
      
      // Check if connected via database
      if (connection) {
        return {
          platform,
          connected: true,
          username: connection.accountName || connection.accountId,
          status: 'active',
          connectedAt: connection.connectedAt,
          channelData: connection.channelData || null,
          source: 'oauth'
        };
      }
      
      // Check if connected via Ayrshare
      const ayrshareMapping = {
        'Instagram': 'instagram',
        'Facebook': 'facebook',
        'X': 'twitter',
        'LinkedIn': 'linkedin',
        'YouTube': 'youtube',
        'Pinterest': 'pinterest',
        'Reddit': 'reddit'
      };
      
      const ayrshareKey = ayrshareMapping[platform];
      if (ayrshareAccounts.includes(ayrshareKey)) {
        const displayInfo = ayrshareDisplayNames.find(d => d.platform === ayrshareKey);
        
        // Get analytics for this platform - Ayrshare returns nested structure like { instagram: { analytics: {...} } }
        const platformData = socialAnalytics[ayrshareKey] || null;
        const platformAnalytics = platformData?.analytics || null;
        
        // Map platform-specific field names to common format
        let followers = 0, following = 0, posts = 0, engagement = 0;
        
        if (platformAnalytics) {
          switch (ayrshareKey) {
            case 'instagram':
              followers = platformAnalytics.followersCount || 0;
              following = platformAnalytics.followsCount || 0;
              posts = platformAnalytics.mediaCount || 0;
              break;
            case 'facebook':
              followers = platformAnalytics.followersCount || platformAnalytics.fanCount || 0;
              following = platformAnalytics.pageFollows || 0;
              posts = platformAnalytics.mediaCount || 0;
              break;
            case 'twitter':
              followers = platformAnalytics.followersCount || 0;
              following = platformAnalytics.friendsCount || 0;
              posts = platformAnalytics.tweetCount || 0;
              break;
            case 'linkedin':
              followers = platformAnalytics.followers?.totalFollowerCount || 0;
              following = 0; // LinkedIn doesn't expose following count
              posts = 0; // LinkedIn doesn't expose post count in analytics
              engagement = platformAnalytics.engagement || 0;
              break;
            default:
              followers = platformAnalytics.followersCount || platformAnalytics.followers || 0;
              following = platformAnalytics.followingCount || platformAnalytics.followsCount || 0;
              posts = platformAnalytics.postsCount || platformAnalytics.mediaCount || 0;
          }
        }
        
        return {
          platform,
          connected: true,
          username: displayInfo?.username || displayInfo?.displayName || ayrshareKey,
          status: 'active',
          connectedAt: displayInfo?.created || null,
          profileUrl: displayInfo?.profileUrl || null,
          userImage: displayInfo?.userImage || null,
          source: 'ayrshare',
          analytics: platformAnalytics ? {
            followers,
            following,
            posts,
            engagement
          } : null
        };
      }
      
      return {
        platform,
        connected: false,
        username: null,
        status: 'inactive'
      };
    });

    res.json({
      success: true,
      connections,
      ayrshareConnected: ayrshareAccounts
    });
  } catch (error) {
    console.error('Get socials status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get social connections status'
    });
  }
});

// ============================================
// Ayrshare Integration Routes
// ============================================

/**
 * POST /api/social/post
 * Post content to multiple social media platforms via Ayrshare
 */
router.post('/post', protect, async (req, res) => {
  try {
    const { platforms, content, mediaUrls, scheduledDate } = req.body;

    if (!platforms || !content) {
      return res.status(400).json({
        success: false,
        message: 'Platforms and content are required'
      });
    }

    const options = {};
    if (mediaUrls) options.mediaUrls = mediaUrls;
    if (scheduledDate) options.scheduleDate = new Date(scheduledDate).toISOString();

    // Pass user's Ayrshare profile key so it posts to their sub-profile
    if (req.user?.ayrshare?.profileKey) {
      options.profileKey = req.user.ayrshare.profileKey;
    }

    const result = await postToSocialMedia(platforms, content, options);
    
    res.json({
      success: true,
      message: scheduledDate ? 'Post scheduled successfully' : 'Posted successfully',
      result
    });
  } catch (error) {
    console.error('Social post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to post to social media',
      error: error.message
    });
  }
});

/**
 * GET /api/social/analytics/:platform
 * Get analytics for a specific platform from Ayrshare
 */
router.get('/analytics/:platform', protect, async (req, res) => {
  try {
    const { platform } = req.params;
    
    const analytics = await getAyrshareAnalytics(platform);
    
    res.json({
      success: true,
      platform,
      analytics,
      fetchedAt: new Date()
    });
  } catch (error) {
    console.error('Analytics fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics',
      error: error.message
    });
  }
});

/**
 * GET /api/social/api-status
 * Check status of all API integrations
 */
router.get('/api-status', protect, async (req, res) => {
  try {
    const status = getAPIStatus();
    
    // Test actual API connectivity
    const testResults = {
      ayrshare: { configured: status.ayrshare.configured, connected: false, error: null },
      apify: { configured: status.apify.configured, connected: false, error: null },
      searchapi: { configured: status.searchapi.configured, connected: false, error: null }
    };
    
    // For now, just return configuration status as connected if configured
    // Real connectivity tests could be added later
    if (status.ayrshare.configured) testResults.ayrshare.connected = true;
    if (status.apify.configured) testResults.apify.connected = true;
    if (status.searchapi.configured) testResults.searchapi.connected = true;
    
    res.json({
      success: true,
      apis: testResults,
      checkedAt: new Date()
    });
  } catch (error) {
    console.error('API status check error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check API status',
      error: error.message
    });
  }
});

/**
 * GET /api/social/ayrshare/profiles
 * Get connected social accounts from Ayrshare
 */
router.get('/ayrshare/profiles', protect, async (req, res) => {
  try {
    const result = await getAyrshareProfile();
    
    if (result.success) {
      // Map Ayrshare profiles to our format
      const profiles = result.profiles || [];
      const connections = profiles.map(profile => ({
        platform: profile.platform === 'twitter' ? 'X' : 
                  profile.platform.charAt(0).toUpperCase() + profile.platform.slice(1),
        connected: true,
        username: profile.username || profile.displayName || profile.id,
        profileUrl: profile.profileUrl,
        profileImage: profile.profileImage
      }));
      
      res.json({
        success: true,
        profiles: connections,
        raw: result.data
      });
    } else {
      res.json({
        success: false,
        message: result.error || 'Failed to get Ayrshare profiles',
        profiles: []
      });
    }
  } catch (error) {
    console.error('Ayrshare profiles error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      profiles: []
    });
  }
});

/**
 * GET /api/social/connect/:platform
 * Get connection URL for a platform
 */
router.get('/connect/:platform', protect, async (req, res) => {
  try {
    const { platform } = req.params;
    const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/#/connect-socials`;
    
    // For YouTube, use our existing Google OAuth
    if (platform.toLowerCase() === 'youtube') {
      // Use existing YouTube auth route
      return res.json({
        success: true,
        authType: 'oauth',
        redirectTo: '/api/social/youtube/auth'
      });
    }
    
    // For other platforms, we'll use Ayrshare's dashboard
    // Note: Ayrshare requires account linking through their dashboard
    const result = await getAyrshareConnectUrl(platform, redirectUrl);
    
    res.json({
      success: true,
      authType: 'ayrshare',
      connectUrl: result.connectUrl,
      message: `To connect ${platform}, you'll be redirected to the Ayrshare dashboard to link your account.`
    });
  } catch (error) {
    console.error('Connect platform error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/social/connect/:platform
 * Save a connected social account (after OAuth callback)
 */
router.post('/connect/:platform', protect, async (req, res) => {
  try {
    const { platform } = req.params;
    const { username, accessToken, refreshToken, profileData } = req.body;
    
    const user = await User.findById(req.user._id);

    // Award credits for first-time connection
    await rewardSocialConnect(user, platform);

    // Remove existing connection for this platform
    user.connectedSocials = user.connectedSocials.filter(s =>
      s.platform.toLowerCase() !== platform.toLowerCase() &&
      !(platform.toLowerCase() === 'x' && s.platform.toLowerCase() === 'twitter')
    );

    // Add new connection
    user.connectedSocials.push({
      platform: platform === 'twitter' ? 'X' : platform,
      accountId: username,
      accountName: username,
      accessToken,
      refreshToken,
      connectedAt: new Date(),
      profileData
    });
    
    await user.save();
    
    res.json({
      success: true,
      message: `${platform} connected successfully`,
      platform
    });
  } catch (error) {
    console.error('Save connection error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * DELETE /api/social/disconnect/:platform
 * Disconnect a social account
 */
router.delete('/disconnect/:platform', protect, async (req, res) => {
  try {
    const { platform } = req.params;
    const user = await User.findById(req.user._id);
    
    // Handle X/Twitter naming
    const platformsToRemove = platform.toLowerCase() === 'x' 
      ? ['x', 'twitter'] 
      : [platform.toLowerCase()];
    
    user.connectedSocials = user.connectedSocials.filter(s => 
      !platformsToRemove.includes(s.platform.toLowerCase())
    );
    
    await user.save();
    
    res.json({
      success: true,
      message: `${platform} disconnected successfully`
    });
  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/social/ayrshare/profile
 * Alias for /ayrshare/profiles - Get connected social accounts from Ayrshare
 */
router.get('/ayrshare/profile', protect, async (req, res) => {
  try {
    const result = await getAyrshareProfile();
    
    if (result.success) {
      const profiles = result.profiles || [];
      const connections = profiles.map(profile => ({
        platform: profile.platform === 'twitter' ? 'X' : 
                  profile.platform.charAt(0).toUpperCase() + profile.platform.slice(1),
        connected: true,
        username: profile.username || profile.displayName || profile.id,
        profileUrl: profile.profileUrl,
        profileImage: profile.profileImage
      }));
      
      res.json({
        success: true,
        profiles: connections
      });
    } else {
      res.json({
        success: false,
        profiles: []
      });
    }
  } catch (error) {
    console.error('Ayrshare profile error:', error);
    res.status(500).json({
      success: false,
      profiles: []
    });
  }
});

/**
 * GET /api/social/ayrshare/connect-url/:platform
 * Get the Ayrshare OAuth URL to connect a specific platform
 */
router.get('/ayrshare/connect-url/:platform', protect, async (req, res) => {
  try {
    const { platform } = req.params;
    const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/#/connect-socials`;
    
    // For YouTube, redirect to our own Google OAuth
    if (platform.toLowerCase() === 'youtube') {
      return res.json({
        success: false,
        message: 'Use /api/social/youtube/auth for YouTube connections'
      });
    }
    
    // Get the Ayrshare connect URL
    const result = await getAyrshareConnectUrl(platform, redirectUrl);
    
    if (result.success) {
      res.json({
        success: true,
        connectUrl: result.connectUrl
      });
    } else {
      res.json({
        success: false,
        message: result.error || 'Failed to get connect URL',
        connectUrl: null
      });
    }
  } catch (error) {
    console.error('Ayrshare connect URL error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
