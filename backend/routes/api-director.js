const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const { updateDraft, toUserId, loadDraftForUser } = require('../services/videoDraftStore');

const { callGemini, parseGeminiJSON } = require('../services/geminiAI');
const {
  buildCharacterContext,
  buildEnhancedStorySystemPrompt,
  normalizeEnhancedStoryResponse,
  normalizeScene,
  buildCharacterSheetPromptGuidance,
  ensureCharacterSheetInPrompt
} = require('../services/directorStoryBuilderPrompt');

const router = express.Router();

// Helper to structure error responses
const responseError = (res, error, defaultMessage = 'An error occurred') => {
  console.error(defaultMessage, error);
  res.status(500).json({ success: false, message: error.message || defaultMessage });
};

// Rate limiter for AI heavy endpoints
const videoAiWriteLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI generation requests, please try again later.' },
  keyGenerator: (req) => String(req.user?._id || req.user?.id || req.ip || 'anon')
});

/**
 * POST /api/director/analyze-brand
 * Step 2: Analyzes brand and generates the Emotional Hook, Story, and Creative Direction.
 */
router.post('/analyze-brand', protect, videoAiWriteLimiter, async (req, res) => {
  try {
    const userId = toUserId(req.user);
    const { jobId, businessName, industry, brandSummary, targetAudience, brandTone, commercialObjective, duration, videoStyle } = req.body;

    if (!jobId) return res.status(400).json({ success: false, message: 'jobId is required' });

    const systemPrompt = `You are a MASTER AI CREATIVE DIRECTOR producing a "Production Bible" for a highly professional commercial.
Analyze the provided brand context and generate the core emotional strategy, story arc, and creative direction.

Return strict JSON with this exact schema:
{
  "brandAnalysis": "string (Deep analysis of the brand and target audience)",
  "emotionalHook": "string (The core emotion that drives the commercial)",
  "story": "string (The narrative arc from beginning to end)",
  "creativeDirection": "string (Visual and auditory guidelines for the commercial)",
  "globalVisualStyle": "string (A one-sentence summary of the visual aesthetic)"
}`;

    const promptText = `
Business Name: ${businessName || 'N/A'}
Industry: ${industry || 'N/A'}
Brand Summary: ${brandSummary || 'N/A'}
Target Audience: ${targetAudience || 'N/A'}
Brand Tone: ${brandTone || 'N/A'}
Commercial Objective: ${commercialObjective || 'N/A'}
Duration: ${duration || 30} seconds
Video Style: ${videoStyle || 'Cinematic Commercial'}
`;

    const rawResponse = await callGemini(promptText, { systemInstruction: systemPrompt, responseMimeType: 'application/json' });
    const productionBible = parseGeminiJSON(rawResponse);

    const updated = await updateDraft(jobId, userId, (current) => ({
      ...current,
      description: promptText, // Save this for backward compatibility
      durationSeconds: duration || 30,
      videoStyle: videoStyle || 'Cinematic Commercial',
      productionBible
    }));

    return res.json({ success: true, draft: updated });
  } catch (error) {
    return responseError(res, error, 'Failed to analyze brand');
  }
});

/**
 * POST /api/director/plan-characters
 * Step 3: Suggests characters based on the Production Bible story.
 */
router.post('/plan-characters', protect, videoAiWriteLimiter, async (req, res) => {
  try {
    const userId = toUserId(req.user);
    const { jobId, productionBible } = req.body;

    if (!jobId || !productionBible) return res.status(400).json({ success: false, message: 'jobId and productionBible are required' });

    const systemPrompt = `You are a MASTER CASTING DIRECTOR. Based on the provided story and creative direction, determine the required cast of characters.

Return strict JSON with this exact schema:
{
  "suggestedCharacters": [
    {
      "characterId": "string (e.g. CH_001)",
      "name": "string",
      "role": "string",
      "importance": "string (e.g. Main, Supporting, Extra)",
      "appearanceStr": "string (Brief physical description and vibe)"
    }
  ]
}`;

    const promptText = `Story: ${productionBible.story}\nCreative Direction: ${productionBible.creativeDirection}`;

    const rawResponse = await callGemini(promptText, { systemInstruction: systemPrompt, responseMimeType: 'application/json' });
    const parsed = parseGeminiJSON(rawResponse);
    
    // Map the suggestions into the characters array as "Pending Setup"
    const pendingCharacters = (parsed.suggestedCharacters || []).map(c => ({
      ...c,
      id: c.characterId,
      status: 'Pending Setup'
    }));

    const updated = await updateDraft(jobId, userId, (current) => {
      // Merge with existing so we don't overwrite user-added ones if they re-run
      const existingChars = current.characters || [];
      const newChars = [...existingChars];
      pendingCharacters.forEach(pc => {
         if (!newChars.find(c => c.id === pc.id)) {
             newChars.push(pc);
         }
      });
      return {
        ...current,
        characters: newChars
      };
    });

    return res.json({ success: true, draft: updated });
  } catch (error) {
    return responseError(res, error, 'Failed to plan characters');
  }
});

/**
 * POST /api/director/generate-screenplay
 * Step 5: Generates the structured scene breakdown.
 */
router.post('/generate-screenplay', protect, videoAiWriteLimiter, async (req, res) => {
  try {
    const userId = toUserId(req.user);
    const { jobId, productionBible, characters, duration } = req.body;

    if (!jobId || !productionBible || !characters) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const lockedCharacters = characters.filter(c => c.status === 'Ready' || c.status === 'Locked' || c.status === 'Approved');
    if (lockedCharacters.length === 0) {
       return res.status(400).json({ success: false, message: 'At least one locked/ready character is required to generate screenplay' });
    }

    const characterContext = lockedCharacters.map(c => `- ID: ${c.id}, Name: ${c.name}, Role: ${c.role}`).join('\n');

    const systemPrompt = `You are a MASTER SCREENWRITER. Write a scene-by-scene screenplay that fits within the ${duration || 30} second duration.
Use ONLY the provided characters.

Return strict JSON with this exact schema:
{
  "voiceScript": "string (The complete voiceover script across all scenes)",
  "screenplay": [
    {
      "sceneId": "string (e.g. SC_001)",
      "title": "string",
      "purpose": "string",
      "emotion": "string",
      "durationSeconds": "number",
      "voiceLine": "string",
      "characterIds": ["string (Must match provided character IDs)"],
      "location": "string",
      "cameraStyle": "string",
      "lightingStyle": "string",
      "action": "string"
    }
  ]
}`;

    const promptText = `Story: ${productionBible.story}\nCreative Direction: ${productionBible.creativeDirection}\n\nAvailable Characters:\n${characterContext}\n\nDuration: ${duration || 30} seconds`;

    const rawResponse = await callGemini(promptText, { systemInstruction: systemPrompt, responseMimeType: 'application/json' });
    const parsed = parseGeminiJSON(rawResponse);

    const updated = await updateDraft(jobId, userId, (current) => ({
      ...current,
      screenplay: parsed.screenplay || [],
      voiceScript: parsed.voiceScript || ''
    }));

    return res.json({ success: true, draft: updated });
  } catch (error) {
    return responseError(res, error, 'Failed to generate screenplay');
  }
});

/**
 * POST /api/director/build-image-prompts
 * Step 7: Generates image prompts for scenes.
 */
router.post('/build-image-prompts', protect, videoAiWriteLimiter, async (req, res) => {
  try {
    const userId = toUserId(req.user);
    const { jobId, screenplay, characters, productionBible } = req.body;

    if (!jobId || !screenplay) return res.status(400).json({ success: false, message: 'jobId and screenplay are required' });

    const systemPrompt = `You are a MASTER CINEMATOGRAPHER AND AI PROMPT ENGINEER. Convert the scene data into highly detailed Midjourney-style image prompts.

CRITICAL REQUIREMENT:
Generate ONE cinematic keyframe representing ONLY this scene.
This is NOT a storyboard.
This is NOT multiple frames.
This is NOT a comic page.
It is ONE photograph taken from ONE camera.
Everything must exist in ONE composition.

Strictly enforce:
- Generate EXACTLY ONE IMAGE.
- Portrait 9:16 only.
- Single cinematic frame.
- Single camera angle.
- Single composition.
- Single moment in time.
- One continuous cinematic scene only.
- Strictly NO storyboard, collage, comic panels, split screen, image grid, contact sheet, film strip, multiple scenes, multiple frames, multiple camera angles, before/after layouts, or montage.

Return strict JSON with this exact schema:
{
  "sceneImages": {
    "SC_001": {
      "imagePrompt": "string (Highly detailed prompt for text-to-image model)"
    }
  }
}`;
    
    const promptText = `Global Style: ${productionBible?.globalVisualStyle || 'Cinematic'}\n\nScenes:\n${JSON.stringify(screenplay, null, 2)}\n\nCharacters:\n${JSON.stringify(characters, null, 2)}`;

    const rawResponse = await callGemini(promptText, { systemInstruction: systemPrompt, responseMimeType: 'application/json' });
    const parsed = parseGeminiJSON(rawResponse);

    const updated = await updateDraft(jobId, userId, (current) => {
      const currentSceneImages = current.sceneImages || {};
      const newSceneImages = parsed.sceneImages || {};
      
      const merged = { ...currentSceneImages };
      
      const updatedScreenplay = (current.screenplay || []).map(scene => {
         const generated = newSceneImages[scene.sceneId];
         if (generated) {
             merged[scene.sceneId] = { ...(merged[scene.sceneId] || {}), ...generated };
             return { ...scene, imagePrompt: generated.imagePrompt };
         }
         return scene;
      });

      return {
        ...current,
        sceneImages: merged,
        screenplay: updatedScreenplay
      };
    });

    return res.json({ success: true, draft: updated });
  } catch (error) {
    return responseError(res, error, 'Failed to build image prompts');
  }
});

/**
 * POST /api/director/build-video-prompts
 * Step 9: Generates video motion prompts for scenes.
 */
router.post('/build-video-prompts', protect, videoAiWriteLimiter, async (req, res) => {
  try {
    const userId = toUserId(req.user);
    const { jobId, screenplay } = req.body;

    if (!jobId || !screenplay) return res.status(400).json({ success: false, message: 'jobId and screenplay are required' });

    const systemPrompt = `You are a MASTER MOTION DESIGNER AND AI VIDEO PROMPT ENGINEER. Convert the scene data into highly detailed RunwayML/Kling-style motion prompts.

CRITICAL REQUIREMENT:
The generated video prompt must describe a single continuous 9:16 vertical commercial frame.
Strictly enforce:
- Single cinematic shot.
- Full-screen composition.
- One camera angle.
- One frame only.
- Strictly NO split screen, collage, storyboard, grid layout, multiple views, montage, diptych, triptych, picture-in-picture, contact sheet, or multi-panel.
- Describe one continuous movement, avoiding transitions, cuts, sequence of shots, or montages.

Return strict JSON with this exact schema:
{
  "sceneVideos": {
    "SC_001": {
      "videoPrompt": "string (Detailed motion prompt describing exact camera movement and subject action)"
    }
  }
}`;
    
    const promptText = `Scenes:\n${JSON.stringify(screenplay, null, 2)}`;

    const rawResponse = await callGemini(promptText, { systemInstruction: systemPrompt, responseMimeType: 'application/json' });
    const parsed = parseGeminiJSON(rawResponse);

    const updated = await updateDraft(jobId, userId, (current) => {
      const currentSceneVideos = current.sceneVideos || {};
      const newSceneVideos = parsed.sceneVideos || {};
      
      const merged = { ...currentSceneVideos };
      
      const updatedScreenplay = (current.screenplay || []).map(scene => {
         const generated = newSceneVideos[scene.sceneId];
         if (generated) {
             merged[scene.sceneId] = { ...(merged[scene.sceneId] || {}), ...generated };
             return { ...scene, videoPrompt: generated.videoPrompt };
         }
         return scene;
      });

      return {
        ...current,
        sceneVideos: merged,
        screenplay: updatedScreenplay
      };
    });

    return res.json({ success: true, draft: updated });
  } catch (error) {
    return responseError(res, error, 'Failed to build video prompts');
  }
});

/**
 * POST /api/director/generate-story
 * Combines brand analysis + scene breakdown in ONE AI call.
 * Returns productionBible, story (scene array), suggestedCharacters, and voiceScript.
 */
router.post('/generate-story', protect, videoAiWriteLimiter, async (req, res) => {
  try {
    const userId = toUserId(req.user);
    const {
      jobId,
      businessName,
      industry,
      brandSummary,
      targetAudience,
      brandTone,
      commercialObjective,
      duration,
      videoStyle,
      storyDirection
    } = req.body;

    if (!jobId) return res.status(400).json({ success: false, message: 'jobId is required' });

    // Look up existing characters from draft if available
    const draftData = await loadDraftForUser(jobId, userId).catch(() => null);
    const existingCharacters = draftData?.characters || [];
    const rawDuration = duration || draftData?.durationSeconds || 30;
    const durationMatch = String(rawDuration).match(/(\d+)/);
    const durationSeconds = durationMatch ? Number(durationMatch[1]) : 30;
    const charContext = buildCharacterContext(existingCharacters);
    const { contextStr, identityLockRules, hasCharacterSheet, identityPhrase, imagePromptPrefix } = charContext;

    const systemPrompt = buildEnhancedStorySystemPrompt({
      durationSeconds,
      videoStyle: videoStyle || 'Cinematic Commercial'
    });

    const promptText = `
Business Name: ${businessName || 'N/A'}
Industry: ${industry || 'N/A'}
Brand Summary: ${brandSummary || 'N/A'}
Target Audience: ${targetAudience || 'N/A'}
Brand Tone: ${brandTone || 'N/A'}
Commercial Objective: ${commercialObjective || 'N/A'}
Duration: ${durationSeconds} seconds
Video Style: ${videoStyle || 'Cinematic Commercial'}
Director Notes / Requested Changes: ${storyDirection || 'N/A'}
Character Sheet Uploaded: ${hasCharacterSheet ? 'YES — use as permanent identity reference in every imagePrompt and videoPrompt' : 'NO — lock identity from cast descriptions'}

Approved Cast Characters (use these EXACT identities in every prompt):
${contextStr}

${identityLockRules}

EXAMPLE imagePrompt opening when Character Sheet exists:
"${imagePromptPrefix || 'The same character'} wearing [scene wardrobe] [action in environment]. [lighting, weather, timeOfDay]. [camera angle, lens, shotComposition]. [visualStyle, colorPalette]. Ultra realistic, photorealistic, 8K, highly detailed, cinematic."
${identityPhrase ? `\nRequired identity lock phrase: "${identityPhrase}"` : ''}
`.trim();

    const rawResponse = await callGemini(promptText, { systemInstruction: systemPrompt, responseMimeType: 'application/json', skipCache: true });
    const parsed = parseGeminiJSON(rawResponse);
    const normalized = normalizeEnhancedStoryResponse(parsed, { durationSeconds, existingCharacters });

    console.log(`[AI Director Story Pipeline] Generated ${normalized.scenes?.length || 0} scenes for duration ${durationSeconds}s`);
    normalized.scenes?.forEach((sc, i) => {
      console.log(`  Scene #${i + 1} (${sc.sceneId}): Title="${sc.title}" | Obj="${sc.businessObjective || 'N/A'}" | Action="${(sc.characterAction || sc.description || '').slice(0, 50)}..."`);
    });

    // Merge AI suggestions with existing user-created/edited characters
    let mergedCharacters = [...existingCharacters];

    const aiSuggestedCharacters = (normalized.suggestedCharacters || []).map(c => ({
      ...c,
      id: c.characterId,
      status: 'Pending Setup'
    }));

    aiSuggestedCharacters.forEach(aiChar => {
      const exists = mergedCharacters.some(c => (c.id || c.characterId) === (aiChar.id || aiChar.characterId));
      if (!exists) {
        mergedCharacters.push(aiChar);
      }
    });

    const updated = await updateDraft(jobId, userId, (current) => {
      const resolvedCharacters = (current?.characters && current.characters.length > 0) ? current.characters : mergedCharacters;
      const snapshot = {
        scenes: normalized.scenes || [],
        voiceScript: normalized.voiceScript || '',
        productionBible: normalized.productionBible || {},
        characters: resolvedCharacters,
        storyTitle: normalized.title || '',
        businessName,
        industry,
        targetAudience,
        brandTone,
        commercialObjective,
        videoStyle: videoStyle || 'Cinematic Commercial',
        durationSeconds
      };

      return {
        ...current,
        businessName,
        industry,
        targetAudience,
        brandTone,
        commercialObjective,
        description: brandSummary || promptText,
        brandSummary: brandSummary || promptText,
        storyDirection: storyDirection || current.storyDirection || '',
        durationSeconds,
        videoStyle: videoStyle || 'Cinematic Commercial',
        storyTitle: normalized.title || '',
        productionBible: normalized.productionBible || {},
        voiceScript: normalized.voiceScript || '',
        scenes: normalized.scenes || [],
        characters: resolvedCharacters,
        storyLocked: true,
        storySnapshot: snapshot
      };
    });

    return res.json({ success: true, draft: updated });
  } catch (error) {
    return responseError(res, error, 'Failed to generate story');
  }
});

/**
 * POST /api/director/edit-scene
 * Rewrites a single scene in place while preserving all other scenes.
 */
router.post('/edit-scene', protect, videoAiWriteLimiter, async (req, res) => {
  try {
    const userId = toUserId(req.user);
    const { jobId, sceneId, userDirection, currentScene, productionBible, characters } = req.body;

    if (!jobId || !sceneId || !userDirection) {
      return res.status(400).json({ success: false, message: 'jobId, sceneId, and userDirection are required' });
    }

    const cast = characters || [];
    const charContext = buildCharacterContext(cast);
    const characterContext = cast.map((c, idx) => {
      const cid = c.id || c.characterId || `CH_${idx + 1}`;
      return `- ID: ${cid}, Name: ${c.name}, Role: ${c.role}, Sheet: ${c.image ? 'UPLOADED' : 'pending'}, Appearance: ${c.appearanceStr || 'N/A'}`;
    }).join('\n');

    const systemPrompt = `You are an expert AI Film Director, Screenwriter, Cinematographer, and Prompt Engineer.
Rewrite ONLY the specified scene based on the user's direction. Keep sceneId and sceneNumber unchanged.

Fill ALL structured visual fields and regenerate identity-aware imagePrompt and videoPrompt.

Required scene fields:
description, environment, characterAction, sceneMood, lighting, weather, timeOfDay,
foregroundObjects, backgroundObjects, cameraDirection, cameraMovement, characterExpression,
characterPose, visualStyle, colorPalette, shotComposition, imagePrompt, videoPrompt,
audio, transition, voiceLine, emotion, location, wardrobe, durationSeconds

IMAGE PROMPT must open with Character Sheet identity reference and include: face consistency, clothing, hairstyle, expression, pose, environment, objects, lighting, camera angle, lens, composition, quality tags (ultra realistic, photorealistic, 8K, cinematic).

VIDEO PROMPT must include: Character Sheet identity, character movement, camera movement, object movement, environmental motion, facial animation, transition cue.

Return strict JSON: { "scene": { ...all fields above... } }`;

    const promptText = `
Production Bible:
- Brand Analysis: ${productionBible?.brandAnalysis || 'N/A'}
- Creative Direction: ${productionBible?.creativeDirection || 'N/A'}
- Global Visual Style: ${productionBible?.globalVisualStyle || 'N/A'}
- Mood: ${productionBible?.mood || 'N/A'}
- Lighting Style: ${productionBible?.lightingStyle || 'N/A'}

Character Sheet Identity Lock:
${charContext.identityLockRules}

Available Characters:
${characterContext || 'N/A'}
${charContext.identityPhrase ? `\nRequired identity phrase: "${charContext.identityPhrase}"` : ''}

Current Scene (${sceneId}):
${JSON.stringify(currentScene, null, 2)}

User's Direction:
"${userDirection}"
`.trim();

    const rawResponse = await callGemini(promptText, { systemInstruction: systemPrompt, responseMimeType: 'application/json' });
    const parsed = parseGeminiJSON(rawResponse);

    const rewrittenScene = parsed.scene;
    if (!rewrittenScene) {
      return res.status(500).json({ success: false, message: 'AI did not return a valid scene' });
    }

    const normalizedScene = normalizeScene(
      { ...currentScene, ...rewrittenScene, sceneId },
      Number(currentScene?.sceneNumber || 1) - 1,
      { existingCharacters: cast, sheetGuidance: buildCharacterSheetPromptGuidance(cast) }
    );

    // Update just this one scene in the draft
    const updated = await updateDraft(jobId, userId, (current) => {
      const existingScenes = current.scenes || [];
      const updatedScenes = existingScenes.map(s =>
        (s.sceneId === sceneId) ? { ...s, ...normalizedScene, sceneId } : s
      );

      const updatedSnapshot = current.storySnapshot ? {
        ...current.storySnapshot,
        scenes: (current.storySnapshot.scenes || []).map(s =>
          (s.sceneId === sceneId) ? { ...s, ...normalizedScene, sceneId } : s
        )
      } : null;

      return {
        ...current,
        scenes: updatedScenes,
        ...(updatedSnapshot ? { storySnapshot: updatedSnapshot } : {})
      };
    });

    return res.json({ success: true, draft: updated, rewrittenScene: normalizedScene });
  } catch (error) {
    return responseError(res, error, 'Failed to edit scene');
  }
});

/**
 * POST /api/director/build-prompts-for-scene
 * Regenerates image + video prompts for a single scene only.
 * Called when user edits a scene's story text in Step 4.
 */
router.post('/build-prompts-for-scene', protect, videoAiWriteLimiter, async (req, res) => {
  try {
    const userId = toUserId(req.user);
    const { jobId, sceneId, scene, characters, productionBible } = req.body;

    if (!jobId || !sceneId || !scene) {
      return res.status(400).json({ success: false, message: 'jobId, sceneId, and scene are required' });
    }

    const cast = (characters || []).filter(c =>
      (scene.characterIds || []).includes(c.id || c.characterId)
    );
    const useCast = cast.length ? cast : (characters || []);
    const charContext = buildCharacterContext(useCast);
    const sheetGuidance = buildCharacterSheetPromptGuidance(useCast);
    const characterContext = useCast.map((c, idx) => {
      const cid = c.id || c.characterId || `CH_${idx + 1}`;
      return `- ${cid}: ${c.name}, ${c.role}. Sheet: ${c.image ? 'UPLOADED' : 'pending'}. Appearance: ${c.appearanceStr || c.appearance || 'N/A'}`;
    }).join('\n');

    const systemPrompt = `You are an expert AI Film Director, Cinematographer, and Prompt Engineer.
Generate identity-aware imagePrompt and videoPrompt using ALL structured scene metadata.

IMAGE PROMPT must include: Character Sheet identity reference, face consistency, clothing, hairstyle, expression, pose, environment, buildings, foreground/background objects, lighting, weather, time of day, camera angle, lens, shot composition, visual style, color palette, quality tags (ultra realistic, photorealistic, 8K, cinematic).

VIDEO PROMPT must include: Character Sheet identity, character movement, camera movement (${scene.cameraMovement || 'specify'}), object movement, environmental motion (wind, rain, smoke, dust), facial animation, foreground/background motion, transition cue.

Never write generic prompts. Open with Character Sheet identity phrase.
Portrait 9:16 single frame. No storyboard/collage/multi-panel.

Return strict JSON: { "imagePrompt": "string", "videoPrompt": "string" }`;

    const promptText = `
Global Visual Style: ${productionBible?.globalVisualStyle || 'Cinematic Commercial'}
Creative Direction: ${productionBible?.creativeDirection || 'N/A'}
Lighting Style: ${productionBible?.lightingStyle || 'N/A'}

${charContext.identityLockRules}
${sheetGuidance.identityPhrase ? `Required identity phrase: "${sheetGuidance.identityPhrase}"` : ''}

Scene Metadata:
- Scene: ${scene.sceneId} — ${scene.title}
- Description: ${scene.description || scene.action || 'N/A'}
- Environment: ${scene.environment || scene.location || 'N/A'}
- Character Action: ${scene.characterAction || 'N/A'}
- Scene Mood: ${scene.sceneMood || scene.emotion || 'N/A'}
- Lighting: ${scene.lighting || 'N/A'}
- Weather: ${scene.weather || 'N/A'}
- Time of Day: ${scene.timeOfDay || 'N/A'}
- Foreground Objects: ${scene.foregroundObjects || 'N/A'}
- Background Objects: ${scene.backgroundObjects || 'N/A'}
- Camera Direction: ${scene.cameraDirection || scene.cameraStyle || 'N/A'}
- Camera Movement: ${scene.cameraMovement || 'N/A'}
- Character Expression: ${scene.characterExpression || 'N/A'}
- Character Pose: ${scene.characterPose || 'N/A'}
- Visual Style: ${scene.visualStyle || productionBible?.globalVisualStyle || 'N/A'}
- Color Palette: ${scene.colorPalette || 'N/A'}
- Shot Composition: ${scene.shotComposition || 'N/A'}
- Wardrobe: ${scene.wardrobe || 'N/A'}
- Transition: ${scene.transition || 'N/A'}
- Existing Image Prompt: ${scene.imagePrompt || 'None'}
- Existing Video Prompt: ${scene.videoPrompt || 'None'}

Characters in this scene:
${characterContext || 'No specific characters'}
`.trim();

    console.log(`[AI Director Prompt Pipeline] Building prompts for Scene ID: ${sceneId}`);
    console.log(`  Input Scene Metadata: Title="${scene.title}" | Action="${(scene.characterAction || scene.action || scene.description || '').slice(0, 60)}..."`);

    const rawResponse = await callGemini(promptText, { systemInstruction: systemPrompt, responseMimeType: 'application/json', skipCache: true });
    const parsed = parseGeminiJSON(rawResponse);

    let rawImgPrompt = parsed.imagePrompt || scene.imagePrompt;
    if (!rawImgPrompt || !String(rawImgPrompt).trim()) {
      const sceneActionText = String(scene.action || scene.description || scene.title || 'commercial scene action').trim();
      rawImgPrompt = `${sceneActionText}. Bright natural daylight, high-key commercial studio lighting. Medium shot, eye-level, 50mm lens. Cinematic Commercial visual style. Ultra realistic, photorealistic, 8K, highly detailed.`;
    }

    let rawVidPrompt = parsed.videoPrompt || scene.videoPrompt;
    if (!rawVidPrompt || !String(rawVidPrompt).trim()) {
      const sceneActionText = String(scene.action || scene.description || scene.title || 'commercial scene action').trim();
      rawVidPrompt = `${sceneActionText}. Slow steady push-in tracking shot, smooth cinematic camera motion. Crisp daylight commercial lighting.`;
    }

    const imagePrompt = ensureCharacterSheetInPrompt(
      rawImgPrompt,
      sheetGuidance.identityPhrase,
      sheetGuidance.imagePromptPrefix
    );
    const videoPrompt = ensureCharacterSheetInPrompt(
      rawVidPrompt,
      sheetGuidance.identityPhrase,
      sheetGuidance.videoPromptPrefix
    );

    console.log(`  Constructed Image Prompt (${imagePrompt.length} chars): "${imagePrompt.slice(0, 80)}..."`);
    console.log(`  Constructed Video Prompt (${videoPrompt.length} chars): "${videoPrompt.slice(0, 80)}..."`);

    // Update just this scene's prompts in the draft
    const updated = await updateDraft(jobId, userId, (current) => {
      const existingScenes = current.scenes || [];
      const updatedScenes = existingScenes.map(s => {
        const sid = String(s.sceneId || s.id || s.sceneNumber || '').toLowerCase();
        const targetId = String(sceneId || '').toLowerCase();
        if (sid === targetId || sid.endsWith(targetId) || targetId.endsWith(sid)) {
          return {
            ...s,
            imagePrompt,
            videoPrompt
          };
        }
        return s;
      });
      return { ...current, scenes: updatedScenes };
    });

    console.log(`[Draft Persistence] Scene: ${sceneId} | Saved imagePromptLength=${imagePrompt.length}, videoPromptLength=${videoPrompt.length} | Mongo Update SUCCESS`);

    return res.json({
      success: true,
      draft: updated,
      imagePrompt,
      videoPrompt
    });
  } catch (error) {
    return responseError(res, error, 'Failed to build prompts for scene');
  }
});

/**
 * POST /api/director/improve-prompt
 * Refines exactly one selected prompt for one scene.
 */
router.post('/improve-prompt', protect, videoAiWriteLimiter, async (req, res) => {
  try {
    const userId = toUserId(req.user);
    const { jobId, sceneId, scene, promptType, existingPrompt, userRequest } = req.body || {};

    if (!jobId || !sceneId || !scene || !['image', 'video'].includes(promptType)) {
      return res.status(400).json({ success: false, message: 'jobId, sceneId, scene, and promptType are required' });
    }

    const cleanExistingPrompt = String(existingPrompt || '').trim();
    const cleanUserRequest = String(userRequest || '').trim();

    if (!cleanExistingPrompt) {
      return res.status(400).json({ success: false, message: 'Existing prompt is required' });
    }
    if (!cleanUserRequest) {
      return res.status(400).json({ success: false, message: 'Improvement request is required' });
    }

    const label = promptType === 'image' ? 'Image Prompt' : 'Video Prompt';
    const systemPrompt = `You are an expert AI Prompt Refinement Assistant for cinematic image and video generation.

Your task is to improve an existing prompt based ONLY on the user's requested modifications.

Rules:
1. Update ONLY the selected prompt.
2. Do NOT modify prompts from other scenes.
3. Preserve the existing story continuity.
4. Preserve the same character identity, face, clothing, age, hairstyle, body proportions, and background unless explicitly requested.
5. Preserve the same scene purpose and narrative.
6. Preserve camera framing and composition unless the user requests a different camera angle.
7. Preserve lighting, mood, and environment unless explicitly requested.
8. Apply ONLY the requested improvements.
9. If the user asks to add something, integrate it naturally into the existing prompt.
10. If the user asks to remove something, remove only that element.
11. Do not rewrite the prompt from scratch unless required.
12. Return ONLY the updated prompt.
13. Do not explain your changes.
14. Do not return markdown.
15. Keep the prompt optimized for high-quality AI image/video generation.`;

    const promptText = `
Scene:
${scene.title || sceneId}

Scene Details:
${JSON.stringify(scene, null, 2)}

Prompt Type:
${label}

Existing Prompt:
${cleanExistingPrompt}

User Improvement Request:
${cleanUserRequest}

Update only this prompt.
`.trim();

    const rawResponse = await callGemini(promptText, { systemInstruction: systemPrompt });
    const improvedPrompt = String(rawResponse || '')
      .replace(/^```(?:\w+)?/i, '')
      .replace(/```$/i, '')
      .trim();

    if (!improvedPrompt) {
      return res.status(500).json({ success: false, message: 'AI did not return an improved prompt' });
    }

    const field = promptType === 'image' ? 'imagePrompt' : 'videoPrompt';
    const updated = await updateDraft(jobId, userId, (current) => {
      const existingScenes = Array.isArray(current.scenes) ? current.scenes : [];
      const updatedScenes = existingScenes.map((s, index) => {
        const sameScene =
          String(s.sceneId || '') === String(sceneId) ||
          String(s.index || s.sceneNumber || index + 1) === String(scene.index || scene.sceneNumber || '');

        return sameScene ? { ...s, [field]: improvedPrompt } : s;
      });

      return {
        ...current,
        scenes: updatedScenes.length ? updatedScenes : current.scenes
      };
    });

    return res.json({
      success: true,
      draft: updated,
      sceneId,
      promptType,
      prompt: improvedPrompt
    });
  } catch (error) {
    return responseError(res, error, 'Failed to improve prompt');
  }
});

module.exports = router;
