/**
 * Serper.dev Instagram Handle Lookup Service
 * Uses Google Search (via Serper API) to find verified Instagram handles for companies.
 * Replaces Gemini handle guessing with real search results.
 */

const SERPER_API_KEY = process.env.SERPER_API_KEY;

/**
 * Look up the Instagram handle for a company using Google Search via Serper.
 * Searches for the company + "instagram" and extracts the handle from the first instagram.com result.
 * @param {string} companyName - The company name to look up
 * @returns {Promise<{handle: string|null, source: string|null}>}
 */
async function lookupInstagramHandle(companyName) {
  if (!SERPER_API_KEY) {
    console.log('⚠️ SERPER_API_KEY not set, skipping Instagram lookup');
    return { handle: null, source: null };
  }

  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: `${companyName} official instagram profile`,
        num: 5
      })
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
            return { handle: match[1], source: profile.link };
          }
        }
      }
    }

    // Search organic results for instagram.com links
    const results = data.organic || [];
    const skipPaths = ['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'tags', 'locations'];
    
    for (const result of results) {
      const link = result.link || '';
      const match = link.match(/instagram\.com\/([a-zA-Z0-9_.]+)\/?/);
      if (match && !skipPaths.includes(match[1])) {
        return { handle: match[1], source: link };
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
 * Adds a small delay between requests to avoid rate limiting.
 * @param {string[]} companyNames - Array of company names
 * @returns {Promise<Object>} Map of companyName -> { handle, source }
 */
async function batchLookupInstagramHandles(companyNames) {
  const results = {};
  
  for (const name of companyNames) {
    results[name] = await lookupInstagramHandle(name);
    // Small delay between requests
    await new Promise(r => setTimeout(r, 300));
  }
  
  return results;
}

module.exports = {
  lookupInstagramHandle,
  batchLookupInstagramHandles
};
