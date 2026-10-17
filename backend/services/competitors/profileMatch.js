'use strict';
// Maker-checker for a scraped Instagram profile. Moved out of routes/competitors.js unchanged so it can be tested.
/**
 * Maker-checker: Validate that a scraped Instagram profile actually matches the competitor.
 * Compares profile fullName, bio, website against competitor name, industry, website.
 * Returns { valid: boolean, score: number, reason: string }
 */
function validateProfileMatch(profile, competitor) {
  const profileName = (profile.fullName || profile.ownerFullName || '').toLowerCase().trim();
  const profileBio = (profile.biography || profile.bio || '').toLowerCase();
  const profileUrl = (profile.externalUrl || '').toLowerCase();
  const profileUsername = (profile.username || profile.ownerUsername || '').toLowerCase();

  const compName = (competitor.name || '').toLowerCase().trim();
  const compWebsite = (competitor.website || '').toLowerCase();
  const compIndustry = (competitor.industry || '').toLowerCase();
  const compDescription = (competitor.description || '').toLowerCase();

  let score = 0;
  const reasons = [];

  // 1. Name matching (strongest signal)
  const compWords = compName.split(/\s+/).filter(w => w.length > 2);

  if (profileName && compName && profileName.length > 2 && (profileName.includes(compName) || compName.includes(profileName))) {
    // Short names (<=5 chars) are more ambiguous - e.g. "Vanta" matches "Vanta Official", "Vanta Clothing"
    const nameBonus = compName.length <= 5 ? 5 : 10;
    score += nameBonus;
    reasons.push(nameBonus < 10 ? 'short name match' : 'exact name match');
  } else {
    let nameScore = 0;
    for (const word of compWords) {
      if (profileName.includes(word)) nameScore += 3; // fullName is a strong signal
      else if (profileUsername.includes(word)) nameScore += 1; // username alone is weak - anyone can register it
    }
    if (nameScore > 0) {
      score += nameScore;
      reasons.push(`name score: ${nameScore}`);
    }
  }

  // 2. Website domain match/mismatch (very strong signal both ways)
  if (compWebsite) {
    const compDomain = compWebsite.replace(/https?:\/\//, '').replace(/www\./, '').split('/')[0];
    if (profileUrl) {
      const profileDomain = profileUrl.replace(/https?:\/\//, '').replace(/www\./, '').split('/')[0];
      if (compDomain && profileDomain) {
        if (compDomain.includes(profileDomain) || profileDomain.includes(compDomain)) {
          score += 8;
          reasons.push('website domain match');
        } else {
          score -= 4;
          reasons.push('website domain MISMATCH');
        }
      }
    }
  }

  // 3. Industry keywords in bio
  if (compIndustry) {
    const industryWords = compIndustry.split(/[\s,]+/).filter(w => w.length > 3);
    let bioMatches = 0;
    for (const word of industryWords) {
      if (profileBio.includes(word)) bioMatches++;
    }
    if (bioMatches > 0) {
      score += bioMatches * 2;
      reasons.push(`industry in bio: ${bioMatches}`);
    }
  }

  // 4. Description keywords in bio
  if (compDescription) {
    const descWords = compDescription.split(/[\s,]+/).filter(w => w.length > 4);
    let descMatches = 0;
    for (const word of descWords.slice(0, 5)) {
      if (profileBio.includes(word)) descMatches++;
    }
    if (descMatches >= 2) {
      score += descMatches;
      reasons.push(`description in bio: ${descMatches}`);
    }
  }

  // 5. Language mismatch penalty - if competitor name is Latin/English but bio is mostly non-Latin
  if (compWords.length > 0 && compWords.every(w => /^[a-z0-9]+$/.test(w)) && profileBio.length > 20) {
    const latinChars = (profileBio.match(/[a-zA-Z]/g) || []).length;
    const totalChars = profileBio.replace(/[\s\d@#.,!?:;'"()\-]/g, '').length;
    if (totalChars > 10 && latinChars / totalChars < 0.3) {
      score -= 5;
      reasons.push('non-English bio penalty');
    }
  }

  // 6. Verified accounts get a boost
  if (profile.verified || profile.isVerified) {
    score += 3;
    reasons.push('verified');
  }

  const valid = score >= 6;
  const reason = reasons.join(', ') || 'no matching signals';

  console.log(`    ?? Maker-checker @${profileUsername} vs "${compName}": score=${score} (${reason}) ? ${valid ? '? PASS' : '? REJECT'}`);

  return { valid, score, reason };
}

module.exports = { validateProfileMatch };
