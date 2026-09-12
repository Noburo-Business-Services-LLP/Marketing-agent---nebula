/**
 * Prompts used by the video pipeline.
 *
 * Split out of promptRegistry.js purely for size — these are large, and
 * keeping them here leaves the main registry readable. Same contract:
 * prose plus {{placeholders}}, with every value precomputed by the caller.
 */

module.exports = {
  'video.ttsTranslate': {
    label: "Voiceover translation",
    summary: "Adapts a finished voiceover into another language for text-to-speech.",
    stage: 'video',
    variables: {
      language: "Value of language",
      script: "Value of script",
      source: "Value of source"
    },
    template: `Translate and adapt this short reel voiceover for text-to-speech.

Target language: {{language}}
Target script: {{script}}

Rules:
- Return only the final voiceover text. No markdown, labels, or quotes.
- Translate the narration into {{language}}; do not return English for this target language.
- Keep brand names, product names, prices, URLs, and technical model names unchanged when needed.
- Keep it natural for a short social media reel.

Voiceover:
{{source}}`
  },

  'video.brief': {
    label: "Video brief",
    summary: "Turns a rough idea into the structured brief the video pipeline runs on.",
    stage: 'video',
    variables: {
      description: "Value of description",
      productName: "Value of productName || 'N/A'",
      productDescription: "Value of productDescription || 'N/A'",
      sourceHint: "Value of sourceHint",
      reusablePromptText: "Value of aiMemoryContext.reusablePromptText"
    },
    template: `You are an AI video strategist.
Return STRICT JSON:
{
  "structuredPrompt": "string",
  "creativeDirection": {
    "targetAudience": "string",
    "tone": "string",
    "visualStyle": "string",
    "cta": "string"
  }
}

Context:
- Description: {{description}}
- Product Name: {{productName}}
- Product Description: {{productDescription}}
- Reference: {{sourceHint}}
{{reusablePromptText}}

Rules:
- structuredPrompt must be concise but actionable for scene generation.
- Keep ad-ready language with clear call-to-action.`
  },

  'video.caption': {
    label: "Video caption",
    summary: "Writes the caption and hashtags for a finished video.",
    stage: 'video',
    variables: {
      name: "Value of profile?.name || 'N/A'",
      industry: "Value of profile?.industry || 'N/A'",
      targetAudience: "Value of profile?.targetAudience || 'N/A'",
      name2: "Value of draft?.input?.product?.name || 'N/A'",
      description: "Value of draft?.input?.description || 'N/A'",
      story: "Value of story || 'N/A'",
      videoStyle: "Value of draft?.videoStyle || 'N/A'",
      block8: "Value of draft?.characterName ? `- Character on screen: ${draft.characterName}`",
      voiceScript: "Value of voiceScript || 'N/A'",
      beatByBeat: "Value of beatByBeat || ' (no scenes available)'",
      block11: "Value of selectedPlatforms.join(', ') || 'instagram'",
      reusablePromptText: "Value of aiMemoryContext.reusablePromptText"
    },
    template: `Write the social caption for THIS specific video — not a generic one.

Return STRICT JSON:
{
  "caption": "string",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5", "#tag6"]
}

THE BUSINESS
- Name: {{name}}
- Industry: {{industry}}
- Audience: {{targetAudience}}
- Product featured: {{name2}}

THE VIDEO (this is what the caption must be about)
- Brief: {{description}}
- Story: {{story}}
- Style: {{videoStyle}}
{{block8}}
- Narration: {{voiceScript}}
- Scene by scene:
{{beatByBeat}}

- Platforms: {{block11}}
{{reusablePromptText}}

RULES
- The caption MUST reference what actually happens in this video — the specific
  product, the moment, the transformation, the feeling this story creates.
  Someone who watched it should recognise it from the caption alone.
- BANNED: "Discover our latest", "Elevate your", "Take your X to the next level",
  "Unlock", "Game-changer", "Look no further", and any line that would fit an
  unrelated business unchanged. If the caption would work for a different
  company's video, rewrite it.
- Name the business or product at least once where it reads naturally.
- 1-3 lines, conversational, no markdown, no emoji spam (2 max).
- End with a clear next step suited to the business (visit, DM, call, order).
- hashtags: 5-12 tags. Mix specific (product, city, category) with reach tags.
  No single-word generics like #love or #instagood.`
  },

  'video.concepts': {
    label: "Video concepts",
    summary: "Generates the concept options you pick from at the start of a video.",
    stage: 'video',
    variables: {
      durationSeconds: "Value of durationSeconds",
      brandName: "Value of brandName",
      industry: "Value of industry",
      brandSummary: "Value of brandSummary",
      targetAudience: "Value of targetAudience",
      conceptRegionHint: "Value of conceptRegionHint",
      brandTone: "Value of brandTone",
      competitors: "Value of competitors || 'N/A'",
      description: "Value of description"
    },
    template: `You are an award-winning Creative Director from Ogilvy, Wieden+Kennedy and Apple.
Your job is NOT to create an advertisement.
Your job is to create a commercial that people remember.

You are creating a premium social media reel ({{durationSeconds}} seconds) for the following brand.

BRAND DETAILS
Business Name: {{brandName}}
Industry: {{industry}}
Brand Summary: {{brandSummary}}
Target Audience: {{targetAudience}}
Target Location / Region: {{conceptRegionHint}}
Brand Tone: {{brandTone}}
Competitors: {{competitors}}

REGIONAL AUTHENTICITY (mandatory)
Every concept must be culturally authentic to "{{conceptRegionHint}}".
- People described in the story must be of that region's ethnicity (e.g. South Indian for Tamil Nadu brands — NOT Western characters).
- Names, settings, wardrobe, festivals, and cultural touchpoints must match.
- Do NOT default to Western/generic scenarios. Draw from regional life, cuisine, family structure, celebrations.

USER'S CREATIVE BRIEF
{{description}}

Your task is to come up with THREE completely different commercial concepts.
Each concept should be emotionally powerful, memorable and capable of becoming a viral premium brand film.
Avoid clichés.
Avoid direct selling.
Avoid explaining the product.
Do not start with the product.
Think like Apple, Nike, Tanishq or Google commercials.

The three concepts MUST be completely different from one another:
- Concept 1 → Emotional
- Concept 2 → Inspirational
- Concept 3 → Unexpected or highly creative

OUTPUT FORMAT — STRICT JSON ONLY, no markdown, no code fences, no prose outside the JSON:
{
  "concepts": [
    {
      "id": "concept_1",
      "type": "emotional",
      "title": "Memorable campaign title",
      "coreEmotion": "What the audience should feel — one short phrase",
      "bigIdea": "One paragraph explaining the central idea",
      "storySummary": "Beginning → Emotion → Brand → Ending, one paragraph",
      "whyItWorks": "Why this works psychologically, one paragraph",
      "visualStyle": "Cinematography, palette, mood direction",
      "musicStyle": "Suggested background music style",
      "endingMessage": "The final line or brand payoff"
    },
    { "id": "concept_2", "type": "inspirational", ... same schema ... },
    { "id": "concept_3", "type": "unexpected", ... same schema ... }
  ],
  "recommended": "concept_1 | concept_2 | concept_3",
  "recommendationReason": "One paragraph explaining why the recommended concept is strongest."
}
Return exactly 3 concepts in the array.`
  },

  'video.casting': {
    label: "Video casting",
    summary: "Decides whether a video needs recurring characters, and who they are.",
    stage: 'video',
    variables: {
      conceptTitle: "Value of conceptTitle || '(from user description)'",
      conceptEmotion: "Value of conceptEmotion || 'n/a'",
      conceptStory: "Value of conceptStory || description",
      conceptVisualStyle: "Value of conceptVisualStyle || 'Premium cinematic'",
      brandName: "Value of brandName",
      industry: "Value of industry",
      targetAudience: "Value of targetAudience",
      regionHint: "Value of regionHint",
      block9: "Value of businessLanguage ? 'Business Language(s): ' + businessLanguage : ''",
      brandTone: "Value of brandTone"
    },
    template: `Based on the approved story, determine whether recurring characters are required.
If characters appear in multiple scenes, create a MASTER CHARACTER REFERENCE prompt.
Generate one production-ready prompt that creates a single cast reference image containing all recurring characters with unique IDs.
The reference should maintain family resemblance, identical facial identity and realistic age progression.
Return only the character reference prompt.

--- CONTEXT ---
APPROVED STORY / CONCEPT
Title: {{conceptTitle}}
Core Emotion: {{conceptEmotion}}
Story Summary: {{conceptStory}}
Visual Style: {{conceptVisualStyle}}

BRAND
Business: {{brandName}}
Industry: {{industry}}
Target Audience: {{targetAudience}}
Target Location / Region: {{regionHint}}
{{block9}}
Brand Tone: {{brandTone}}

--- REGIONAL AUTHENTICITY (MANDATORY) ---
Every character MUST look like a real member of the brand's actual target market.
- Ethnicity, skin tone, facial features, body type, and age markers must match "{{regionHint}}".
- Names MUST be authentic to that region (e.g. Tamil / Hindi / Kannada / regional Indian names for an Indian brand — NOT Western names like John, Emma, David, Sarah).
- Clothing must match the region and business context (e.g. saree, kurta, veshti, sherwani, dupatta for South Indian brands — NOT generic Western casualwear unless the concept explicitly demands it).
- Do NOT default to White/European appearance. Do NOT produce generic "Western-looking" characters unless the target region is explicitly Western.
- Cultural touches (jewellery, bindi, mangalsutra, henna, footwear) should reflect the region where relevant.
The single most important rule: viewers from the target region must recognize these as their people.

--- OUTPUT ---
Return STRICT JSON ONLY (no markdown, no code fences, no prose outside the JSON) matching this schema:
{
  "characters": [
    {
      "id": "01",
      "name": "Full realistic name",
      "age": "e.g. 34",
      "gender": "Male | Female | Non-binary",
      "role": "Their role in the story",
      "personality": "One short sentence",
      "appearance": "Facial features, build, ethnicity",
      "clothing": "Specific outfit matching the story",
      "hairStyle": "Specific haircut/style",
      "hairColor": "Natural hair color"
    }
  ],
  "castReferencePrompt": "The single MASTER CHARACTER REFERENCE prompt — one clean horizontal photograph, plain off-white / neutral studio backdrop, all characters standing side-by-side in a single row, evenly spaced, full-body visible, facing camera, natural warm cinematic lighting, photorealistic commercial studio quality. EVERY character must authentically look like a real person from {{regionHint}} — correct ethnicity, skin tone, facial features, and regional wardrobe (saree/kurta/veshti/salwar for Indian brands). Do NOT render Western/European-looking people unless the concept explicitly demands it. Directly UNDER each character render a small clean text label in this exact format on TWO lines: line 1 = '01', '02', '03' ... (the zero-padded 2-digit number in a small warm-gold color), line 2 = 'FULLNAME · AGE XX' (in black or dark grey, all uppercase). Match the characters array order left to right. STRICT PROHIBITIONS: do NOT render any headline text, tagline, brand name banner, marketing copy, decorative typography, or slogans anywhere in the image — only the numbered character labels described above are allowed. Do NOT add background props, furniture, or a floor plate. Do NOT put the brand name anywhere in the frame. Keep the background as clean empty studio wall. Maintain family resemblance if applicable, identical facial identity, realistic age progression."
}
Character IDs MUST be zero-padded 2-digit strings: "01", "02", "03" ... matching the order they appear in the master image.
Return only what the story genuinely needs (up to 8 characters).`
  },

  'video.characterSheet': {
    label: "Character reference sheet",
    summary: "Describes the character reference image that keeps a face consistent across scenes.",
    stage: 'video',
    variables: {
      resolvedArtStyle: "Value of resolvedArtStyle",
      videoStyle: "Value of videoStyle || 'Cinematic, extremely high quality.'"
    },
    template: `Create a professional Master Character Reference Sheet.
The sheet must show the exact same person in all views and preserve the identical face, hairstyle, beard, skin tone, body proportions, and age.

Include the following sections:
1. Face Views: Front view, Left profile, Right profile, 45-degree angle.
2. Body Views: Full body front, Full body side, Full body back.
3. Expression Sheet: Neutral, Happy, Serious, Thinking.
4. Pose Sheet: Standing, Walking, Sitting, Pointing.

Requirements:
- Use the exact same person in every image.
- Maintain identical facial geometry.
- Maintain identical beard style.
- Maintain identical hairstyle and hairline.
- Maintain identical skin tone and ethnicity.
- Maintain identical body proportions.
- Use a clean studio background.
- Arrange everything in a professional character reference sheet layout.
- Art Style / Format: {{resolvedArtStyle}}.
- Video Theme Style: {{videoStyle}}
- CRITICAL: Do not add glasses, hats, or other face-obscuring accessories unless explicitly specified.
`
  }
};
