/**
 * Brand Routes
 * Full brand intake and analysis workflow
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { deepScrapeWebsite } = require('../services/scraper');
const { callClaude, parseClaudeJSON } = require('../services/claudeAI');
const { lookupInstagramHandle } = require('../services/serperLookup');
const { fetchPostsForCompetitors } = require('./competitors');
const Competitor = require('../models/Competitor');

/**
 * POST /api/brand/quick-analyze
 * Quick website analysis for onboarding - scrapes and returns company info with competitor discovery
 */
router.post('/quick-analyze', protect, async (req, res) => {
  try {
    const { websiteUrl } = req.body;
    
    // Validate URL
    let validUrl;
    try {
      // Handle URLs without protocol
      let urlToValidate = websiteUrl;
      if (!urlToValidate.startsWith('http://') && !urlToValidate.startsWith('https://')) {
        urlToValidate = 'https://' + urlToValidate;
      }
      validUrl = new URL(urlToValidate);
      if (!['http:', 'https:'].includes(validUrl.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch (e) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid URL. Please enter a valid website address.',
        validUrl: false
      });
    }
    
    console.log(`ðŸ“¡ Quick analyzing website: ${validUrl.origin}`);
    
    // Use deep scraping with Apify fallback for JS-rendered sites
    console.log('ðŸ”§ Using deep scraper with Apify fallback...');
    const scrapedResult = await deepScrapeWebsite(validUrl.origin, { forceRefresh: true });
    console.log('ðŸ” Deep scrape result:', JSON.stringify({
      success: scrapedResult.success,
      source: scrapedResult.source,
      cached: scrapedResult.cached,
      hasParsed: !!scrapedResult.parsed,
      parsedTitle: scrapedResult.parsed?.title,
      parsedDescription: scrapedResult.parsed?.description?.substring(0, 100),
      textLength: scrapedResult.parsed?.text?.length || scrapedResult.parsed?.fullText?.length || 0
    }));
    
    if (!scrapedResult || !scrapedResult.success) {
      return res.status(400).json({
        success: false,
        error: 'Could not access the website. Please check the URL and try again.',
        validUrl: true,
        accessible: false
      });
    }
    
    // Extract text content from parsed result
    const parsed = scrapedResult.parsed || {};
    const textContent = [
      parsed.title || '',
      parsed.description || '',
      parsed.headings?.map(h => h.text).join(' ') || '',
      parsed.text?.substring(0, 8000) || parsed.fullText?.substring(0, 8000) || ''
    ].join('\n').substring(0, 15000);
    
    console.log('ðŸ“ Scraped content length:', textContent.length);
    console.log('ðŸ“ Content preview:', textContent.substring(0, 500));
    
    // If we couldn't get enough content, try to infer from URL
    const minContentLength = 100;
    if (textContent.length < minContentLength) {
      console.log('âš ï¸ Not enough content scraped, will rely more on URL inference');
    }
    
    // Use Claude to deeply analyze the website content and discover PRECISE competitors
    const analysisPrompt = `You are a senior market research analyst at McKinsey with 15 years of experience in competitive intelligence. Your job is to DEEPLY understand this business and find their EXACT competitors.

ðŸŒ WEBSITE TO ANALYZE:
URL: ${validUrl.origin}
Domain: ${validUrl.hostname}

ðŸ“„ SCRAPED WEBSITE CONTENT:
${textContent}

â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
ðŸ§  STEP 1: DEEP BUSINESS ANALYSIS
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
Read the content carefully and understand:
- What EXACTLY does this business do? (not generic, be specific)
- What is their PRIMARY business model? (courses, accelerator, marketplace, agency, etc.)
- Who EXACTLY are their customers? (students, startups, enterprises, consumers?)
- What specific PROBLEM do they solve?
- What is their PRICING model? (free, paid, subscription, equity?)
- What GEOGRAPHY do they serve? (local, regional, national, global?)

â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
ðŸŽ¯ STEP 2: PRECISE NICHE IDENTIFICATION
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
DON'T just say "Edtech" or "SaaS". Be HYPER-SPECIFIC:
- If they teach coding â†’ "Coding Bootcamp" not "Edtech"
- If they do startup acceleration â†’ "Startup Accelerator & Incubator" not "Edtech"
- If they sell fashion â†’ "Sustainable Women's Fashion" not "Ecommerce"
- If they do MBA courses â†’ "Executive MBA Programs" not "Education"

â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
ðŸ”¥ STEP 3: FIND EXACT COMPETITORS (MOST IMPORTANT!)
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”

ðŸš¨ðŸš¨ðŸš¨ MANDATORY: YOU MUST RETURN EXACTLY 15 COMPETITORS ðŸš¨ðŸš¨ðŸš¨
This is a HARD requirement. EXACTLY 15 real competitors.


Find competitors who do THE SAME THING, not just same industry.

âš ï¸ CRITICAL - UNDERSTAND THE NICHE FIRST:
- If business is "Startup Accelerator/Incubator" â†’ Competitors are: T-Hub, NSRCEL, IIT Madras Incubation Cell, Antler India, Y Combinator, Venture Catalysts, 100x.VC, Headstart Network, StartupTN, EDII-TN, Zone Startups, Techstars, 500 Startups
- If business is "Startup Accelerator" â†’ Competitors are NOT: upGrad, Unacademy, BYJU'S (these are general edtech - COMPLETELY WRONG!)
- If business is "Coding Bootcamp" â†’ Competitors are: Masai School, Scaler, Newton School, Coding Ninjas, AlmaBetter, Striver, CodeChef
- If business is "Online MBA" â†’ Competitors are: upGrad, Great Learning, Emeritus, Jaro Education, ISB Online, IIM Online
- If business is "K-12 Tutoring" â†’ Competitors are: BYJU'S, Vedantu, Physics Wallah, Unacademy, Toppr

ðŸ“ GEOGRAPHY DISTRIBUTION (MANDATORY - ALL 3 LEVELS):
1. LOCAL (same city/region): EXACTLY 5 competitors from the same city/region
2. NATIONAL (country leaders): EXACTLY 5 national competitors 
3. GLOBAL (international): EXACTLY 5 global leaders

â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
ðŸ“‹ RETURN THIS JSON STRUCTURE:
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
{
  "companyName": "Company Name (properly capitalized)",
  "industry": "Broad industry (Edtech, FinTech, SaaS, etc.)",
  "niche": "HYPER-SPECIFIC niche (e.g., 'Startup Accelerator & Entrepreneurship Bootcamp', 'AI-Powered Coding Education', 'Premium Women's Workwear')",
  "businessModel": "How they make money (courses, equity, subscription, ads, marketplace fees, etc.)",
  "businessType": "MUST be exactly one of: B2B, B2C, or Both (no other text, just one of these 3 values)",
  "businessLocation": "City, State, Country",
  "description": "2-3 sentence description of EXACTLY what they do",
  "targetAudience": "SPECIFIC audience with demographics and pain points",
  "brandVoice": ["2-3 voice traits"],
  "suggestedGoals": ["3-4 specific marketing goals"],
  "keyProducts": ["List of main products/services with specifics"],
  "competitors": [
    { "name": "Local Competitor 1", "type": "local", "reason": "Why they compete", "website": "https://..." },
    { "name": "Local Competitor 2", "type": "local", "reason": "Why they compete", "website": "https://..." },
    { "name": "Local Competitor 3", "type": "local", "reason": "Why they compete", "website": "https://..." },
    { "name": "Local Competitor 4", "type": "local", "reason": "Why they compete", "website": "https://..." },
    { "name": "Local Competitor 5", "type": "local", "reason": "Why they compete", "website": "https://..." },
    { "name": "National Competitor 1", "type": "national", "reason": "Why they compete", "website": "https://..." },
    { "name": "National Competitor 2", "type": "national", "reason": "Why they compete", "website": "https://..." },
    { "name": "National Competitor 3", "type": "national", "reason": "Why they compete", "website": "https://..." },
    { "name": "National Competitor 4", "type": "national", "reason": "Why they compete", "website": "https://..." },
    { "name": "National Competitor 5", "type": "national", "reason": "Why they compete", "website": "https://..." },
    { "name": "Global Leader 1", "type": "global", "reason": "Why aspirational", "website": "https://..." },
    { "name": "Global Leader 2", "type": "global", "reason": "Why aspirational", "website": "https://..." },
    { "name": "Global Leader 3", "type": "global", "reason": "Why aspirational", "website": "https://..." },
    { "name": "Global Leader 4", "type": "global", "reason": "Why aspirational", "website": "https://..." },
    { "name": "Global Leader 5", "type": "global", "reason": "Why aspirational", "website": "https://..." }
  ],
  "socialMediaHints": ["any social handles found on site"],
  "uniqueSellingPoints": ["what makes them unique"],
  "confidence": 0.9
}

ðŸš¨ VALIDATION RULES:
1. You MUST return EXACTLY 15 competitors (5 local + 5 national + 5 global)
2. All competitors MUST be REAL companies that CURRENTLY EXIST
3. Competitors MUST do the SAME THING as this business (same business model)
4. Each competitor MUST have a real website URL
5. Do NOT include upGrad/Unacademy/BYJU'S for startup accelerators!

Return ONLY valid JSON, no other text.`;

    console.log('📤 Calling Claude Sonnet 4.6 for website analysis...');
    const claudeResponse = await callClaude(analysisPrompt);
    
    let extractedData = {
      companyName: validUrl.hostname.replace('www.', '').split('.')[0],
      industry: '',
      niche: '',
      businessType: '',
      businessLocation: '',
      description: '',
      targetAudience: '',
      brandVoice: ['Professional'],
      suggestedGoals: [],
      keyProducts: [],
      competitors: [],
      socialMediaHints: [],
      uniqueSellingPoints: [],
      confidence: 0.5
    };
    
    try {
      const claudeParsed = parseClaudeJSON(claudeResponse);
      extractedData = { ...extractedData, ...claudeParsed };
      console.log('Claude analysis parsed successfully');
    } catch (e) {
      console.log('Could not parse Claude response:', e.message);
    }
    
    // Capitalize company name
    extractedData.companyName = extractedData.companyName
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    
    // Sanitize businessType to match enum values
    if (extractedData.businessType) {
      const bt = extractedData.businessType.toUpperCase();
      if (bt.includes('B2B') && bt.includes('B2C')) {
        extractedData.businessType = 'Both';
      } else if (bt.includes('B2B')) {
        extractedData.businessType = 'B2B';
      } else if (bt.includes('B2C')) {
        extractedData.businessType = 'B2C';
      } else {
        extractedData.businessType = 'Both'; // Default fallback
      }
    }
    
    // Save discovered competitors to database with Serper-verified Instagram handles
    const userId = req.user.userId || req.user.id;
    if (extractedData.competitors && extractedData.competitors.length > 0) {
      console.log('Saving ' + extractedData.competitors.length + ' competitors with Serper handle lookup...');
      
      try {
        // Delete old auto-discovered competitors
        await Competitor.deleteMany({ userId, isAutoDiscovered: true });

        // Serper handle lookup for each competitor
        console.log('Resolving Instagram handles via Serper...');
        const handleMap = {};
        for (const comp of extractedData.competitors) {
          if (!comp.name || comp.name.length < 2) continue;
          const lookup = await lookupInstagramHandle(comp.name, comp.reason || comp.description || '');
          handleMap[comp.name] = lookup.handle;
          await new Promise(r => setTimeout(r, 300));
        }

        // Save competitors to DB with Serper-verified handles
        const savedCompetitors = [];
        for (const comp of extractedData.competitors) {
          if (!comp.name || comp.name.length < 2) continue;
          const serperHandle = handleMap[comp.name];

          try {
            const competitor = new Competitor({
              userId,
              name: comp.name,
              website: comp.website || '',
              description: comp.reason || comp.description || '',
              industry: extractedData.industry || '',
              competitorType: comp.type || 'unknown',
              socialHandles: {
                instagram: serperHandle || '',
                twitter: '',
                facebook: '',
                linkedin: ''
              },
              location: comp.location || extractedData.businessLocation || '',
              isActive: true,
              isAutoDiscovered: true,
              posts: [],
              metrics: { followers: 0, lastFetched: new Date() }
            });
            await competitor.save();
            savedCompetitors.push(competitor);
            console.log('Saved competitor: ' + comp.name + ' (' + (comp.type || 'unknown') + ') @' + (serperHandle || 'no-handle'));
          } catch (saveError) {
            console.error('Error saving competitor ' + comp.name + ':', saveError.message);
          }
        }

        console.log('Total competitors saved: ' + savedCompetitors.length);

        // Fire-and-forget: Apify scrapes Instagram posts in background
        if (savedCompetitors.length > 0) {
          fetchPostsForCompetitors(savedCompetitors).catch(err =>
            console.error('Background post fetch error:', err.message)
          );
        }
      } catch (dbError) {
        console.error('Error saving competitors to database:', dbError.message);
      }
    }
    
    // Also convert competitors array to the format expected by frontend
    extractedData.competitorHints = extractedData.competitors?.map(c => c.name) || [];
    
    // Extract and save brand assets from the scraped website
    const brandAssets = {
      logoUrl: parsed.logoUrl || '',
      ogImage: parsed.ogImage || '',
      favicon: parsed.favicon || '',
      brandColors: parsed.brandColors || [],
      images: (parsed.images || []).slice(0, 10) // Top 10 images
    };
    
    console.log('ðŸŽ¨ Extracted brand assets:', JSON.stringify(brandAssets, null, 2));
    
    // Save brand assets to user's profile
    try {
      const User = require('../models/User');
      const user = await User.findById(userId);
      if (user) {
        // Make sure businessProfile exists
        if (!user.businessProfile) {
          user.businessProfile = {};
        }
        user.businessProfile.brandAssets = brandAssets;
        await user.save();
        console.log('âœ… Brand assets saved to user profile');
      }
    } catch (brandAssetError) {
      console.error('âš ï¸ Error saving brand assets:', brandAssetError.message);
    }
    
    // Include brand assets in response
    extractedData.brandAssets = brandAssets;
    
    res.json({
      success: true,
      validUrl: true,
      accessible: true,
      url: validUrl.origin,
      scrapeSource: scrapedResult.source || 'basic',
      data: extractedData
    });
    
  } catch (error) {
    console.error('Quick analyze error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Analysis failed. You can continue without website analysis.',
      validUrl: true
    });
  }
});

module.exports = router;
