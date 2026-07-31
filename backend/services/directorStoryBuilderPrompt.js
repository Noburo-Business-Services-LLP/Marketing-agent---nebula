function parseSceneDuration(value, fallback = 6) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(3, Math.min(15, Math.round(value)));
  }
  const raw = String(value || '').trim();
  const range = raw.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (range) {
    return Math.max(3, Math.min(15, Math.round((Number(range[1]) + Number(range[2])) / 2)));
  }
  const single = raw.match(/(\d+)/);
  if (single) return Math.max(3, Math.min(15, Number(single[1])));
  return fallback;
}

function sceneCountForDuration(durationSeconds = 30) {
  const d = Number(durationSeconds) || 30;
  if (d <= 30) return { min: 4, max: 6 };
  if (d <= 60) return { min: 6, max: 10 };
  if (d <= 90) return { min: 8, max: 12 };
  return { min: 8, max: 15 };
}

function describeCharacterForPrompt(c, idx = 0) {
  const cid = c.characterId || c.id || `CH_${String(idx + 1).padStart(3, '0')}`;
  const wardrobe = c.wardrobe || c.clothing || c.appearanceStr || '';
  const parts = [
    c.name ? `Name: ${c.name}` : null,
    `Character ID: ${cid}`,
    c.role ? `Role: ${c.role}` : null,
    c.age || c.appearance?.ageAppearance ? `Age: ${c.age || c.appearance.ageAppearance}` : null,
    c.gender || c.appearance?.gender ? `Gender: ${c.gender || c.appearance.gender}` : null,
    c.appearanceStr || c.appearance ? `Appearance: ${c.appearanceStr || (typeof c.appearance === 'string' ? c.appearance : JSON.stringify(c.appearance))}` : null,
    c.hairStr || c.hair?.style ? `Hairstyle: ${c.hairStr || c.hair.style}` : null,
    wardrobe ? `Clothing: ${wardrobe}` : null,
    c.image ? 'Character Sheet: UPLOADED — permanent face/hair/skin identity reference' : 'Character Sheet: pending upload'
  ].filter(Boolean);
  return parts.join(' | ');
}

function buildCharacterSheetPromptGuidance(existingCharacters = []) {
  if (!existingCharacters.length) {
    return {
      hasCharacterSheet: false,
      primaryCharacter: null,
      imagePromptPrefix: '',
      videoPromptPrefix: '',
      identityPhrase: 'Maintain consistent character identity across all scenes.'
    };
  }

  const primary = existingCharacters.find((c) => c.image) || existingCharacters[0];
  const name = primary.name || 'the character';
  const clothing = primary.wardrobe || primary.clothing || primary.appearanceStr || 'their established outfit from the Character Sheet';
  const hair = primary.hairStr || primary.hair?.style || 'their established hairstyle from the Character Sheet';
  const appearance = primary.appearanceStr || primary.appearance || 'identical facial features from the Character Sheet';

  const identityPhrase = primary.image
    ? `The same character from the uploaded Character Sheet (${name}) with ${appearance}, ${hair}, wearing ${clothing}. Maintain identical facial features, face geometry, eyes, nose, jawline, hairstyle, skin tone, and age from the Character Sheet.`
    : `The same character (${name}) with ${appearance}, ${hair}, wearing ${clothing}. Maintain identical facial features, hairstyle, skin tone, and age across every scene.`;

  const imagePromptPrefix = primary.image
    ? `The same character from the uploaded Character Sheet (${name})`
    : `The same character (${name})`;

  const videoPromptPrefix = primary.image
    ? `The same character from the uploaded Character Sheet (${name})`
    : `The same character (${name})`;

  return {
    hasCharacterSheet: existingCharacters.some((c) => Boolean(c.image)),
    primaryCharacter: primary,
    imagePromptPrefix,
    videoPromptPrefix,
    identityPhrase
  };
}

function buildCharacterContext(existingCharacters = []) {
  const sheetGuidance = buildCharacterSheetPromptGuidance(existingCharacters);

  if (!existingCharacters.length) {
    return {
      ...sheetGuidance,
      contextStr: 'No pre-defined characters provided. Suggest suitable cast characters with detailed appearance for AI generation.',
      identityLockRules: `When characters are introduced, describe a consistent identity (face, hair, age, skin tone, clothing) that must remain identical across all scenes and prompts.

IMAGE PROMPT RULE: Never write generic prompts like "a man walking". Always specify face, hair, clothing, expression, pose, environment, lighting, lens, and quality tags.

VIDEO PROMPT RULE: Include character movement, camera movement, object movement, environmental motion (wind, rain, smoke, dust), and facial animation.`
    };
  }

  const lines = existingCharacters.map((c, idx) => describeCharacterForPrompt(c, idx));

  return {
    ...sheetGuidance,
    contextStr: lines.join('\n'),
    identityLockRules: `CHARACTER IDENTITY LOCK (MANDATORY):
The uploaded Character Sheet is the single source of truth for every scene and every prompt.
Never change face, hairstyle, age, skin tone, or facial structure.
Across every scene maintain: same face, same eyes, same nose, same jawline, same hairstyle, same clothing style (unless the story explicitly changes wardrobe in that scene).

IMAGE PROMPT FORMAT (REQUIRED — every imagePrompt MUST follow this pattern):
Start with: "${sheetGuidance.imagePromptPrefix} wearing [specific clothing for this scene]..."
Then include ALL of:
- Character identity + face consistency reference to Character Sheet
- Clothing and accessories
- Hairstyle (locked to Character Sheet)
- Facial expression (characterExpression field)
- Body pose (characterPose field)
- Exact action (characterAction field)
- Environment, buildings, foregroundObjects, backgroundObjects
- Lighting (lighting field), weather (weather), timeOfDay
- Camera angle, lens, shotComposition
- visualStyle and colorPalette
- Quality tags: ultra realistic, photorealistic, 8K, highly detailed, cinematic, professional commercial photography

BAD: "A man walking through a city"
GOOD: "${sheetGuidance.identityPhrase} walks confidently through a modern downtown street at sunset. Glass skyscrapers reflect warm golden light. Medium-wide shot, 35mm lens, shallow depth of field, warm color grading."

VIDEO PROMPT FORMAT (REQUIRED — every videoPrompt MUST include):
- Character movement and body motion
- Camera movement (cameraMovement field — Dolly In/Out, Tracking, Orbit, Crane, Handheld, etc.)
- Object movement in scene
- Environmental movement: wind, rain, smoke, dust, particles, lighting animation
- Facial animation and expression changes
- Foreground and background motion
- Scene transition cue (transition field)
Start with the same Character Sheet identity phrase as the image prompt.`
  };
}

function buildEnhancedStorySystemPrompt({ durationSeconds = 30, videoStyle = 'Cinematic Commercial' } = {}) {
  const { min, max } = sceneCountForDuration(durationSeconds);

  return `You are a WORLD-CLASS MULTI-INDUSTRY COMMERCIAL CREATIVE DIRECTOR. You act as three expert AI minds in unison:
1. BRAIN 1 (Business Analyst): Deeply understands the brand's industry, audience, USP, core emotion, and commercial goal.
2. BRAIN 2 (Creative Director): Builds authentic, industry-specific narrative arcs, believable locations, character roles, and concrete human actions.
3. BRAIN 3 (Cinematographer): Specifies professional camera lenses, framing, lighting, color palettes, and identity-locked prompts.

INDUSTRY-SPECIFIC STORY ARCHETYPES (MANDATORY MATCH):
Identify the brand's industry from the brief and follow the corresponding realistic commercial arc:

- TECH / SOFTWARE / CLOUD:
  - Arc: Founder arrival at studio → Team collaboration at glass table → Developers coding on workstations → Mobile UX prototype testing → Datacenter/Cloud monitoring wall → Brand Keynote reveal.
  - Aesthetic: Modern minimal, crisp daylight, Apple/Tesla keynote tone.

- FOOD / SWEETS / RESTAURANTS:
  - Arc: Morning preparation/crafting → Customers entering → Warm family selection → Detailed close-ups of fresh food/sweets → Shared family enjoyment → Brand closing.
  - Aesthetic: Warm golden lighting, festive atmosphere, vibrant delicious colors.

- TEXTILE / FASHION / RETAIL:
  - Arc: Elegant showroom entrance → Family/client browsing outfits → Stylist assistance & mirror fitting → Celebration/wedding moment → Brand closing.
  - Aesthetic: Luxury interior, rich textures, soft flattering lighting, high elegance.

- BEAUTY / SALON / HEALTHCARE:
  - Arc: Customer arrival & consultation → Service/treatment process → Skillful technique close-up → Mirror transformation reveal → Confident smile → Brand closing.
  - Aesthetic: Clean bright studio, fresh ambient lighting, high confidence.

- SPORTS / FITNESS:
  - Arc: Dawn workout → Coach motivation → Intense physical training → Dynamic action play → Victory celebration → Brand closing.
  - Aesthetic: Dynamic fast cuts, contrast lighting, energetic movement.

- REAL ESTATE / CONSTRUCTION:
  - Arc: Architectural site/blueprint review → Property walkthrough → Living space highlight → Key handover → Happy family home moment → Brand closing.
  - Aesthetic: Bright spacious architectural photography, sun-drenched natural light.

COMMERCIAL STORYTELLING MANDATE:
Do NOT output generic marketing summaries. You MUST craft an authentic narrative arc following a real commercial progression:
1. SCENE 1: Problem / Opportunity / Arrival (Establishing human context & business objective)
2. SCENE 2: Collaboration & Deep Work (Team reviewing real workstations, code, or physical product)
3. SCENE 3: Technical Execution & Crafting (Close-up of actual work, testing on real physical mobile/desktop devices)
4. SCENE 4: Operational Scale / Infrastructure (DevOps monitoring, physical server rack order, production environment)
5. SCENE 5: Client Experience & Success (Business owner testing software, smiling, handshake/approval)
6. SCENE 6: Brand Keynote Reveal (Team together, crisp brand closing & tagline)

COMMERCIAL DIRECTING CONSTRAINTS:
1. NO STALE SCI-FI TROPES: Absolute ban on "glowing purple/indigo room flooding", "floating holograms", "glassmorphism energy beams", and "futuristic cyberspace".
2. AESTHETIC: Modern minimal architectural studio, bright natural daylight, crisp high-key commercial lighting, subtle natural color accents.
3. CONCRETE SCRIPT & TITLES: Every scene MUST have a unique, highly specific title (e.g., "Morning at Protekk Studio", "Architecture Code Review") and concrete visual action. NEVER output placeholder titles like "Scene Beat 1".

STORY REQUIREMENTS (STRICT SCENE COUNT):
You MUST generate EXACTLY ${min} to ${max} cinematic scenes in the "scenes" array for a ${durationSeconds}-second commercial (each scene 5–8 seconds long, total timing = ${durationSeconds} seconds). Do NOT under-generate scenes.

FOR EVERY SCENE — STRUCTURED FIELDS (all required):
- title, description (cinematic paragraph — NOT short)
- businessObjective (Why this scene exists in the commercial — e.g. "Demonstrate enterprise software development capability")
- marketingMessage (Concrete customer benefit — e.g. "Custom scalable web and mobile software solutions")
- environment, characterAction (Observable physical action — e.g. "Krishna walks through engineering floor while developer shows code on dual 4K monitors")
- sceneMood, lighting, weather, timeOfDay
- foregroundObjects, backgroundObjects
- cameraDirection, cameraMovement, shotComposition
- characterExpression, characterPose
- visualStyle, colorPalette
- imagePrompt (identity-aware, production-quality, filmable action)
- videoPrompt (motion-rich, identity-aware)
- audio, duration, transition, voiceLine
- emotion, location, wardrobe, characterIds

CHARACTER IDENTITY RULES
- Character Sheet = single source of truth. Never drift face, hair, age, or skin tone.
- Every imagePrompt and videoPrompt MUST open by referencing the Character Sheet identity explicitly.

TECHNICAL CONSTRAINTS
- Video Style: ${videoStyle}
- Portrait 9:16 vertical commercial format.
- Single continuous frame per image — NO storyboard, collage, split screen, multi-panel.
- Single continuous shot per video — NO cuts or montage.

Return strict JSON with this EXACT schema (no markdown):
{
  "title": "string",
  "summary": "string",
  "style": "string",
  "mood": "string",
  "cameraStyle": "string",
  "lightingStyle": "string",
  "productionBible": {
    "brandAnalysis": "string",
    "emotionalHook": "string",
    "story": "string",
    "creativeDirection": "string",
    "globalVisualStyle": "string"
  },
  "characters": [
    {
      "characterId": "string",
      "name": "string",
      "role": "string",
      "importance": "Main | Supporting | Extra",
      "appearanceStr": "string"
    }
  ],
  "voiceScript": "string",
  "scenes": [
    {
      "sceneNumber": 1,
      "sceneId": "SC_001",
      "title": "string",
      "businessObjective": "Why this scene exists (e.g. Establish brand trust and software engineering capability)",
      "marketingMessage": "Customer takeaway (e.g. Scalable custom web & mobile platforms)",
      "description": "Rich cinematic paragraph describing the action, characters, and story beat",
      "characterAction": "Concrete physical action performed by characters in the scene",
      "environment": "Believable physical location (e.g. Modern glass architectural engineering floor)",
      "cameraMovement": "Slow tracking dolly shot",
      "lighting": "Crisp natural daylight with subtle warm practical LED accents",
      "voiceLine": "Voiceover sentence for this scene",
      "imagePrompt": "Identity-locked photorealistic prompt string",
      "videoPrompt": "Motion-rich video generation prompt string",
      "durationSeconds": 6,
      "location": "string",
      "wardrobe": "string",
      "characterIds": ["CH_001"]
    }
  ]
}`;
}

const SCENE_VISUAL_FIELDS = [
  'sceneMood',
  'lighting',
  'weather',
  'timeOfDay',
  'foregroundObjects',
  'backgroundObjects',
  'cameraMovement',
  'characterExpression',
  'characterPose',
  'visualStyle',
  'colorPalette',
  'shotComposition'
];

function pickSceneVisualFields(scene = {}) {
  const out = {};
  for (const key of SCENE_VISUAL_FIELDS) {
    out[key] = String(scene[key] || '').trim();
  }
  return out;
}

function ensureCharacterSheetInPrompt(prompt, identityPhrase, prefix) {
  const text = String(prompt || '').trim();
  if (!text) return text;
  const lower = text.toLowerCase();
  if (lower.includes('character sheet') || lower.includes('same character') || lower.includes('identical facial')) {
    return text;
  }
  if (prefix && !lower.startsWith(prefix.toLowerCase().slice(0, 20))) {
    return `${prefix}. ${text} ${identityPhrase ? `Maintain ${identityPhrase.split('.')[0]}.` : ''}`.trim();
  }
  if (identityPhrase) {
    return `${identityPhrase} ${text}`.trim();
  }
  return text;
}

function normalizeScene(scene = {}, index = 0, ctx = {}) {
  const { parsed = {}, existingCharacters = [], sheetGuidance = {} } = ctx;
  const sceneNumber = Number(scene.sceneNumber) || index + 1;
  const sceneId = String(scene.sceneId || `SC_${String(sceneNumber).padStart(3, '0')}`);
  const cleanStr = (s) => String(s || '').replace(/Commercial brand showcase\s*-\s*Commercial Scene Beat\s*\d+/gi, '').replace(/Commercial Scene Beat\s*\d+/gi, '').trim();

  const description = cleanStr(scene.description);
  const characterAction = cleanStr(scene.characterAction);
  const businessObjective = cleanStr(scene.businessObjective);
  const marketingMessage = cleanStr(scene.marketingMessage);
  const environment = cleanStr(scene.environment || scene.location);
  const cameraMovement = cleanStr(scene.cameraMovement || scene.cameraStyle);
  const lighting = cleanStr(scene.lighting);
  const durationSec = parseSceneDuration(scene.durationSeconds ?? scene.duration, 6);
  const visualFields = pickSceneVisualFields(scene);

  const actionParts = [
    description,
    characterAction && !description.includes(characterAction) ? characterAction : ''
  ].filter(Boolean);

  const action = cleanStr(actionParts.join('\n\n') || scene.action);

  let imagePrompt = String(scene.imagePrompt || '').trim();
  let videoPrompt = String(scene.videoPrompt || '').trim();

  if (!imagePrompt) {
    const sceneText = description || characterAction || action || `Scene ${sceneNumber}`;
    const envText = environment ? ` in ${environment}` : '';
    const lightText = lighting || 'Crisp natural daylight, high-key commercial studio lighting';
    imagePrompt = `${sceneText}${envText}. ${lightText}. Medium tracking shot, 50mm lens. Cinematic Commercial visual style. Ultra realistic, photorealistic, 8K, highly detailed.`;
  }

  if (!videoPrompt) {
    const sceneText = description || characterAction || action || `Scene ${sceneNumber}`;
    const cameraText = cameraMovement || 'Slow steady push-in tracking shot, smooth cinematic camera motion';
    videoPrompt = `${sceneText}. ${cameraText}. Crisp natural daylight commercial lighting.`;
  }

  if (sheetGuidance.identityPhrase) {
    imagePrompt = ensureCharacterSheetInPrompt(
      imagePrompt,
      sheetGuidance.identityPhrase,
      sheetGuidance.imagePromptPrefix
    );
    videoPrompt = ensureCharacterSheetInPrompt(
      videoPrompt,
      sheetGuidance.identityPhrase,
      sheetGuidance.videoPromptPrefix
    );
  }

  return {
    sceneId,
    sceneNumber,
    title: String(scene.title || `Scene ${sceneNumber}`).trim(),
    description,
    businessObjective,
    marketingMessage,
    characterAction,
    environment,
    cameraMovement,
    lighting,
    action,
    ...visualFields,
    emotion: String(scene.emotion || visualFields.sceneMood || parsed.mood || '').trim(),
    location: environment || String(scene.location || '').trim(),
    wardrobe: String(scene.wardrobe || '').trim(),
    cameraStyle: cameraMovement || String(scene.cameraStyle || scene.cameraDirection || parsed.cameraStyle || '').trim(),
    cameraDirection: String(scene.cameraDirection || cameraMovement || '').trim(),
    characterIds: Array.isArray(scene.characterIds) && scene.characterIds.length
      ? scene.characterIds
      : existingCharacters.slice(0, 1).map((c) => c.characterId || c.id).filter(Boolean),
    durationSeconds: durationSec,
    duration: String(scene.duration || `${durationSec} seconds`).trim(),
    voiceLine: String(scene.voiceLine || scene.audio || '').trim(),
    audio: String(scene.audio || scene.voiceLine || '').trim(),
    transition: String(scene.transition || '').trim(),
    imagePrompt,
    videoPrompt
  };
}

function normalizeEnhancedStoryResponse(parsed = {}, { durationSeconds = 30, existingCharacters = [] } = {}) {
  const sheetGuidance = buildCharacterSheetPromptGuidance(existingCharacters);

  const productionBible = {
    ...(parsed.productionBible || {}),
    title: parsed.title || parsed.productionBible?.title || '',
    story: parsed.summary || parsed.productionBible?.story || '',
    mood: parsed.mood || parsed.productionBible?.mood || parsed.productionBible?.emotionalHook || '',
    visualStyle: parsed.style || parsed.productionBible?.globalVisualStyle || '',
    globalVisualStyle: parsed.style || parsed.productionBible?.globalVisualStyle || '',
    cameraStyle: parsed.cameraStyle || parsed.productionBible?.cameraStyle || '',
    lightingStyle: parsed.lightingStyle || parsed.productionBible?.lightingStyle || '',
    emotionalHook: parsed.mood || parsed.productionBible?.emotionalHook || '',
    creativeDirection: parsed.productionBible?.creativeDirection || parsed.style || ''
  };

  const suggestedCharacters = (parsed.characters || parsed.suggestedCharacters || []).map((c, idx) => ({
    characterId: c.characterId || c.id || `CH_${String(idx + 1).padStart(3, '0')}`,
    name: c.name || `Character ${idx + 1}`,
    role: c.role || 'Character',
    importance: c.importance || 'Main',
    appearanceStr: c.appearanceStr || c.appearance || ''
  }));

  const voiceScript = String(parsed.voiceScript || '').trim()
    || (Array.isArray(parsed.scenes)
      ? parsed.scenes.map((s) => s.voiceLine || s.audio || '').filter(Boolean).join(' ')
      : '');

  const ctx = { parsed, existingCharacters, sheetGuidance };
  
  let rawScenes = [];
  if (Array.isArray(parsed.scenes) && parsed.scenes.length > 0) {
    rawScenes = parsed.scenes;
  } else if (Array.isArray(parsed.screenplay) && parsed.screenplay.length > 0) {
    rawScenes = parsed.screenplay;
  } else if (Array.isArray(parsed.shotList) && parsed.shotList.length > 0) {
    rawScenes = parsed.shotList;
  } else if (Array.isArray(parsed.sceneList) && parsed.sceneList.length > 0) {
    rawScenes = parsed.sceneList;
  } else if (Array.isArray(parsed.sceneBreakdown) && parsed.sceneBreakdown.length > 0) {
    rawScenes = parsed.sceneBreakdown;
  } else if (Array.isArray(parsed.story) && parsed.story.length > 0) {
    rawScenes = parsed.story;
  } else if (Array.isArray(parsed.productionBible?.scenes) && parsed.productionBible.scenes.length > 0) {
    rawScenes = parsed.productionBible.scenes;
  }

  // Fallback: If Gemini returned no scene array, auto-construct clean scenes without placeholder text
  if (!rawScenes.length) {
    const { min } = sceneCountForDuration(durationSeconds);
    const sceneCount = Math.max(4, min || 6);
    rawScenes = Array.from({ length: sceneCount }, (_, idx) => ({
      sceneNumber: idx + 1,
      sceneId: `SC_${String(idx + 1).padStart(3, '0')}`,
      title: `Scene ${idx + 1}`,
      description: `Team collaboration and technical execution beat ${idx + 1}`,
      characterAction: 'Characters engaging in authentic business collaboration',
      environment: 'Modern architectural commercial studio'
    }));
  }

  const scenes = rawScenes.map((scene, index) =>
    normalizeScene(scene, index, ctx)
  );

  return {
    title: parsed.title || productionBible.title || '',
    summary: parsed.summary || productionBible.story || '',
    productionBible,
    suggestedCharacters,
    voiceScript,
    scenes
  };
}

module.exports = {
  SCENE_VISUAL_FIELDS,
  buildCharacterContext,
  buildCharacterSheetPromptGuidance,
  buildEnhancedStorySystemPrompt,
  normalizeEnhancedStoryResponse,
  normalizeScene,
  ensureCharacterSheetInPrompt,
  parseSceneDuration,
  sceneCountForDuration
};
