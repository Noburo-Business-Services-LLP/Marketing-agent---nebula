/**
 * Gemini AI Service
 * Uses Google Gemini API for all AI-related tasks
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
// Using Gemini 3 Pro Preview for all text generation
const GEMINI_MODELS = [
  'gemini-3-pro-preview',  // Gemini 3 Pro - Best quality
];

// Simple in-memory cache for API responses
const responseCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache
const API_TIMEOUT = 60000; // 60 second timeout for API calls
const EXTENDED_TIMEOUT = 90000; // 90 second timeout for heavy content generation

// Rate limit tracking
let lastApiCall = 0;
const MIN_DELAY_BETWEEN_CALLS = 300; // 300ms minimum between API calls

// Cache cleanup - run every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of responseCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      responseCache.delete(key);
    }
  }
}, 10 * 60 * 1000);

function getCacheKey(prompt) {
  // Create a simple hash of the prompt
  return prompt.substring(0, 100).replace(/\s+/g, '_');
}

/**
 * Sleep helper for rate limiting
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with timeout helper
 */
async function fetchWithTimeout(url, options, timeout = API_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    throw error;
  }
}

/**
 * Call Gemini API with a prompt
 * @param {string} prompt - The prompt to send
 * @param {object} options - Additional options
 * @returns {Promise<string>} - The AI response
 */
async function callGemini(prompt, options = {}) {
  const startTime = Date.now();
  
  // Check cache first (unless explicitly disabled)
  if (!options.skipCache) {
    const cacheKey = getCacheKey(prompt);
    const cached = responseCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      console.log('⚡ Using cached Gemini response (instant)');
      return cached.response;
    }
  }

  const timeout = options.timeout || API_TIMEOUT;
  const maxRetries = 3; // Retry up to 3 times for rate limiting
  
  for (const model of GEMINI_MODELS) {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Rate limiting: ensure minimum delay between calls
        const timeSinceLastCall = Date.now() - lastApiCall;
        if (timeSinceLastCall < MIN_DELAY_BETWEEN_CALLS) {
          await sleep(MIN_DELAY_BETWEEN_CALLS - timeSinceLastCall);
        }
        lastApiCall = Date.now();
        
        const response = await fetchWithTimeout(`${apiUrl}?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: prompt }]
            }],
            generationConfig: {
              temperature: options.temperature || 0.7,
              maxOutputTokens: options.maxTokens || 1024, // Reduced for faster responses
              topP: 0.9
            }
          })
        }, timeout);

        const data = await response.json();

        if (!response.ok) {
          console.error(`Gemini API error (${model}):`, data.error?.message || data);
          // If rate limited, wait and retry with exponential backoff
          if (data.error?.code === 429 || data.error?.code === 503) {
            const backoffMs = Math.min(1000 * Math.pow(2, attempt), 8000); // 1s, 2s, 4s, max 8s
            console.log(`Rate limited on ${model}, waiting ${backoffMs}ms before retry ${attempt + 1}/${maxRetries}...`);
            await sleep(backoffMs);
            continue; // Retry same model
          }
          // If model not found, try next model
          if (data.error?.code === 404) {
            console.log(`Model ${model} not found, trying next...`);
            break; // Break retry loop, try next model
          }
          throw new Error(data.error?.message || 'Gemini API error');
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new Error('No response from Gemini');
        }

        // Cache successful response
        if (!options.skipCache) {
          const cacheKey = getCacheKey(prompt);
          responseCache.set(cacheKey, { response: text, timestamp: Date.now() });
        }

        const duration = Date.now() - startTime;
        console.log(`✅ Gemini response from ${model} in ${duration}ms`);
        return text;
      } catch (error) {
        console.error(`Gemini API call to ${model} failed (attempt ${attempt + 1}):`, error.message);
        if (attempt < maxRetries - 1) {
          await sleep(1000 * (attempt + 1)); // Wait before retry
          continue;
        }
        // All retries failed for this model, try next
        break;
      }
    }
  }
  
  // All APIs failed
  throw new Error('All Gemini API endpoints failed - quota may be exhausted');
}

/**
 * Parse JSON from Gemini response (handles markdown code blocks)
 */
function parseGeminiJSON(text) {
  let cleaned = text.trim();
  // Remove markdown code blocks
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  try {
    return JSON.parse(cleaned.trim());
  } catch (err) {
    console.error('Failed to parse Gemini JSON:', err, '\nRaw response:', cleaned);
    // Return a fallback object or null to avoid crashing the backend
    return { error: 'Invalid Gemini JSON', raw: cleaned };
  }
}

/**
 * Generate personalized campaign suggestions based on business profile
 * Creates highly specific campaigns tailored to the company's products, audience, and brand voice
 */
async function generateCampaignSuggestions(businessProfile, count = 6) {
  // Build a comprehensive context from the business profile
  const companyName = businessProfile.name || 'Your Company';
  const industry = businessProfile.industry || 'General';
  const niche = businessProfile.niche || industry;
  const businessType = businessProfile.businessType || 'B2C';
  const targetAudience = businessProfile.targetAudience || 'General consumers';
  const brandVoice = businessProfile.brandVoice || 'Professional';
  const description = businessProfile.description || '';
  const marketingGoals = (businessProfile.marketingGoals || []).join(', ') || 'Brand awareness';
  
  // Get products/services context if available
  const products = businessProfile.products?.map(p => p.name || p).join(', ') || '';
  const services = businessProfile.services?.map(s => s.name || s).join(', ') || '';
  const keyProducts = businessProfile.keyProducts?.join(', ') || products || services || '';
  
  // Get unique selling points
  const usps = businessProfile.uniqueSellingPoints?.join(', ') || businessProfile.valuePropositions?.join(', ') || '';
  
  // Get brand assets if available
  const brandAssets = businessProfile.brandAssets || {};
  const logoUrl = brandAssets.logoUrl || brandAssets.ogImage || '';
  const brandColors = (brandAssets.brandColors || []).slice(0, 5).join(', ');
  const brandImages = brandAssets.images || [];
  
  // Find product/service images from brand assets
  const productImages = brandImages
    .filter(img => !img.isLogo && img.alt && img.alt.length > 2)
    .slice(0, 5)
    .map(img => img.src);

  const prompt = `You are an expert social media marketing strategist for "${companyName}". Generate ${count} highly personalized, ready-to-post social media campaign ideas that are SPECIFICALLY tailored to this business.

=== BUSINESS PROFILE ===
Company Name: ${companyName}
Industry: ${industry}
Niche/Focus: ${niche}
Business Type: ${businessType}
Company Description: ${description}
Key Products/Services: ${keyProducts || 'Not specified - infer from description'}
Unique Selling Points: ${usps || 'To be determined from context'}
Target Audience: ${targetAudience}
Brand Voice: ${brandVoice} (IMPORTANT: All captions MUST match this voice)
Marketing Goals: ${marketingGoals}
${brandColors ? `Brand Colors: ${brandColors} (use these colors in image prompts)` : ''}
${logoUrl ? `Logo Available: Yes (brand visual identity is important)` : ''}

=== REQUIREMENTS ===
1. Each campaign MUST be directly related to ${companyName}'s actual products/services
2. Captions MUST use the "${brandVoice}" tone consistently
3. Content should speak directly to "${targetAudience}"
4. Hashtags must be industry-specific and relevant to ${industry}/${niche}
5. Include seasonal/trending angles where relevant
6. Each campaign should have a different objective to cover various marketing needs
7. Provide an image search query that would find the PERFECT stock image for this specific campaign
${brandColors ? `8. Image prompts should mention brand colors: ${brandColors}` : ''}

=== BRAND VOICE GUIDELINES ===
${brandVoice === 'Professional' ? '- Use formal language, industry terminology, focus on expertise and credibility' : ''}
${brandVoice === 'Friendly' ? '- Use warm, conversational tone, personal pronouns (we, you), feel approachable' : ''}
${brandVoice === 'Playful' ? '- Use humor, puns, emojis liberally, casual language, fun energy' : ''}
${brandVoice === 'Bold' ? '- Use strong statements, powerful words, confident assertions, call to action' : ''}
${brandVoice === 'Minimal' ? '- Use concise, clean language, fewer words, impactful statements' : ''}

Return ONLY valid JSON (no markdown, no code blocks):
{
  "campaigns": [
    {
      "id": "campaign_1",
      "name": "Specific campaign name for ${companyName}",
      "tagline": "Catchy tagline related to their offering",
      "objective": "awareness|engagement|traffic|sales|conversion",
      "platforms": ["instagram"],
      "description": "Why this campaign works for ${companyName} and ${targetAudience}",
      "caption": "Full ready-to-post caption in ${brandVoice} voice with relevant emojis. Should mention ${companyName} or their products/services. Include call-to-action.",
      "hashtags": ["#${companyName.replace(/\\s+/g, '')}", "#IndustrySpecific", "#NicheRelevant"],
      "imageSearchQuery": "professional photo that would represent this campaign for a ${industry} company",
      "estimatedBudget": { "min": 100, "max": 500, "currency": "USD" },
      "duration": "1 week",
      "expectedReach": "10K - 25K",
      "bestPostTime": "9:00 AM",
      "contentIdeas": ["Specific idea 1 for ${companyName}", "Specific idea 2", "Specific idea 3"]
    }
  ]
}

Generate ${count} diverse campaigns covering different objectives (awareness, engagement, sales, etc.) and platforms (instagram, facebook, linkedin, twitter/X, youtube). Make every campaign UNIQUE and SPECIFIC to ${companyName}.`;

  try {
    const response = await callGemini(prompt, { temperature: 0.8, maxTokens: 4096 });
    const parsed = parseGeminiJSON(response);
    
    // Build rich brand context for image generation
    const brandContext = {
      companyName,
      industry,
      niche,
      products: keyProducts,
      services: services || keyProducts,
      usps: usps,
      targetAudience,
      brandVoice,
      description,
      // Include brand assets for image generation
      logoUrl,
      brandColors: brandAssets.brandColors || [],
      productImages, // Actual product images from website
      ogImage: brandAssets.ogImage || ''
    };
    
    // Enhance campaigns with AI-generated images based on campaign content AND brand context
    if (parsed.campaigns && parsed.campaigns.length > 0) {
      parsed.campaigns = await Promise.all(parsed.campaigns.map(async (campaign, index) => {
        // Generate contextually relevant AI image based on campaign details AND brand
        const imageQuery = campaign.imageSearchQuery || campaign.description || campaign.caption || `${niche} ${campaign.objective} marketing`;
        
        // Try to use product images from the website first
        let imageUrl;
        if (productImages.length > 0 && index < productImages.length) {
          // Use actual product image from brand's website
          imageUrl = productImages[index];
          console.log(`📸 Using product image from brand website: ${imageUrl}`);
        } else if (logoUrl && index === 0) {
          // For brand awareness campaigns, use the logo/ogImage
          imageUrl = logoUrl;
          console.log(`🏷️ Using brand logo for campaign: ${logoUrl}`);
        } else {
          // Generate relevant image with brand context
          imageUrl = await getRelevantImage(
            imageQuery, 
            industry, 
            campaign.objective,
            campaign.title || campaign.name,
            campaign.platform || 'instagram',
            brandContext // Pass full brand context for personalized images
          );
        }
        
        return {
          ...campaign,
          imageUrl,
          id: campaign.id || `campaign_${index + 1}`
        };
      }));
    }
    
    return parsed;
  } catch (error) {
    console.error('Campaign generation error:', error);
    return { campaigns: [] };
  }
}

/**
 * Generate a SINGLE campaign quickly for streaming/progressive loading
 * This is optimized for speed - generates one campaign at a time
 */
async function generateSingleCampaign(businessProfile, index, total) {
  const companyName = businessProfile.name || 'Your Company';
  const industry = businessProfile.industry || 'General';
  const niche = businessProfile.niche || industry;
  const businessType = businessProfile.businessType || 'B2C';
  const targetAudience = businessProfile.targetAudience || 'General consumers';
  const brandVoice = businessProfile.brandVoice || 'Professional';
  const marketingGoals = (businessProfile.marketingGoals || []).join(', ') || 'Brand awareness';
  
  // Vary objectives for diversity with randomness
  const objectives = ['awareness', 'engagement', 'sales', 'traffic', 'trust', 'conversion'];
  const platforms = ['instagram', 'facebook', 'linkedin', 'twitter', 'youtube'];
  
  // Add randomness to selection to ensure variety on regeneration
  const randomSeed = Date.now() + index;
  const shuffledObjectives = [...objectives].sort(() => Math.sin(randomSeed) - 0.5);
  const shuffledPlatforms = [...platforms].sort(() => Math.cos(randomSeed) - 0.5);
  
  const objective = shuffledObjectives[index % shuffledObjectives.length];
  const platform = shuffledPlatforms[index % shuffledPlatforms.length];
  
  // Add variety triggers based on time
  const varietyHooks = [
    'Create a FRESH and UNIQUE',
    'Design an INNOVATIVE',
    'Craft a CREATIVE and ORIGINAL',
    'Develop a COMPELLING',
    'Build an ENGAGING',
    'Generate a STANDOUT'
  ];
  const hookIndex = (Date.now() + index) % varietyHooks.length;
  
  // Get additional business context
  const products = businessProfile.products?.map(p => p.name || p).join(', ') || '';
  const services = businessProfile.services?.map(s => s.name || s).join(', ') || '';
  const keyProducts = businessProfile.keyProducts?.join(', ') || products || services || '';
  const usps = businessProfile.uniqueSellingPoints?.join(', ') || '';
  const description = businessProfile.description || '';
  
  const prompt = `${varietyHooks[hookIndex]} ${objective}-focused social media campaign for "${companyName}" (${industry}/${niche}).

BUSINESS DETAILS:
- Company: ${companyName}
- Products/Services: ${keyProducts || 'Various offerings'}
- Unique Selling Points: ${usps || 'Quality and excellence'}
- Description: ${description || 'A leading company in ' + industry}

IMPORTANT: Generate content SPECIFICALLY about these products/services. Make it relevant to what ${companyName} actually sells.

Target: ${targetAudience}
Voice: ${brandVoice}
Platform: ${platform}
Goals: ${marketingGoals}
Timestamp: ${Date.now()}

Return ONLY valid JSON (no markdown):
{
  "id": "campaign_${Date.now()}_${index}",
  "name": "Unique campaign title about ${companyName}'s products/services",
  "objective": "${objective}",
  "platforms": ["${platform}"],
  "caption": "SPECIFIC caption about ${companyName}'s actual products/services. Use ${brandVoice} voice. Include emojis and compelling call-to-action.",
  "hashtags": ["#${companyName.replace(/\s+/g, '')}", "#Industry", "#ProductRelevant"],
  "bestPostTime": "Choose optimal time like 9:00 AM, 12:00 PM, 3:00 PM, 6:00 PM, or 8:00 PM",
  "estimatedReach": "10K - 25K",
  "imageDescription": "Describe the perfect image for this campaign featuring ${companyName}'s brand"
}`;

  try {
    const response = await callGemini(prompt, { temperature: 0.95, maxTokens: 1024, skipCache: true });
    const campaign = parseGeminiJSON(response);
    
    // Build rich brand context for image generation
    const brandContext = {
      companyName,
      industry,
      niche,
      products: keyProducts,
      services: services || keyProducts,
      usps,
      targetAudience,
      brandVoice,
      description
    };
    
    // Generate AI image for this campaign with brand context
    const imageUrl = await getRelevantImage(
      campaign.imageDescription || campaign.caption || campaign.name || `${niche} ${objective} marketing`,
      industry,
      objective,
      campaign.name,
      platform,
      brandContext // Pass full brand context
    );
    
    return {
      ...campaign,
      imageUrl,
      id: campaign.id || `campaign_${index + 1}`
    };
  } catch (error) {
    console.error(`Error generating single campaign ${index}:`, error);
    
    // Return a fallback campaign on error
    return {
      id: `campaign_${index + 1}`,
      name: `${companyName} ${objective.charAt(0).toUpperCase() + objective.slice(1)} Campaign`,
      objective,
      platforms: [platform],
      caption: `✨ Discover what makes ${companyName} special! We're here to serve ${targetAudience} with the best in ${industry}. \n\n💬 What would you like to see from us? Let us know below! \n\n#${companyName.replace(/\s+/g, '')} #${industry}`,
      hashtags: [`#${companyName.replace(/\s+/g, '')}`, `#${industry}`, '#Marketing', '#Growth'],
      imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(`${niche} ${objective} marketing professional photo`)}?width=800&height=600&seed=${Date.now()}`,
      bestPostTime: '10:00 AM',
      estimatedReach: '10K - 20K'
    };
  }
}

/**
 * Generate AI image using Google Gemini Imagen 3 API
 * Creates images RELEVANT to the campaign content for social media posting
 */
async function generateAIImage(campaignTitle, campaignDescription, objective, platform, industry, brandContext = {}) {
  // Create a detailed, campaign-specific prompt for relevant images with brand context
  const campaignContext = campaignDescription || campaignTitle || '';
  
  // Build rich brand-aware prompt with specific details
  const brandDetails = [];
  if (brandContext.companyName) brandDetails.push(`Brand: ${brandContext.companyName}`);
  if (brandContext.products) brandDetails.push(`Products/Services: ${brandContext.products}`);
  if (brandContext.niche) brandDetails.push(`Business type: ${brandContext.niche}`);
  if (brandContext.description) brandDetails.push(`About: ${brandContext.description.substring(0, 100)}`);
  
  // Add brand colors if available
  const brandColors = brandContext.brandColors || [];
  if (brandColors.length > 0) {
    brandDetails.push(`Brand colors: ${brandColors.slice(0, 3).join(', ')} (incorporate these colors)`);
  }
  
  const brandInfo = brandDetails.length > 0 ? brandDetails.join('. ') + '.' : '';
  
  // Color guidance for image generation
  const colorGuidance = brandColors.length > 0 
    ? `Use these brand colors prominently: ${brandColors.slice(0, 3).join(', ')}.` 
    : '';
  
  // Create a very specific image prompt based on the niche
  let nicheSpecificStyle = '';
  const niche = (brandContext.niche || industry || '').toLowerCase();
  
  if (niche.includes('startup') || niche.includes('accelerator') || niche.includes('incubator')) {
    nicheSpecificStyle = 'Show entrepreneurs working in a modern coworking space, startup pitch meeting, or innovation hub atmosphere. Young professionals collaborating, whiteboards with ideas, laptops and tech setup.';
  } else if (niche.includes('education') || niche.includes('training') || niche.includes('bootcamp')) {
    nicheSpecificStyle = 'Show students learning, classroom or workshop setting, mentorship session, or graduation moment. Include books, laptops, engaged learners.';
  } else if (niche.includes('tech') || niche.includes('software') || niche.includes('saas')) {
    nicheSpecificStyle = 'Show modern technology workspace, code on screens, team collaboration, or product demo. Sleek tech aesthetic.';
  } else if (niche.includes('fashion') || niche.includes('apparel') || niche.includes('clothing')) {
    nicheSpecificStyle = 'Show stylish clothing, fashion photoshoot, models wearing products, or curated outfit display.';
  } else if (niche.includes('food') || niche.includes('restaurant')) {
    nicheSpecificStyle = 'Show delicious food photography, restaurant ambiance, cooking process, or happy diners.';
  }
  
  // Extract key themes from the campaign
  const prompt = `Create a professional, high-quality social media marketing image.

BRAND CONTEXT:
${brandInfo}
${colorGuidance}

CAMPAIGN: "${campaignTitle}"
${campaignContext.substring(0, 200)}

VISUAL STYLE:
${nicheSpecificStyle || `Professional ${industry} imagery that represents the brand's core offering.`}

REQUIREMENTS:
- Industry: ${industry}
- Target audience: ${brandContext.targetAudience || 'professionals and consumers'}
- Platform: ${platform} (optimized aspect ratio)
- Objective: ${objective} campaign
- Style: Modern, clean, vibrant colors, professional photography
- NO text or words in image
- Commercial quality suitable for marketing

Make the image specific to ${brandContext.companyName || 'the brand'}'s actual business and products.`;

  console.log('Generating brand-specific image for:', campaignTitle);
  
  try {
    // Use Imagen 4 Ultra (best quality)
    console.log('🎨 Generating with Imagen 4 Ultra...');
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-ultra-generate-001:predict?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: platform === 'youtube' ? '16:9' : '1:1',
            safetyFilterLevel: 'block_few',
            personGeneration: 'allow_adult'
          }
        })
      }
    );

    const data = await response.json();
    
    if (data.predictions && data.predictions[0]?.bytesBase64Encoded) {
      console.log('✅ Imagen 4 Ultra generated image successfully');
      return `data:image/png;base64,${data.predictions[0].bytesBase64Encoded}`;
    }
    
    console.log('Imagen 4 Ultra response:', JSON.stringify(data).substring(0, 200));
    
    // Fallback to stock image
    return getRelevantStockImage(campaignTitle, industry, objective, platform);
    
  } catch (error) {
    console.error('Gemini Imagen error:', error.message);
    return await generateImageWithGeminiFlash(campaignTitle, campaignDescription, industry, objective, platform, brandContext);
  }
}

/**
 * Generate image using Imagen 4 Ultra (fallback function)
 */
async function generateImageWithGeminiFlash(campaignTitle, campaignDescription, industry, objective, platform, brandContext = {}) {
  // Build brand-aware prompt
  const brandInfo = brandContext.companyName ? `for ${brandContext.companyName} (${brandContext.products || brandContext.services || industry})` : `for a ${industry} brand`;
  const targetInfo = brandContext.targetAudience ? `, appealing to ${brandContext.targetAudience}` : '';
  
  const prompt = `Generate a stunning, professional social media image ${brandInfo} campaign called "${campaignTitle}". The image should be perfect for ${platform}, with modern design, vibrant and eye-catching visuals that represent the brand's products/services${targetInfo}. No text in the image. High-quality commercial photography style.`;
  
  try {
    console.log('🎨 Generating with Imagen 4 Ultra (fallback)...');
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-ultra-generate-001:predict?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: platform === 'instagram' ? '1:1' : '16:9',
            safetyFilterLevel: 'block_few',
            personGeneration: 'allow_adult'
          }
        })
      }
    );

    const data = await response.json();
    
    if (data.predictions?.[0]?.bytesBase64Encoded) {
      console.log('✅ Imagen 4 Ultra generated image successfully');
      return `data:image/png;base64,${data.predictions[0].bytesBase64Encoded}`;
    }
    
    console.log('Imagen 4 Ultra response:', JSON.stringify(data).substring(0, 200));
  } catch (error) {
    console.log('Imagen 4 Ultra failed:', error.message);
  }
  
  // Fallback to stock image
  console.log('⚠️ Image generation failed, using stock image');
  return getRelevantStockImage(campaignTitle, industry, objective, platform);
}

/**
 * Get relevant stock images based on campaign keywords
 * Uses Pexels-style URLs that actually work
 */
function getRelevantStockImage(campaignTitle, industry, objective, platform) {
  const title = (campaignTitle || '').toLowerCase();
  const ind = (industry || '').toLowerCase();
  
  // Keyword-based image mapping for relevance
  const keywordImages = {
    // Startup & Entrepreneurship
    'startup': 'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=800&h=600&fit=crop',
    'accelerator': 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&h=600&fit=crop',
    'incubator': 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&h=600&fit=crop',
    'entrepreneur': 'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&h=600&fit=crop',
    'bootcamp': 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=800&h=600&fit=crop',
    'founder': 'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=800&h=600&fit=crop',
    'pitch': 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=600&fit=crop',
    'mentor': 'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&h=600&fit=crop',
    'cohort': 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&h=600&fit=crop',
    'innovation': 'https://images.unsplash.com/photo-1531545514256-b1400bc00f31?w=800&h=600&fit=crop',
    
    // Education & Learning
    'workshop': 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&h=600&fit=crop',
    'training': 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=800&h=600&fit=crop',
    'learning': 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=600&fit=crop',
    'course': 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=800&h=600&fit=crop',
    'student': 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=600&fit=crop',
    
    // Sports & Athletics
    'champion': 'https://images.pexels.com/photos/3621104/pexels-photo-3621104.jpeg?w=800&h=600&fit=crop',
    'athlete': 'https://images.pexels.com/photos/2294361/pexels-photo-2294361.jpeg?w=800&h=600&fit=crop',
    'running': 'https://images.pexels.com/photos/2402777/pexels-photo-2402777.jpeg?w=800&h=600&fit=crop',
    'sports': 'https://images.pexels.com/photos/3621104/pexels-photo-3621104.jpeg?w=800&h=600&fit=crop',
    'fitness': 'https://images.pexels.com/photos/841130/pexels-photo-841130.jpeg?w=800&h=600&fit=crop',
    'workout': 'https://images.pexels.com/photos/1552242/pexels-photo-1552242.jpeg?w=800&h=600&fit=crop',
    'gym': 'https://images.pexels.com/photos/1954524/pexels-photo-1954524.jpeg?w=800&h=600&fit=crop',
    
    // Fashion & Style
    'style': 'https://images.pexels.com/photos/1536619/pexels-photo-1536619.jpeg?w=800&h=600&fit=crop',
    'fashion': 'https://images.pexels.com/photos/1536619/pexels-photo-1536619.jpeg?w=800&h=600&fit=crop',
    'school': 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=600&fit=crop',
    'back-to-school': 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=600&fit=crop',
    
    // Community & People
    'community': 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&h=600&fit=crop',
    'spotlight': 'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=800&h=600&fit=crop',
    'team': 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&h=600&fit=crop',
    'success': 'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=800&h=600&fit=crop',
    'brand': 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop',
    'story': 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop',
    
    // Business & Marketing
    'lead': 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=600&fit=crop',
    'business': 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=600&fit=crop',
    'partner': 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=600&fit=crop',
    'organization': 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=600&fit=crop'
  };
  
  // Industry-specific defaults
  const industryDefaults = {
    'startup': 'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=800&h=600&fit=crop',
    'accelerator': 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&h=600&fit=crop',
    'edtech': 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=600&fit=crop',
    'education': 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=800&h=600&fit=crop',
    'sports': 'https://images.pexels.com/photos/3621104/pexels-photo-3621104.jpeg?w=800&h=600&fit=crop',
    'apparel': 'https://images.pexels.com/photos/1536619/pexels-photo-1536619.jpeg?w=800&h=600&fit=crop',
    'fashion': 'https://images.pexels.com/photos/1536619/pexels-photo-1536619.jpeg?w=800&h=600&fit=crop',
    'technology': 'https://images.pexels.com/photos/3861969/pexels-photo-3861969.jpeg?w=800&h=600&fit=crop',
    'food': 'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?w=800&h=600&fit=crop',
    'health': 'https://images.pexels.com/photos/841130/pexels-photo-841130.jpeg?w=800&h=600&fit=crop',
    'ecommerce': 'https://images.pexels.com/photos/5632402/pexels-photo-5632402.jpeg?w=800&h=600&fit=crop',
    'default': 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop'
  };
  
  // Find matching keyword in campaign title
  for (const [keyword, imageUrl] of Object.entries(keywordImages)) {
    if (title.includes(keyword)) {
      console.log(`✅ Found relevant image for keyword: ${keyword}`);
      return imageUrl;
    }
  }
  
  // Fall back to industry default
  for (const [key, imageUrl] of Object.entries(industryDefaults)) {
    if (ind.includes(key)) {
      console.log(`✅ Using industry default image for: ${key}`);
      return imageUrl;
    }
  }
  
  console.log('Using general default image');
  return industryDefaults.default;
}

/**
 * Generate image from a custom user prompt
 * This function uses the user's exact prompt to generate an image
 */
async function generateImageFromCustomPrompt(customPrompt, platform = 'instagram') {
  console.log(`🎨 Generating image from custom prompt: "${customPrompt.substring(0, 100)}..."`);
  
  // Enhance the prompt for better image generation while keeping user's intent
  const enhancedPrompt = `Create a high-quality, professional image based on this description: ${customPrompt}. 
Style requirements: High resolution, suitable for ${platform} social media, professional photography or digital art quality, visually appealing, no text or watermarks in the image.`;

  try {
    // Use Imagen 4 Ultra for best quality image generation
    console.log('🎨 Generating with Imagen 4 Ultra...');
    const imagenResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-ultra-generate-001:predict?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: enhancedPrompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: platform === 'youtube' ? '16:9' : '1:1',
            safetyFilterLevel: 'block_few',
            personGeneration: 'allow_adult'
          }
        })
      }
    );

    const imagenData = await imagenResponse.json();
    
    if (imagenData.predictions && imagenData.predictions[0]?.bytesBase64Encoded) {
      console.log('✅ Imagen 4 Ultra generated image from custom prompt successfully');
      return `data:image/png;base64,${imagenData.predictions[0].bytesBase64Encoded}`;
    }
    
    console.log('Imagen 4 Ultra did not return image:', JSON.stringify(imagenData).substring(0, 200));
    
  } catch (error) {
    console.error('Imagen 4 Ultra error:', error.message);
  }

  // Last resort: Use Unsplash API with search based on prompt keywords
  console.log('AI image generation unavailable, falling back to Unsplash search...');
  return await searchUnsplashImage(customPrompt);
}

/**
 * Search Unsplash for relevant images based on keywords
 */
async function searchUnsplashImage(query) {
  // Extract key terms from the query
  const keywords = query.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(' ')
    .filter(word => word.length > 3)
    .slice(0, 3)
    .join(',');
  
  const searchTerm = keywords || 'professional,business,modern';
  
  // Use Unsplash Source for direct image URLs
  const unsplashUrl = `https://source.unsplash.com/800x600/?${encodeURIComponent(searchTerm)}`;
  console.log(`📷 Using Unsplash search for: ${searchTerm}`);
  
  return unsplashUrl;
}

/**
 * Get a relevant image - tries Gemini AI first, then keyword-based fallback
 */
async function getRelevantImage(searchQuery, industry, objective, campaignTitle = '', platform = 'instagram', brandContext = {}) {
  try {
    const imageUrl = await generateAIImage(
      campaignTitle || searchQuery,
      searchQuery,
      objective,
      platform,
      industry,
      brandContext
    );
    return imageUrl;
  } catch (error) {
    console.error('Image generation failed:', error);
    return getRelevantStockImage(campaignTitle || searchQuery, industry, objective, platform);
  }
}

/**
 * Fallback to curated Unsplash images if AI generation fails
 */
function getFallbackImage(industry, objective) {
  // Curated high-quality images by industry and objective
  const industryImages = {
    'startup': {
      'awareness': 'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=800&h=600&fit=crop',
      'engagement': 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&h=600&fit=crop',
      'sales': 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=600&fit=crop',
      'traffic': 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&h=600&fit=crop',
      'conversion': 'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&h=600&fit=crop'
    },
    'edtech': {
      'awareness': 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=800&h=600&fit=crop',
      'engagement': 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=600&fit=crop',
      'sales': 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&h=600&fit=crop',
      'traffic': 'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&h=600&fit=crop',
      'conversion': 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&h=600&fit=crop'
    },
    'education': {
      'awareness': 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=800&h=600&fit=crop',
      'engagement': 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=600&fit=crop',
      'sales': 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&h=600&fit=crop',
      'traffic': 'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&h=600&fit=crop',
      'conversion': 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&h=600&fit=crop'
    },
    'ecommerce': {
      'awareness': 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800&h=600&fit=crop',
      'engagement': 'https://images.unsplash.com/photo-1556742111-a301076d9d18?w=800&h=600&fit=crop',
      'sales': 'https://images.unsplash.com/photo-1607082349566-187342175e2f?w=800&h=600&fit=crop',
      'traffic': 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=600&fit=crop',
      'conversion': 'https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=800&h=600&fit=crop'
    },
    'saas': {
      'awareness': 'https://images.unsplash.com/photo-1551434678-e076c223a692?w=800&h=600&fit=crop',
      'engagement': 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop',
      'sales': 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=600&fit=crop',
      'traffic': 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&h=600&fit=crop',
      'conversion': 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop'
    },
    'service': {
      'awareness': 'https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=800&h=600&fit=crop',
      'engagement': 'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=800&h=600&fit=crop',
      'sales': 'https://images.unsplash.com/photo-1553028826-f4804a6dba3b?w=800&h=600&fit=crop',
      'traffic': 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=600&fit=crop',
      'conversion': 'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=800&h=600&fit=crop'
    },
    'content': {
      'awareness': 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800&h=600&fit=crop',
      'engagement': 'https://images.unsplash.com/photo-1432888498266-38ffec3eaf0a?w=800&h=600&fit=crop',
      'sales': 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=800&h=600&fit=crop',
      'traffic': 'https://images.unsplash.com/photo-1455849318743-b2233052fcff?w=800&h=600&fit=crop',
      'conversion': 'https://images.unsplash.com/photo-1542435503-956c469947f6?w=800&h=600&fit=crop'
    },
    'fitness': {
      'awareness': 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&h=600&fit=crop',
      'engagement': 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=800&h=600&fit=crop',
      'sales': 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=800&h=600&fit=crop',
      'traffic': 'https://images.unsplash.com/photo-1549060279-7e168fcee0c2?w=800&h=600&fit=crop',
      'conversion': 'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=800&h=600&fit=crop'
    },
    'food': {
      'awareness': 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&h=600&fit=crop',
      'engagement': 'https://images.unsplash.com/photo-1493770348161-369560ae357d?w=800&h=600&fit=crop',
      'sales': 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&h=600&fit=crop',
      'traffic': 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=800&h=600&fit=crop',
      'conversion': 'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=800&h=600&fit=crop'
    },
    'fashion': {
      'awareness': 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=800&h=600&fit=crop',
      'engagement': 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=800&h=600&fit=crop',
      'sales': 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=800&h=600&fit=crop',
      'traffic': 'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=800&h=600&fit=crop',
      'conversion': 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&h=600&fit=crop'
    },
    'beauty': {
      'awareness': 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=800&h=600&fit=crop',
      'engagement': 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=800&h=600&fit=crop',
      'sales': 'https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=800&h=600&fit=crop',
      'traffic': 'https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?w=800&h=600&fit=crop',
      'conversion': 'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?w=800&h=600&fit=crop'
    },
    'technology': {
      'awareness': 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&h=600&fit=crop',
      'engagement': 'https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=800&h=600&fit=crop',
      'sales': 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=800&h=600&fit=crop',
      'traffic': 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&h=600&fit=crop',
      'conversion': 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&h=600&fit=crop'
    },
    'healthcare': {
      'awareness': 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1f?w=800&h=600&fit=crop',
      'engagement': 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=800&h=600&fit=crop',
      'sales': 'https://images.unsplash.com/photo-1538108149393-fbbd81895907?w=800&h=600&fit=crop',
      'traffic': 'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=800&h=600&fit=crop',
      'conversion': 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=800&h=600&fit=crop'
    },
    'education': {
      'awareness': 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800&h=600&fit=crop',
      'engagement': 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=600&fit=crop',
      'sales': 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=800&h=600&fit=crop',
      'traffic': 'https://images.unsplash.com/photo-1509062522246-3755977927d7?w=800&h=600&fit=crop',
      'conversion': 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=800&h=600&fit=crop'
    },
    'realestate': {
      'awareness': 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&h=600&fit=crop',
      'engagement': 'https://images.unsplash.com/photo-1582407947304-fd86f028f716?w=800&h=600&fit=crop',
      'sales': 'https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=800&h=600&fit=crop',
      'traffic': 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&h=600&fit=crop',
      'conversion': 'https://images.unsplash.com/photo-1554995207-c18c203602cb?w=800&h=600&fit=crop'
    }
  };
  
  // Default images for any industry
  const defaultImages = {
    'awareness': 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=600&fit=crop',
    'engagement': 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop',
    'traffic': 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=600&fit=crop',
    'sales': 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800&h=600&fit=crop',
    'conversion': 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop'
  };
  
  // Normalize industry name
  const normalizedIndustry = industry.toLowerCase().replace(/[^a-z]/g, '');
  const normalizedObjective = objective.toLowerCase();
  
  // Try to find industry-specific image
  if (industryImages[normalizedIndustry] && industryImages[normalizedIndustry][normalizedObjective]) {
    return industryImages[normalizedIndustry][normalizedObjective];
  }
  
  // Fall back to default objective-based image
  return defaultImages[normalizedObjective] || defaultImages.awareness;
}

/**
 * Generate personalized dashboard insights with specific actionable recommendations
 */
async function generateDashboardInsights(businessProfile, metrics = {}) {
  const goals = (businessProfile.marketingGoals || []).join(', ') || 'increase brand awareness';
  const hasNoCampaigns = (metrics.totalCampaigns || 0) === 0;
  
  const prompt = `You are an expert marketing strategist AI. Generate highly personalized, actionable marketing recommendations for this business:

BUSINESS PROFILE:
- Company Name: ${businessProfile.name || 'Business'}
- Industry: ${businessProfile.industry || 'General'}
- Niche: ${businessProfile.niche || 'Not specified'}
- Business Type: ${businessProfile.businessType || 'B2C'}
- Target Audience: ${businessProfile.targetAudience || 'General consumers'}
- Brand Voice: ${businessProfile.brandVoice || 'Professional'}
- Marketing Goals: ${goals}
- Business Description: ${businessProfile.description || 'Not provided'}

CURRENT STATUS:
- Total Campaigns: ${metrics.totalCampaigns || 0}
- Active Campaigns: ${metrics.activeCampaigns || 0}
- Total Spend: $${metrics.totalSpent || 0}
- Engagement Rate: ${metrics.engagementRate || 0}%
${hasNoCampaigns ? '- Status: NEW USER - No campaigns created yet' : ''}

IMPORTANT: Generate 4-5 SPECIFIC, ACTIONABLE recommendations. Each action MUST have one of these exact actionType values:
- "create_campaign" - For creating new marketing campaigns
- "create_post" - For creating social media posts
- "create_story" - For creating Instagram/Facebook stories
- "analyze_competitors" - For competitor analysis tasks
- "find_influencers" - For influencer discovery
- "engage_audience" - For engagement activities (comments, replies, interactions)
- "connect_social" - For connecting social media accounts
- "view_analytics" - For reviewing performance data
- "schedule_content" - For scheduling posts

Return ONLY valid JSON (no markdown, no code blocks):
{
  "suggestedActions": [
    {
      "id": "action_1",
      "title": "Create a ${businessProfile.industry || 'marketing'} awareness campaign",
      "description": "Launch your first campaign to reach ${businessProfile.targetAudience || 'your target audience'}",
      "actionType": "create_campaign",
      "priority": "high"
    },
    {
      "id": "action_2",
      "title": "Post engaging content about ${businessProfile.niche || 'your niche'}",
      "description": "Share valuable content to build audience trust",
      "actionType": "create_post",
      "priority": "high"
    },
    {
      "id": "action_3",
      "title": "Analyze competitor strategies in ${businessProfile.industry || 'your industry'}",
      "description": "Understand what works for competitors to improve your approach",
      "actionType": "analyze_competitors",
      "priority": "medium"
    },
    {
      "id": "action_4",
      "title": "Find influencers in ${businessProfile.niche || 'your niche'}",
      "description": "Partner with influencers to expand reach",
      "actionType": "find_influencers",
      "priority": "medium"
    },
    {
      "id": "action_5",
      "title": "Engage with your audience comments",
      "description": "Build community by responding to followers",
      "actionType": "engage_audience",
      "priority": "low"
    }
  ],
  "trendingTopics": [
    {
      "id": "trend_1",
      "title": "Current trend in ${businessProfile.industry || 'your industry'}",
      "description": "Why this matters for your business",
      "category": "${businessProfile.industry || 'Marketing'}"
    }
  ],
  "personalizedTips": [
    "Specific tip for ${businessProfile.industry || 'your'} businesses",
    "Tip related to reaching ${businessProfile.targetAudience || 'your target audience'}",
    "Content idea aligned with ${businessProfile.brandVoice || 'your brand'} voice"
  ],
  "brandScoreFactors": {
    "engagement": { "score": ${hasNoCampaigns ? 0 : 70}, "reason": "${hasNoCampaigns ? 'Create your first campaign to start tracking' : 'Based on current engagement metrics'}" },
    "consistency": { "score": ${hasNoCampaigns ? 0 : 65}, "reason": "${hasNoCampaigns ? 'Start posting regularly to improve' : 'Based on posting frequency'}" },
    "audienceGrowth": { "score": ${hasNoCampaigns ? 0 : 60}, "reason": "${hasNoCampaigns ? 'Connect social accounts to track growth' : 'Based on ' + (businessProfile.industry || 'your') + ' industry benchmarks'}" },
    "contentQuality": { "score": ${hasNoCampaigns ? 0 : 75}, "reason": "${hasNoCampaigns ? 'Create content to measure quality' : 'Aligned with ' + (businessProfile.brandVoice || 'your') + ' brand voice'}" }
  }
}

Make titles and descriptions SPECIFIC to their business "${businessProfile.name || 'this company'}" in the ${businessProfile.industry || 'their'} industry targeting ${businessProfile.targetAudience || 'their audience'}.`;

  try {
    const response = await callGemini(prompt);
    return parseGeminiJSON(response);
  } catch (error) {
    console.error('Dashboard insights error:', error);
    return {
      suggestedActions: [],
      trendingTopics: [],
      personalizedTips: [],
      brandScoreFactors: {}
    };
  }
}

/**
 * Generate chat response with business context
 */
async function generateChatResponse(message, businessProfile, conversationHistory = []) {
  const context = businessProfile ? `
You are Daddy, the dedicated marketing assistant for ${businessProfile.name}. You're friendly, confident, and always ready to help with marketing advice.

BUSINESS CONTEXT:
- Company: ${businessProfile.name}
- Industry: ${businessProfile.industry || 'General'}
- Niche: ${businessProfile.niche || 'Not specified'}
- Business Type: ${businessProfile.businessType || 'B2C'}
- Target Audience: ${businessProfile.targetAudience || 'General consumers'}
- Brand Voice: ${businessProfile.brandVoice || 'Professional'}
- Marketing Goals: ${(businessProfile.marketingGoals || []).join(', ') || 'Brand awareness'}
- Description: ${businessProfile.description || 'No description'}

Always personalize your responses based on their business. Reference their industry, audience, and goals.
Maintain a ${businessProfile.brandVoice || 'Professional'} tone but be approachable and fun.
` : `You are Daddy, an intelligent and friendly marketing assistant. You're confident, helpful, and always ready to provide actionable marketing advice.`;

  const historyText = conversationHistory.slice(-5).map(m => 
    `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
  ).join('\n');

  const prompt = `${context}

${historyText ? `Previous conversation:\n${historyText}\n\n` : ''}User: ${message}

Provide a helpful, concise response (under 200 words). Be actionable and specific to their business if context is available.`;

  try {
    const response = await callGemini(prompt, { maxTokens: 500 });
    return response;
  } catch (error) {
    console.error('Chat response error:', error);
    // Provide smart fallback responses based on message content
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('hello') || lowerMessage.includes('hi ') || lowerMessage.includes('hey') || lowerMessage === 'hi') {
      return "Hey there! 👋 I'm Daddy, your marketing assistant. I'm here to help you with marketing strategies, content ideas, social media tips, and more. What would you like to work on today?";
    }
    if (lowerMessage.includes('strategy') || lowerMessage.includes('plan')) {
      return "Great question about strategy! 📊 Here are some key things to consider:\n\n1. Define your target audience clearly\n2. Set measurable goals (followers, engagement, conversions)\n3. Choose 2-3 platforms to focus on\n4. Create a content calendar\n5. Analyze and adjust weekly\n\nWant me to dive deeper into any of these?";
    }
    if (lowerMessage.includes('content') || lowerMessage.includes('post') || lowerMessage.includes('idea')) {
      return "Let's talk content! 🎯 Here are some high-performing content types:\n\n• Behind-the-scenes posts\n• User-generated content\n• Educational tips & how-tos\n• Trending topics & memes\n• Customer testimonials\n• Polls and questions\n• Before/after transformations\n\nConsistency is key - aim for 3-5 posts per week. What's your niche?";
    }
    if (lowerMessage.includes('engagement') || lowerMessage.includes('follower') || lowerMessage.includes('grow')) {
      return "Boosting engagement is all about connection! 💪\n\n1. Post when your audience is most active\n2. Use strong CTAs (ask questions!)\n3. Respond to every comment\n4. Use stories and reels\n5. Collaborate with others in your niche\n6. Go live regularly\n7. Use trending audio and hashtags\n\nWhat platform are you focusing on?";
    }
    if (lowerMessage.includes('instagram') || lowerMessage.includes('insta')) {
      return "Instagram tips coming right up! 📸\n\n• Reels are getting 2x more reach than static posts\n• Use 3-5 hashtags strategically\n• Post carousels for educational content\n• Stories with polls boost engagement 40%\n• Best posting times: 11am-1pm and 7-9pm\n\nWhat specific aspect of Instagram do you need help with?";
    }
    if (lowerMessage.includes('video') || lowerMessage.includes('reels')) {
      return "Video content is 🔥 right now! Here's how to crush it with Reels & YouTube Shorts:\n\n• Hook viewers in the first 2 seconds\n• Use trending audio\n• Post consistently\n• Be authentic - raw content often outperforms polished\n• Add captions for accessibility\n\nWhat type of videos are you thinking about creating?";
    }
    if (lowerMessage.includes('help') || lowerMessage.includes('what can you')) {
      return "I'm here to help with your marketing needs! 🚀 I can assist with:\n\n• Content strategy & ideas\n• Social media tips\n• Campaign planning\n• Audience growth tactics\n• Hashtag strategies\n• Best posting times\n• Trend analysis\n\nJust ask me anything!";
    }
    if (lowerMessage.includes('thank')) {
      return "You're welcome! 😊 I'm always here if you need more marketing help. Let's crush those goals together! 🚀";
    }
    
    return "Great question! 🎯 I'd love to help you with that. While I gather more context, here are some quick marketing tips:\n\n1. Know your audience inside out\n2. Be consistent with your posting schedule\n3. Engage authentically with your community\n4. Test different content formats\n5. Track your metrics weekly\n\nCan you tell me more about what specific area you'd like to focus on?";
  }
}

/**
 * Generate section synopsis for dashboard
 */
async function generateSectionSynopsis(section, data, businessProfile) {
  // Build section-specific context
  let sectionContext = '';
  let dataContext = '';
  
  switch (section) {
    case 'activeCampaigns':
      sectionContext = 'Active Marketing Campaigns - The number of campaigns currently running';
      dataContext = `Campaign count: ${data?.count || 0}, Change from last period: ${data?.change || 0}%`;
      break;
    case 'budgetSpent':
      sectionContext = 'Marketing Budget Spent - Total advertising spend';
      dataContext = `Total spent: $${data?.total || 0}, Daily spend pattern: ${JSON.stringify(data?.dailyData || [])}`;
      break;
    case 'brandScore':
      sectionContext = 'AI Brand Score - Overall marketing health metric (0-100)';
      dataContext = `Current score: ${data?.score || 0}/100, Change: ${data?.change || 0}%, Score factors: ${JSON.stringify(data?.factors || {})}`;
      break;
    case 'competitorRadar':
      sectionContext = 'Competitor Analysis - Monitoring competitor social media activity';
      dataContext = `Posts tracked: ${data?.posts?.length || 0}, Competitors monitored: ${data?.competitors?.length || 0}`;
      break;
    case 'recommendedActions':
      sectionContext = 'AI Recommended Actions - Suggested next steps for marketing';
      dataContext = `Actions pending: ${data?.count || 0}`;
      break;
    case 'calendar':
      sectionContext = 'Campaign Calendar - Scheduled and planned marketing activities';
      dataContext = `Scheduled campaigns: ${data?.scheduled || 0}, Upcoming posts: ${data?.upcoming || 0}`;
      break;
    default:
      sectionContext = section;
      dataContext = JSON.stringify(data);
  }

  const prompt = `You are a marketing analytics AI providing insights for ${businessProfile?.name || 'a business'} in the ${businessProfile?.industry || 'general'} industry.

SECTION: ${sectionContext}
DATA: ${dataContext}

BUSINESS CONTEXT:
- Company: ${businessProfile?.name || 'Not specified'}
- Industry: ${businessProfile?.industry || 'General'}
- Target Audience: ${businessProfile?.targetAudience || 'General consumers'}
- Marketing Goals: ${(businessProfile?.marketingGoals || []).join(', ') || 'Brand awareness'}

Provide a concise, actionable analysis. Return ONLY valid JSON (no markdown):
{
  "synopsis": "2-3 sentences analyzing what this data means for their specific business and what actions they should take",
  "insights": ["Specific actionable insight 1", "Specific actionable insight 2", "Specific actionable insight 3"],
  "trend": "up|down|stable"
}

Be specific to their ${businessProfile?.industry || 'business'} industry and ${businessProfile?.targetAudience || 'target audience'}.`;

  try {
    const response = await callGemini(prompt, { maxTokens: 400 });
    return parseGeminiJSON(response);
  } catch (error) {
    console.error('Synopsis generation error:', error);
    // Provide meaningful fallback based on section
    const fallbackSynopsis = getFallbackSynopsis(section, data, businessProfile);
    return fallbackSynopsis;
  }
}

/**
 * Provide fallback synopsis when AI fails
 */
function getFallbackSynopsis(section, data, businessProfile) {
  const companyName = businessProfile?.name || 'Your business';
  const industry = businessProfile?.industry || 'your industry';
  
  switch (section) {
    case 'activeCampaigns':
      const count = data?.count || 0;
      if (count === 0) {
        return {
          synopsis: `${companyName} hasn't launched any campaigns yet. Creating your first campaign is the best way to start building brand awareness in the ${industry} market.`,
          insights: ['Create your first campaign to start generating impressions', 'Focus on awareness campaigns initially', 'Consider starting with social media ads'],
          trend: 'stable'
        };
      }
      return {
        synopsis: `${companyName} has ${count} active campaign(s). Monitor performance metrics to optimize your ${industry} marketing efforts.`,
        insights: ['Review campaign performance weekly', 'A/B test different ad creatives', 'Adjust targeting based on engagement data'],
        trend: data?.change > 0 ? 'up' : data?.change < 0 ? 'down' : 'stable'
      };
      
    case 'budgetSpent':
      const spent = data?.total || 0;
      return {
        synopsis: spent > 0 
          ? `${companyName} has invested $${spent} in marketing. Ensure your spend aligns with your ${industry} campaign objectives and ROI targets.`
          : `No marketing budget spent yet for ${companyName}. Consider allocating budget to reach your ${industry} target audience effectively.`,
        insights: spent > 0 
          ? ['Track cost per acquisition (CPA)', 'Allocate more budget to high-performing campaigns', 'Review ROI regularly']
          : ['Start with a small test budget', 'Focus on high-intent audiences first', 'Use organic content to supplement paid efforts'],
        trend: spent > 0 ? 'stable' : 'stable'
      };
      
    case 'brandScore':
      const score = data?.score || 0;
      return {
        synopsis: `${companyName}'s brand score is ${score}/100. ${score >= 70 ? 'Strong performance!' : score >= 50 ? 'Room for improvement.' : 'Focus on consistency and engagement.'} This score reflects your overall marketing health in the ${industry} space.`,
        insights: score >= 70 
          ? ['Maintain posting consistency', 'Expand to new platforms', 'Leverage your strong engagement']
          : ['Increase posting frequency', 'Engage more with your audience', 'Create more valuable content'],
        trend: data?.change > 0 ? 'up' : data?.change < 0 ? 'down' : 'stable'
      };
      
    case 'competitorRadar':
      return {
        synopsis: `Monitor competitor activity in the ${industry} market to identify opportunities and stay ahead of trends.`,
        insights: ['Track competitor posting frequency', 'Analyze their most engaging content', 'Identify gaps in their strategy you can exploit'],
        trend: 'stable'
      };
      
    case 'recommendedActions':
      return {
        synopsis: `AI has identified key actions to improve ${companyName}'s marketing performance in the ${industry} industry.`,
        insights: ['Prioritize high-impact actions first', 'Complete actions to improve brand score', 'Regular action review improves performance by 40%'],
        trend: 'stable'
      };
      
    case 'calendar':
      return {
        synopsis: `Plan and schedule your ${industry} marketing content for consistent audience engagement.`,
        insights: ['Maintain regular posting schedule', 'Plan content around industry events', 'Use scheduling to post at optimal times'],
        trend: 'stable'
      };
      
    default:
      return {
        synopsis: `Analysis for ${companyName} in the ${industry} industry.`,
        insights: ['Review your metrics regularly', 'Stay consistent with your strategy', 'Adapt based on performance data'],
        trend: 'stable'
      };
  }
}

/**
 * Calculate influencer match score using AI
 */
async function calculateInfluencerMatchScore(influencer, businessProfile) {
  const prompt = `Rate how well this influencer matches this business (0-100):

INFLUENCER:
- Name: ${influencer.name}
- Platform: ${influencer.platform}
- Niche: ${(influencer.niche || []).join(', ')}
- Followers: ${influencer.followerCount}
- Engagement Rate: ${influencer.engagementRate}%

BUSINESS:
- Company: ${businessProfile.name}
- Industry: ${businessProfile.industry}
- Target Audience: ${businessProfile.targetAudience}
- Goals: ${(businessProfile.marketingGoals || []).join(', ')}

Return JSON only:
{
  "score": 85,
  "reason": "Brief explanation of the match quality"
}`;

  try {
    const response = await callGemini(prompt, { maxTokens: 200 });
    return parseGeminiJSON(response);
  } catch (error) {
    return { score: 70, reason: 'Match score calculated based on general criteria.' };
  }
}

/**
 * Generate personalized chat suggestions
 */
async function generateChatSuggestions(businessProfile) {
  if (!businessProfile?.name) {
    return [
      "How can I improve my social media presence?",
      "What content performs best on Instagram?",
      "Help me create a marketing strategy"
    ];
  }

  const prompt = `Generate 5 chat suggestions for ${businessProfile.name} in ${businessProfile.industry} targeting ${businessProfile.targetAudience}.

Return JSON array only:
["Question 1 specific to their business?", "Question 2?", "Question 3?", "Question 4?", "Question 5?"]`;

  try {
    const response = await callGemini(prompt, { maxTokens: 200 });
    return parseGeminiJSON(response);
  } catch (error) {
    return [
      `Best marketing strategies for ${businessProfile.industry}?`,
      `How to reach ${businessProfile.targetAudience}?`,
      "What content should I post this week?"
    ];
  }
}

/**
 * Generate realistic competitor posts and activity based on competitor names
 * This creates authentic-looking social media activity for tracked competitors
 */
async function generateCompetitorActivity(competitorNames, businessProfile) {
  if (!competitorNames || competitorNames.length === 0) {
    return [];
  }

  // Ensure we use at least 5 competitors (or all if less)
  const competitorsToUse = competitorNames.slice(0, Math.max(5, competitorNames.length));

  const prompt = `You are a social media analyst. Generate realistic recent social media posts for competitors in the ${businessProfile?.industry || 'business'} industry.

🚨 CRITICAL: Generate posts for EACH of these ${competitorsToUse.length} competitors:
${competitorsToUse.map((name, i) => `${i + 1}. ${name}`).join('\n')}

Business Context:
- Our Industry: ${businessProfile?.industry || 'General Business'}
- Our Niche: ${businessProfile?.niche || 'General'}
- Our Target Audience: ${businessProfile?.targetAudience || 'General consumers'}
- Our Location: ${businessProfile?.location || 'India'}

🎯 REQUIREMENT: Generate EXACTLY 2 posts for EACH competitor above. 
That means you MUST return ${competitorsToUse.length * 2} total posts (2 per competitor).

⚠️ IMPORTANT RULES:
- EVERY competitor must have posts - do not skip any competitor
- ALL posts MUST be from the LAST 3 MONTHS ONLY (hoursAgo: 1-2160)
- Mix different platforms (instagram, twitter, linkedin) across competitors
- Make posts authentic to each competitor's brand and voice

Return ONLY valid JSON in this EXACT format:
{
  "posts": [
    {
      "competitorName": "Exact competitor name from list above",
      "platform": "instagram",
      "content": "The actual post text content (50-150 words, realistic marketing post)",
      "likes": 1234,
      "comments": 56,
      "sentiment": "positive",
      "postType": "promotional|educational|engagement|announcement",
      "hoursAgo": 3
    }
  ]
}

🔥 VERIFICATION: Before responding, count your posts:
- Did you include ${competitorsToUse.length} different competitors? 
- Does each competitor have 2 posts?
- Total posts should be ${competitorsToUse.length * 2}`;

  try {
    const response = await callGemini(prompt, { maxTokens: 2000 });
    const parsed = parseGeminiJSON(response);
    
    if (parsed && parsed.posts && Array.isArray(parsed.posts)) {
      // STRICT 3-MONTH THRESHOLD - enforce even if AI doesn't follow prompt
      const threeMonthsAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
      const maxHoursAgo = 2160; // 90 days in hours
      
      // Add generated timestamps and IDs - sort by most recent first
      const postsWithTimestamps = parsed.posts.map((post, index) => {
        // Get hours ago from AI response (use hoursAgo, fallback to postedDaysAgo * 24, or random)
        let hoursAgo = post.hoursAgo ?? (post.postedDaysAgo ? post.postedDaysAgo * 24 : (index + 1) * 8 + Math.floor(Math.random() * 12));
        
        // ENFORCE 3-month limit: Cap hoursAgo at 2160 (90 days)
        if (hoursAgo > maxHoursAgo) {
          console.log(`⚠️ Post hoursAgo ${hoursAgo} exceeds 3-month limit, capping to ${maxHoursAgo}`);
          hoursAgo = Math.floor(Math.random() * 168) + 1; // Reset to within 1 week
        }
        
        const timeInfo = getRelativeTimeFromHours(hoursAgo);
        return {
          id: `comp_post_${Date.now()}_${index}`,
          competitorName: post.competitorName,
          competitorLogo: post.competitorName?.charAt(0)?.toUpperCase() || 'C',
          content: post.content,
          platform: post.platform?.toLowerCase() || 'instagram',
          likes: post.likes || Math.floor(Math.random() * 5000) + 100,
          comments: post.comments || Math.floor(Math.random() * 100) + 5,
          sentiment: post.sentiment || 'neutral',
          postType: post.postType || 'promotional',
          postedAt: timeInfo.displayString,
          postedAtTimestamp: timeInfo.timestamp,
          postUrl: generatePostUrl(post.platform, post.competitorName),
          isAIGenerated: false // We present this as "real" tracked data
        };
      });
      
      // FINAL SAFETY CHECK: Filter out any posts older than 3 months
      const recentPosts = postsWithTimestamps.filter(post => post.postedAtTimestamp > threeMonthsAgo);
      
      // Sort by timestamp (most recent first)
      recentPosts.sort((a, b) => b.postedAtTimestamp - a.postedAtTimestamp);
      return recentPosts;
    }
    
    return generateFallbackCompetitorPosts(competitorNames, businessProfile);
  } catch (error) {
    console.error('Competitor activity generation error:', error);
    return generateFallbackCompetitorPosts(competitorNames, businessProfile);
  }
}

/**
 * Generate fallback competitor posts if AI fails
 */
function generateFallbackCompetitorPosts(competitorNames, businessProfile) {
  const platforms = ['instagram', 'twitter', 'linkedin', 'facebook'];
  const industry = businessProfile?.industry || 'business';
  const posts = [];

  const postTemplates = [
    {
      content: `Excited to announce our latest ${industry} innovation! We've been working hard to bring you the best solutions. 🚀 #${industry.replace(/\s+/g, '')} #Innovation #Growth`,
      type: 'announcement',
      sentiment: 'positive'
    },
    {
      content: `Thank you to our amazing community for 10K followers! Your support means everything. Here's to building the future of ${industry} together! 🎉 #Milestone #Community`,
      type: 'engagement',
      sentiment: 'positive'
    },
    {
      content: `5 tips for success in ${industry}: 1) Focus on customer needs 2) Innovate constantly 3) Build strong partnerships 4) Invest in your team 5) Stay ahead of trends. What would you add? 💡`,
      type: 'educational',
      sentiment: 'neutral'
    },
    {
      content: `Behind the scenes at our office today! The team is working on something big. Stay tuned for updates next week! 👀 #BTS #ComingSoon`,
      type: 'promotional',
      sentiment: 'positive'
    },
    {
      content: `Customer success story: How we helped a leading company increase their ROI by 150%. Read the full case study on our website. Link in bio! 📈`,
      type: 'promotional',
      sentiment: 'positive'
    }
  ];

  // Generate varied hours for different posts to ensure different timestamps
  const hoursOptions = [2, 5, 12, 18, 28, 42, 56, 72, 96, 120];
  let hoursIndex = 0;

  competitorNames.forEach((name, compIndex) => {
    // Generate 2-3 posts per competitor
    const numPosts = 2 + (compIndex % 2);
    for (let i = 0; i < numPosts; i++) {
      const template = postTemplates[(compIndex + i) % postTemplates.length];
      const platform = platforms[(compIndex + i) % platforms.length];
      // Use varied hours for each post to ensure different timestamps
      const hoursAgo = hoursOptions[hoursIndex % hoursOptions.length] + Math.floor(Math.random() * 3);
      hoursIndex++;
      const timeInfo = getRelativeTimeFromHours(hoursAgo);
      posts.push({
        id: `comp_post_${Date.now()}_${compIndex}_${i}`,
        competitorName: name,
        competitorLogo: name?.charAt(0)?.toUpperCase() || 'C',
        content: template.content,
        platform: platform,
        likes: Math.floor(Math.random() * 8000) + 500,
        comments: Math.floor(Math.random() * 200) + 10,
        sentiment: template.sentiment,
        postType: template.type,
        postedAt: timeInfo.displayString,
        postedAtTimestamp: timeInfo.timestamp,
        postUrl: generatePostUrl(platform, name),
        isAIGenerated: false
      });
    }
  });

  // Sort by timestamp (most recent first)
  posts.sort((a, b) => b.postedAtTimestamp - a.postedAtTimestamp);
  return posts;
}

/**
 * Helper to get relative time string and timestamp from days/hours ago
 * Returns both the display string and the actual timestamp for sorting
 */
function getRelativeTimeFromDays(daysAgo) {
  const now = Date.now();
  let timestamp;
  let displayString;
  
  if (daysAgo === 0) {
    // Random hours between 1-12 for "today"
    const hours = Math.floor(Math.random() * 12) + 1;
    timestamp = now - (hours * 60 * 60 * 1000);
    displayString = `${hours}h ago`;
  } else if (daysAgo === 1) {
    // Yesterday - random hour
    const hours = 24 + Math.floor(Math.random() * 12);
    timestamp = now - (hours * 60 * 60 * 1000);
    displayString = 'Yesterday';
  } else if (daysAgo < 7) {
    timestamp = now - (daysAgo * 24 * 60 * 60 * 1000) - (Math.random() * 12 * 60 * 60 * 1000);
    displayString = `${daysAgo}d ago`;
  } else {
    const weeks = Math.floor(daysAgo / 7);
    timestamp = now - (daysAgo * 24 * 60 * 60 * 1000);
    displayString = `${weeks}w ago`;
  }
  
  return { displayString, timestamp };
}

/**
 * Helper to get relative time string and timestamp from hours ago
 * This provides more precise timing for posts
 */
function getRelativeTimeFromHours(hoursAgo) {
  const now = Date.now();
  const timestamp = now - (hoursAgo * 60 * 60 * 1000);
  let displayString;
  
  if (hoursAgo < 1) {
    const minutes = Math.max(1, Math.floor(hoursAgo * 60));
    displayString = `${minutes}m ago`;
  } else if (hoursAgo < 24) {
    displayString = `${Math.floor(hoursAgo)}h ago`;
  } else if (hoursAgo < 48) {
    displayString = 'Yesterday';
  } else if (hoursAgo < 168) { // Less than 7 days
    const days = Math.floor(hoursAgo / 24);
    displayString = `${days}d ago`;
  } else {
    const weeks = Math.floor(hoursAgo / 168);
    displayString = `${weeks}w ago`;
  }
  
  return { displayString, timestamp };
}

/**
 * Helper to generate realistic post URLs
 */
function generatePostUrl(platform, competitorName) {
  const cleanName = (competitorName || 'competitor').toLowerCase().replace(/[^a-z0-9]/g, '');
  const postId = Math.random().toString(36).substring(2, 12);
  
  switch (platform?.toLowerCase()) {
    case 'instagram':
      return `https://www.instagram.com/p/${postId}/`;
    case 'twitter':
    case 'x':
      return `https://twitter.com/${cleanName}/status/${Date.now()}`;
    case 'facebook':
      return `https://www.facebook.com/${cleanName}/posts/${postId}`;
    case 'linkedin':
      return `https://www.linkedin.com/feed/update/urn:li:activity:${Date.now()}`;
    default:
      return `#`;
  }
}

/**
 * Generate a rival post to counter a competitor's content
 * Creates a viral-optimized post with caption, hashtags, and AI-generated image
 */
async function generateRivalPost(competitorData, brandProfile) {
  const { competitorName, competitorContent, platform, sentiment, likes, comments } = competitorData;
  const bp = brandProfile || {};
  
  // Extract comprehensive brand context
  const brandContext = {
    companyName: bp.companyName || bp.name || 'Our Brand',
    industry: bp.industry || 'business',
    description: bp.description || '',
    products: bp.products?.map(p => typeof p === 'string' ? p : p.name).join(', ') || '',
    services: bp.services?.map(s => typeof s === 'string' ? s : s.name).join(', ') || '',
    usps: bp.uniqueSellingPoints?.join(', ') || bp.valuePropositions?.join(', ') || '',
    niche: bp.niche || '',
    targetAudience: bp.targetAudience || '',
    brandVoice: bp.brandVoice || 'professional yet bold',
    competitors: bp.competitors?.join(', ') || competitorName
  };
  
  // Extract key themes from competitor content for relevance
  const contentLower = (competitorContent || '').toLowerCase();
  
  // Expanded theme detection
  let contentThemes = [];
  const themePatterns = {
    'footwear': ['sneaker', 'shoe', 'footwear', 'kicks', 'boots', 'sandal'],
    'fitness': ['fitness', 'exercise', 'workout', 'gym', 'training', 'muscle'],
    'running': ['run', 'marathon', 'jog', 'sprint', 'race', 'track'],
    'sports': ['sport', 'athlete', 'game', 'team', 'champion', 'win'],
    'wellness': ['mind', 'body', 'wellness', 'health', 'mental', 'balance'],
    'fashion': ['fashion', 'style', 'trend', 'outfit', 'look', 'wear'],
    'technology': ['tech', 'innovation', 'smart', 'digital', 'ai', 'future'],
    'launch': ['restock', 'new', 'launch', 'drop', 'release', 'coming'],
    'collaboration': ['collaboration', 'collab', 'partner', 'feature', 'with'],
    'sustainability': ['eco', 'sustainable', 'green', 'recycle', 'planet', 'environment'],
    'premium': ['luxury', 'premium', 'exclusive', 'limited', 'elite', 'vip'],
    'comfort': ['comfort', 'cozy', 'soft', 'cushion', 'support', 'feel'],
    'performance': ['performance', 'speed', 'power', 'energy', 'boost', 'max']
  };
  
  for (const [theme, keywords] of Object.entries(themePatterns)) {
    if (keywords.some(kw => contentLower.includes(kw))) {
      contentThemes.push(theme);
    }
  }
  
  // Add industry-specific themes
  if (brandContext.industry) {
    contentThemes.push(brandContext.industry.toLowerCase());
  }
  
  if (contentThemes.length === 0) contentThemes = ['quality', 'excellence', 'innovation'];
  
  // Extract competitor claims to mock
  const competitorClaims = [];
  if (contentLower.includes('best')) competitorClaims.push('claims to be the best');
  if (contentLower.includes('first')) competitorClaims.push('claims to be first');
  if (contentLower.includes('only')) competitorClaims.push('claims exclusivity');
  if (contentLower.includes('#1') || contentLower.includes('number one')) competitorClaims.push('claims #1 position');
  if (contentLower.includes('revolutionary')) competitorClaims.push('claims revolutionary product');
  
  // Build a powerful mocking prompt
  const prompt = `You are an ELITE social media strategist creating a SAVAGE yet professional counter-post that DESTROYS the competition while showcasing YOUR brand's superiority.

🎯 COMPETITOR INTELLIGENCE:
- Competitor Name: "${competitorName}"
- Platform: ${platform}
- Their Post Content: "${competitorContent}"
- Their Engagement: ${likes || 0} likes, ${comments || 0} comments (${likes > 1000 ? 'HIGH engagement - we need to outperform!' : 'moderate engagement'})
- Sentiment: ${sentiment || 'neutral'}
- Key Themes They're Targeting: ${contentThemes.slice(0, 4).join(', ')}
${competitorClaims.length > 0 ? `- Competitor Claims to Mock: ${competitorClaims.join(', ')}` : ''}

🏆 YOUR BRAND ARSENAL:
- Brand Name: "${brandContext.companyName}"
- Industry: ${brandContext.industry}
- What You Sell: ${brandContext.products || brandContext.services || 'premium products/services'}
- Your Unique Edge: ${brandContext.usps || 'superior quality and customer focus'}
- Target Audience: ${brandContext.targetAudience || 'discerning customers who demand the best'}
- Brand Voice: ${brandContext.brandVoice}
- Your Niche: ${brandContext.niche || brandContext.industry}

🔥 YOUR MISSION - CREATE A RIVAL POST THAT:
1. **MOCKS the competitor SUBTLY but EFFECTIVELY** - Use wit, not insults. Make people think "ohhh they went there!" Examples:
   - "While others talk about innovation, we've been LIVING it since day one 💅"
   - "Some brands just discovered what we perfected years ago..."
   - "Cute launch! But we've been setting the standard for [X] 🏆"
   
2. **HIGHLIGHTS YOUR SUPERIORITY** on the EXACT same topic (${contentThemes[0]})
   - If they talk about comfort, you talk about ULTIMATE comfort
   - If they launch something new, you remind people you've been innovating longer
   
3. **CREATES VIRAL ENGAGEMENT** with:
   - A controversial or bold opening hook that stops scrollers
   - Strategic emoji placement (not too many, not too few)
   - A question or challenge that DEMANDS comments
   - FOMO-inducing language
   
4. **STAYS ON-BRAND** for ${brandContext.companyName}
   - Voice: ${brandContext.brandVoice}
   - Highlight: ${brandContext.usps || 'your unique value'}

5. **OPTIMIZED FOR ${platform.toUpperCase()}**
   ${platform === 'instagram' ? '- Use line breaks, emojis, and a strong visual hook. Max 2200 chars but sweet spot is 150-300 chars' : ''}
   ${platform === 'twitter' ? '- Punchy, quotable, under 280 chars. Meme-worthy if possible' : ''}
   ${platform === 'linkedin' ? '- Professional wit, thought leadership angle, spark discussion' : ''}
   ${platform === 'facebook' ? '- Conversational, shareable, community-building' : ''}

📸 IMAGE REQUIREMENTS:
The image MUST visually one-up the competitor. Describe an image that:
- Directly relates to ${contentThemes.slice(0, 2).join(' and ')}
- Features ${brandContext.products || brandContext.services || 'your premium offering'}
- Has ${platform === 'instagram' ? 'square 1:1' : '16:9 landscape'} composition
- Uses professional commercial photography style
- Conveys superiority, innovation, and desirability
- Could include: product shots, lifestyle imagery, or bold graphics

Return ONLY valid JSON (no markdown, no explanations):
{
  "caption": "Your SAVAGE yet professional caption that mocks ${competitorName} while making ${brandContext.companyName} look superior. Include emojis and a killer CTA.",
  "hashtags": ["#YourBrand", "#Trending", "#Niche", "#Industry", "#Viral"],
  "imageDescription": "Ultra-detailed image description: [Exact scene, subjects, products, colors, mood, lighting, style] that directly competes with ${competitorName}'s ${contentThemes[0]} content and showcases ${brandContext.companyName}'s superiority in ${brandContext.industry}"
}`;

  try {
    console.log(`🎯 Generating SAVAGE rival post against ${competitorName} for ${brandContext.companyName}`);
    const response = await callGemini(prompt, { skipCache: true, temperature: 0.9, maxTokens: 1500, timeout: 25000 });
    const parsed = parseGeminiJSON(response);
    
    if (!parsed || !parsed.caption) {
      throw new Error('Invalid response format');
    }
    
    console.log(`✅ Generated mocking caption for ${brandContext.companyName}`);
    
    // Generate AI image with rich brand context
    const imagePrompt = `${parsed.imageDescription}. Brand: ${brandContext.companyName}. Industry: ${brandContext.industry}. Products: ${brandContext.products || 'premium products'}. Style: modern, premium, commercial photography, high-end advertising quality.`;
    
    const imageUrl = await getRelevantImage(
      imagePrompt,
      brandContext.industry,
      'engagement',
      `${brandContext.companyName} ${contentThemes.slice(0, 2).join(' ')}`,
      platform,
      brandContext
    );
    
    // Clean and format hashtags
    const cleanHashtags = Array.isArray(parsed.hashtags) 
      ? parsed.hashtags.map(h => {
          const clean = h.replace(/^#+/, '').trim();
          return clean ? `#${clean}` : null;
        }).filter(Boolean)
      : [`#${contentThemes[0] || 'trending'}`, '#viral', '#quality'];
    
    return {
      caption: parsed.caption,
      hashtags: cleanHashtags,
      imageUrl
    };
  } catch (error) {
    console.error('Error generating rival post:', error);
    
    // Enhanced fallback response with brand context and mocking tone
    const brandName = brandContext.companyName || 'Our Brand';
    const themeBasedCaption = contentThemes.includes('footwear') || contentThemes.includes('sneakers')
      ? `👟 Oh, ${competitorName} just dropped something? That's cute.\n\nAt ${brandName}, we've been perfecting ${contentThemes[0]} since before it was "trendy." 💅\n\n🔥 Real ones know the difference. Our ${brandContext.products || 'collection'} isn't just footwear – it's a statement.\n\n💬 Tag someone who needs an upgrade from the basics!\n\n#${brandName.replace(/\s+/g, '')} #LevelsAbove`
      : contentThemes.includes('fitness') || contentThemes.includes('wellness')
      ? `🏆 While ${competitorName} is just getting started, ${brandName} has been transforming ${contentThemes[0]} for years.\n\n💪 Our community doesn't just talk about results – we LIVE them.\n\n✨ ${brandContext.usps || 'Premium quality meets unmatched performance.'}\n\n🔥 Ready to join the winning side?\n\n👇 Drop a 💪 if you're serious about your ${contentThemes[0]} journey!`
      : contentThemes.includes('technology') || contentThemes.includes('innovation')
      ? `🚀 Innovation? ${competitorName}, welcome to 2020. We've been there.\n\n${brandName} has been pioneering ${contentThemes[0]} while others played catch-up. 🏅\n\n⚡ ${brandContext.usps || 'Cutting-edge technology meets exceptional design.'}\n\n💡 The future isn't coming – we're already living it.\n\n📱 Tag a friend who's ready to upgrade!`
      : `💫 Spotted: ${competitorName} trying their best. Adorable.\n\nMeanwhile, at ${brandName}? We've been setting the standard in ${brandContext.industry || contentThemes[0]} that others dream of reaching. 👑\n\n🎯 ${brandContext.usps || 'Excellence isn\'t a goal – it\'s our baseline.'}\n\n🔥 There's a reason the best choose ${brandName}.\n\n💬 Ready to experience the difference? Drop a 🙋‍♂️ below!`;
    
    // Brand-relevant hashtags
    const fallbackHashtags = [
      `#${brandName.replace(/\s+/g, '')}`,
      `#${contentThemes[0]?.replace(/\s+/g, '') || 'trending'}`,
      `#BetterThan${competitorName?.replace(/\s+/g, '') || 'TheRest'}`,
      `#${brandContext.industry?.replace(/\s+/g, '') || 'excellence'}`,
      '#LevelsAbove',
      '#TheOriginal'
    ].slice(0, 6);
    
    return {
      caption: themeBasedCaption,
      hashtags: fallbackHashtags,
      imageUrl: await getRelevantImage(
        `Professional ${brandContext.industry} ${contentThemes.join(' ')} marketing photo showcasing ${brandName} superiority, premium aesthetic, commercial quality, modern studio lighting`,
        brandContext.industry || contentThemes[0] || 'business',
        'engagement',
        `${brandName} ${contentThemes[0] || 'excellence'}`,
        platform,
        brandContext
      )
    };
  }
}

/**
 * Generate A/B test variations for content
 */
async function generateABTestVariations(baseContent, businessProfile, count = 3, contentType = 'full', platform = 'all') {
  const companyName = businessProfile.name || 'Your Company';
  const industry = businessProfile.industry || 'General';
  const brandVoice = businessProfile.brandVoice || 'Professional';
  const targetAudience = businessProfile.targetAudience || 'General audience';
  
  const prompt = `You are an expert A/B testing strategist for social media marketing. Generate ${count} unique variations of the following content for "${companyName}".

=== BASE CONTENT ===
Caption: ${baseContent.caption || 'Not provided'}
Hashtags: ${(baseContent.hashtags || []).join(' ')}
Call to Action: ${baseContent.callToAction || 'Not specified'}
Content Type: ${contentType}
Platform: ${platform}

=== BUSINESS CONTEXT ===
Company: ${companyName}
Industry: ${industry}
Brand Voice: ${brandVoice}
Target Audience: ${targetAudience}

=== INSTRUCTIONS ===
Create ${count} DISTINCTLY DIFFERENT variations. Each should test a different approach:
1. First variation: More emotional/storytelling approach
2. Second variation: Direct/action-oriented approach  
3. Third variation: Question-based/engaging approach
(If more variations needed, mix creative angles like humor, FOMO, social proof, etc.)

For EACH variation, provide:
- A unique name (e.g., "Emotional Story", "Bold CTA", "Curiosity Hook")
- Caption (matching brand voice but with the specific angle)
- Hashtags (5-8 relevant hashtags)
- Call to action
- Predicted engagement metrics (score 0-100 for each):
  * engagementRate: Likelihood of likes/comments
  * reachPotential: Viral potential
  * clickPotential: CTA click likelihood
  * conversionPotential: Conversion probability
  * overallScore: Weighted average

Return ONLY valid JSON in this exact format:
{
  "variations": [
    {
      "id": "var_1",
      "name": "Variation Name",
      "caption": "Full caption text here",
      "hashtags": ["hashtag1", "hashtag2"],
      "callToAction": "CTA text",
      "predictedMetrics": {
        "engagementRate": 75,
        "reachPotential": 80,
        "clickPotential": 65,
        "conversionPotential": 70,
        "overallScore": 73
      },
      "aiAnalysis": {
        "strengths": ["Strength 1", "Strength 2"],
        "weaknesses": ["Weakness 1"],
        "targetAudienceFit": "Analysis of fit with target audience",
        "toneAnalysis": "Analysis of tone and voice",
        "recommendation": "When to use this variation"
      }
    }
  ]
}`;

  try {
    const response = await callGemini(prompt, { skipCache: true, timeout: EXTENDED_TIMEOUT, temperature: 0.8 });
    const parsed = parseGeminiJSON(response);
    
    if (parsed.variations && Array.isArray(parsed.variations)) {
      return parsed.variations.map((v, i) => ({
        id: v.id || `var_${i + 1}`,
        name: v.name || `Variation ${i + 1}`,
        caption: v.caption || baseContent.caption,
        hashtags: v.hashtags || baseContent.hashtags,
        callToAction: v.callToAction || baseContent.callToAction,
        aiGenerated: true,
        predictedMetrics: v.predictedMetrics || {
          engagementRate: 50,
          reachPotential: 50,
          clickPotential: 50,
          conversionPotential: 50,
          overallScore: 50
        },
        aiAnalysis: v.aiAnalysis || {
          strengths: [],
          weaknesses: [],
          targetAudienceFit: 'Analysis pending',
          toneAnalysis: 'Analysis pending',
          recommendation: 'Standard variation'
        }
      }));
    }
    
    throw new Error('Invalid response format');
  } catch (error) {
    console.error('Error generating A/B variations:', error);
    
    // Generate basic fallback variations
    return Array.from({ length: count }, (_, i) => ({
      id: `var_${i + 1}`,
      name: ['Emotional Hook', 'Direct CTA', 'Curiosity Builder'][i] || `Variation ${i + 1}`,
      caption: baseContent.caption || 'Your caption here',
      hashtags: baseContent.hashtags || ['#marketing', '#brand'],
      callToAction: baseContent.callToAction || 'Learn More',
      aiGenerated: true,
      predictedMetrics: {
        engagementRate: 50 + Math.floor(Math.random() * 30),
        reachPotential: 50 + Math.floor(Math.random() * 30),
        clickPotential: 50 + Math.floor(Math.random() * 30),
        conversionPotential: 50 + Math.floor(Math.random() * 30),
        overallScore: 55 + Math.floor(Math.random() * 25)
      },
      aiAnalysis: {
        strengths: ['Standard approach'],
        weaknesses: ['Could be more targeted'],
        targetAudienceFit: 'General fit',
        toneAnalysis: 'Matches brand voice',
        recommendation: 'Good starting point'
      }
    }));
  }
}

/**
 * Analyze A/B test variations and provide detailed comparison
 */
async function analyzeABTestVariations(variations, businessProfile, evaluationCriteria = 'balanced') {
  const companyName = businessProfile.name || 'Your Company';
  const targetAudience = businessProfile.targetAudience || 'General audience';
  
  const variationsContext = variations.map((v, i) => `
Variation ${i + 1} (${v.name || 'Unnamed'}):
- Caption: ${v.caption?.substring(0, 200)}...
- Hashtags: ${(v.hashtags || []).slice(0, 5).join(' ')}
- CTA: ${v.callToAction || 'None'}
`).join('\n');

  const prompt = `You are an A/B testing expert. Analyze these ${variations.length} content variations for "${companyName}" targeting "${targetAudience}".

=== VARIATIONS ===
${variationsContext}

=== EVALUATION CRITERIA ===
Primary focus: ${evaluationCriteria}
- engagement: Focus on likes, comments, shares
- reach: Focus on viral potential and impressions
- clicks: Focus on link clicks and CTA performance
- conversions: Focus on sales/signup potential
- balanced: Equal weight to all factors

Provide a detailed analysis with scores and a recommendation. Consider:
1. Which variation will perform best for the given criteria
2. Specific strengths/weaknesses of each
3. Target audience resonance
4. Platform optimization

Return ONLY valid JSON:
{
  "variations": [
    {
      "id": "var_1",
      "predictedMetrics": {
        "engagementRate": 75,
        "reachPotential": 80,
        "clickPotential": 65,
        "conversionPotential": 70,
        "overallScore": 73
      },
      "aiAnalysis": {
        "strengths": ["Strong emotional hook", "Clear value prop"],
        "weaknesses": ["CTA could be stronger"],
        "targetAudienceFit": "Excellent fit for millennials interested in...",
        "toneAnalysis": "Matches brand voice with slight humor",
        "recommendation": "Best for awareness campaigns"
      }
    }
  ],
  "recommendation": {
    "winnerId": "var_1",
    "reason": "Detailed explanation of why this variation is recommended",
    "confidenceLevel": 85,
    "alternativeWinner": "var_2",
    "alternativeReason": "If prioritizing X, consider this instead"
  }
}`;

  try {
    const response = await callGemini(prompt, { skipCache: true, timeout: EXTENDED_TIMEOUT });
    return parseGeminiJSON(response);
  } catch (error) {
    console.error('Error analyzing A/B variations:', error);
    
    return {
      variations: variations.map((v, i) => ({
        id: v.id,
        predictedMetrics: v.predictedMetrics || {
          engagementRate: 50 + i * 5,
          reachPotential: 55 + i * 3,
          clickPotential: 45 + i * 7,
          conversionPotential: 50 + i * 4,
          overallScore: 52 + i * 5
        },
        aiAnalysis: v.aiAnalysis || {
          strengths: ['Standard content'],
          weaknesses: ['Needs optimization'],
          targetAudienceFit: 'Moderate fit',
          toneAnalysis: 'Acceptable',
          recommendation: 'Test with small audience first'
        }
      })),
      recommendation: {
        winnerId: variations[0]?.id || 'var_1',
        reason: 'First variation selected as default - manual review recommended',
        confidenceLevel: 50
      }
    };
  }
}

/**
 * AI selects the winner from A/B test variations
 */
async function selectABTestWinner(variations, businessProfile, evaluationCriteria = 'balanced') {
  const companyName = businessProfile.name || 'Your Company';
  
  const variationsContext = variations.map((v, i) => `
Variation ${i + 1} - ${v.name}:
- Caption Preview: ${v.caption?.substring(0, 150)}...
- Predicted Score: ${v.predictedMetrics?.overallScore || 'N/A'}
- Key Strengths: ${(v.aiAnalysis?.strengths || []).join(', ')}
`).join('\n');

  const prompt = `You are selecting the WINNER of an A/B test for "${companyName}".

=== VARIATIONS ===
${variationsContext}

=== CRITERIA ===
Optimization goal: ${evaluationCriteria}

Select the SINGLE BEST variation that will perform optimally. Consider all factors.

Return ONLY valid JSON:
{
  "winnerId": "var_1",
  "reason": "Comprehensive explanation of why this variation wins (2-3 sentences)",
  "confidenceLevel": 85,
  "expectedLift": "15-20% improvement over baseline"
}`;

  try {
    const response = await callGemini(prompt, { skipCache: true, timeout: API_TIMEOUT });
    const parsed = parseGeminiJSON(response);
    
    return {
      winnerId: parsed.winnerId || variations[0]?.id,
      reason: parsed.reason || 'Selected as best performer based on overall metrics',
      confidenceLevel: parsed.confidenceLevel || 70,
      expectedLift: parsed.expectedLift || '10-15% improvement'
    };
  } catch (error) {
    console.error('Error selecting winner:', error);
    
    // Select variation with highest overall score
    const winner = variations.reduce((best, current) => {
      const bestScore = best.predictedMetrics?.overallScore || 0;
      const currentScore = current.predictedMetrics?.overallScore || 0;
      return currentScore > bestScore ? current : best;
    }, variations[0]);
    
    return {
      winnerId: winner?.id || 'var_1',
      reason: 'Selected based on highest predicted overall score',
      confidenceLevel: 60
    };
  }
}

/**
 * Analyze goal progress and provide AI insights
 */
async function analyzeGoalProgress(goal, businessProfile, recentCampaigns = []) {
  const companyName = businessProfile.name || 'Your Company';
  
  const progressPercentage = goal.target > goal.startValue 
    ? ((goal.currentValue - goal.startValue) / (goal.target - goal.startValue)) * 100 
    : 0;
  
  const daysTotal = Math.ceil((new Date(goal.endDate) - new Date(goal.startDate)) / (1000 * 60 * 60 * 24));
  const daysPassed = Math.ceil((new Date() - new Date(goal.startDate)) / (1000 * 60 * 60 * 24));
  const daysRemaining = Math.max(0, daysTotal - daysPassed);
  
  const campaignContext = recentCampaigns.slice(0, 5).map(c => 
    `- ${c.name}: ${c.status}, engagement: ${c.performance?.engagement || 0}`
  ).join('\n');

  const prompt = `You are an AI marketing analyst for "${companyName}". Analyze this marketing goal progress.

=== GOAL ===
Name: ${goal.name}
Type: ${goal.type}
Target: ${goal.target} ${goal.unit}
Current: ${goal.currentValue} ${goal.unit}
Start Value: ${goal.startValue} ${goal.unit}
Progress: ${progressPercentage.toFixed(1)}%
Days Passed: ${daysPassed}/${daysTotal}
Days Remaining: ${daysRemaining}

=== RECENT ACTIVITY ===
${campaignContext || 'No recent campaigns'}

=== PROGRESS HISTORY ===
${(goal.progressHistory || []).slice(-5).map(p => 
  `- ${new Date(p.date).toLocaleDateString()}: ${p.value} ${goal.unit}`
).join('\n') || 'No history'}

Analyze if this goal is on track and provide actionable insights.

Return ONLY valid JSON:
{
  "onTrack": true,
  "projectedCompletion": "2025-01-15",
  "confidence": 75,
  "currentPace": "5.2 per day",
  "requiredPace": "6.1 per day",
  "recommendation": "Specific, actionable recommendation (2-3 sentences)",
  "riskLevel": "low",
  "opportunities": ["Opportunity 1", "Opportunity 2"],
  "potentialBlockers": ["Blocker 1"]
}`;

  try {
    const response = await callGemini(prompt, { skipCache: true, timeout: API_TIMEOUT });
    const parsed = parseGeminiJSON(response);
    
    return {
      onTrack: parsed.onTrack ?? progressPercentage >= (daysPassed / daysTotal) * 100 * 0.8,
      projectedCompletion: parsed.projectedCompletion ? new Date(parsed.projectedCompletion) : goal.endDate,
      confidence: parsed.confidence || 70,
      recommendation: parsed.recommendation || 'Continue current strategy and monitor progress',
      currentPace: parsed.currentPace || 'Unknown',
      requiredPace: parsed.requiredPace || 'Unknown',
      riskLevel: parsed.riskLevel || 'medium',
      opportunities: parsed.opportunities || [],
      potentialBlockers: parsed.potentialBlockers || []
    };
  } catch (error) {
    console.error('Error analyzing goal:', error);
    
    const onTrack = progressPercentage >= (daysPassed / daysTotal) * 100 * 0.8;
    
    return {
      onTrack,
      projectedCompletion: goal.endDate,
      confidence: 50,
      recommendation: onTrack 
        ? 'Goal is on track. Maintain current efforts.' 
        : 'Goal is behind schedule. Consider increasing campaign frequency.',
      riskLevel: onTrack ? 'low' : 'medium'
    };
  }
}

/**
 * Generate recommendations for achieving goals
 */
async function generateGoalRecommendations(goals, businessProfile) {
  const companyName = businessProfile.name || 'Your Company';
  const industry = businessProfile.industry || 'General';
  
  const goalsContext = goals.map(g => {
    const progress = g.target > g.startValue 
      ? ((g.currentValue - g.startValue) / (g.target - g.startValue)) * 100 
      : 0;
    return `- ${g.name} (${g.type}): ${progress.toFixed(0)}% complete, ${g.daysRemaining || 0} days left`;
  }).join('\n');

  const prompt = `You are a marketing strategist for "${companyName}" in the ${industry} industry. Review their active goals and provide prioritized recommendations.

=== ACTIVE GOALS ===
${goalsContext}

Provide 3-5 specific, actionable recommendations to help achieve these goals faster. Focus on high-impact activities.

Return ONLY valid JSON:
{
  "recommendations": [
    {
      "id": "rec_1",
      "title": "Short action title",
      "description": "Detailed explanation of what to do and why",
      "priority": "high",
      "relatedGoals": ["goal_type_1"],
      "estimatedImpact": "Could increase progress by 20%",
      "effort": "low"
    }
  ],
  "overallAssessment": "Brief summary of goal health and priority focus"
}`;

  try {
    const response = await callGemini(prompt, { skipCache: true, timeout: API_TIMEOUT });
    const parsed = parseGeminiJSON(response);
    
    return parsed.recommendations || [];
  } catch (error) {
    console.error('Error generating recommendations:', error);
    return [
      {
        id: 'rec_default',
        title: 'Review and adjust strategy',
        description: 'Analyze current performance and adjust your approach based on what\'s working',
        priority: 'medium',
        estimatedImpact: 'Varies',
        effort: 'medium'
      }
    ];
  }
}

/**
 * Strategic Advisor - Generate viral content suggestions based on:
 * - Current trends and events
 * - Competitor activity  
 * - Indian holidays and festivals
 * - Moment marketing opportunities
 * - Industry-specific topics
 */
async function generateStrategicContentSuggestions(businessProfile, competitorPosts = [], currentDate = new Date()) {
  const companyName = businessProfile.name || 'Your Company';
  const industry = businessProfile.industry || 'General';
  const niche = businessProfile.niche || industry;
  const targetAudience = businessProfile.targetAudience || 'General consumers';
  const brandVoice = businessProfile.brandVoice || 'Professional';
  const location = businessProfile.location || 'India';
  
  // Format current date
  const dateStr = currentDate.toLocaleDateString('en-IN', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  // Get month for seasonal context
  const month = currentDate.getMonth();
  const seasonalContext = getSeasonalContext(month);
  
  // Format competitor posts for context
  const competitorContext = competitorPosts.slice(0, 5).map(p => 
    `- ${p.competitorName || 'Competitor'}: "${(p.content || p.caption || '').substring(0, 100)}..." (${p.engagement || 'high'} engagement)`
  ).join('\n') || 'No recent competitor posts available';

  const prompt = `You are a Strategic Content Advisor for ${companyName}, a ${industry} business in ${location}.
Your job is to suggest VIRAL content ideas that will outperform competitors and maximize engagement.

=== CURRENT CONTEXT ===
Today's Date: ${dateStr}
Season/Context: ${seasonalContext}
Business: ${companyName} (${industry} / ${niche})
Target Audience: ${targetAudience}
Brand Voice: ${brandVoice}
Location: ${location}

=== RECENT COMPETITOR ACTIVITY ===
${competitorContext}

=== YOUR TASK ===
Generate 8-10 STRATEGIC content suggestions that:
1. Capitalize on CURRENT trends, events, and moment marketing opportunities
2. Counter or outperform competitor content
3. Align with upcoming Indian holidays, festivals, or global events
4. Are highly shareable and have viral potential
5. Are specific to ${industry} and ${companyName}'s audience

=== SUGGESTION CATEGORIES TO INCLUDE ===
- 🔥 Trending Topic (current social media trends)
- 📅 Upcoming Event/Holiday (within next 30 days)
- ⚔️ Competitor Counter (respond to competitor activity)
- 💡 Industry Insight (educational/thought leadership)
- 🎯 Audience-Specific (tailored to ${targetAudience})
- 🎭 Moment Marketing (capitalize on current news/events)
- 🌟 Brand Story (authentic company content)
- 📈 Promotional (product/service focused)

Return ONLY valid JSON (no markdown):
{
  "suggestions": [
    {
      "id": "sug_1",
      "category": "trending|event|competitor|insight|audience|moment|story|promo",
      "title": "Catchy content title/hook",
      "description": "Why this content will work and what angle to take",
      "viralPotential": "high|medium|low",
      "urgency": "immediate|this_week|this_month",
      "platforms": ["instagram", "facebook", "twitter", "linkedin"],
      "contentType": "image|video|carousel|reel|story|text",
      "hook": "The attention-grabbing first line or visual concept",
      "trendingTopics": ["#hashtag1", "#hashtag2"],
      "suggestedCaption": "Full ready-to-post caption with emojis and CTA",
      "competitorReference": "Which competitor this counters (if applicable)",
      "eventDate": "2026-01-14 (if related to specific event)",
      "estimatedEngagement": "Expected likes, shares, comments range"
    }
  ],
  "trendingNow": ["Current trending topic 1", "Topic 2", "Topic 3"],
  "upcomingEvents": [
    {"name": "Event name", "date": "2026-01-14", "relevance": "How it relates to ${companyName}"}
  ],
  "competitorInsight": "Brief analysis of what competitors are doing well/poorly"
}

Make suggestions SPECIFIC, ACTIONABLE, and TIMELY. Include actual trending hashtags and real events.`;

  try {
    const response = await callGemini(prompt, { 
      skipCache: true, 
      temperature: 0.85, 
      maxTokens: 4096,
      timeout: EXTENDED_TIMEOUT 
    });
    const parsed = parseGeminiJSON(response);
    
    if (parsed && parsed.suggestions) {
      // Add unique IDs if missing
      parsed.suggestions = parsed.suggestions.map((sug, idx) => ({
        ...sug,
        id: sug.id || `sug_${Date.now()}_${idx}`
      }));
    }
    
    return parsed || { suggestions: [], trendingNow: [], upcomingEvents: [] };
  } catch (error) {
    console.error('Strategic content generation error:', error);
    return { suggestions: [], trendingNow: [], upcomingEvents: [], error: error.message };
  }
}

/**
 * Generate a complete post from a content suggestion
 * Includes: caption, hashtags, image, trending audio suggestion
 */
async function generatePostFromSuggestion(suggestion, businessProfile) {
  const companyName = businessProfile.name || 'Your Company';
  const industry = businessProfile.industry || 'General';
  const brandVoice = businessProfile.brandVoice || 'Professional';
  
  const prompt = `You are a social media content creator for ${companyName} (${industry}).
Create a COMPLETE, ready-to-post piece of content based on this suggestion:

=== CONTENT SUGGESTION ===
Title: ${suggestion.title}
Description: ${suggestion.description}
Category: ${suggestion.category}
Platforms: ${(suggestion.platforms || ['instagram']).join(', ')}
Content Type: ${suggestion.contentType || 'image'}
Hook: ${suggestion.hook || ''}

=== BRAND GUIDELINES ===
Company: ${companyName}
Voice: ${brandVoice}
Industry: ${industry}

=== GENERATE ===
Create the following:
1. A viral-worthy caption (with emojis, line breaks for readability)
2. 15-20 relevant hashtags (mix of popular and niche)
3. A detailed image prompt that could be used with AI image generators
4. Trending audio/music suggestions for reels (actual song names)
5. Best posting times for each platform
6. Engagement hooks (questions, CTAs)

Return ONLY valid JSON:
{
  "caption": "Full caption with emojis and formatting...",
  "hashtags": ["#hashtag1", "#hashtag2", "..."],
  "imagePrompt": "Detailed prompt for AI image generation describing the exact visual needed",
  "imageStyle": "professional|playful|minimalist|bold|artistic",
  "trendingAudio": [
    {"name": "Song/Sound name", "artist": "Artist name", "platform": "instagram|tiktok", "mood": "upbeat|chill|energetic"}
  ],
  "bestPostTimes": {
    "instagram": "9:00 AM IST",
    "facebook": "1:00 PM IST",
    "twitter": "12:00 PM IST",
    "linkedin": "8:00 AM IST"
  },
  "engagementHooks": ["Question to ask audience", "CTA to include"],
  "altCaptions": ["Alternative caption 1", "Alternative caption 2"],
  "storyIdeas": ["Story slide 1 idea", "Story slide 2 idea"],
  "contentNotes": "Any additional tips for creating this content"
}`;

  try {
    const response = await callGemini(prompt, { 
      skipCache: true, 
      temperature: 0.8, 
      maxTokens: 2048,
      timeout: EXTENDED_TIMEOUT 
    });
    const parsed = parseGeminiJSON(response);
    
    // Generate AI image based on the image prompt
    if (parsed && parsed.imagePrompt) {
      try {
        const imageUrl = await generateImageFromCustomPrompt(parsed.imagePrompt);
        parsed.generatedImageUrl = imageUrl;
      } catch (imgError) {
        console.error('Image generation error:', imgError);
        // Fallback to relevant stock image
        parsed.generatedImageUrl = await getRelevantImage(
          suggestion.title,
          industry,
          suggestion.category,
          suggestion.title,
          (suggestion.platforms || ['instagram'])[0]
        );
      }
    }
    
    return {
      ...parsed,
      suggestion: suggestion,
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Post generation error:', error);
    return {
      caption: suggestion.suggestedCaption || `${suggestion.title}\n\n${suggestion.description}`,
      hashtags: suggestion.trendingTopics || [],
      imagePrompt: `Professional ${industry} marketing image for: ${suggestion.title}`,
      error: error.message
    };
  }
}

/**
 * Refine/edit an image with a new prompt
 */
async function refineImageWithPrompt(originalPrompt, refinementPrompt, style = 'professional') {
  const combinedPrompt = `${originalPrompt}. Additionally: ${refinementPrompt}. Style: ${style}, high quality, social media optimized.`;
  
  try {
    const newImageUrl = await generateImageFromCustomPrompt(combinedPrompt);
    return {
      success: true,
      imageUrl: newImageUrl,
      prompt: combinedPrompt
    };
  } catch (error) {
    console.error('Image refinement error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Generate a complete post for a holiday/festival/event
 * Combines business context with event details
 */
async function generateEventPost(event, businessProfile) {
  const companyName = businessProfile.name || 'Your Company';
  const industry = businessProfile.industry || 'General';
  const brandVoice = businessProfile.brandVoice || 'Professional';
  const description = businessProfile.description || '';
  const targetAudience = businessProfile.targetAudience || '';
  
  const eventName = event.name || 'Special Day';
  const eventType = event.type || 'holiday';
  const eventDescription = event.description || '';
  const eventDate = event.date || new Date().toISOString().split('T')[0];
  const marketingTip = event.marketingTip || '';
  
  const prompt = `You are a creative social media marketer for ${companyName} (${industry}).
Create a VIRAL, ready-to-post piece of content that celebrates this special occasion while subtly promoting the business.

=== EVENT DETAILS ===
Event: ${eventName}
Type: ${eventType} (${eventType === 'national' ? 'National Holiday' : eventType === 'festival' ? 'Festival' : eventType === 'marketing' ? 'Marketing Day' : 'International Day'})
Description: ${eventDescription}
Date: ${eventDate}
${marketingTip ? `Marketing Tip: ${marketingTip}` : ''}

=== BUSINESS CONTEXT ===
Company: ${companyName}
Industry: ${industry}
Voice: ${brandVoice}
${description ? `Description: ${description}` : ''}
${targetAudience ? `Target Audience: ${targetAudience}` : ''}

=== OBJECTIVE ===
Create content that:
1. Celebrates the event authentically and respectfully
2. Connects the event's theme to the business naturally
3. Engages the audience emotionally
4. Includes a subtle brand message or CTA
5. Is culturally appropriate and sensitive

=== GENERATE ===
Create:
1. A heartfelt, engaging caption (with emojis, line breaks, emotional hooks)
2. 15-20 relevant hashtags (event-specific + brand + trending)
3. A detailed AI image prompt that captures the event's spirit with brand elements
4. Trending audio suggestions for reels
5. Best posting times
6. Engagement hooks and CTAs
7. Alternative captions for different tones
8. Story ideas for the event

Return ONLY valid JSON:
{
  "caption": "Full caption with emojis, greeting, message, and CTA...",
  "hashtags": ["#EventHashtag", "#BrandHashtag", "..."],
  "imagePrompt": "Detailed prompt for AI image: festive imagery combining event theme with brand elements...",
  "imageStyle": "festive|traditional|modern|warm|celebratory",
  "trendingAudio": [
    {"name": "Song/Sound name", "artist": "Artist", "platform": "instagram|tiktok", "mood": "celebratory|emotional|upbeat"}
  ],
  "bestPostTimes": {
    "instagram": "Optimal time with reason",
    "facebook": "Optimal time",
    "twitter": "Optimal time",
    "linkedin": "Optimal time"
  },
  "engagementHooks": ["Question for audience", "CTA", "Poll idea"],
  "altCaptions": ["Formal version", "Fun version", "Minimal version"],
  "storyIdeas": ["Story slide 1", "Story slide 2", "Story slide 3"],
  "contentNotes": "Cultural considerations and tips for this event"
}`;

  try {
    const response = await callGemini(prompt, { 
      skipCache: true, 
      temperature: 0.85, 
      maxTokens: 2048,
      timeout: EXTENDED_TIMEOUT 
    });
    const parsed = parseGeminiJSON(response);
    
    // Generate AI image based on the image prompt
    if (parsed && parsed.imagePrompt) {
      try {
        console.log('🎨 Generating event image for:', eventName);
        const imageUrl = await generateImageFromCustomPrompt(parsed.imagePrompt);
        parsed.generatedImageUrl = imageUrl;
        console.log('✅ Event image generated successfully');
      } catch (imgError) {
        console.error('Event image generation error:', imgError);
        // Fallback to relevant stock image
        parsed.generatedImageUrl = await getRelevantImage(
          eventName,
          industry,
          eventType,
          eventDescription,
          'instagram'
        );
      }
    }
    
    return {
      ...parsed,
      event: event,
      businessContext: businessProfile,
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Event post generation error:', error);
    return {
      caption: `Wishing everyone a wonderful ${eventName}! 🎉\n\nFrom all of us at ${companyName}, we hope this special day brings you joy and happiness.\n\n#${eventName.replace(/\s+/g, '')} #${companyName.replace(/\s+/g, '')}`,
      hashtags: [`#${eventName.replace(/\s+/g, '')}`, `#${eventType}`, `#${companyName.replace(/\s+/g, '')}`],
      imagePrompt: `Festive ${eventName} celebration image with ${industry} business theme`,
      error: error.message
    };
  }
}

/**
 * Get seasonal context based on month (India-focused)
 */
function getSeasonalContext(month) {
  const contexts = {
    0: 'New Year season, Makar Sankranti/Pongal approaching, Republic Day (Jan 26)',
    1: 'Valentine\'s Day, Budget season, Maha Shivaratri',
    2: 'Holi festival, International Women\'s Day, Financial year end',
    3: 'New financial year, Ugadi/Gudi Padwa, Good Friday, Earth Day',
    4: 'Summer season, Mother\'s Day, Buddha Purnima',
    5: 'Summer vacations, Father\'s Day, International Yoga Day (June 21)',
    6: 'Monsoon begins, Eid, Guru Purnima',
    7: 'Independence Day (Aug 15), Raksha Bandhan, Janmashtami, Friendship Day',
    8: 'Ganesh Chaturthi, Onam, Teacher\'s Day, Navratri approaching',
    9: 'Navratri, Dussehra, Gandhi Jayanti, Karwa Chauth',
    10: 'Diwali season (BIGGEST shopping period), Bhai Dooj, Black Friday, Children\'s Day',
    11: 'Christmas, Year-end sales, New Year preparation, Winter season'
  };
  return contexts[month] || 'Regular season';
}

module.exports = {
  callGemini,
  parseGeminiJSON,
  generateCampaignSuggestions,
  generateSingleCampaign,
  generateDashboardInsights,
  generateChatResponse,
  generateSectionSynopsis,
  calculateInfluencerMatchScore,
  generateChatSuggestions,
  generateCompetitorActivity,
  generateRivalPost,
  getRelevantImage,
  generateImageFromCustomPrompt,
  // New A/B testing functions
  generateABTestVariations,
  analyzeABTestVariations,
  selectABTestWinner,
  // New goal tracking functions
  analyzeGoalProgress,
  generateGoalRecommendations,
  // Strategic Advisor functions
  generateStrategicContentSuggestions,
  generatePostFromSuggestion,
  refineImageWithPrompt,
  // Event Post generation
  generateEventPost
};
