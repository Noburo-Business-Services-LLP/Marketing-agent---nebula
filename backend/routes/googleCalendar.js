const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect } = require('../middleware/auth');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALENDAR_REDIRECT_URI = process.env.GOOGLE_CALENDAR_REDIRECT_URI || 'http://localhost:5000/api/google-calendar/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');

// In-memory state store for OAuth (same pattern as YouTube)
const pendingCalendarOAuthStates = new Map();

// Clean up old states every 5 minutes
setInterval(() => {
  for (const [key, value] of pendingCalendarOAuthStates.entries()) {
    if (Date.now() - value.createdAt > 10 * 60 * 1000) {
      pendingCalendarOAuthStates.delete(key);
    }
  }
}, 5 * 60 * 1000);

// GET /api/google-calendar/status — check if user has Google Calendar connected
router.get('/status', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({
      success: true,
      connected: user?.googleCalendar?.connected || false,
      connectedAt: user?.googleCalendar?.connectedAt || null
    });
  } catch (error) {
    console.error('Google Calendar status error:', error);
    res.status(500).json({ success: false, message: 'Failed to check status' });
  }
});

// GET /api/google-calendar/auth — initiate OAuth flow
router.get('/auth', protect, (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.status(400).json({ success: false, message: 'Google Calendar not configured' });
    }

    const state = Buffer.from(JSON.stringify({
      userId: req.user._id.toString(),
      timestamp: Date.now(),
      random: Math.random().toString(36).substring(7)
    })).toString('base64');

    pendingCalendarOAuthStates.set(state, {
      userId: req.user._id.toString(),
      createdAt: Date.now()
    });

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', GOOGLE_CALENDAR_REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', CALENDAR_SCOPES);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);

    res.json({ success: true, authUrl: authUrl.toString() });
  } catch (error) {
    console.error('Google Calendar auth initiation error:', error);
    res.status(500).json({ success: false, message: 'Failed to initiate authentication' });
  }
});

// GET /api/google-calendar/callback — handle OAuth redirect
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.log('Google Calendar OAuth error:', error);
    return res.send('<script>window.close();</script>');
  }

  if (!code || !state) {
    return res.send('<script>alert("Missing parameters");window.close();</script>');
  }

  try {
    const stateData = pendingCalendarOAuthStates.get(state);
    if (!stateData) {
      return res.send('<script>alert("Invalid or expired state");window.close();</script>');
    }
    pendingCalendarOAuthStates.delete(state);

    const userId = stateData.userId;

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_CALENDAR_REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error('Google Calendar token exchange error:', tokenData);
      return res.send('<script>alert("Failed to connect");window.close();</script>');
    }

    const { access_token, refresh_token, expires_in } = tokenData;

    // Save tokens to user
    const user = await User.findById(userId);
    if (!user) {
      return res.send('<script>alert("User not found");window.close();</script>');
    }

    user.googleCalendar = {
      accessToken: access_token,
      refreshToken: refresh_token,
      tokenExpiresAt: new Date(Date.now() + expires_in * 1000),
      calendarId: 'primary',
      connected: true,
      connectedAt: new Date()
    };
    await user.save();

    console.log(`📅 Google Calendar connected for user ${userId}`);

    // Close the popup
    res.send('<script>window.close();</script>');
  } catch (error) {
    console.error('Google Calendar callback error:', error);
    res.send('<script>alert("Connection failed");window.close();</script>');
  }
});

// POST /api/google-calendar/disconnect — disconnect Google Calendar
router.post('/disconnect', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.googleCalendar = {
      accessToken: '',
      refreshToken: '',
      tokenExpiresAt: null,
      calendarId: 'primary',
      connected: false,
      connectedAt: null
    };
    await user.save();

    res.json({ success: true, message: 'Google Calendar disconnected' });
  } catch (error) {
    console.error('Google Calendar disconnect error:', error);
    res.status(500).json({ success: false, message: 'Failed to disconnect' });
  }
});

// Helper: refresh access token if expired
async function getValidAccessToken(user) {
  const gcal = user.googleCalendar;
  if (!gcal?.connected || !gcal.refreshToken) return null;

  // Check if token is still valid (with 5 min buffer)
  if (gcal.tokenExpiresAt && new Date(gcal.tokenExpiresAt) > new Date(Date.now() + 5 * 60 * 1000)) {
    return gcal.accessToken;
  }

  // Refresh the token
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: gcal.refreshToken,
        grant_type: 'refresh_token'
      })
    });

    const data = await response.json();
    if (data.error) {
      console.error('Token refresh failed:', data);
      return null;
    }

    // Update stored token
    user.googleCalendar.accessToken = data.access_token;
    user.googleCalendar.tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000);
    await user.save();

    return data.access_token;
  } catch (error) {
    console.error('Token refresh error:', error);
    return null;
  }
}

// POST /api/google-calendar/create-event — create a calendar event for a scheduled post
router.post('/create-event', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user?.googleCalendar?.connected) {
      return res.status(400).json({ success: false, message: 'Google Calendar not connected' });
    }

    const { title, description, startTime, platform } = req.body;

    const accessToken = await getValidAccessToken(user);
    if (!accessToken) {
      return res.status(401).json({ success: false, message: 'Google Calendar token expired. Please reconnect.' });
    }

    const startDate = new Date(startTime);
    const endDate = new Date(startDate.getTime() + 30 * 60 * 1000); // 30 min duration

    const event = {
      summary: `📱 ${title || 'Scheduled Post'}`,
      description: `${description || ''}\n\nPlatform: ${platform || 'Social Media'}\n\n— Created by Nebulaa Gravity`,
      start: {
        dateTime: startDate.toISOString(),
        timeZone: 'Asia/Kolkata'
      },
      end: {
        dateTime: endDate.toISOString(),
        timeZone: 'Asia/Kolkata'
      },
      colorId: '5', // banana yellow
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 15 }
        ]
      }
    };

    const calendarId = user.googleCalendar.calendarId || 'primary';
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      }
    );

    const eventData = await response.json();

    if (eventData.error) {
      console.error('Google Calendar event creation error:', eventData);
      return res.status(500).json({ success: false, message: eventData.error.message || 'Failed to create event' });
    }

    res.json({
      success: true,
      eventId: eventData.id,
      htmlLink: eventData.htmlLink
    });
  } catch (error) {
    console.error('Google Calendar create event error:', error);
    res.status(500).json({ success: false, message: 'Failed to create calendar event' });
  }
});

module.exports = router;
