/**
 * Serper.dev Instagram Handle Lookup Service
 * Uses Google Search (via Serper API) to find verified Instagram handles for companies.
 * Includes title-matching validation to skip personal accounts.
 */

const SERPER_API_KEY = process.env.SERPER_API_KEY;

/**
 * Check if a Google result title looks like a company/brand Instagram page
 * vs a personal account. Returns true if the result is likely a match for the company.
 */
function isCompanyMatch(title, snippet, companyName) {
  const snippetLower = (snippet || '').toLowerCase();
  const nameLower = companyName.toLowerCase().trim();
  
  // Strip (@handle) from title so handle text doesn't falsely match company name
  const cleanTitle = (title || '').replace(/\(@[a-zA-Z0-9_.]+\)/g, '').toLowerCase().trim();
  
  // Extract individual words from company name (min 3 chars to avoid noise)
  const nameWords = nameLower.split(/\s+/).filter(w => w.length >= 3);
  
  // Check if cleaned title contains the company name or significant part of it
  if (cleanTitle.includes(nameLower)) return true;
  
  // Check if any significant word from company name appears in cleaned title
  const wordMatch = nameWords.some(word => cleanTitle.includes(word));
  
  // Also check snippet for business indicators matching company name
  const snippetMatch = nameWords.some(word => snippetLower.includes(word));
  
  // Pattern: "Firstname Lastname (@handle)" — likely a personal account
  const personalPattern = /^[A-Z][a-z]+ [A-Z][a-z]+ \(@/;
  if (personalPattern.test(title || '') && !wordMatch) {
    return false;
  }
  
  // If cleaned title contains a name word, it's likely the company
  if (wordMatch) return true;
  
  // If snippet mentions business keywords AND company name — accept
  const businessKeywords = ['business', 'company', 'brand', 'official', 'platform', 'app', 'startup', 'services', 'solutions', 'founded', 'headquarters'];
  const hasBizKeyword = businessKeywords.some(kw => snippetLower.includes(kw));
  if (hasBizKeyword && snippetMatch) return true;
  
  return false;
}

/**
 * Look up the Instagram handle for a company using Google Search via Serper.
 * @param {string} companyName - The company name to look up
 * @param {string} [description] - Optional business description for better disambiguation
 * @returns {Promise<{handle: string|null, source: string|null}>}
 */

/**
 * Extract a validated Instagram handle from Serper organic results.
 * Handles both profile URLs and post/reel URLs (extracting handle from title).
 */
function extractHandleFromResults(results, companyName) {
  const skipPaths = ['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'tags', 'locations'];
  let fallbackHandle = null;

  for (const result of results) {
    const link = result.link || '';
    const title = result.title || '';
    const snippet = result.snippet || '';
    
    const urlMatch = link.match(/instagram\.com\/([a-zA-Z0-9_.]+)\/?/);
    if (!urlMatch) continue;

    const urlPath = urlMatch[1];

    // If it's a profile URL (not a post/reel), validate title
    if (!skipPaths.includes(urlPath)) {
      if (isCompanyMatch(title, snippet, companyName)) {
        console.log(`  ✅ ${companyName}: title-validated → @${urlPath} (title: "${title}")`);
        return { handle: urlPath, source: link };
      }
      if (!fallbackHandle) {
        fallbackHandle = { handle: urlPath, source: link, title };
      }
      continue;
    }

    // For post/reel URLs, try to extract handle from title: "Photo by Company (@handle)"
    const titleHandleMatch = title.match(/\(@([a-zA-Z0-9_.]+)\)/);
    if (titleHandleMatch && isCompanyMatch(title, snippet, companyName)) {
      const handle = titleHandleMatch[1];
      console.log(`  ✅ ${companyName}: extracted from post title → @${handle} (title: "${title}")`);
      return { handle, source: `https://www.instagram.com/${handle}/` };
    }
  }

  if (fallbackHandle) {
    console.log(`  ⚠️ ${companyName}: no title-validated match. Skipped: @${fallbackHandle.handle} (title: "${fallbackHandle.title}")`);
  }
  return null;
}

async function lookupInstagramHandle(companyName, description) {
  if (!SERPER_API_KEY) {
    console.log('⚠️ SERPER_API_KEY not set, skipping Instagram lookup');
    return { handle: null, source: null };
  }

  try {
    // Simple query matches what works in actual Google search
    const query = description 
      ? `${companyName} ${description.split(' ').slice(0, 4).join(' ')} instagram`
      : `${companyName} instagram`;
    
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q: query, num: 10 })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`Serper API error for "${companyName}":`, data.message || data);
      return { handle: null, source: null };
    }

    // Check knowledge graph first (most reliable)
    if (data.knowledgeGraph?.socialProfiles) {
      for (const profile of data.knowledgeGraph.socialProfiles) {
        if (profile.name?.toLowerCase() === 'instagram') {
          const match = profile.link?.match(/instagram\.com\/([a-zA-Z0-9_.]+)\/?/);
          if (match) {
            console.log(`  📊 ${companyName}: found via knowledge graph → @${match[1]}`);
            return { handle: match[1], source: profile.link };
          }
        }
      }
    }

    // Search organic results for instagram.com links WITH title validation
    const foundHandle = extractHandleFromResults(data.organic || [], companyName);
    if (foundHandle) return foundHandle;

    // If description was used and no match found, retry without description
    if (description) {
      console.log(`  🔄 ${companyName}: retrying without description...`);
      const retryResponse = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: `${companyName} instagram`, num: 10 })
      });
      const retryData = await retryResponse.json();
      if (retryResponse.ok) {
        // Check knowledge graph in retry too
        if (retryData.knowledgeGraph?.socialProfiles) {
          for (const profile of retryData.knowledgeGraph.socialProfiles) {
            if (profile.name?.toLowerCase() === 'instagram') {
              const kgMatch = profile.link?.match(/instagram\.com\/([a-zA-Z0-9_.]+)\/?/);
              if (kgMatch) {
                console.log(`  📊 ${companyName}: found via knowledge graph (retry) → @${kgMatch[1]}`);
                return { handle: kgMatch[1], source: profile.link };
              }
            }
          }
        }
        const retryHandle = extractHandleFromResults(retryData.organic || [], companyName);
        if (retryHandle) return retryHandle;
      }
    }
    
    return { handle: null, source: null };
  } catch (error) {
    console.error(`Serper lookup error for "${companyName}":`, error.message);
    return { handle: null, source: null };
  }
}

/**
 * Batch lookup Instagram handles for multiple companies.
 * @param {string[]} companyNames - Array of company names
 * @param {Object} [descriptionMap] - Optional map of companyName -> description
 * @returns {Promise<Object>} Map of companyName -> { handle, source }
 */
async function batchLookupInstagramHandles(companyNames, descriptionMap) {
  const results = {};
  
  for (const name of companyNames) {
    const desc = descriptionMap?.[name] || null;
    results[name] = await lookupInstagramHandle(name, desc);
    await new Promise(r => setTimeout(r, 300));
  }
  
  return results;
}

module.exports = {
  lookupInstagramHandle,
  batchLookupInstagramHandles
};
