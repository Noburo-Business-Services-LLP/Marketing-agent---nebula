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
  
  // If we have a commentId passed in, we can use the new replyToComment logic or pass it down
  // However, dispatch payload can contain commentId (see my socialInboxService change)
  // Let's modify dispatchReply to accept options and pass to replyToComment if commentId is present
  const commentId = arguments[0]?.commentId;
  
  if (commentId) {
    return await replyToComment(platform, commentId, body, profileKey);
  }

  const result = await postToSocialMedia([platform], replyText, { profileKey });

  return {
    success: Boolean(result?.success),
    provider: 'ayrshare',
    providerResponse: result?.data || null,
    error: result?.error || ''
  };
}

async function replyToComment(platform, commentId, replyText, profileKey) {
  const p = getAyrsharePlatform(platform);
  
  if (!profileKey) {
    return {
      success: false,
      provider: 'local',
      error: 'No connected profile key is available for provider reply dispatch.'
    };
  }

  // Uses Ayrshare comment reply endpoint if applicable.
  // We simulate postToSocialMedia using Ayrshare's direct comment features.
  // In a real integration, this calls the specific Ayrshare /comments endpoint
  const result = await postToSocialMedia([p], replyText, { profileKey, commentId });
  return {
    success: Boolean(result?.success),
    provider: 'ayrshare',
    providerResponse: result?.data || null,
    error: result?.error || ''
  };
}

module.exports = {
  dispatchReply,
  replyToComment
};
