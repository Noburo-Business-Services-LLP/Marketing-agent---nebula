/**
 * What the social-posting provider (Ayrshare) charges us. These are the numbers the owner gave and the
 * hand-over records (docs/superpowers/HANDOVER-nebulaa-redesign-3.md, section 5 item 2): the Business plan is
 * $599 a month, the first 30 profiles are included, each profile after that is $8.99, up to 100.
 * They are not read from the provider; change them here if the contract changes.
 */
const AYRSHARE = {
  planUsdPerMonth: 599,
  includedProfiles: 30,
  extraProfileUsd: 8.99,
  maxProfiles: 100
};

module.exports = { AYRSHARE };
