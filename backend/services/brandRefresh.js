const { resolveBrandIdentity } = require('./brandMemory');

/**
 * Bring the saved brand profile in line with what the owner has typed in
 * Settings. Settings always win; a fresh website read only fills a description
 * that Settings left empty. Returns the names of the fields that changed, so
 * the screen can say what was updated. The caller saves the document.
 */
function alignProfileToSettings(profile, { bp = {}, user = {} } = {}, site = null) {
  const changed = [];
  const identity = resolveBrandIdentity({ bp, user, brandProfile: null });
  const name = identity.name === 'Not set' ? '' : identity.name;
  const siteText = site && typeof site.description === 'string' ? site.description.trim() : '';
  const description = identity.description || siteText;

  if (name && profile.brandName !== name) { profile.brandName = name.slice(0, 120); changed.push('name'); }
  if (description && profile.brandDescription !== description) {
    profile.brandDescription = description.slice(0, 4000);
    changed.push('description');
  }
  const voice = Array.isArray(bp.brandVoice) ? bp.brandVoice.join(', ') : String(bp.brandVoice || '').trim();
  if (voice && profile.detectedProfile && profile.detectedProfile.tone !== voice) {
    profile.detectedProfile.tone = voice;
    changed.push('tone');
  }
  return changed;
}

module.exports = { alignProfileToSettings };
