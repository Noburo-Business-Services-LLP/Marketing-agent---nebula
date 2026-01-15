/**
 * Brand Routes
 * Full brand intake and analysis workflow
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const BrandProfile = require('../models/BrandProfile');
const ScrapeJob = require('../models/ScrapeJob');
const Insight = require('../models/Insight');
const { scrapeWebsite, scrapeWebsitePages, searchNews, deepScrapeWebsite } = require('../services/scraper');
const { analyzeBrand, generateWithLLM } = require('../services/llmRouter');

/**
 * POST /api/brand/intake
 * Start brand intake process with website URL
 */
router.post('/intake', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { 
      websiteUrl, 
      category, 
      targetRegion, 
      targetCustomer, 
      budget,
      competitors = [],
      socialHandles = {}
    } = req.body;
    
    // Validate URL
    let validUrl;
    try {
      validUrl = new URL(websiteUrl);
      if (!['http:', 'https:'].includes(validUrl.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch (e) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid URL provided',
        errorType: 'validation_error'
      });
    }
    
    // Check if brand already exists for this URL
    let brandProfile = await BrandProfile.findOne({ userId, websiteUrl: validUrl.origin });
    
    if (brandProfile) {
      // Update existing
      brandProfile.category = category || brandProfile.category;
      brandProfile.targetRegion = targetRegion || brandProfile.targetRegion;
      brandProfile.targetCustomer = targetCustomer || brandProfile.targetCustomer;
      brandProfile.marketingBudget = budget ? { monthly: budget, currency: 'USD' } : brandProfile.marketingBudget;
      brandProfile.socialHandles = { ...brandProfile.socialHandles, ...socialHandles };
      brandProfile.analysisStatus = 'pending';
    } else {
      // Create new
      brandProfile = new BrandProfile({
        userId,
        websiteUrl: validUrl.origin,
        name: validUrl.hostname.replace('www.', ''),
        category,
        targetRegion,
        targetCustomer,
        marketingBudget: budget ? { monthly: budget, currency: 'USD' } : undefined,
        socialHandles,
        competitors: competitors.map(c => ({ name: c, url: c.startsWith('http') ? c : null })),
        analysisStatus: 'pending'
      });
    }
    
    await brandProfile.save();
    
    // Create scrape job
    const pagesToScrape = ['/', '/about', '/pricing', '/products', '/services', '/blog', '/contact'];
    const scrapeJob = new ScrapeJob({
      userId,
      jobType: 'brand_analysis',
      urls: pagesToScrape.map(page => ({
        url: new URL(page, validUrl.origin).toString(),
        status: 'pending'
      })),
      status: 'queued',
      progress: { total: pagesToScrape.length, completed: 0, failed: 0 },
      relatedEntity: { type: 'brand', id: brandProfile._id }
    });
    
    await scrapeJob.save();
    
    // Start async analysis (don't wait)
    analyzeBrandAsync(brandProfile._id, scrapeJob._id, validUrl.origin).catch(err => {
      console.error('Brand analysis failed:', err);
    });
    
    res.status(201).json({
      success: true,
      brand: {
        id: brandProfile._id,
        name: brandProfile.name,
        websiteUrl: brandProfile.websiteUrl,
        status: 'analyzing'
      },
      scrapeJobId: scrapeJob._id,
      message: 'Brand intake started. Analysis in progress.'
    });
    
  } catch (error) {
    console.error('Brand intake error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      errorType: 'server_error'
    });
  }
});

/**
 * Async brand analysis function
 */
async function analyzeBrandAsync(brandId, jobId, baseUrl) {
  const brandProfile = await BrandProfile.findById(brandId);
  const scrapeJob = await ScrapeJob.findById(jobId);
  
  if (!brandProfile || !scrapeJob) {
    throw new Error('Brand or job not found');
  }
  
  try {
    brandProfile.analysisStatus = 'analyzing';
    scrapeJob.status = 'processing';
    scrapeJob.startedAt = new Date();
    await Promise.all([brandProfile.save(), scrapeJob.save()]);
    
    // Scrape all pages
    const scrapedData = [];
    let allContent = '';
    
    for (let i = 0; i < scrapeJob.urls.length; i++) {
      const urlEntry = scrapeJob.urls[i];
      
      try {
        const result = await scrapeWebsite(urlEntry.url);
        
        if (result.success) {
          urlEntry.status = 'completed';
          urlEntry.scrapedAt = new Date();
          urlEntry.sourceId = result.sourceId;
          urlEntry.cached = result.cached;
          
          scrapedData.push({
            url: urlEntry.url,
            page: new URL(urlEntry.url).pathname,
            ...result.parsed
          });
          
          allContent += `\n\n--- Page: ${urlEntry.url} ---\n`;
          allContent += `Title: ${result.parsed.title}\n`;
          allContent += `Description: ${result.parsed.description}\n`;
          allContent += `Headings: ${result.parsed.headings.map(h => h.text).join(', ')}\n`;
          allContent += `Content: ${result.parsed.paragraphs.slice(0, 10).join('\n')}\n`;
          
          scrapeJob.progress.completed++;
        } else {
          urlEntry.status = result.errorType === 'robots_blocked' ? 'blocked' : 'failed';
          urlEntry.error = result.error;
          urlEntry.errorType = result.errorType;
          scrapeJob.progress.failed++;
        }
      } catch (err) {
        urlEntry.status = 'failed';
        urlEntry.error = err.message;
        scrapeJob.progress.failed++;
      }
      
      await scrapeJob.save();
    }
    
    // Update scrape job
    scrapeJob.completedAt = new Date();
    scrapeJob.status = scrapeJob.progress.failed === scrapeJob.progress.total ? 'failed' : 
                       scrapeJob.progress.failed > 0 ? 'partial' : 'completed';
    scrapeJob.results = {
      successCount: scrapeJob.progress.completed,
      failedCount: scrapeJob.progress.failed,
      dataSourceIds: scrapeJob.urls.filter(u => u.sourceId).map(u => u.sourceId)
    };
    await scrapeJob.save();
    
    if (scrapedData.length === 0) {
      brandProfile.analysisStatus = 'failed';
      brandProfile.analysisError = 'Could not scrape any pages from the website';
      await brandProfile.save();
      return;
    }
    
    // Analyze with AI
    const aiAnalysis = await analyzeBrand(allContent, baseUrl);
    
    if (aiAnalysis.brandProfile) {
      const bp = aiAnalysis.brandProfile;
      
      brandProfile.name = bp.name || brandProfile.name;
      brandProfile.description = bp.description || '';
      brandProfile.industry = bp.industry || '';
      brandProfile.niche = bp.niche || '';
      brandProfile.targetAudience = {
        demographics: bp.targetAudience ? [bp.targetAudience] : [],
        psychographics: [],
        painPoints: [],
        goals: []
      };
      brandProfile.brandVoice = bp.brandVoice || 'Professional';
      brandProfile.valuePropositions = bp.valuePropositions || [];
      brandProfile.uniqueSellingPoints = bp.uniqueSellingPoints || [];
      brandProfile.products = (bp.products || []).map(p => 
        typeof p === 'string' ? { name: p, description: '' } : p
      );
      
      // Store scraped pages info
      brandProfile.scrapedPages = scrapedData.map(d => ({
        url: d.url,
        page: d.page,
        scrapedAt: new Date(),
        sourceId: scrapeJob.urls.find(u => u.url === d.url)?.sourceId
      }));
    }
    
    brandProfile.analysisStatus = 'completed';
    brandProfile.lastAnalyzedAt = new Date();
    brandProfile.dataFreshness.lastUpdated = new Date();
    await brandProfile.save();
    
    // Generate insights
    const insightPromises = [];
    
    // SWOT Analysis
    if (aiAnalysis.brandProfile) {
      const swotInsight = new Insight({
        userId: brandProfile.userId,
        type: 'brand_analysis',
        category: 'SWOT',
        title: `Brand Analysis: ${brandProfile.name}`,
        content: {
          strengths: aiAnalysis.brandProfile.valuePropositions || [],
          uniqueSellingPoints: aiAnalysis.brandProfile.uniqueSellingPoints || [],
          brandVoice: aiAnalysis.brandProfile.brandVoice
        },
        citations: scrapedData.map(d => ({
          url: d.url,
          title: d.title,
          fetchedAt: new Date()
        })),
        relatedBrand: brandProfile._id,
        generatedBy: { provider: 'gemini', taskType: 'brand_analysis' },
        dataFreshness: { generatedAt: new Date(), basedOnDataFrom: new Date() }
      });
      insightPromises.push(swotInsight.save());
    }
    
    await Promise.all(insightPromises);
    
  } catch (error) {
    console.error('Brand analysis error:', error);
    brandProfile.analysisStatus = 'failed';
    brandProfile.analysisError = error.message;
    await brandProfile.save();
    
    scrapeJob.status = 'failed';
    scrapeJob.error = error.message;
    await scrapeJob.save();
  }
}

/**
 * GET /api/brand/profiles
 * Get all brand profiles for user
 */
router.get('/profiles', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const profiles = await BrandProfile.find({ userId }).sort({ createdAt: -1 });
    
    res.json({
      success: true,
      profiles: profiles.map(p => ({
        id: p._id,
        name: p.name,
        websiteUrl: p.websiteUrl,
        industry: p.industry,
        status: p.analysisStatus,
        lastAnalyzed: p.lastAnalyzedAt,
        dataFreshness: p.dataFreshness
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/brand/:id
 * Get full brand profile
 */
router.get('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const profile = await BrandProfile.findOne({ _id: req.params.id, userId });
    
    if (!profile) {
      return res.status(404).json({ success: false, error: 'Brand profile not found' });
    }
    
    // Get related insights
    const insights = await Insight.find({ 
      relatedBrand: profile._id, 
      status: 'active' 
    }).sort({ createdAt: -1 }).limit(10);
    
    res.json({
      success: true,
      profile,
      insights,
      dataFreshness: {
        lastUpdated: profile.dataFreshness.lastUpdated,
        isStale: Date.now() - profile.dataFreshness.lastUpdated > (profile.dataFreshness.staleDays * 24 * 60 * 60 * 1000)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/brand/:id/status
 * Get brand analysis status
 */
router.get('/:id/status', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const profile = await BrandProfile.findOne({ _id: req.params.id, userId });
    
    if (!profile) {
      return res.status(404).json({ success: false, error: 'Brand profile not found' });
    }
    
    // Get latest scrape job
    const scrapeJob = await ScrapeJob.findOne({
      'relatedEntity.id': profile._id,
      'relatedEntity.type': 'brand'
    }).sort({ createdAt: -1 });
    
    res.json({
      success: true,
      status: profile.analysisStatus,
      error: profile.analysisError,
      scrapeJob: scrapeJob ? {
        status: scrapeJob.status,
        progress: scrapeJob.progress,
        urls: scrapeJob.urls.map(u => ({
          url: u.url,
          status: u.status,
          error: u.error
        }))
      } : null
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/brand/:id/refresh
 * Re-analyze brand (refresh data)
 */
router.post('/:id/refresh', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const profile = await BrandProfile.findOne({ _id: req.params.id, userId });
    
    if (!profile) {
      return res.status(404).json({ success: false, error: 'Brand profile not found' });
    }
    
    // Create new scrape job
    const pagesToScrape = ['/', '/about', '/pricing', '/products', '/services', '/blog'];
    const scrapeJob = new ScrapeJob({
      userId,
      jobType: 'brand_analysis',
      urls: pagesToScrape.map(page => ({
        url: new URL(page, profile.websiteUrl).toString(),
        status: 'pending'
      })),
      status: 'queued',
      progress: { total: pagesToScrape.length, completed: 0, failed: 0 },
      relatedEntity: { type: 'brand', id: profile._id }
    });
    
    await scrapeJob.save();
    
    profile.analysisStatus = 'pending';
    await profile.save();
    
    // Start async analysis
    analyzeBrandAsync(profile._id, scrapeJob._id, profile.websiteUrl).catch(err => {
      console.error('Brand refresh failed:', err);
    });
    
    res.json({
      success: true,
      message: 'Brand refresh started',
      scrapeJobId: scrapeJob._id
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/brand/:id
 * Delete brand profile
 */
router.delete('/:id', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const result = await BrandProfile.findOneAndDelete({ _id: req.params.id, userId });
    
    if (!result) {
      return res.status(404).json({ success: false, error: 'Brand profile not found' });
    }
    
    // Clean up related data
    await Promise.all([
      Insight.deleteMany({ relatedBrand: req.params.id }),
      ScrapeJob.deleteMany({ 'relatedEntity.id': req.params.id, 'relatedEntity.type': 'brand' })
    ]);
    
    res.json({ success: true, message: 'Brand profile deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

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
    
    console.log(`📡 Quick analyzing website: ${validUrl.origin}`);
    
    // Use deep scraping with Apify fallback for JS-rendered sites
    console.log('🔧 Using deep scraper with Apify fallback...');
    const scrapedResult = await deepScrapeWebsite(validUrl.origin, { forceRefresh: true });
    console.log('🔍 Deep scrape result:', JSON.stringify({
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
    
    console.log('📝 Scraped content length:', textContent.length);
    console.log('📝 Content preview:', textContent.substring(0, 500));
    
    // If we couldn't get enough content, try to infer from URL
    const minContentLength = 100;
    if (textContent.length < minContentLength) {
      console.log('⚠️ Not enough content scraped, will rely more on URL inference');
    }
    
    // Use Gemini to deeply analyze the website content and discover PRECISE competitors
    const analysisPrompt = `You are a senior market research analyst at McKinsey with 15 years of experience in competitive intelligence. Your job is to DEEPLY understand this business and find their EXACT competitors.

🌐 WEBSITE TO ANALYZE:
URL: ${validUrl.origin}
Domain: ${validUrl.hostname}

📄 SCRAPED WEBSITE CONTENT:
${textContent}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 STEP 1: DEEP BUSINESS ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Read the content carefully and understand:
- What EXACTLY does this business do? (not generic, be specific)
- What is their PRIMARY business model? (courses, accelerator, marketplace, agency, etc.)
- Who EXACTLY are their customers? (students, startups, enterprises, consumers?)
- What specific PROBLEM do they solve?
- What is their PRICING model? (free, paid, subscription, equity?)
- What GEOGRAPHY do they serve? (local, regional, national, global?)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 STEP 2: PRECISE NICHE IDENTIFICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DON'T just say "Edtech" or "SaaS". Be HYPER-SPECIFIC:
- If they teach coding → "Coding Bootcamp" not "Edtech"
- If they do startup acceleration → "Startup Accelerator & Incubator" not "Edtech"
- If they sell fashion → "Sustainable Women's Fashion" not "Ecommerce"
- If they do MBA courses → "Executive MBA Programs" not "Education"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔥 STEP 3: FIND EXACT COMPETITORS (MOST IMPORTANT!)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Find competitors who do THE SAME THING, not just same industry.

⚠️ CRITICAL EXAMPLES:
- If business is "Startup Accelerator" → Competitors are: T-Hub, NSRCEL, Antler, Y Combinator, Venture Catalysts, 100x.VC, Headstart
- If business is "Startup Accelerator" → Competitors are NOT: upGrad, Unacademy, BYJU'S (these are general edtech, WRONG!)
- If business is "Coding Bootcamp" → Competitors are: Masai School, Scaler, Newton School, Coding Ninjas
- If business is "Online MBA" → Competitors are: upGrad, Great Learning, Emeritus, Jaro Education
- If business is "K-12 Tutoring" → Competitors are: BYJU'S, Vedantu, Physics Wallah, Unacademy

🔍 COMPETITOR CATEGORIES TO FIND:
1. REGIONAL (same city/state): 2-3 local competitors
2. NATIONAL (same country): 3-4 major national players
3. GLOBAL (aspirational): 1-2 global leaders in the space

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 RETURN THIS JSON STRUCTURE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "companyName": "Company Name (properly capitalized)",
  "industry": "Broad industry (Edtech, FinTech, SaaS, etc.)",
  "niche": "HYPER-SPECIFIC niche (e.g., 'Startup Accelerator & Entrepreneurship Bootcamp', 'AI-Powered Coding Education', 'Premium Women's Workwear')",
  "businessModel": "How they make money (courses, equity, subscription, ads, marketplace fees, etc.)",
  "businessType": "B2B, B2C, or Both",
  "businessLocation": "City, State, Country",
  "description": "2-3 sentence description of EXACTLY what they do",
  "targetAudience": "SPECIFIC audience with demographics and pain points",
  "brandVoice": ["2-3 voice traits"],
  "suggestedGoals": ["3-4 specific marketing goals"],
  "keyProducts": ["List of main products/services with specifics"],
  "competitors": [
    {
      "name": "Regional Competitor 1",
      "type": "regional",
      "reason": "Why they compete (be specific)",
      "instagram": "@handle",
      "twitter": "@handle",
      "website": "https://..."
    },
    {
      "name": "Regional Competitor 2",
      "type": "regional",
      "reason": "Why they compete",
      "instagram": "@handle"
    },
    {
      "name": "National Competitor 1 (market leader)",
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
      "name": "Global Leader (aspirational)",
      "type": "global",
      "reason": "Why they're aspirational",
      "instagram": "@handle"
    }
  ],
  "socialMediaHints": ["any social handles found on site"],
  "uniqueSellingPoints": ["what makes them unique"],
  "confidence": 0.9
}

⚠️ FINAL CHECK BEFORE RESPONDING:
- Are competitors doing THE SAME THING as this business? (not just same industry)
- Did you include regional + national + global mix?
- Are all competitors REAL companies that exist?
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
    
    console.log('🤖 LLM analysis result:', {
      type: typeof analysis,
      isObject: typeof analysis === 'object',
      keys: typeof analysis === 'object' ? Object.keys(analysis) : 'N/A',
      preview: JSON.stringify(analysis).substring(0, 500)
    });
    
    // generateWithLLM returns the parsed JSON directly when jsonSchema is provided
    if (analysis && typeof analysis === 'object') {
      extractedData = { ...extractedData, ...analysis };
      console.log('✅ Extracted data:', JSON.stringify(extractedData, null, 2));
    } else if (typeof analysis === 'string') {
      // Try to parse JSON from text response (fallback)
      try {
        const jsonMatch = analysis.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          extractedData = { ...extractedData, ...parsed };
          console.log('✅ Parsed JSON from text:', JSON.stringify(extractedData, null, 2));
        }
      } catch (e) {
        console.log('⚠️ Could not parse JSON from text response:', e.message);
      }
    } else {
      console.log('⚠️ Unexpected analysis result type:', typeof analysis);
    }
    
    // Capitalize company name
    extractedData.companyName = extractedData.companyName
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    
    // Save discovered competitors to database for Competitor Radar
    const userId = req.user.userId || req.user.id;
    if (extractedData.competitors && extractedData.competitors.length > 0) {
      console.log(`💾 Saving ${extractedData.competitors.length} discovered competitors to database...`);
      
      try {
        const Competitor = require('../models/Competitor');
        
        // Delete old auto-discovered competitors for this user
        await Competitor.deleteMany({ userId, isAutoDiscovered: true });
        
        // Save new competitors
        for (const comp of extractedData.competitors) {
          try {
            const competitor = new Competitor({
              userId,
              name: comp.name,
              website: comp.website || '',
              description: comp.reason || '',
              industry: extractedData.industry || '',
              socialHandles: {
                instagram: comp.instagram?.replace('@', '') || '',
                twitter: comp.twitter?.replace('@', '') || '',
                facebook: comp.facebook || '',
                linkedin: comp.linkedin || ''
              },
              location: extractedData.businessLocation || '',
              isActive: true,
              isAutoDiscovered: true,
              posts: [],
              metrics: {
                followers: 0,
                lastFetched: new Date()
              }
            });
            await competitor.save();
            console.log(`✅ Saved competitor: ${comp.name}`);
          } catch (saveError) {
            console.error(`⚠️ Error saving competitor ${comp.name}:`, saveError.message);
          }
        }
        
        console.log('✅ Competitors saved successfully');
      } catch (dbError) {
        console.error('⚠️ Error saving competitors to database:', dbError.message);
      }
    }
    
    // Also convert competitors array to the format expected by frontend
    extractedData.competitorHints = extractedData.competitors?.map(c => c.name) || [];
    
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
