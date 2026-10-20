// Limits on the model-written reply drafts in the Inbox, so a flood of incoming messages cannot run up provider cost.
// A message beyond a limit is still stored and shown; it just has no drafted reply ("Draft paused for now").
module.exports = {
  DRAFTS_PER_ACCOUNT_PER_DAY: 200, // counted per India day (IST)
  DRAFTS_PER_CONVERSATION_PER_HOUR: 10,
  DRAFT_PAUSED_NOTE: 'Draft paused for now',
  SPEND_ACTION: 'campaign_text'
};
