const express = require('express');
const router = express.Router();
const { protect, optionalAuth } = require('../middleware/auth');
const User = require('../models/User');
const { generateChatResponse, generateChatSuggestions } = require('../services/geminiAI');
const { deductCredits, ensureCreditCycle } = require('../middleware/creditGuard');

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
    let userId = null;
    if (req.user) {
      userId = req.user.userId || req.user.id || req.user._id;
      const user = await User.findById(userId);
      if (user) {
        businessProfile = user.businessProfile || null;
        
        // Credit check (0.5 per chat message)
        await ensureCreditCycle(user);
        if (user.credits.balance < 0.5) {
          return res.status(403).json({
            success: false,
            message: 'Insufficient credits',
            creditsRemaining: user.credits.balance,
            required: 0.5
          });
        }
      }
    }

    // Generate response using Gemini with business context
    const aiResponse = await generateChatResponse(message, businessProfile, conversationHistory);

    // Deduct credits if authenticated
    let creditsRemaining;
    if (userId) {
      const creditResult = await deductCredits(userId, 0.5, 'chat_message');
      creditsRemaining = creditResult.balance;
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
