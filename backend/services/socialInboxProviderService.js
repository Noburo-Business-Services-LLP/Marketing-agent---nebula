const socialMediaAPI = require('./socialMediaAPI');

// Only Instagram and Facebook are set up for receiving and replying. Other platforms are shown as "not available yet".
const REPLY_PLATFORMS = ['instagram', 'facebook'];
const COMMENT_TYPES = ['comment', 'mention', 'reply'];

const NOT_AVAILABLE_YET = 'Replying here is not available yet. For now you can reply on Instagram and Facebook.';

function isReplyPlatform(platform) {
  return REPLY_PLATFORMS.includes(String(platform || '').toLowerCase());
}

// Plain wording only. The provider's own text goes to the log, never to the customer.
function plainError(kind, code) {
  const n = Number(code) || 0;
  if (n === 361) return 'Direct messages are not switched on for this account yet.';
  if (n === 362) return 'Please reconnect this account in Connected accounts, then try again.';
  if (n === 363) return 'We could not find that person to message. They may need to write to you first.';
  if (n === 215) return 'That comment could not be found. It may have been deleted.';
  return kind === 'comment'
    ? 'The reply could not be posted. Please try again in a moment.'
    : 'The message could not be sent. Please try again in a moment.';
}

function fail(error, extra = {}) {
  return { success: false, provider: 'local', error, ...extra };
}

/**
 * Send one reply through Ayrshare.
 * A comment is answered under the comment; a direct message is answered as a direct message.
 * This never falls back to creating a public post.
 * @param {object} args { user, conversation, body, messageType, commentId, recipientId }
 */
async function dispatchReply({ user, conversation, body, messageType, commentId, recipientId }) {
  const platform = String(conversation?.platform || '').toLowerCase();
  if (!isReplyPlatform(platform)) return fail(NOT_AVAILABLE_YET);

  const profileKey = user?.ayrshare?.profileKey || '';
  if (!profileKey) return fail('Please connect your social account first, then try again.');

  const text = String(body || '').trim();
  if (!text) return fail('The reply is empty.');

  const isComment = COMMENT_TYPES.includes(String(messageType || '').toLowerCase());

  if (isComment) {
    if (!commentId) return fail('We could not tell which comment this answers, so nothing was sent.');
    const result = await socialMediaAPI.replyToAyrshareComment({ profileKey, platform, commentId: String(commentId), text });
    if (!result?.success) {
      console.warn('[Inbox] comment reply failed:', result?.code || '', result?.error || '');
      return fail(plainError('comment', result?.code), { provider: 'ayrshare', code: result?.code || 0 });
    }
    return { success: true, provider: 'ayrshare', providerResponse: { id: result.replyId || '' }, error: '' };
  }

  const toId = recipientId || conversation?.participantId || '';
  if (!toId || toId === 'unknown') return fail('We could not tell who to send this message to, so nothing was sent.');
  const result = await socialMediaAPI.sendAyrshareDirectMessage({ profileKey, platform, recipientId: String(toId), text });
  if (!result?.success) {
    console.warn('[Inbox] direct message failed:', result?.code || '', result?.error || '');
    return fail(plainError('message', result?.code), { provider: 'ayrshare', code: result?.code || 0 });
  }
  return { success: true, provider: 'ayrshare', providerResponse: { id: result.messageId || '' }, error: '' };
}

module.exports = {
  dispatchReply,
  isReplyPlatform,
  REPLY_PLATFORMS,
  NOT_AVAILABLE_YET
};
