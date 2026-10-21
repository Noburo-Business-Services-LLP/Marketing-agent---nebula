'use strict';
/**
 * The demo account's "connected" social accounts: stored in the user's own `ayrshare` fields, which /social/status,
 * Home and Performance read. The profile key starts with `demo-`, so the app answers every provider read from these
 * stored values and never calls the provider for this account (services/demoProfile.js, decision D101).
 * No profile link is stored: a fictional handle might belong to a real person on the real network.
 */
const { BRAND, SOCIALS } = require('./constants');
const { PROFILE_KEY, DEMO_TAG } = require('./safety');

const DAY = 24 * 60 * 60 * 1000;

/** The `ayrshare` sub-document. `connectedAt` is when the accounts were linked (the day after sign-up). */
function buildAyrshare({ connectedAt, avatarUrl = '', now = new Date() }) {
  return {
    profileKey: PROFILE_KEY,
    refId: DEMO_TAG,
    title: `${BRAND.name} (demo)`,
    createdAt: connectedAt,
    activeSocialAccounts: SOCIALS.map((s) => s.platform),
    displayNames: SOCIALS.map((s, i) => ({
      platform: s.platform,
      username: s.username,
      displayName: s.displayName,
      userImage: avatarUrl,
      created: new Date(connectedAt.getTime() + i * 6 * 60 * 1000).toISOString(),
      analytics: { ...s.analytics }
    })),
    lastCheckedAt: now,
    lastError: ''
  };
}

const connectedAtFor = (createdAt) => new Date(createdAt.getTime() + DAY);

module.exports = { buildAyrshare, connectedAtFor };
