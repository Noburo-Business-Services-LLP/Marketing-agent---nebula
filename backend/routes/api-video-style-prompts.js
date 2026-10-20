/**
 * API Endpoint: /api/generateVideoStylePrompts
 * 
 * Generates optimized prompts for Step 2 based on:
 * - User description
 * - Video style
 * - Character info
 * - Scene count
 */

const express = require('express');
const {
  generateScenePrompts,
  generateStyledPrompts,
  styleDefinitions
} = require('../services/video-style-prompt-engineering');
const { getKlingDuration } = require('../services/videoService');
const { protect } = require('../middleware/auth');

const router = express.Router();

// The builder was public and uncapped (one load-test request got a 221 MB answer). It needs a login, the AI limiter
// (server-main.js) and these caps; anything outside them is a plain 400.
const LIMITS = { maxScenes: 20, maxDurationSeconds: 300, maxDescription: 2000, maxName: 120 };
const bad = (res, message) => res.status(400).json({ success: false, error: message, message });
const isText = (v, max, { required = true } = {}) => (v === undefined || v === null || v === '' ? !required : typeof v === 'string' && v.length <= max);
const wholeIn = (v, lo, hi) => { const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v; return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };

/**
 * POST /api/generateVideoStylePrompts
 * 
 * Request body:
 * {
 *   description: "A professional selling software tools",
 *   videoStyle: "Cinematic Commercial",
 *   characterName: "SIVA",
 *   sceneCount: 5,
 *   productName: "ProductName" (optional),
 *   duration: 30 (total seconds)
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   videoStyle: "Cinematic Commercial",
 *   totalDuration: 30,
 *   promptText: "...",
 *   scenes: [
 *     {
 *       sceneNumber: 1,
 *       title: "Opening Hook",
 *       durationSeconds: 6,
 *       imagePrompt: "...",
 *       videoPrompt: "...",
 *       audioStyle: "...",
 *       cameraDirections: {...}
 *     },
 *     ...
 *   ]
 * }
 */
router.post('/generateVideoStylePrompts', protect, async (req, res) => {
  try {
    const body = req.body || {};
    const { description, videoStyle, characterName } = body;
    const productName = body.productName || null;

    // Validate inputs
    if (!description || !videoStyle || !characterName || body.sceneCount === 0) {
      return bad(res, 'Missing required fields: description, videoStyle, characterName, sceneCount');
    }
    const sceneCount = wholeIn(body.sceneCount === undefined ? 5 : body.sceneCount, 1, LIMITS.maxScenes);
    if (sceneCount === null) return bad(res, `Scene count must be a whole number from 1 to ${LIMITS.maxScenes}.`);
    const duration = wholeIn(body.duration === undefined ? 30 : body.duration, 1, LIMITS.maxDurationSeconds);
    if (duration === null) return bad(res, `Duration must be a whole number of seconds from 1 to ${LIMITS.maxDurationSeconds}.`);
    if (!isText(description, LIMITS.maxDescription)) return bad(res, `The description must be text of at most ${LIMITS.maxDescription} characters.`);
    if (!isText(characterName, LIMITS.maxName) || !isText(productName, LIMITS.maxName, { required: false })) {
      return bad(res, `Names must be text of at most ${LIMITS.maxName} characters.`);
    }
    if (typeof videoStyle !== 'string' || !Object.prototype.hasOwnProperty.call(styleDefinitions, videoStyle)) {
      return bad(res, `That video style is not supported. Supported styles: ${Object.keys(styleDefinitions).join(', ')}`);
    }

    console.log('\n🎬 ===================== GENERATE VIDEO STYLE PROMPTS =====================');
    console.log(`📝 Description: ${description.length} characters`);
    console.log(`🎨 Video Style: ${videoStyle}`);
    console.log(`👤 Character: ${characterName}`);
    console.log(`🎬 Scene Count: ${sceneCount}`);
    console.log(`⏱️  Total Duration: ${duration}s`);
    if (productName) console.log(`📦 Product: ${productName}`);
    console.log('========================================================================\n');

    // Calculate duration per scene (flexible)
    const baseDurationPerScene = Math.floor(duration / sceneCount);
    
    // Generate overall styled prompts
    const overallPrompts = generateStyledPrompts(
      description,
      videoStyle,
      characterName,
      productName
    );
    const combinedPromptText = `${overallPrompts.videoPrompt}\n\nAudio:\n${overallPrompts.audioPrompt}`;

    // Generate scene prompts
    const generatedScenes = generateScenePrompts(
      description,
      videoStyle,
      characterName,
      sceneCount,
      productName
    );

    // Enhance each scene with timing and cinematography.
    //
    // Scene length is NOT free: Kling v2.5 only renders 5s or 10s clips.
    // Asking for anything else (the old 1.2x / 0.8x pacing weights produced
    // 6s, 7s, 4s...) leaves a gap the renderer fills by freezing the final
    // frame — which is what made every scene end on a still. Snap to what
    // the model can deliver and the freeze never happens.
    const enhancedScenes = generatedScenes.map((scene, index) => {
      const sceneDuration = getKlingDuration({ durationSeconds: baseDurationPerScene });

      return {
        sceneNumber: scene.sceneNumber || index + 1,
        title: scene.sceneType || scene.title || `Scene ${index + 1}`,
        sceneType: scene.sceneType,
        description: scene.description || '',
        durationSeconds: sceneDuration,
        setting: scene.setting,
        focus: scene.focus,
        emphasis: scene.emphasis,
        characterAction: scene.characterAction,
        
        // IMAGE PROMPT - for Step 3
        imagePrompt: scene.imagePrompt,
        
        // VIDEO PROMPT - for Step 4
        videoPrompt: scene.videoPrompt,
        
        // AUDIO STYLE - for Step 5
        audioStyle: scene.audioStyle,
        
        // CAMERA DIRECTIONS - for cinematography reference
        cameraDirections: {
          angles: scene.sceneType ? styleDefinitions[videoStyle].cameraAngles : 'Professional framing',
          lighting: scene.lighting || styleDefinitions[videoStyle].colorGrade,
          movement: styleDefinitions[videoStyle].pacing,
          characterActions: scene.characterAction,
          composition: scene.composition || 'Professional composition'
        }
      };
    });

    // Calculate total generated duration
    const totalGeneratedDuration = enhancedScenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);

    const response = {
      success: true,
      metadata: {
        videoStyle: videoStyle,
        characterName: characterName,
        productName: productName || null,
        description: description,
        requestedDuration: duration,
        actualDuration: totalGeneratedDuration,
        sceneCount: sceneCount,
        generatedAt: new Date().toISOString()
      },
      promptText: combinedPromptText,
      scenes: enhancedScenes,
      
      // Summary for quick reference
      summary: {
        totalScenes: enhancedScenes.length,
        totalDuration: totalGeneratedDuration,
        averageSceneDuration: Math.round(totalGeneratedDuration / sceneCount),
        videoStyle: videoStyle,
        cinematographyStyle: styleDefinitions[videoStyle].cameraStyle,
        audioTone: styleDefinitions[videoStyle].audioTone,
        colorGrade: styleDefinitions[videoStyle].colorGrade
      }
    };

    // Log the generation
    console.log(`✅ Generated ${enhancedScenes.length} scenes with style-aware prompts`);
    console.log(`   Total duration: ${totalGeneratedDuration}s`);
    console.log(`   Cinematography: ${styleDefinitions[videoStyle].cameraStyle}`);
    console.log(`   Audio tone: ${styleDefinitions[videoStyle].audioTone}\n`);

    return res.status(200).json(response);

  } catch (error) {
    console.error('❌ Error generating video style prompts:');
    console.error('   Message:', error.message);
    console.error('   Stack:', error.stack);

    return res.status(500).json({ success: false, error: 'Failed to generate prompts', message: 'Something went wrong. Please try again.' });
  }
});

/**
 * GET /api/videoStyles
 * 
 * Returns all available video styles with descriptions
 */
router.get('/videoStyles', (req, res) => {
  const styles = Object.entries(styleDefinitions).map(([key, value]) => ({
    id: key,
    name: value.name,
    description: `${value.cameraStyle} - ${value.audioTone}`,
    cameraStyle: value.cameraStyle,
    audioTone: value.audioTone,
    colorGrade: value.colorGrade,
    pacing: value.pacing
  }));

  return res.status(200).json({
    success: true,
    totalStyles: styles.length,
    styles: styles
  });
});

/**
 * POST /api/generateSceneDescriptions
 * 
 * Generate detailed descriptions for individual scenes
 * (for manual refinement or detailed planning)
 */
router.post('/generateSceneDescriptions', protect, async (req, res) => {
  try {
    const { videoStyle } = req.body || {};

    if (!videoStyle || !(req.body || {}).sceneNumber) {
      return bad(res, 'Missing required fields: videoStyle, sceneNumber');
    }
    const sceneNumber = wholeIn(req.body.sceneNumber, 1, LIMITS.maxScenes);
    if (sceneNumber === null) return bad(res, `Scene number must be a whole number from 1 to ${LIMITS.maxScenes}.`);

    if (typeof videoStyle !== 'string' || !Object.prototype.hasOwnProperty.call(styleDefinitions, videoStyle)) {
      return bad(res, 'That video style was not found.');
    }

    const style = styleDefinitions[videoStyle];

    const detailedDescription = {
      success: true,
      videoStyle: videoStyle,
      sceneNumber: sceneNumber,
      styleGuide: {
        cinematography: style.cameraStyle,
        characterMovement: style.characterMovement,
        audioTone: style.audioTone,
        colorGrade: style.colorGrade,
        pacing: style.pacing,
        cameraAngles: style.cameraAngles,
        overallPrompt: style.prompt
      },
      tips: {
        forImageGeneration: `Focus on: ${style.colorGrade}, ${style.cameraStyle}`,
        forVideoGeneration: `Movement should be: ${style.characterMovement}, Pacing: ${style.pacing}`,
        forAudio: `Deliver with: ${style.audioTone}, match character: ${style.characterMovement}`
      }
    };

    return res.status(200).json(detailedDescription);

  } catch (error) {
    console.error('❌ Error generating scene descriptions:');
    console.error('   Message:', error.message);

    return res.status(500).json({ success: false, error: 'Failed to generate scene descriptions', message: 'Something went wrong. Please try again.' });
  }
});

router.LIMITS = LIMITS;
module.exports = router;
