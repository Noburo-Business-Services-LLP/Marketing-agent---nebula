'use strict';
/**
 * The demo brand's Inbox: 25 conversations (comments and direct messages) on Instagram, Facebook and YouTube, the three
 * networks the app's Inbox can reply on. WhatsApp and Google reviews are not part of the Inbox model: WhatsApp has no
 * place in it, and Google reviews are read live from the provider (services/googleReviews.js), which a demo account never
 * reaches, so that panel stays "not connected" for this account (decision D119).
 *
 * Method (D114): the customer messages are written by hand as RAW rows; everything the app works out is worked out by the
 * app's own pure function (socialInboxService.analyzeEngagement: sentiment, priority, lead and spam scores, and the
 * general reply suggestions). The drafted replies are written by hand (no model call is made, nothing is charged).
 *
 * The settings are "approval before sending": direct messages get a drafted reply that waits for a yes (3 wait now); the
 * comment channel is suggest-only, so unanswered comments carry suggestions only. Replies already sent went out through
 * the app's usual path (the same signature, sender and status fields); four of them were drafted and then approved.
 * 7 conversations are unread (what Home counts), 5 read, 11 replied, 2 closed.
 */
const mongoose = require('mongoose');
const { analyzeEngagement } = require('../../services/socialInboxService');

const HOUR = 3600000;
const SIGNATURE = '- Team Zaya';

// ago: hours before now of the first message; later messages are `plus` minutes after the one before.
const C = (n, platform, type, name, user, status, ago, msgs, extra = {}) => ({ n, platform, type, name, user, status, ago, msgs, ...extra });
const cu = (text, plus = 0) => ({ from: 'customer', text, plus });
const ow = (text, plus = 90) => ({ from: 'owner', text, plus });

/** The 25 conversations, newest first. `pending` = a drafted reply waiting for a yes. `approved` = drafted, approved and sent. */
const SCRIPT = [
  // ---- unread (7)
  C(1, 'instagram', 'dm', 'Priya Sundar', 'priya_sundar_92', 'unread', 3.2, [cu('Hi! Which shade of the Tinted Mineral SPF would suit medium-wheatish skin? I am in Bengaluru and the sun is brutal right now')],
    { pending: { draft: 'Hi Priya! The Tinted Mineral SPF 40 has one sheer tint made to blend into most Indian skin tones, medium-wheatish included, with no white cast. It also sits well under makeup.', reason: 'Approval required mode' } }),
  C(2, 'facebook', 'dm', 'Ramesh Kumar', '', 'unread', 5.5, [cu('Very disappointed. The Kumkumadi serum I got today has a broken seal and the oil leaked inside the box. I want a refund or a replacement.')],
    { pending: { draft: 'We are so sorry about this, Ramesh. Please send us your order number and a photo of the box and the bottle, and we will arrange a replacement for you right away.', reason: 'Negative sentiment requires approval' } }),
  C(3, 'instagram', 'dm', 'Neha Gupta', 'neha.gupta.salon', 'unread', 20, [cu('Hi Zaya team, mujhe apne salon ke liye bulk mein chahiye: Hair Oil aur Face Mask, around 60 pieces each. Kya bulk pricing available hai? GST invoice bhi chahiye.')],
    { pending: { draft: 'Namaste Neha! Thank you for thinking of Zaya for your salon. We do take bulk orders. Could you share your city and the quantities, and our team will send you a quote with a GST invoice?', reason: 'Approval required mode' } }),
  C(4, 'instagram', 'comment', 'Kavitha Ramesh', 'kavitha.r_chennai', 'unread', 9, [cu('Intha hair oil romba nalla irukku! Smell kooda lovely. Chennai la shop irukka? 😍')],
    { post: { n: 38, kind: 'reel' }, suggest: 'Nandri Kavitha! 💜 Right now we are online only, on our website and the big marketplaces, but we love pop-ups and will announce the next Chennai one here.' }),
  C(5, 'instagram', 'comment', 'Ananya Iyer', 'ananya.iyer.glow', 'unread', 14, [cu('Been using the Kumkumadi serum for a month and my skin looks so even. Obsessed 😍')],
    { post: { n: 29, kind: 'post' }, suggest: 'This made our day, Ananya! Thank you for sharing. 🌿 Keep going with the night ritual, three drops is all it needs.' }),
  C(6, 'facebook', 'comment', 'Suresh Menon', '', 'unread', 28, [cu('Ordered 6 days ago and the tracking still says packed. Any update please?')],
    { post: { n: 33, kind: 'post' }, suggest: 'Sorry for the wait, Suresh. Please message us your order number and we will check with the courier today.' }),
  C(7, 'youtube', 'comment', 'Lakshmi R', '', 'unread', 40, [cu('Lovely video! Can you make one on how to use the night cream?')],
    { post: { n: 21, kind: 'reel' }, suggest: 'Thank you, Lakshmi! A how-to for the Bakuchi Night Repair Cream is on our list. Stay tuned.' }),
  // ---- read, not replied (5)
  C(8, 'instagram', 'comment', 'Divya Nair', 'divya.nair.skin', 'read', 60, [cu('Is the toner alcohol free?')],
    { post: { n: 27, kind: 'post' }, suggest: 'Yes Divya, the Rose Petal Toner is alcohol-free: steam-distilled rose water, aloe and glycerin. 🌹' }),
  C(9, 'instagram', 'dm', 'Meera Nair', 'meeranair_kochi', 'read', 74, [cu('Do you ship to Kochi? And how many days does it usually take?')],
    { suggest: 'Hi Meera! Yes, we ship across India. Delivery to Kochi usually takes a few working days, and you will get tracking as soon as it ships.' }),
  C(10, 'facebook', 'comment', 'Arjun Das', '', 'read', 84, [cu('Price of the face mask?')],
    { post: { n: 24, kind: 'post' }, suggest: 'Hi Arjun! The Saffron and Sandal Face Mask (100 g) is Rs 749 on our website.' }),
  C(11, 'instagram', 'comment', 'earnmoney_fast_01', 'earnmoney_fast_01', 'read', 96, [cu('Work from home and earn guaranteed income daily! Click here to join 👉')],
    { post: { n: 30, kind: 'post' }, suggest: '' }),
  C(12, 'instagram', 'dm', 'Sanjana Rao', 'sanjana.glows', 'read', 118, [cu('Hi! I am a skincare creator in Hyderabad (18k followers). I would love to try your products and make a reel. Is there a gifting or collaboration programme? Please share an email.')],
    { suggest: 'Hi Sanjana, thank you for reaching out! We do work with creators. Could you share your profile link and what you have in mind? Our team will get back to you with the details.' }),
  // ---- replied (11)
  C(13, 'instagram', 'comment', 'Ishita Verma', 'ishita.verma', 'replied', 146, [cu('Honestly the best face mask I have tried. The saffron smell is so calming ✨'), ow('Thank you so much, Ishita! 💜 So happy it is part of your Sunday ritual.', 55)],
    { post: { n: 24, kind: 'post' } }),
  C(14, 'instagram', 'dm', 'Shalini Menon', 'shalini.menon', 'replied', 170, [cu('Is the Bakuchi night cream okay to use during pregnancy?'),
    ow('Great question, Shalini. Every skin and every pregnancy is different, so we would suggest showing the full ingredient list (it is on the product page) to your doctor before using any new product.', 130)], { approved: true }),
  C(15, 'facebook', 'comment', 'Murugan S', '', 'replied', 190, [cu('சூப்பர் product! Parcel ரொம்ப fast-a vandhuchu 👍'), ow('Romba nandri Murugan! 🙏 Happy you liked it.', 70)],
    { post: { n: 20, kind: 'post' } }),
  C(16, 'instagram', 'dm', 'Rhea Kapoor', 'rhea.kapoor.k', 'replied', 215, [cu('Hi, I placed an order on Monday. Where can I check the status?'),
    ow('Hi Rhea! You will find a tracking link in the shipping email we sent. If you cannot see it, send us your order number and we will share the status right here.', 45)]),
  C(17, 'instagram', 'comment', 'Tanvi Shah', 'tanvi_shah_', 'replied', 240, [cu('Which one is better for oily skin, the neem cleanser or the rose toner?'),
    ow('Hi Tanvi! They do different jobs: the Neem and Turmeric Cleanser washes the day away, and the Rose Petal Toner refreshes after. For oily skin, many people use both. 🌿', 100)],
    { post: { n: 18, kind: 'post' } }),
  C(18, 'instagram', 'dm', 'Rohit Malhotra', 'rohit_malhotra_17', 'replied', 262, [cu('Diwali ke liye gift box available hai kya? Meri behen ko skincare gift karna hai'),
    ow('Namaste Rohit! Festive gift sets are on the way, we will announce them here first. For now the Lip Balm Trio (Rs 399) is our favourite small gift.', 80)]),
  C(19, 'facebook', 'dm', 'Deepa Krishnan', '', 'replied', 288, [cu('Do you have a return policy if the product does not suit my skin?'),
    ow('Hi Deepa! You will find our return and exchange details on the policy page of our website. If anything feels off, message us and we will help.', 120)], { approved: true }),
  C(20, 'instagram', 'comment', 'Fatima Sheikh', 'fatima.sheikh.04', 'replied', 310, [cu('Loved the unboxing reel! The packaging is so pretty 💜'), ow('Thank you Fatima! Every box is packed by hand in Chennai. 🌸', 65)],
    { post: { n: 14, kind: 'reel' } }),
  C(21, 'youtube', 'comment', 'Gautham N', '', 'replied', 350, [cu('Nice explanation of kumkumadi oil. Where can I buy it?'), ow('Thanks Gautham! You can order from our website, zayanaturals.example, or on the big marketplaces.', 180)],
    { post: { n: 9, kind: 'reel' } }),
  C(22, 'instagram', 'dm', 'Pooja Reddy', 'pooja.reddy.97', 'replied', 380, [cu('Can I use the face mask twice a week?'),
    ow('Hi Pooja! Yes, twice a week is how most of our customers use it: apply, rest ten minutes, rinse with cool water. If your skin feels dry, once a week is fine too.', 150)], { approved: true }),
  C(23, 'instagram', 'dm', 'Aarthi Manikandan', 'aarthi_mani', 'replied', 410, [cu('Hair oil use pannalama ennoda kids ku? 6 years paiyan'),
    ow('Hi Aarthi! Our Coconut and Hibiscus Hair Oil is made for everyone. For children we suggest a small patch test first, and use a little at a time.', 95)], { approved: true }),
  // ---- closed (2)
  C(24, 'instagram', 'comment', 'Vikram Joshi', 'vikram.joshi.mumbai', 'closed', 460, [cu('My order came 5 days late and nobody told me. Not happy.'),
    ow('We are sorry, Vikram. That is not the experience we want for you. Please send us your order number so we can look into what happened and make it right.', 80),
    cu('Sent in DM. Thanks for responding.', 240), ow('Thank you, we have received it and sent you a thank-you code for your next order. 💜', 100)], { post: { n: 11, kind: 'post' } }),
  C(25, 'facebook', 'dm', 'Swapna Pillai', '', 'closed', 520, [cu('I received the hair oil but my order had a lip balm trio missing. Can you check?'),
    ow('Hi Swapna, sorry about that. Please share a photo of the parcel and your order number and we will sort it out.', 60),
    cu('Order number ZN-20418, photo attached.', 180), ow('Thank you! We have shipped the missing Lip Balm Trio today. You will get the tracking by email.', 120)])
];

/** The three Inbox settings screens read these: approval before sending, direct messages on, comments suggest-only. */
function settingsRow(userId, now) {
  return {
    userId, workspaceId: 'default', enabled: true, automationMode: 'approval_required',
    channels: { messages: true, comments: false, mentions: false, replies: false },
    platforms: { instagram: true, facebook: true, linkedin: false, x: false, youtube: false },
    businessTone: 'friendly', replyStyle: 'friendly',
    responseRules: [{ name: 'Bulk and wholesale questions', enabled: true, matchType: 'contains', value: 'bulk', action: 'needs_approval', priority: 5 }],
    channelOverrides: [],
    guardrails: { requireApprovalForNegative: true, requireApprovalForHighPriority: true, skipSpam: true, maxAutoRepliesPerConversationPerDay: 3, signature: SIGNATURE },
    createdAt: new Date(now.getTime() - 60 * 24 * HOUR), updatedAt: new Date(now.getTime() - 6 * 24 * HOUR)
  };
}

const withSig = (t) => `${t}\n\n${SIGNATURE}`;
const pad = (n, w = 2) => String(n).padStart(w, '0');

/**
 * The rows. Returns { conversations, messages, settings, counts } as plain objects ready for validateSync / insertMany.
 * `userId` (ObjectId), `now` (Date).
 */
function build({ userId, now }) {
  const conversations = []; const messages = [];
  const accountOf = { instagram: 'demo-zaya-ig', facebook: 'demo-zaya-fb', youtube: 'demo-zaya-yt' };
  let msgNo = 0;
  for (const c of SCRIPT) {
    const threadId = `demo-zaya-thread-${pad(c.n)}`;
    const convoId = new mongoose.Types.ObjectId();
    let at = now.getTime() - c.ago * HOUR;
    const rows = []; const embedded = [];
    const inbound = c.msgs.filter((m) => m.from === 'customer');
    const lastInbound = inbound[inbound.length - 1];
    let latestScores = null;
    for (const m of c.msgs) {
      at += (m.plus || 0) * 60000;
      if (at > now.getTime() - 10 * 60000) at = now.getTime() - 10 * 60000; // nothing is dated in the future
      msgNo += 1;
      const createdAt = new Date(at);
      const idStr = `demo-zaya-msg-${pad(msgNo, 3)}`;
      if (m.from === 'customer') {
        const ins = analyzeEngagement(m.text);
        latestScores = ins;
        const isLast = m === lastInbound;
        const unanswered = isLast && ['unread', 'read'].includes(c.status);
        const sentLater = c.status === 'replied' || c.status === 'closed';
        let ai = { suggestedReplies: [], autoReplyCandidate: '', autoReplyStatus: 'none', autoReplyReason: '', sendAttempts: 0, generatedAt: null, draftSource: '' };
        const draftFor = c.pending ? c.pending.draft : c.suggest;
        const ownerReply = (c.msgs[c.msgs.indexOf(m) + 1] || {}).text;
        if (c.pending) {
          ai = { suggestedReplies: [c.pending.draft, ...ins.suggestions.slice(0, 2)], autoReplyCandidate: c.pending.draft, autoReplyStatus: 'pending_approval', autoReplyReason: c.pending.reason, sendAttempts: 0, generatedAt: new Date(at + 60000), draftSource: 'ai' };
        } else if (unanswered && draftFor) {
          ai = { suggestedReplies: [draftFor, ...ins.suggestions.slice(0, 2)], autoReplyCandidate: draftFor, autoReplyStatus: 'suggested', autoReplyReason: 'Auto reply disabled for this platform/channel', sendAttempts: 0, generatedAt: new Date(at + 60000), draftSource: 'ai' };
        } else if (unanswered) {
          // spam: the app skips it
          ai = { suggestedReplies: [], autoReplyCandidate: '', autoReplyStatus: 'skipped', autoReplyReason: 'Skipped spam-like message', sendAttempts: 0, generatedAt: new Date(at + 60000), draftSource: '' };
        } else if (sentLater && ownerReply) {
          ai = { suggestedReplies: [ownerReply, ...ins.suggestions.slice(0, 2)], autoReplyCandidate: ownerReply, autoReplyStatus: c.approved ? 'sent' : 'suggested', autoReplyReason: c.approved ? 'Approved and sent' : 'Auto reply disabled for this platform/channel', sendAttempts: c.approved ? 1 : 0, generatedAt: new Date(at + 60000), draftSource: 'ai' };
        }
        rows.push({
          userId, conversationId: convoId, platform: c.platform, socialAccountId: accountOf[c.platform], providerThreadId: threadId, providerMessageId: idStr,
          providerParentId: '', postId: c.post ? `demo-zaya-post-${c.post.n}` : '', commentId: c.type === 'comment' ? idStr : '', parentCommentId: '',
          platformPostType: c.post ? c.post.kind : '', direction: 'inbound', senderType: 'customer', autoSent: false, messageType: c.type === 'comment' ? 'comment' : 'dm', status: 'sent', errorMessage: '',
          authorId: `demo-zaya-user-${pad(c.n)}`, authorName: c.name, body: m.text, mediaUrls: [], permalink: '',
          sentiment: ins.sentiment, spamScore: ins.spamScore, leadScore: ins.leadScore, engagementScore: ins.engagementScore, priority: ins.priority,
          ai, autoReplied: false, rawPayload: { demo: true }, createdAt, updatedAt: createdAt
        });
      } else {
        rows.push({
          userId, conversationId: convoId, platform: c.platform, socialAccountId: accountOf[c.platform], providerThreadId: threadId, providerMessageId: idStr,
          providerParentId: '', postId: c.post ? `demo-zaya-post-${c.post.n}` : '', commentId: '', parentCommentId: '', platformPostType: c.post ? c.post.kind : '',
          direction: 'outbound', senderType: 'agent', autoSent: false, messageType: 'reply', status: 'sent', errorMessage: '', authorId: 'nebulaa', authorName: 'Nebulaa',
          body: withSig(m.text), mediaUrls: [], permalink: '', sentiment: 'neutral', spamScore: 0, leadScore: 0, engagementScore: 0, priority: 'normal',
          ai: { suggestedReplies: [], autoReplyCandidate: '', autoReplyStatus: 'none', autoReplyReason: '', sendAttempts: 0, generatedAt: null, draftSource: '' },
          autoReplied: false, rawPayload: { dispatch: { success: true, provider: 'demo', code: 0 } }, createdAt, updatedAt: createdAt
        });
      }
    }
    for (const r of rows) {
      embedded.push({
        providerMessageId: r.providerMessageId, providerParentId: '', direction: r.direction, senderType: r.senderType, autoSent: false, messageType: r.messageType, status: 'sent',
        errorMessage: '', authorId: r.authorId, authorName: r.authorName, body: r.body, mediaUrls: [], permalink: '', sentiment: r.sentiment, spamScore: r.spamScore, rawPayload: r.rawPayload, createdAt: r.createdAt
      });
    }
    const last = rows[rows.length - 1];
    const unread = c.status === 'unread';
    conversations.push({
      _id: convoId, userId, platform: c.platform, socialAccountId: accountOf[c.platform], providerThreadId: threadId, participantId: `demo-zaya-user-${pad(c.n)}`,
      participantName: c.name, participantUsername: c.user, avatarUrl: '', assignedUserId: null, workspaceId: 'default', subject: '',
      lastMessagePreview: last.body.slice(0, 500), lastMessageAt: last.createdAt, status: c.status,
      priority: latestScores.priority, tags: [], sentiment: latestScores.sentiment, spamScore: latestScores.spamScore, leadScore: latestScores.leadScore, engagementScore: latestScores.engagementScore,
      messageTypes: [c.type === 'comment' ? 'comment' : 'dm', ...(rows.some((r) => r.direction === 'outbound') ? ['reply'] : [])],
      unreadCount: unread ? 1 : 0, webhookRegistered: true, lastSyncedAt: last.createdAt, messages: embedded,
      createdAt: rows[0].createdAt, updatedAt: last.createdAt
    });
    messages.push(...rows);
  }
  const count = (f) => conversations.filter(f).length;
  return {
    conversations, messages, settings: settingsRow(userId, now),
    counts: {
      conversations: conversations.length, unread: count((c) => c.status === 'unread'), read: count((c) => c.status === 'read'), replied: count((c) => c.status === 'replied'), closed: count((c) => c.status === 'closed'),
      pending: messages.filter((m) => m.ai && m.ai.autoReplyStatus === 'pending_approval').length, messages: messages.length
    }
  };
}

module.exports = { SCRIPT, SIGNATURE, build, settingsRow };
