/**
 * EmailCampaign Model
 * 
 * Stores email campaigns with multi-stage follow-up sequences.
 * Each campaign can have initial message + multiple follow-ups.
 */

const mongoose = require('mongoose');

const emailMessageSchema = new mongoose.Schema({
  stage: {
    type: String,
    enum: ['initial', 'follow_up_1', 'follow_up_2', 'follow_up_3', 'follow_up_4'],
    required: true
  },
  subject: {
    type: String,
    required: true,
    trim: true
  },
  body: {
    type: String,
    required: true
  },
  delayDays: {
    type: Number,
    default: 0 // Days after previous message
  },
  isEdited: {
    type: Boolean,
    default: false
  }
});

const recipientSchema = new mongoose.Schema({
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true
  },
  email: {
    type: String,
    required: true
  },
  firstName: String,
  lastName: String,
  companyName: String,
  currentStage: {
    type: String,
    enum: ['pending', 'initial', 'follow_up_1', 'follow_up_2', 'follow_up_3', 'follow_up_4', 'completed', 'replied', 'bounced', 'unsubscribed'],
    default: 'pending'
  },
  sentAt: [{
    stage: String,
    timestamp: Date,
    messageId: String
  }],
  openedAt: [{
    stage: String,
    timestamp: Date
  }],
  repliedAt: Date,
  status: {
    type: String,
    enum: ['active', 'paused', 'completed', 'failed'],
    default: 'active'
  }
});

const emailCampaignSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  name: {
    type: String,
    required: true,
    trim: true
  },
  
  // Campaign type based on lead status/filter
  campaignType: {
    type: String,
    enum: ['cold_outreach', 'warm_lead', 'follow_up', 're_engagement', 'custom'],
    default: 'cold_outreach'
  },
  
  // Filter criteria used to select leads
  filterCriteria: {
    status: [String],
    source: [String],
    tags: [String],
    leadIds: [mongoose.Schema.Types.ObjectId]
  },
  
  // Email messages for each stage
  messages: [emailMessageSchema],
  
  // Recipients
  recipients: [recipientSchema],
  
  // Sender info
  sender: {
    email: {
      type: String,
      required: true
    },
    name: String,
    replyTo: String
  },
  
  // Campaign status
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'active', 'paused', 'completed'],
    default: 'draft'
  },
  
  // Schedule
  scheduledAt: Date,
  startedAt: Date,
  completedAt: Date,
  
  // Stats
  stats: {
    totalRecipients: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    opened: { type: Number, default: 0 },
    replied: { type: Number, default: 0 },
    bounced: { type: Number, default: 0 },
    unsubscribed: { type: Number, default: 0 }
  }
  
}, {
  timestamps: true
});

// Index for efficient queries
emailCampaignSchema.index({ userId: 1, status: 1 });
emailCampaignSchema.index({ 'recipients.leadId': 1 });

module.exports = mongoose.model('EmailCampaign', emailCampaignSchema);
