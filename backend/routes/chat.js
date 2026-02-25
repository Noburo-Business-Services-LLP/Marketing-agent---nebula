const express = require('express');
const router = express.Router();
const { protect, optionalAuth } = require('../middleware/auth');
const User = require('../models/User');
const { generateChatResponse, generateChatSuggestions } = require('../services/geminiAI');
const { checkTrial, deductCredits } = require('../middleware/trialGuard');

// Chat completion endpoint - uses Gemini AI with user context
router.post('/message', optionalAuth, async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    // Get user's business profile if authenticated
    let businessProfile = null;
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    if (req.user) {
      const user = await User.findById(userId);
      if (user && user.businessProfile) {
        businessProfile = user.businessProfile;
      }

      // Check trial status for authenticated users
      if (user) {
        const now = new Date();
        const trialEnd = user.trial?.expiresAt ? new Date(user.trial.expiresAt) : null;
        if (trialEnd && now > trialEnd) {
          return res.status(403).json({ success: false, trialExpired: true, message: 'Trial expired' });
        }
        if ((user.credits?.balance ?? 100) < 0.5) {
          return res.status(403).json({ success: false, creditsExhausted: true, message: 'Insufficient credits for chat' });
        }
      }
    }

    // Generate response using Gemini with business context
    const aiResponse = await generateChatResponse(message, businessProfile, conversationHistory);

    // Deduct 0.5 credits for chat message (only for authenticated users)
    let creditsRemaining;
    if (userId) {
      const chatCreditResult = await deductCredits(userId, 'chat_message', 1, 'Chat message');
      creditsRemaining = chatCreditResult.creditsRemaining;
    }

    res.json({
      success: true,
      response: aiResponse,
      personalized: !!businessProfile,
      creditsRemaining
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get response. Please try again.'
    });
  }
});

// Quick suggestions endpoint - personalized based on business profile
router.get('/suggestions', optionalAuth, async (req, res) => {
  try {
    let businessProfile = null;
    
    if (req.user) {
      const user = await User.findById(req.user.userId || req.user.id || req.user._id);
      if (user && user.businessProfile) {
        businessProfile = user.businessProfile;
      }
    }

    const suggestions = await generateChatSuggestions(businessProfile);

    res.json({
      success: true,
      suggestions,
      personalized: !!businessProfile
    });
  } catch (error) {
    console.error('Suggestions error:', error);
    res.json({
      success: true,
      suggestions: [
        "How can I improve my social media engagement?",
        "What content should I post this week?",
        "Help me create a marketing strategy"
      ]
    });
  }
});

module.exports = router;
