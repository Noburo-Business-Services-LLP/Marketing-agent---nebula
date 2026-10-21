// How the paid plans and add-ons are presented and wired to Razorpay.
// Prices, Quarks and add-on rules live in config/apiCosts.js (one place the
// owner edits); this file only holds names, copy and environment variable names.

const PLAN_PRESENTATION = {
  starter: {
    name: 'Starter',
    description: 'Marketing for one business, planned, made and improved every month.',
    extraFeatures: [],
    envVar: 'RAZORPAY_PLAN_ID_STARTER'
  },
  professional: {
    name: 'Growth',
    description: 'More room each month, for businesses that market every day.',
    extraFeatures: ['Up to 5 team members'],
    envVar: 'RAZORPAY_PLAN_ID_PROFESSIONAL'
  },
  agency: {
    name: 'Agency',
    description: 'Run the marketing of several client brands from one account, with one shared pool of Quarks.',
    extraFeatures: ['5 client brands included', 'Publishing, inbox and competitor insights included', 'Usage report for each client'],
    envVar: 'RAZORPAY_PLAN_ID_AGENCY'
  }
};

const ADDON_ENV_VARS = {
  publish: 'RAZORPAY_PLAN_ID_ADDON_PUBLISH',
  competitors: 'RAZORPAY_PLAN_ID_ADDON_COMPETITORS',
  inbox: 'RAZORPAY_PLAN_ID_ADDON_INBOX',
  bundle: 'RAZORPAY_PLAN_ID_ADDON_BUNDLE'
};

// The extra client slot (Agency plan) is its own monthly subscription with its own Razorpay plan.
const SLOT_ENV_VAR = 'RAZORPAY_PLAN_ID_SLOT';

// Names that appear on invoices (Zoho Books). GST is its own 18 percent line.
const INVOICE_ITEMS = {
  plan: 'Nebulaa subscription',
  agency: 'Nebulaa Agency subscription',
  addon: 'Nebulaa add-on',
  slot: 'Nebulaa extra client',
  topup: 'Nebulaa Quarks'
};

module.exports = { PLAN_PRESENTATION, ADDON_ENV_VARS, SLOT_ENV_VAR, INVOICE_ITEMS };
