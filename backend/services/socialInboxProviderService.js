const { postToSocialMedia } = require('./socialMediaAPI');

function getAyrsharePlatform(platform) {
  if (platform === 'x') return 'twitter';
  return platform;
}

async function dispatchReply({ user, conversation, body }) {
  const platform = getAyrsharePlatform(conversation.platform);
  const profileKey = user?.ayrshare?.profileKey || '';

  if (!profileKey) {
    return {
      success: false,
      provider: 'local',
      error: 'No connected Ayrshare profile key is available for provider reply dispatch.'
    };
  }

  // Ayrshare can post public replies/comments for supported platform post workflows.
  // True DMs and provider-specific comment reply IDs require per-platform APIs/scopes.
  const permalink = conversation.messages?.slice(-1)?.[0]?.permalink || '';
  const replyText = permalink ? `${body}\n\n${permalink}` : body;
  const result = await postToSocialMedia([platform], replyText, { profileKey });

  return {
    success: Boolean(result?.success),
    provider: 'ayrshare',
    providerResponse: result?.data || null,
    error: result?.error || ''
  };
}

module.exports = {
  dispatchReply
};
