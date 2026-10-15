// How the paid plans and add-ons are presented and wired to Razorpay.
// Prices, Quarks and add-on rules live in config/apiCosts.js (one place the
// owner edits); this file only holds names, copy and environment variable names.

const PLAN_PRESENTATION = {
  starter: {
    name: 'Starter',
    description: 'Posts and short videos for one business, every month.',
    extraFeatures: [],
    envVar: 'RAZORPAY_PLAN_ID_STARTER'
  },
  professional: {
    name: 'Growth',
    description: 'Over three times the output, for businesses that post every day.',
    extraFeatures: ['Up to 5 team members'],
    envVar: 'RAZORPAY_PLAN_ID_PROFESSIONAL'
  }
};

const ADDON_ENV_VARS = {
  publish: 'RAZORPAY_PLAN_ID_ADDON_PUBLISH',
  competitors: 'RAZORPAY_PLAN_ID_ADDON_COMPETITORS',
  inbox: 'RAZORPAY_PLAN_ID_ADDON_INBOX',
  bundle: 'RAZORPAY_PLAN_ID_ADDON_BUNDLE'
};

// Names that appear on invoices (Zoho Books). GST is its own 18 percent line.
const INVOICE_ITEMS = {
  plan: 'Nebulaa subscription',
  addon: 'Nebulaa add-on',
  topup: 'Nebulaa Quarks'
};

module.exports = { PLAN_PRESENTATION, ADDON_ENV_VARS, INVOICE_ITEMS };
