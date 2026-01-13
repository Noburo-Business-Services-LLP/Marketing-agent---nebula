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
const { scrapeWebsite, scrapeWebsitePages, searchNews } = require('../services/scraper');
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
 * Quick website analysis for onboarding - scrapes and returns company info
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
    
    // Scrape the main page
    const scrapedResult = await scrapeWebsite(validUrl.origin);
    
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
      parsed.text?.substring(0, 5000) || ''
    ].join('\n').substring(0, 10000);
    
    // Use Gemini to analyze the website content
    const analysisPrompt = `Analyze this website content and extract comprehensive business information. Return ONLY valid JSON.

Website: ${validUrl.origin}
Content: ${textContent}

Return this exact JSON structure:
{
  "companyName": "detected company name",
  "industry": "one of: Ecommerce, SaaS, Service, Content, Other",
  "niche": "specific niche or focus area (e.g., 'Sustainable Fashion', 'B2B Marketing Software')",
  "businessType": "one of: B2B, B2C, Both - determine based on target customers",
  "businessLocation": "city, state/region, country - try to detect from contact info, address, or content hints",
  "description": "brief 1-2 sentence description of what they do",
  "targetAudience": "detailed description of who their customers/users are",
  "brandVoice": "one of: Professional, Friendly, Playful, Bold, Minimal",
  "suggestedGoals": ["array of 2-3 specific marketing goals that would suit this business"],
  "keyProducts": ["main products or services offered"],
  "competitorHints": ["any competitor names or similar businesses mentioned or implied"],
  "socialMediaHints": ["any social media URLs or handles found"],
  "confidence": 0.8
}

Important: For businessLocation, look for addresses, phone numbers with area codes, "Contact Us" info, or any location mentions. If not found, make a reasonable guess based on the domain (.co.uk = UK, .com.au = Australia, etc.) or leave as empty string.`;

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
      brandVoice: 'Professional',
      suggestedGoals: [],
      keyProducts: [],
      competitorHints: [],
      socialMediaHints: [],
      confidence: 0.5
    };
    
    if (analysis.json) {
      extractedData = { ...extractedData, ...analysis.json };
    }
    
    // Capitalize company name
    extractedData.companyName = extractedData.companyName
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    
    res.json({
      success: true,
      validUrl: true,
      accessible: true,
      url: validUrl.origin,
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
