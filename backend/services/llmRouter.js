/**
 * LLM Router Service
 * Unified interface for Gemini and Grok APIs
 * Handles structured JSON outputs with validation and retry
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GROK_API_KEY = process.env.GROK_API_KEY;

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent';
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';

// Structured logging for LLM calls (no keys logged)
const logLLMCall = (provider, taskType, success, duration, error = null) => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    type: 'llm_call',
    provider,
    taskType,
    success,
    durationMs: duration,
    error: error ? error.message : null
  }));
};

/**
 * Validate JSON against a simple schema
 * @param {object} data - The data to validate
 * @param {object} schema - Simple schema with required fields and types
 * @returns {object} - { valid: boolean, errors: string[] }
 */
function validateSchema(data, schema) {
  const errors = [];
  
  if (!schema) return { valid: true, errors: [] };
  
  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (data[field] === undefined || data[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }
  
  // Check field types
  if (schema.properties) {
    for (const [field, config] of Object.entries(schema.properties)) {
      if (data[field] !== undefined) {
        const expectedType = config.type;
        const actualType = Array.isArray(data[field]) ? 'array' : typeof data[field];
        
        if (expectedType && actualType !== expectedType) {
          errors.push(`Field ${field} should be ${expectedType}, got ${actualType}`);
        }
      }
    }
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Parse JSON from LLM response (handles markdown code blocks and truncated JSON)
 */
function parseJSON(text) {
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
  cleaned = cleaned.trim();
  
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // Try to repair truncated JSON
    if (err.message.includes('Unterminated string') || err.message.includes('Unexpected end')) {
      console.log('Attempting to repair truncated JSON in llmRouter...');
      
      // Find the last complete object in an array
      const lastCompleteIndex = cleaned.lastIndexOf('},');
      if (lastCompleteIndex > 0) {
        let repaired = cleaned.substring(0, lastCompleteIndex + 1);
        
        // Count open brackets to close properly
        const openBrackets = (repaired.match(/\[/g) || []).length;
        const closeBrackets = (repaired.match(/]/g) || []).length;
        const openBraces = (repaired.match(/{/g) || []).length;
        const closeBraces = (repaired.match(/}/g) || []).length;
        
        // Add missing closing brackets
        for (let i = 0; i < openBrackets - closeBrackets; i++) {
          repaired += ']';
        }
        for (let i = 0; i < openBraces - closeBraces; i++) {
          repaired += '}';
        }
        
        try {
          const parsed = JSON.parse(repaired);
          console.log('✅ Successfully repaired truncated JSON in llmRouter');
          return parsed;
        } catch (repairErr) {
          // Repair failed, throw original error
        }
      }
    }
    throw err;
  }
}

/**
 * Call Gemini API
 */
async function callGemini(prompt, options = {}) {
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: options.temperature || 0.7,
          maxOutputTokens: options.maxTokens || 8192, // Increased default for longer responses
          topP: 0.9
        }
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'Gemini API error');
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('No response from Gemini');
    }

    logLLMCall('gemini', options.taskType, true, Date.now() - startTime);
    return text;
  } catch (error) {
    logLLMCall('gemini', options.taskType, false, Date.now() - startTime, error);
    throw error;
  }
}

/**
 * Call Grok API (X.AI)
 */
async function callGrok(prompt, options = {}) {
  const startTime = Date.now();
  
  if (!GROK_API_KEY) {
    // Fallback to Gemini if Grok key not available
    console.warn('Grok API key not available, falling back to Gemini');
    return callGemini(prompt, { ...options, taskType: `${options.taskType}_grok_fallback` });
  }
  
  try {
    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'grok-beta',
        messages: [
          {
            role: 'system',
            content: 'You are Grok, a witty and creative AI assistant. Provide punchy, creative, and trend-aware responses.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: options.temperature || 0.8,
        max_tokens: options.maxTokens || 4096
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'Grok API error');
    }

    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error('No response from Grok');
    }

    logLLMCall('grok', options.taskType, true, Date.now() - startTime);
    return text;
  } catch (error) {
    logLLMCall('grok', options.taskType, false, Date.now() - startTime, error);
    
    // Fallback to Gemini on Grok failure
    console.warn('Grok API failed, falling back to Gemini:', error.message);
    return callGemini(prompt, { ...options, taskType: `${options.taskType}_grok_fallback` });
  }
}

/**
 * Main LLM Router function
 * @param {object} params
 * @param {string} params.provider - 'gemini' or 'grok'
 * @param {string} params.taskType - Type of task for logging
 * @param {string} params.prompt - The prompt to send
 * @param {object} params.jsonSchema - Optional schema for validation
 * @param {number} params.temperature - Optional temperature (0-1)
 * @param {number} params.maxTokens - Optional max tokens
 * @returns {Promise<object|string>} - Parsed JSON or raw text
 */
async function generateWithLLM({ provider, taskType, prompt, jsonSchema, temperature, maxTokens }) {
  const options = { taskType, temperature, maxTokens };
  
  // Add JSON instruction if schema provided
  let finalPrompt = prompt;
  if (jsonSchema) {
    finalPrompt += `\n\nIMPORTANT: Return ONLY valid JSON matching this structure. No markdown, no explanation:\n${JSON.stringify(jsonSchema, null, 2)}`;
  }
  
  // First attempt
  let response;
  try {
    response = provider === 'grok' 
      ? await callGrok(finalPrompt, options)
      : await callGemini(finalPrompt, options);
  } catch (error) {
    throw new Error(`LLM ${provider} failed: ${error.message}`);
  }
  
  // If no schema, return raw text
  if (!jsonSchema) {
    return response;
  }
  
  // Parse and validate JSON
  let parsed;
  try {
    parsed = parseJSON(response);
  } catch (parseError) {
    // Retry once on JSON parse failure
    console.warn(`JSON parse failed, retrying ${provider}...`);
    
    const retryPrompt = `${finalPrompt}\n\nPREVIOUS RESPONSE WAS INVALID JSON. Please return ONLY valid JSON, no markdown code blocks.`;
    
    try {
      response = provider === 'grok'
        ? await callGrok(retryPrompt, options)
        : await callGemini(retryPrompt, options);
      parsed = parseJSON(response);
    } catch (retryError) {
      throw new Error(`Failed to get valid JSON from ${provider} after retry: ${retryError.message}`);
    }
  }
  
  // Validate against schema
  const validation = validateSchema(parsed, jsonSchema);
  if (!validation.valid) {
    console.warn(`Schema validation failed: ${validation.errors.join(', ')}`);
    // Don't throw, just log - partial data may still be useful
  }
  
  return parsed;
}

/**
 * Task-specific helper functions
 */

// Summarization (Gemini)
async function summarize(text, options = {}) {
  return generateWithLLM({
    provider: 'gemini',
    taskType: 'summarization',
    prompt: `Summarize the following content concisely:\n\n${text}`,
    ...options
  });
}

// Content writing (Gemini)
async function writeContent(topic, style, platform, options = {}) {
  return generateWithLLM({
    provider: 'gemini',
    taskType: 'content_writing',
    prompt: `Write ${style} content about "${topic}" for ${platform}. Make it engaging and platform-appropriate.`,
    ...options
  });
}

// Creative variants (Grok)
async function generateCreativeVariants(baseContent, count = 3, options = {}) {
  return generateWithLLM({
    provider: 'grok',
    taskType: 'creative_variants',
    prompt: `Generate ${count} creative, punchy variants of this content. Make them trend-aware and engaging:\n\n"${baseContent}"`,
    jsonSchema: {
      required: ['variants'],
      properties: {
        variants: { type: 'array' }
      }
    },
    ...options
  });
}

// Strategy generation (Gemini)
async function generateStrategy(brandProfile, competitors, trends, options = {}) {
  return generateWithLLM({
    provider: 'gemini',
    taskType: 'strategy_generation',
    prompt: `Generate a comprehensive marketing strategy based on:
    
Brand Profile: ${JSON.stringify(brandProfile)}
Competitor Insights: ${JSON.stringify(competitors)}
Current Trends: ${JSON.stringify(trends)}

Provide actionable recommendations with specific tactics.`,
    jsonSchema: {
      required: ['strategy', 'tactics', 'timeline'],
      properties: {
        strategy: { type: 'object' },
        tactics: { type: 'array' },
        timeline: { type: 'array' }
      }
    },
    ...options
  });
}

// Entity extraction (Gemini)
async function extractEntities(text, options = {}) {
  return generateWithLLM({
    provider: 'gemini',
    taskType: 'entity_extraction',
    prompt: `Extract key entities from this text. Identify: companies, products, people, technologies, topics, and sentiment.

Text: ${text}`,
    jsonSchema: {
      required: ['entities'],
      properties: {
        entities: { type: 'array' },
        topics: { type: 'array' },
        sentiment: { type: 'string' }
      }
    },
    ...options
  });
}

// Trend-aware brainstorming (Grok)
async function brainstormIdeas(context, count = 5, options = {}) {
  return generateWithLLM({
    provider: 'grok',
    taskType: 'brainstorming',
    prompt: `Generate ${count} creative, contrarian, trend-aware ideas based on:

${context}

Be bold, witty, and think outside the box. Consider current cultural moments and viral trends.`,
    jsonSchema: {
      required: ['ideas'],
      properties: {
        ideas: { type: 'array' }
      }
    },
    ...options
  });
}

// Clustering/categorization (Gemini)
async function clusterTopics(items, options = {}) {
  return generateWithLLM({
    provider: 'gemini',
    taskType: 'clustering',
    prompt: `Cluster and categorize these items into meaningful groups:

${JSON.stringify(items)}

Identify themes, patterns, and relationships.`,
    jsonSchema: {
      required: ['clusters'],
      properties: {
        clusters: { type: 'array' }
      }
    },
    ...options
  });
}

// Analyze brand from website (Gemini)
async function analyzeBrand(websiteContent, url, options = {}) {
  return generateWithLLM({
    provider: 'gemini',
    taskType: 'brand_analysis',
    prompt: `Analyze this company's brand based on their website content:

URL: ${url}
Content: ${websiteContent}

Extract and analyze:
1. Company name and description
2. Industry and niche
3. Target audience
4. Value propositions
5. Brand voice and tone
6. Key products/services
7. Unique selling points
8. Competitors mentioned or implied`,
    jsonSchema: {
      required: ['brandProfile'],
      properties: {
        brandProfile: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            industry: { type: 'string' },
            niche: { type: 'string' },
            targetAudience: { type: 'string' },
            valuePropositions: { type: 'array' },
            brandVoice: { type: 'string' },
            products: { type: 'array' },
            uniqueSellingPoints: { type: 'array' }
          }
        }
      }
    },
    ...options
  });
}

// Generate competitor comparison (Gemini)
async function compareCompetitors(brandData, competitorData, options = {}) {
  return generateWithLLM({
    provider: 'gemini',
    taskType: 'competitor_comparison',
    prompt: `Compare this brand against its competitors:

Brand: ${JSON.stringify(brandData)}
Competitors: ${JSON.stringify(competitorData)}

Provide:
1. Comparison table of key attributes
2. Messaging themes for each
3. Opportunities for the brand
4. Gaps to address
5. Recommended positioning`,
    jsonSchema: {
      required: ['comparison', 'opportunities', 'recommendations'],
      properties: {
        comparison: { type: 'array' },
        messagingThemes: { type: 'array' },
        opportunities: { type: 'array' },
        gaps: { type: 'array' },
        recommendations: { type: 'array' }
      }
    },
    ...options
  });
}

// Generate content variants (Grok for creativity)
async function generatePostVariants(topic, platform, tone, cta, count = 5, options = {}) {
  return generateWithLLM({
    provider: 'grok',
    taskType: 'post_variants',
    prompt: `Generate ${count} engaging ${platform} post variants:

Topic: ${topic}
Tone: ${tone}
CTA: ${cta}

Make them punchy, scroll-stopping, and platform-optimized. Include emojis where appropriate.`,
    jsonSchema: {
      required: ['variants'],
      properties: {
        variants: { type: 'array' }
      }
    },
    ...options
  });
}

// Generate long-form content (Gemini)
async function generateLongForm(topic, platform, tone, options = {}) {
  return generateWithLLM({
    provider: 'gemini',
    taskType: 'long_form_content',
    prompt: `Write a comprehensive ${platform} article/post about:

Topic: ${topic}
Tone: ${tone}

Requirements:
- Well-structured with clear sections
- Engaging introduction
- Valuable insights
- Strong conclusion with CTA
- ${platform}-appropriate formatting`,
    ...options
  });
}

// Generate hashtags (Gemini)
async function generateHashtags(content, platform, count = 4, options = {}) {
  return generateWithLLM({
    provider: 'gemini',
    taskType: 'hashtag_generation',
    prompt: `Generate exactly 4 relevant hashtags for this ${platform} content:

${content}

Include a mix of:
- High-volume hashtags
- Niche-specific hashtags  
- Trending hashtags
- Branded hashtag suggestions`,
    jsonSchema: {
      required: ['hashtags'],
      properties: {
        hashtags: { type: 'array' },
        categories: { type: 'object' }
      }
    },
    ...options
  });
}

// Compliance check (Gemini)
async function checkCompliance(content, options = {}) {
  return generateWithLLM({
    provider: 'gemini',
    taskType: 'compliance_check',
    prompt: `Review this marketing content for compliance issues:

${content}

Check for:
1. False or misleading claims
2. Made-up statistics
3. Unverifiable statements
4. Potentially offensive content
5. Legal concerns (disclaimers needed)
6. Platform policy violations`,
    jsonSchema: {
      required: ['isCompliant', 'issues'],
      properties: {
        isCompliant: { type: 'boolean' },
        issues: { type: 'array' },
        suggestions: { type: 'array' },
        riskLevel: { type: 'string' }
      }
    },
    ...options
  });
}

// Generate campaign plan (Gemini)
async function generateCampaignPlan(brandProfile, objective, budget, duration, options = {}) {
  return generateWithLLM({
    provider: 'gemini',
    taskType: 'campaign_planning',
    prompt: `Generate a complete marketing campaign plan:

Brand: ${JSON.stringify(brandProfile)}
Objective: ${objective}
Budget: $${budget}
Duration: ${duration}

Include:
1. Target audience segments
2. Channel strategy
3. Creative concepts
4. Landing page outline
5. Weekly calendar
6. Budget allocation
7. KPI targets
8. A/B testing ideas`,
    jsonSchema: {
      required: ['campaign'],
      properties: {
        campaign: {
          type: 'object',
          properties: {
            audience: { type: 'object' },
            channels: { type: 'array' },
            creatives: { type: 'array' },
            landingPage: { type: 'object' },
            calendar: { type: 'array' },
            budget: { type: 'object' },
            kpis: { type: 'array' }
          }
        }
      }
    },
    ...options
  });
}

// Analyze metrics and generate insights (Gemini + Grok for actions)
async function analyzeMetrics(metrics, options = {}) {
  // First, get insights from Gemini
  const insights = await generateWithLLM({
    provider: 'gemini',
    taskType: 'metrics_analysis',
    prompt: `Analyze these marketing metrics and provide insights:

${JSON.stringify(metrics)}

Identify:
1. Performance patterns
2. Areas of concern
3. Opportunities
4. Benchmark comparisons`,
    jsonSchema: {
      required: ['insights'],
      properties: {
        insights: { type: 'array' },
        performance: { type: 'object' },
        concerns: { type: 'array' },
        opportunities: { type: 'array' }
      }
    },
    ...options
  });
  
  // Then get action recommendations from Grok
  const actions = await generateWithLLM({
    provider: 'grok',
    taskType: 'action_recommendations',
    prompt: `Based on these analytics insights, suggest bold, actionable next steps:

${JSON.stringify(insights)}

Be specific, creative, and prioritize high-impact actions.`,
    jsonSchema: {
      required: ['actions'],
      properties: {
        actions: { type: 'array' }
      }
    },
    ...options
  });
  
  return { insights, actions };
}

module.exports = {
  generateWithLLM,
  summarize,
  writeContent,
  generateCreativeVariants,
  generateStrategy,
  extractEntities,
  brainstormIdeas,
  clusterTopics,
  analyzeBrand,
  compareCompetitors,
  generatePostVariants,
  generateLongForm,
  generateHashtags,
  checkCompliance,
  generateCampaignPlan,
  analyzeMetrics,
  // Export raw callers for advanced use
  callGemini,
  callGrok,
  parseJSON,
  validateSchema
};
