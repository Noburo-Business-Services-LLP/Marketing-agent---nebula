const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { getInstagramAccountHealthReport } = require('../services/instagram-fix');

router.get('/health', protect, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id || req.user?.userId || null;
    const user = userId ? await User.findById(userId) : req.user;

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const instagram = await getInstagramAccountHealthReport({
      user,
      profileKey: user?.ayrshare?.profileKey || ''
    });

    const connectedSocials = Array.isArray(user.connectedSocials) ? user.connectedSocials : [];
    const otherAccounts = connectedSocials
      .filter((entry) => String(entry?.platform || '').toLowerCase() !== 'instagram')
      .map((entry) => {
        const tokenExpiresAt = entry?.tokenExpiresAt || null;
        const tokenExpired = tokenExpiresAt ? new Date(tokenExpiresAt) <= new Date() : false;

        return {
          platform: entry.platform,
          connected: true,
          accountName: entry.accountName || entry.accountId || null,
          tokenExpiresAt,
          tokenExpired,
          needsReconnect: tokenExpired,
          message: tokenExpired
            ? `${entry.platform} token has expired and should be re-authenticated.`
            : `${entry.platform} account looks connected.`
        };
      });

    return res.json({
      success: true,
      accounts: [
        {
          ...instagram,
          reauthRequired: instagram.needsReconnect
        },
        ...otherAccounts
      ],
      ayrshare: {
        profileKeyPresent: Boolean(user?.ayrshare?.profileKey),
        lastCheckedAt: user?.ayrshare?.lastCheckedAt || null,
        lastError: user?.ayrshare?.lastError || ''
      }
    });
  } catch (error) {
    console.error('Account health error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to check account health',
      error: error.message
    });
  }
});

module.exports = router;
