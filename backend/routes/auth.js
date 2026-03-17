const express = require('express');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const User = require('../models/User');
const { generateToken, protect } = require('../middleware/auth');

const router = express.Router();

// Demo mode flag: when MONGODB_URI is missing or clearly a placeholder, skip DB and use in-memory users
const isDemoMode =
  !process.env.MONGODB_URI ||
  process.env.MONGODB_URI.includes('your_mongodb_connection_string_here');
const demoUsers = new Map(); // email -> { email, password, firstName, lastName, companyName, onboardingCompleted, businessProfile, connectedSocials }

// Fail-fast when DB isn't connected (prevents Mongoose buffering timeouts)
// In demo mode (no MONGODB_URI), we allow requests through and handle them in-memory.
const requireDb = (req, res, next) => {
  if (isDemoMode) {
    return next();
  }
  if (mongoose.connection.readyState === 1) return next(); // connected
  return res.status(503).json({
    success: false,
    message: 'Database not connected. Please configure MONGODB_URI and restart the backend.'
  });
};

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: errors.array()[0].msg,
      errors: errors.array()
    });
  }
  next();
};

// @route   POST /api/auth/signup
// @desc    Register a new user
// @access  Public
router.post('/signup', [
  body('email')
    .isEmail()
    .withMessage('Please enter a valid email address')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/\d/)
    .withMessage('Password must contain at least one number')
    .matches(/[a-zA-Z]/)
    .withMessage('Password must contain at least one letter'),
  body('firstName')
    .trim()
    .notEmpty()
    .withMessage('First name is required')
    .isLength({ max: 50 })
    .withMessage('First name cannot exceed 50 characters'),
  body('companyName')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Company name cannot exceed 100 characters'),
  requireDb,
  handleValidationErrors
], async (req, res) => {
  try {
    const { email, password, firstName, lastName, companyName } = req.body;

    // Demo-mode auth: store users in memory without MongoDB
    if (isDemoMode) {
      const lowerEmail = email.toLowerCase();
      if (demoUsers.has(lowerEmail)) {
        return res.status(400).json({
          success: false,
          message: 'An account with this email already exists. Please sign in.'
        });
      }

      const demoUser = {
        _id: lowerEmail,
        email: lowerEmail,
        firstName,
        lastName: lastName || '',
        companyName: companyName || '',
        onboardingCompleted: false,
        businessProfile: {},
        connectedSocials: [],
      };
      demoUsers.set(lowerEmail, { ...demoUser, password });

      const token = `demo:${lowerEmail}`;

      return res.status(201).json({
        success: true,
        message: 'Account created successfully! (demo mode)',
        token,
        user: demoUser
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists. Please sign in.'
      });
    }

    // Create new user
    const user = await User.create({
      email: email.toLowerCase(),
      password,
      firstName,
      lastName: lastName || '',
      companyName: companyName || ''
    });

    // Generate token
    const token = generateToken(user._id);

    // Update last login
    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });

    res.status(201).json({
      success: true,
      message: 'Account created successfully! Welcome to Gravity.',
      token,
      user: user.toPublicJSON()
    });
  } catch (error) {
    console.error('Signup error:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists.'
      });
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const message = Object.values(error.errors).map(err => err.message).join('. ');
      return res.status(400).json({
        success: false,
        message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Unable to create account. Please try again later.'
    });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', [
  body('email')
    .isEmail()
    .withMessage('Please enter a valid email address')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  requireDb,
  handleValidationErrors
], async (req, res) => {
  try {
    const { email, password } = req.body;

    // Demo-mode auth: validate against in-memory users
    if (isDemoMode) {
      const lowerEmail = email.toLowerCase();
      const stored = demoUsers.get(lowerEmail);
      if (!stored || stored.password !== password) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password. Please try again.'
        });
      }

      const { password: _pw, ...publicUser } = stored;
      const token = `demo:${lowerEmail}`;
      return res.status(200).json({
        success: true,
        message: 'Welcome back! (demo mode)',
        token,
        user: publicUser
      });
    }

    // Find user and include password for comparison
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password. Please try again.'
      });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Your account has been deactivated. Please contact support.'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password. Please try again.'
      });
    }

    // Generate token
    const token = generateToken(user._id);

    // Update last login
    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: 'Welcome back!',
      token,
      user: user.toPublicJSON()
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to sign in. Please try again later.'
    });
  }
});

// @route   GET /api/auth/me
// @desc    Get current logged in user
// @access  Private
router.get('/me', protect, requireDb, async (req, res) => {
  try {
    if (isDemoMode) {
      const email = req.demoEmail || (req.user && req.user.email);
      const stored = email ? demoUsers.get(email.toLowerCase()) : null;
      if (!stored) {
        return res.status(404).json({
          success: false,
          message: 'User not found (demo mode)'
        });
      }
      const { password, ...publicUser } = stored;
      return res.status(200).json({
        success: true,
        user: publicUser
      });
    }

    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      user: user.toPublicJSON()
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to fetch user data'
    });
  }
});

// @route   PUT /api/auth/update-profile
// @desc    Update user profile
// @access  Private
router.put('/update-profile', protect, [
  body('firstName')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('First name cannot exceed 50 characters'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Last name cannot exceed 50 characters'),
  body('companyName')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Company name cannot exceed 100 characters'),
  requireDb,
  handleValidationErrors
], async (req, res) => {
  try {
    const allowedUpdates = ['firstName', 'lastName', 'companyName', 'avatar'];
    const updates = {};
    
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: user.toPublicJSON()
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to update profile'
    });
  }
});

// @route   PUT /api/auth/complete-onboarding
// @desc    Complete onboarding and save business profile
// @access  Private
router.put('/complete-onboarding', protect, requireDb, async (req, res) => {
  try {
    const { businessProfile, connectedSocials } = req.body;

    if (isDemoMode) {
      const email = req.demoEmail || (req.user && req.user.email);
      const key = email ? email.toLowerCase() : null;
      const stored = key ? demoUsers.get(key) : null;
      if (!stored) {
        return res.status(404).json({
          success: false,
          message: 'User not found (demo mode)'
        });
      }

      const updated = {
        ...stored,
        onboardingCompleted: true,
        businessProfile: businessProfile || stored.businessProfile || {},
        connectedSocials: Array.isArray(connectedSocials) && connectedSocials.length > 0
          ? connectedSocials.map(social => ({
              platform: social.platform,
              accountName: social.username || social.accountName,
              connectedAt: new Date()
            }))
          : (stored.connectedSocials || []),
      };

      demoUsers.set(key, updated);
      const { password, ...publicUser } = updated;

      console.log('Onboarding completed for demo user:', publicUser.email);
      console.log('Business Profile (demo):', JSON.stringify(publicUser.businessProfile, null, 2));

      return res.status(200).json({
        success: true,
        message: 'Onboarding completed successfully (demo mode)',
        user: publicUser
      });
    }

    const updateData = {
      onboardingCompleted: true,
      businessProfile: businessProfile || {}
    };

    // If connected socials are provided during onboarding, save them
    if (connectedSocials && Array.isArray(connectedSocials) && connectedSocials.length > 0) {
      updateData.connectedSocials = connectedSocials.map(social => ({
        platform: social.platform,
        accountName: social.username || social.accountName,
        connectedAt: new Date()
      }));
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateData,
      { new: true }
    );

    console.log('Onboarding completed for user:', user.email);
    console.log('Business Profile saved:', JSON.stringify(user.businessProfile, null, 2));

    res.status(200).json({
      success: true,
      message: 'Onboarding completed successfully',
      user: user.toPublicJSON()
    });
  } catch (error) {
    console.error('Complete onboarding error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to complete onboarding'
    });
  }
});

// @route   PUT /api/auth/change-password
// @desc    Change password
// @access  Private
router.put('/change-password', protect, [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters long')
    .matches(/\d/)
    .withMessage('New password must contain at least one number')
    .matches(/[a-zA-Z]/)
    .withMessage('New password must contain at least one letter'),
  requireDb,
  handleValidationErrors
], async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Get user with password
    const user = await User.findById(req.user._id).select('+password');

    // Check current password
    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    // Generate new token
    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
      token
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to change password'
    });
  }
});

// @route   POST /api/auth/logout
// @desc    Logout user (client-side token removal)
// @access  Private
router.post('/logout', protect, (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
});

module.exports = router;
