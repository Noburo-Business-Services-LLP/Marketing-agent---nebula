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

  return `You are an expert AI Film Director, Screenwriter, Cinematographer, and Prompt Engineer.

Your task is to generate a complete cinematic story that produces high-quality AI images and AI videos — not just readable text.

OBJECTIVES
- Expand every scene with rich cinematic details and structured visual metadata.
- Generate production-quality imagePrompt and videoPrompt for EVERY scene in the same response.
- Use the approved Character Sheet as the direct identity source for all prompts (never generic "a man" or "a woman").
- Maintain story continuity across all scenes.

STORY REQUIREMENTS
Generate: Story Title, Summary, Overall Mood, Visual Style, Camera Style, Lighting Style, Character Information, and ${min}–${max} cinematic scenes (~5–10 seconds each, total ≈ ${durationSeconds}s).

FOR EVERY SCENE — STRUCTURED FIELDS (all required):
- title, description (cinematic paragraph — NOT short)
- environment, characterAction
- sceneMood, lighting, weather, timeOfDay
- foregroundObjects, backgroundObjects
- cameraDirection, cameraMovement, shotComposition
- characterExpression, characterPose
- visualStyle, colorPalette
- imagePrompt (identity-aware, production-quality)
- videoPrompt (motion-rich, identity-aware)
- audio, duration, transition, voiceLine
- emotion, location, wardrobe, characterIds

IMAGE PROMPT CHECKLIST (every imagePrompt must include):
Character identity | Face consistency reference to Character Sheet | Clothing | Hairstyle | Expression | Pose | Environment | Buildings | Objects | Lighting | Weather | Time of day | Camera angle | Lens | Composition | Visual style | Color palette | ultra realistic | photorealistic | 8K | highly detailed | cinematic

VIDEO PROMPT CHECKLIST (every videoPrompt must include):
Same Character Sheet identity opening | Character movement | Camera movement | Object movement | Environmental movement (wind, rain, smoke, dust, particles) | Facial animation | Foreground motion | Background motion | Scene transition cue

CHARACTER IDENTITY RULES
- Character Sheet = single source of truth. Never drift face, hair, age, or skin tone.
- Every imagePrompt and videoPrompt MUST open by referencing the Character Sheet identity explicitly.

STORY CONTINUITY
- Logical location progression, emotional continuity, object/clothing/lighting continuity.

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
      "description": "string",
      "environment": "string",
      "characterAction": "string",
      "sceneMood": "string",
      "lighting": "string",
      "weather": "string",
      "timeOfDay": "string",
      "foregroundObjects": "string",
      "backgroundObjects": "string",
      "cameraDirection": "string",
      "cameraMovement": "string",
      "characterExpression": "string",
      "characterPose": "string",
      "visualStyle": "string",
      "colorPalette": "string",
      "shotComposition": "string",
      "imagePrompt": "string",
      "videoPrompt": "string",
      "audio": "string",
      "duration": "string",
      "durationSeconds": 6,
      "transition": "string",
      "emotion": "string",
      "location": "string",
      "wardrobe": "string",
      "cameraStyle": "string",
      "characterIds": ["CH_001"],
      "voiceLine": "string"
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
  const description = String(scene.description || '').trim();
  const characterAction = String(scene.characterAction || '').trim();
  const environment = String(scene.environment || scene.location || '').trim();
  const durationSec = parseSceneDuration(scene.durationSeconds ?? scene.duration, 6);
  const visualFields = pickSceneVisualFields(scene);

  const actionParts = [description, characterAction].filter(Boolean);
  const action = actionParts.join('\n\n') || String(scene.action || '').trim();

  let imagePrompt = String(scene.imagePrompt || '').trim();
  let videoPrompt = String(scene.videoPrompt || '').trim();

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
    environment,
    characterAction,
    action,
    ...visualFields,
    emotion: String(scene.emotion || visualFields.sceneMood || parsed.mood || '').trim(),
    location: environment || String(scene.location || '').trim(),
    wardrobe: String(scene.wardrobe || '').trim(),
    cameraStyle: String(scene.cameraStyle || scene.cameraDirection || parsed.cameraStyle || '').trim(),
    cameraDirection: String(scene.cameraDirection || scene.cameraStyle || '').trim(),
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
  const scenes = (Array.isArray(parsed.scenes) ? parsed.scenes : []).map((scene, index) =>
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
