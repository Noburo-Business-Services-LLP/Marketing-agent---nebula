/**
 * The business name lives in two saved places: `businessProfile.name` (what the person edits) and
 * `companyName` (set at sign-up, shown in admin lists). Whenever the business profile name is saved,
 * the sign-up name follows it, so every screen shows the same name.
 */
function applyNameSync(updates) {
  const name = updates && updates.businessProfile && typeof updates.businessProfile === 'object'
    ? String(updates.businessProfile.name || '').trim()
    : '';
  if (name) updates.companyName = name.slice(0, 100);
  return updates;
}

module.exports = { applyNameSync };
