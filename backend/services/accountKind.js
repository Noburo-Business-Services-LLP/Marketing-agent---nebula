// The optional sign-up answer: one business, or several brands run for clients.
// Only these two answers are kept; anything else becomes empty (so a hand-made request cannot store other text).
const ACCOUNT_KINDS = ['one', 'several'];

function cleanAccountKind(profile) {
  if (!profile || typeof profile !== 'object' || !('accountKind' in profile)) return profile;
  const v = profile.accountKind;
  return { ...profile, accountKind: typeof v === 'string' && ACCOUNT_KINDS.includes(v) ? v : '' };
}

module.exports = { ACCOUNT_KINDS, cleanAccountKind };
