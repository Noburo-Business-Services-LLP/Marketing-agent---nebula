'use strict';
// Turns a user's saved business profile into the input the Blueprint engine expects.
// Pure and total: never throws on missing or odd fields.

const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const profileOf = (user) => (user && user.businessProfile && typeof user.businessProfile === 'object' ? user.businessProfile : {});
const firstLong = (vals, min) => vals.map(str).find((s) => s.length >= min) || '';

function nameOf(user) {
  return str(profileOf(user).name) || str((user || {}).companyName);
}

function instagramOf(user) {
  const socials = Array.isArray((user || {}).connectedSocials) ? user.connectedSocials : [];
  const ig = socials.find((s) => s && s.platform === 'instagram' && str(s.username));
  return ig ? str(ig.username) : '';
}

function whatYouSellOf(user) {
  const p = profileOf(user);
  return firstLong([p.description, p.heroProduct, p.problemSolved], 10);
}

function whoItsForOf(user) {
  const p = profileOf(user);
  return firstLong([p.targetCustomerProfile, p.targetAudience], 5);
}

function goalOf(user) {
  const goals = profileOf(user).marketingGoals;
  const first = (Array.isArray(goals) ? goals : []).map((g) => str(typeof g === 'string' ? g : g && g.text).toLowerCase()).find(Boolean) || '';
  if (/enquir|lead/.test(first)) return 'enquiries';
  if (/sale|sell/.test(first)) return 'sales';
  if (/follow|awareness|brand/.test(first)) return 'followers';
  if (/launch/.test(first)) return 'launch';
  return 'enquiries';
}

function competitorsOf(user) {
  const list = profileOf(user).competitors;
  return (Array.isArray(list) ? list : [])
    .map((c) => str(typeof c === 'string' ? c : c && c.name))
    .filter(Boolean)
    .slice(0, 3)
    .map((name) => ({ name }));
}

function inputFromProfile(user) {
  return {
    businessName: nameOf(user),
    website: str(profileOf(user).website),
    instagram: instagramOf(user),
    whatYouSell: whatYouSellOf(user),
    whoItsFor: whoItsForOf(user),
    goal: goalOf(user),
    competitors: competitorsOf(user),
    offers: []
  };
}

function profileComplete(user) {
  const missing = [];
  if (nameOf(user).length < 2) missing.push('business name');
  if (!str(profileOf(user).website) && !instagramOf(user)) missing.push('website or Instagram page');
  if (!whatYouSellOf(user)) missing.push('what you sell');
  if (!whoItsForOf(user)) missing.push('who it is for');
  return { complete: missing.length === 0, missing };
}

module.exports = { profileComplete, inputFromProfile };
