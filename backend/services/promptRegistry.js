/**
 * The prompts that drive generation, in one place, in a form a person can edit.
 *
 * Why a registry rather than editing the source strings directly: the prompts
 * were previously template literals interpolating live JS expressions, so the
 * only way to change one was to change code and redeploy. Everything variable
 * is now precomputed by the caller and passed in as a named value, which leaves
 * a template containing nothing but prose and {{placeholders}} — safe to hand
 * to a user, and safe to accept back.
 *
 * Substitution is deliberately dumb: {{name}} is replaced with a string, and
 * nothing else is evaluated. An edited template cannot execute anything.
 */

const PROMPTS = {
  'campaign.content': {
    label: 'Campaign content',
    // Shown in the UI so it is clear which prompt to reach for.
    summary:
      'Writes the caption, hashtags and image brief for every post in a campaign. Change this if the writing is off — tone, hooks, length, structure.',
    stage: 'campaign',
    variables: {
      brandDisplayName: 'Your brand name',
      industry: 'Your industry',
      campaignName: 'The campaign name you typed',
      campaignDescription: 'The campaign brief you typed',
      objective: 'Campaign objective (awareness, traffic, …)',
      audience: 'Age, gender, location and interests, combined',
      platforms: 'Selected platforms, comma separated',
      tone: 'Brand tone',
      language: 'Output language',
      productBlock: 'Linked product name, price and description, if any',
      brandContextBlock: 'Brand visual tokens, palette and guidelines',
      keyMessagesBlock: 'Mandatory content structures from your templates',
      memoryContext: 'What past campaigns learned',
      totalPosts: 'How many posts to write',
      slotCount: 'How many scheduled dates',
      platformNativeRules: 'Per-platform length and style rules',
      brandLockRules: 'Brand lock rules, strict or relaxed',
      productImageRule: 'Whether a product image was supplied',
      colorRule: 'Background and text colour enforcement',
      languageRule: 'Whether English is permitted'
    },
    template: `ROLE: You are a senior social media strategist and copywriter at a leading digital marketing agency. You craft high-converting, scroll-stopping social media campaigns for premium brands.

OBJECTIVE: You are a strict content generator. Your job is to STRICTLY follow and fill the provided template structures.

STRICT RULES:
- Do NOT change the format, do NOT remove sections, and do NOT convert content into paragraphs.
- Automatically fill ALL bullet points, numbered points, highlights, tips, outcomes, and sections with meaningful content based on the campaign details.
- Do NOT leave any placeholders like [Key Point 1], [Tip 1], [Point], or [Outcome].
- ONLY keep the CTA link field as "[Link]" or "[Your CTA Link]".
- Do NOT add any introduction, conversational filler, or extra commentary.
- Keep all headings, symbols, and markers (like colons :) exactly as they appear in the template.

CONTEXT:
- Brand: {{brandDisplayName}} ({{industry}} industry)
- Campaign: "{{campaignName}}"{{campaignDescription}}
- Objective: {{objective}}
- Target audience: {{audience}}
- Platforms: {{platforms}}
- Tone: {{tone}}
- Language: {{language}}
{{productBlock}}{{brandContextBlock}}{{keyMessagesBlock}}{{memoryContext}}

INSTRUCTIONS:
1. Create exactly {{totalPosts}} campaign posts.
2. For EACH of the {{slotCount}} scheduled slots, you MUST generate exactly one post for EVERY selected platform: {{platforms}}.
3. For each platform, you MUST use the exact structure provided in the [PLATFORM CONTENT FORMAT] section.
4. Captions must be platform-native: {{platformNativeRules}}
5. Each caption should open with a strong hook (question, bold claim, statistic, or story opener).
6. Include 3-5 relevant hashtags per post. Mix broad and niche hashtags. Never use generic tags like #marketing or #business alone.
7. The imageDescription for each post should describe a PROFESSIONAL AD CREATIVE. Describe the visual style, subjects, colors, mood, lighting, and composition. Do NOT mention metadata.
8. CRITICAL: For each scheduled slot (every collection of posts for different platforms on the same date), you MUST provide the EXACT SAME imageDescription. This ensures the same visual is used across all platforms for that slot.
9. {{brandLockRules}}
10. PRODUCT COMPOSITION: The imageDescription should position the product as a realistic premium hero element (prefer center or slightly offset center), visually balanced with brand design.
11. {{productImageRule}}
12. {{colorRule}}
13. LANGUAGE ENFORCEMENT: Write caption and CTA strictly in {{language}}. {{languageRule}}
14. IMAGE TEXT ENFORCEMENT: Also provide "imageText" for each post (2-5 words max), strictly in {{language}}. It must be short, punchy, and suitable for text overlay on the image.

Return ONLY valid JSON (no markdown, no backticks):
{
  "posts": [
    {
      "platform": "instagram|linkedin|twitter|facebook",
      "caption": "The full caption text with emojis and line breaks",
      "hashtags": ["#tag1", "#tag2", "#tag3"],
      "contentTheme": "educational|promotional|engagement|storytelling|social_proof|problem_solution",
      "imageDescription": "Detailed visual description for AI image generation",
      "imageText": "Short overlay text (2-5 words) strictly in selected language"
    }
  ]
}`
  },

  'image.creative': {
    label: 'Image creative',
    summary:
      'Turns an image brief into the instruction sent to the image model. Change this if the pictures are wrong — composition, typography, how strictly brand colours are held.',
    stage: 'image',
    // Only the standard ad-creative path is editable. Character-consistency and
    // cinematic-frame images take separate branches with identity-preservation
    // rules that an accidental edit would quietly break, so those stay in code.
    variables: {
      brandLine: 'Your brand name and industry',
      campaignTheme: 'The campaign theme',
      productBlock: 'Linked product name, description and whether a reference image exists',
      imageDescription: 'The visual direction, from the campaign prompt or your own brief',
      tone: 'Brand tone',
      paletteLine: 'Locked brand palette, when brand lock is on',
      fontLine: 'Preferred typography style',
      keyMessagesLine: 'Campaign messaging, for inspiration only',
      designQuality: 'Rendering style, stricter when brand lock is on',
      aspectRatio: 'Output shape (1:1, 4:5, 9:16)',
      language: 'Language for any text drawn on the image',
      languageRule: 'Whether English is permitted on the image',
      overlayTextRule: 'Exact headline text to render, if you set one',
      brandIdentityRule: 'How to work the brand name into the design',
      colorPaletteRule: 'Which colours to use',
      strictBrandPriorityRule: 'Whether brand identity outranks product colour',
      colorEnforcementRule: 'Exact background and text colours, when brand lock is on',
      logoRule: 'How to place the uploaded logo',
      productRule: 'Product placement, when brand lock is on',
      productRealismRule: 'How realistic and how colour-controlled the product must be',
      typographyRule: 'Typography style',
      seriesConsistencyRule: 'Consistency across a multi-post campaign'
    },
    template: `ROLE: You are an elite creative director at a top-tier advertising agency. You create award-winning social media ad creatives that drive engagement and conversions for global brands.

OBJECTIVE: Generate a single, publication-ready social media ad image that looks like it was produced by a professional design team. The image must be visually stunning, immediately attention-grabbing in a social feed, and communicate the brand message through design, not through literal text dumps.

CONTEXT:
- Brand: {{brandLine}}
- Campaign theme: {{campaignTheme}}
{{productBlock}}
- Visual direction: {{imageDescription}}
- Tone & mood: {{tone}}
{{paletteLine}}{{fontLine}}{{keyMessagesLine}}

INSTRUCTIONS:
1. DESIGN QUALITY: {{designQuality}}
2. ASPECT RATIO: The image MUST be in exactly {{aspectRatio}} aspect ratio. This is critical.
3. RESOLUTION: Output at 1024px on the longest edge maximum. Do not exceed 1K resolution.
4. TEXT ON IMAGE: If the design calls for text overlays, keep them SHORT (3-7 words max). Use professional typography and no more than 2 font styles. The text should be a punchy headline or tagline, NOT a paragraph. Never put placeholder text like [Date], [Name], [CTA], etc.
4A. LANGUAGE LOCK FOR IMAGE TEXT: Any visible text rendered on the image MUST be strictly in {{language}}. {{languageRule}}
4B. TEXT SAFETY RULE: If you are not confident rendering {{language}} script correctly, do NOT render any extra text overlay instead of falling back to English.
{{overlayTextRule}}
5. BRAND IDENTITY: {{brandIdentityRule}}
6. NO METADATA: Do NOT include post numbers, aspect ratio labels, generic "Brand" labels, campaign names, watermark text, frame borders, or UI-like editor elements.
7. VISUAL STORYTELLING: Let imagery communicate the message with strong focal points and emotional resonance.
8. COLOR PALETTE: {{colorPaletteRule}}
9. STRICT BRAND PRIORITY: {{strictBrandPriorityRule}}
{{colorEnforcementRule}}
{{logoRule}}
{{productRule}}
{{productRealismRule}}
{{typographyRule}}
{{seriesConsistencyRule}}`
  }
};

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Fill a template's {{placeholders}} from `vars`.
 *
 * An unknown placeholder collapses to an empty string rather than being left
 * as literal "{{foo}}" text: a user who deletes a variable from a template
 * should get a prompt without it, not one telling the model about braces.
 */
function renderTemplate(template, vars = {}) {
  return String(template || '')
    .replace(PLACEHOLDER, (_, name) => {
      const value = vars[name];
      return value === undefined || value === null ? '' : String(value);
    })
    // Precomputed blocks are often empty, which leaves runs of blank lines.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function listPrompts() {
  return Object.entries(PROMPTS).map(([id, p]) => ({
    id,
    label: p.label,
    summary: p.summary,
    stage: p.stage,
    variables: p.variables,
    defaultTemplate: p.template
  }));
}

function getPrompt(id) {
  return PROMPTS[id] || null;
}

/**
 * The template to actually use for this user: their edit if they have one,
 * otherwise the shipped default. A lookup failure falls back to the default
 * rather than throwing — a database problem should not stop generation.
 */
async function resolveTemplate(userId, id) {
  const prompt = PROMPTS[id];
  if (!prompt) throw new Error(`Unknown prompt: ${id}`);
  if (!userId) return prompt.template;

  try {
    const PromptOverride = require('../models/PromptOverride');
    const override = await PromptOverride.findOne({ user: userId, promptId: id }).lean();
    if (override && override.template && override.template.trim()) {
      return override.template;
    }
  } catch (err) {
    console.error(`[promptRegistry] override lookup failed for ${id}:`, err.message);
  }
  return prompt.template;
}

/** Resolve then fill, in one step. This is what generation code calls. */
async function buildPrompt(userId, id, vars) {
  return renderTemplate(await resolveTemplate(userId, id), vars);
}

module.exports = { PROMPTS, listPrompts, getPrompt, renderTemplate, resolveTemplate, buildPrompt };
