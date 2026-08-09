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

const router = express.Router();

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
router.post('/generateVideoStylePrompts', async (req, res) => {
  try {
    const {
      description,
      videoStyle,
      characterName,
      sceneCount = 5,
      productName = null,
      duration = 30
    } = req.body;

    // Validate inputs
    if (!description || !videoStyle || !characterName || !sceneCount) {
      return res.status(400).json({
        error: 'Missing required fields: description, videoStyle, characterName, sceneCount'
      });
    }

    if (!styleDefinitions[videoStyle]) {
      return res.status(400).json({
        error: `Video style "${videoStyle}" not supported. Supported styles: ${Object.keys(styleDefinitions).join(', ')}`
      });
    }

    console.log('\n🎬 ===================== GENERATE VIDEO STYLE PROMPTS =====================');
    console.log(`📝 Description: ${description}`);
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

    return res.status(500).json({
      error: 'Failed to generate prompts',
      message: error.message
    });
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
router.post('/generateSceneDescriptions', async (req, res) => {
  try {
    const {
      videoStyle,
      sceneNumber,
      customDescription = null
    } = req.body;

    if (!videoStyle || !sceneNumber) {
      return res.status(400).json({
        error: 'Missing required fields: videoStyle, sceneNumber'
      });
    }

    if (!styleDefinitions[videoStyle]) {
      return res.status(400).json({
        error: `Video style "${videoStyle}" not found`
      });
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

    return res.status(500).json({
      error: 'Failed to generate scene descriptions',
      message: error.message
    });
  }
});

module.exports = router;
