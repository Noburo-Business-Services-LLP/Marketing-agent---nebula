'use strict';
/**
 * Where a customer's data lives, and what happens to each place when they ask to be deleted or to download their data.
 * Export and deletion both read this list. A test fails when a model that refers to a user is missing from it, so a
 * new feature cannot quietly leave a customer's data behind.
 *
 * action:
 *   delete     erased when the account is deleted, and included in the export
 *   anonymise  kept for our own records, but the link to the person is removed
 *   retain     kept because the law requires it (tax invoices), apart from the account, used for nothing else
 * `field` is the field that holds the customer's id in that collection (for models that refer to a user in more than one way,
 * `also` lists the other fields that point at the same customer).
 */
const RETENTION_YEARS = 8; // tax and company records: to be confirmed by the accountant

const D = 'delete';
const RULES = [
  { model: 'AIBrandMemory', field: 'userId', action: D },
  { model: 'AICampaignHistory', field: 'userId', action: D },
  { model: 'AIContentPerformance', field: 'userId', action: D },
  { model: 'AIVideoMemory', field: 'userId', action: D },
  { model: 'AdCampaign', field: 'userId', action: D },
  { model: 'AnalyticsSnapshot', field: 'userId', action: D },
  { model: 'AutoReplySettings', field: 'userId', action: D },
  { model: 'Blueprint', field: 'userId', action: D },
  { model: 'BrandAsset', field: 'user', action: D },
  { model: 'BrandIntelligenceProfile', field: 'userId', action: D },
  { model: 'BrandProfile', field: 'userId', action: D },
  { model: 'CachedCampaign', field: 'userId', action: D },
  { model: 'Campaign', field: 'userId', action: D },
  { model: 'CampaignPlan', field: 'userId', action: D },
  { model: 'ClientInvoice', field: 'client', action: 'retain', note: 'Invoices we made for a managed client: tax records.' },
  { model: 'Collaboration', field: 'userId', action: D },
  { model: 'Competitor', field: 'userId', action: D },
  { model: 'CompetitorReadLog', field: 'userId', action: D },
  { model: 'CompetitorSnapshot', field: 'userId', action: D },
  { model: 'ContentCalendar', field: 'userId', action: D },
  { model: 'ContentDraft', field: 'userId', action: D },
  { model: 'ContentIdea', field: 'userId', action: D },
  { model: 'CreateUpload', field: 'user', action: D },
  { model: 'CsmSession', field: 'client', also: ['csm'], action: D },
  { model: 'DashboardCache', field: 'userId', action: D },
  { model: 'Draft', field: 'userId', action: D },
  { model: 'EmailCampaign', field: 'userId', action: D },
  { model: 'FeatureEvent', field: 'userId', action: D },
  { model: 'HeroVideoJob', field: 'userId', action: D },
  { model: 'HomeDraft', field: 'userId', action: D, note: 'Home drafts from competitor posts: the request ledger, and the text of drafts that were shown. Removed after 30 days anyway.' },
  { model: 'Influencer', field: 'userId', action: D },
  { model: 'InfluencerAnalytics', field: 'userId', action: D },
  { model: 'Insight', field: 'userId', action: D },
  { model: 'ListeningBatchLog', field: 'userId', action: D },
  { model: 'ListeningScore', field: 'userId', action: D },
  { model: 'ListeningWeekly', field: 'userId', action: D },
  { model: 'MentionLog', field: 'userId', action: D },
  { model: 'Notification', field: 'userId', action: D },
  { model: 'OnboardingContext', field: 'userId', action: D },
  { model: 'PhotoshootJob', field: 'user', action: D, note: 'Photoshoot jobs and the links to their photos (the photo files are found by the image cleanup like other generated pictures).' },
  { model: 'Product', field: 'user', action: D },
  { model: 'PromptOverride', field: 'user', action: D },
  { model: 'QuarkLedger', field: 'user', action: D, note: 'Found by account only. An agency\'s rows tagged with a client (workspace) belong to the agency pool and are kept when that client is removed; they go when the agency is deleted.' },
  { model: 'Reminder', field: 'userId', action: D },
  { model: 'ScrapeJob', field: 'userId', action: D },
  { model: 'SeoReport', field: 'userId', action: D },
  { model: 'SocialInboxConversation', field: 'userId', action: D, note: 'Includes messages from the customer\'s own customers.' },
  { model: 'SocialInboxMessage', field: 'userId', action: D },
  { model: 'SocialPostAttempt', field: 'userId', action: D },
  { model: 'SocialSnapshot', field: 'userId', action: D },
  { model: 'StaffAction', field: 'client', action: 'anonymise', note: 'Our own audit trail of what staff did; the link to the customer is removed.' },
  { model: 'StudioVideo', field: 'user', action: D },
  { model: 'Submission', field: 'userId', action: D },
  { model: 'Trend', field: 'userId', action: D },
  { model: 'VideoDraft', field: 'userId', action: D },
  { model: 'VideoJob', field: 'userId', action: D },
  { model: 'WeeklyProposal', field: 'userId', action: D }
];

// Models that do not hold a customer's data, so they need no rule. Anything not listed here and not in RULES fails the test.
const NOT_CUSTOMER_DATA = [
  'AiSpendDay', 'AiSwitch', 'AyrshareApiCall', 'Coupon',
  'User', // the account itself: handled by the deletion steps, not as a collection
  'Analytics' // legacy, unused
];

const ruleFor = (model) => RULES.find((r) => r.model === model) || null;

/** The query that finds one customer's documents in a collection. */
function filterFor(rule, userId) {
  const fields = [rule.field, ...(rule.also || [])];
  return fields.length === 1 ? { [rule.field]: userId } : { $or: fields.map((f) => ({ [f]: userId })) };
}

/** Names of collections that are erased (for the export and the deletion). */
const erasable = () => RULES.filter((r) => r.action === 'delete');

module.exports = { RULES, NOT_CUSTOMER_DATA, RETENTION_YEARS, ruleFor, filterFor, erasable };
