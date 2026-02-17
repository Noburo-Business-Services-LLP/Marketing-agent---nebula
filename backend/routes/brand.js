/**
 * Brand Routes
 * Full brand intake and analysis workflow
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { deepScrapeWebsite } = require('../services/scraper');
const { generateWithLLM } = require('../services/llmRouter');

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
    
    // Use Gemini to deeply analyze the website content and discover PRECISE competitors
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

ðŸš¨ðŸš¨ðŸš¨ MANDATORY: YOU MUST RETURN EXACTLY 8 COMPETITORS ðŸš¨ðŸš¨ðŸš¨
This is a HARD requirement. Not 2, not 3, EXACTLY 8 real competitors.
I will reject any response with fewer than 8 competitors.

Find competitors who do THE SAME THING, not just same industry.

âš ï¸ CRITICAL - UNDERSTAND THE NICHE FIRST:
- If business is "Startup Accelerator/Incubator" â†’ Competitors are: T-Hub, NSRCEL, IIT Madras Incubation Cell, Antler India, Y Combinator, Venture Catalysts, 100x.VC, Headstart Network, StartupTN, EDII-TN, Zone Startups, Techstars, 500 Startups
- If business is "Startup Accelerator" â†’ Competitors are NOT: upGrad, Unacademy, BYJU'S (these are general edtech - COMPLETELY WRONG!)
- If business is "Coding Bootcamp" â†’ Competitors are: Masai School, Scaler, Newton School, Coding Ninjas, AlmaBetter, Striver, CodeChef
- If business is "Online MBA" â†’ Competitors are: upGrad, Great Learning, Emeritus, Jaro Education, ISB Online, IIM Online
- If business is "K-12 Tutoring" â†’ Competitors are: BYJU'S, Vedantu, Physics Wallah, Unacademy, Toppr

ðŸ“ GEOGRAPHY DISTRIBUTION (MANDATORY - ALL 3 LEVELS):
1. REGIONAL (same state/city): EXACTLY 2 competitors from the same state/city
2. NATIONAL (India/country leaders): EXACTLY 4 national competitors 
3. GLOBAL (aspirational): EXACTLY 2 global leaders

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
    {
      "name": "Regional Competitor 1 (same city/state)",
      "type": "regional",
      "reason": "Why they compete (be specific)",
      "instagram": "@actual_real_handle",
      "twitter": "@handle",
      "website": "https://..."
    },
    {
      "name": "Regional Competitor 2 (same city/state)",
      "type": "regional",
      "reason": "Why they compete",
      "instagram": "@handle"
    },
    {
      "name": "National Competitor 1 (MARKET LEADER in country)",
      "type": "national",
      "reason": "Why they compete",
      "instagram": "@handle"
    },
    {
      "name": "National Competitor 2",
      "type": "national",
      "reason": "Why they compete",
      "instagram": "@handle"
    },
    {
      "name": "National Competitor 3",
      "type": "national",
      "reason": "Why they compete",
      "instagram": "@handle"
    },
    {
      "name": "National Competitor 4",
      "type": "national",
      "reason": "Why they compete",
      "instagram": "@handle"
    },
    {
      "name": "Global Leader 1 (aspirational)",
      "type": "global",
      "reason": "Why they're aspirational",
      "instagram": "@handle"
    },
    {
      "name": "Global Leader 2 (aspirational)",
      "type": "global",
      "reason": "Why they're aspirational",
      "instagram": "@handle"
    }
  ],
  "socialMediaHints": ["any social handles found on site"],
  "uniqueSellingPoints": ["what makes them unique"],
  "confidence": 0.9
}

ðŸš¨ VALIDATION RULES:
1. You MUST return EXACTLY 8 competitors (2 regional + 4 national + 2 global)
2. All competitors MUST be REAL companies that CURRENTLY EXIST
3. Competitors MUST do the SAME THING as this business (same business model)
4. Instagram handles MUST be real verified handles
5. Do NOT include upGrad/Unacademy/BYJU'S for startup accelerators!
- Do competitors have active social media presence?

Return ONLY valid JSON, no other text.`;

    const analysis = await generateWithLLM({
      provider: 'gemini',
      prompt: analysisPrompt,
      taskType: 'analysis',
      jsonSchema: { type: 'object' }
    });
    
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
    
    console.log('ðŸ¤– LLM analysis result:', {
      type: typeof analysis,
      isObject: typeof analysis === 'object',
      keys: typeof analysis === 'object' ? Object.keys(analysis) : 'N/A',
      preview: JSON.stringify(analysis).substring(0, 500)
    });
    
    // generateWithLLM returns the parsed JSON directly when jsonSchema is provided
    if (analysis && typeof analysis === 'object') {
      extractedData = { ...extractedData, ...analysis };
      console.log('âœ… Extracted data:', JSON.stringify(extractedData, null, 2));
    } else if (typeof analysis === 'string') {
      // Try to parse JSON from text response (fallback)
      try {
        const jsonMatch = analysis.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          extractedData = { ...extractedData, ...parsed };
          console.log('âœ… Parsed JSON from text:', JSON.stringify(extractedData, null, 2));
        }
      } catch (e) {
        console.log('âš ï¸ Could not parse JSON from text response:', e.message);
      }
    } else {
      console.log('âš ï¸ Unexpected analysis result type:', typeof analysis);
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
    
    // Save discovered competitors to database for Competitor Radar
    const userId = req.user.userId || req.user.id;
    if (extractedData.competitors && extractedData.competitors.length >= 6) {
      console.log(`ðŸ’¾ Saving ${extractedData.competitors.length} discovered competitors to database...`);
      
      try {
        const Competitor = require('../models/Competitor');
        
        // Only delete old auto-discovered competitors if we have at least 6 new ones
        // This prevents data loss if AI returns fewer competitors
        await Competitor.deleteMany({ userId, isAutoDiscovered: true });
        
        // Save new competitors
        for (const comp of extractedData.competitors) {
          try {
            const competitor = new Competitor({
              userId,
              name: comp.name,
              website: comp.website || '',
              description: comp.reason || comp.description || '',
              industry: extractedData.industry || '',
              competitorType: comp.type || 'unknown', // regional, national, or global
              socialHandles: {
                instagram: comp.instagram?.replace('@', '') || '',
                twitter: comp.twitter?.replace('@', '') || '',
                facebook: comp.facebook || '',
                linkedin: comp.linkedin || ''
              },
              location: comp.location || extractedData.businessLocation || '',
              isActive: true,
              isAutoDiscovered: true,
              posts: [],
              metrics: {
                followers: 0,
                lastFetched: new Date()
              }
            });
            await competitor.save();
            console.log(`âœ… Saved competitor: ${comp.name} (${comp.type || 'unknown'})`);
          } catch (saveError) {
            console.error(`âš ï¸ Error saving competitor ${comp.name}:`, saveError.message);
          }
        }
        
        console.log('âœ… Competitors saved successfully');
      } catch (dbError) {
        console.error('âš ï¸ Error saving competitors to database:', dbError.message);
      }
    } else if (extractedData.competitors && extractedData.competitors.length > 0 && extractedData.competitors.length < 6) {
      // AI returned fewer than 6 competitors - log warning but still save what we have
      console.log(`âš ï¸ AI returned only ${extractedData.competitors.length} competitors (expected 8). Saving anyway...`);
      
      try {
        const Competitor = require('../models/Competitor');
        
        // Save these competitors without deleting old ones (merge approach)
        for (const comp of extractedData.competitors) {
          try {
            // Check if competitor already exists
            const existing = await Competitor.findOne({ userId, name: comp.name });
            if (!existing) {
              const competitor = new Competitor({
                userId,
                name: comp.name,
                website: comp.website || '',
                description: comp.reason || comp.description || '',
                industry: extractedData.industry || '',
                competitorType: comp.type || 'unknown',
                socialHandles: {
                  instagram: comp.instagram?.replace('@', '') || '',
                  twitter: comp.twitter?.replace('@', '') || '',
                  facebook: comp.facebook || '',
                  linkedin: comp.linkedin || ''
                },
                location: comp.location || extractedData.businessLocation || '',
                isActive: true,
                isAutoDiscovered: true,
                posts: [],
                metrics: { followers: 0, lastFetched: new Date() }
              });
              await competitor.save();
              console.log(`âœ… Added competitor: ${comp.name} (${comp.type || 'unknown'})`);
            }
          } catch (saveError) {
            console.error(`âš ï¸ Error saving competitor ${comp.name}:`, saveError.message);
          }
        }
      } catch (dbError) {
        console.error('âš ï¸ Error saving competitors:', dbError.message);
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
