const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./identityLockConfig');
const comfyUI = require('./comfyUIClient');

const DEFAULT_NEGATIVE = [
  'different person',
  'wrong face',
  'face drift',
  'reconstructed face',
  'multiple faces',
  'duplicate people',
  'storyboard',
  'collage',
  'split screen',
  'text',
  'watermark',
  'low quality',
  'blurry face',
  'dark background',
  'underexposed shadows',
  'black silhouette backdrop',
  'hologram overlay',
  'overuse of glowing UI',
  'flat lighting',
  'generic AI artwork',
  'digital poster',
  'sci-fi energy beams',
  'space nebula',
  'glowing blue particles',
  'fantasy portal',
  'futuristic cyberspace',
  'holographic screen'
].join(', ');

function buildSceneGenerationPrompt({
  scene = {},
  prompt = '',
  identityPackage = null,
  plan = null,
  identityInstruction = '',
  rawPrompt = false
}) {
  if (rawPrompt) return String(prompt || '').trim();

  const scenePrompt = String(prompt || scene.imagePrompt || scene.action || '').trim();
  const camera = scene.cameraStyle || scene.camera || 'ARRI Alexa 35, 85mm cinema lens, f/1.8 shallow depth of field';
  const pose = scene.action || scene.pose || 'Natural commercial gesture with focused, authentic expression';
  const environment = scene.location || scene.environment || 'Vibrant architectural tech office / studio space with natural lighting';
  const lighting = scene.lighting || scene.lightingStyle || 'Bright professional studio lighting, clear high-key illumination, natural daylight';
  const wardrobe = scene.wardrobe || '';

  const identitySection = identityPackage
    ? [
        '[IDENTITY]',
        '- Use ONLY the uploaded Character Sheet reference image',
        '- Preserve exact identity without altering facial structure',
        '- Reference image has absolute priority over text description',
        identityInstruction ? `- Note: ${identityInstruction}` : ''
      ].filter(Boolean).join('\n')
    : '';

  const sceneSection = [
    '[SCENE]',
    `- Action & Story Moment: ${scenePrompt}`,
    `- Expression & Gesture: ${pose}`,
    `- Location & Set: ${environment}`,
    wardrobe ? `- Wardrobe: ${wardrobe}` : ''
  ].filter(Boolean).join('\n');

  const cameraSection = [
    '[CAMERA]',
    `- Lens & Camera: ${camera}`,
    '- Framing: 9:16 vertical commercial framing'
  ].join('\n');

  const lightingSection = [
    '[LIGHTING]',
    `- Illumination: ${lighting}`,
    '- Ambience: Well-lit environment, soft natural shadows, authentic skin texture'
  ].join('\n');

  const styleSection = [
    '[STYLE]',
    '- Color Science: Clean commercial color grade, vibrant natural tones, bright photorealism',
    plan?.globalVisualStyle ? `- Grade Note: ${plan.globalVisualStyle}` : ''
  ].filter(Boolean).join('\n');

  const directorNotesSection = [
    '[DIRECTOR NOTES]',
    '- Commercial Aesthetic: Apple Keynote launch film, OpenAI announcement, Tesla AI presentation',
    '- Human Performance: Natural human emotion, authentic business interaction',
    '- Realism: Real physical studio photography, zero AI-generated appearance, bright clear background'
  ].join('\n');

  return [
    identitySection,
    sceneSection,
    cameraSection,
    lightingSection,
    styleSection,
    directorNotesSection
  ].filter(Boolean).join('\n\n');
}

async function writeGenerationProof(identityPackage, proof, logger = null) {
  try {
    const dir = identityPackage?.dir
      || (identityPackage?.referencePath ? path.dirname(identityPackage.referencePath) : null);
    if (!dir) return;
    const proofPath = path.join(dir, 'last_generation_proof.json');
    await fs.promises.writeFile(proofPath, JSON.stringify(proof, null, 2));
    if (logger) logger(`[IdentityGen] Proof written: ${proofPath}`);
  } catch (error) {
    if (logger) logger(`[IdentityGen] Could not write proof: ${error.message}`);
  }
}

async function generateWithComfyUIIdentity({
  prompt,
  negativePrompt = DEFAULT_NEGATIVE,
  identityPackage,
  scene = null,
  seed = null,
  logger = null
}) {
  if (!identityPackage?.referencePath) {
    throw new Error('Identity package missing Character Sheet reference');
  }
  if (!fs.existsSync(identityPackage.referencePath)) {
    throw new Error(`Character Sheet missing on disk: ${identityPackage.referencePath}`);
  }

  const comfyReady = await comfyUI.checkComfyUIAvailable(true);
  if (!comfyReady) {
    throw new Error(`ComfyUI is not reachable at ${config.COMFYUI_URL}`);
  }

  const identityEngine = identityPackage.identityEngine || config.IDENTITY_ENGINE;
  const { workflow, workflowPath } = await comfyUI.loadWorkflowTemplate(identityEngine);

  const referenceImageName = await comfyUI.uploadImageToComfyUI(
    identityPackage.referencePath,
    `character_${identityPackage.characterId}.png`
  );

  const effectiveSeed = Number.isFinite(seed)
    ? seed
    : crypto.randomInt(1, 2147483647);

  const injected = comfyUI.injectIdentityWorkflow(workflow, {
    prompt,
    negativePrompt,
    referenceImageName,
    seed: effectiveSeed,
    pulidWeight: config.PULID_WEIGHT
  });

  // HARD FAIL if Character Sheet / PuLID / sampler are not actually wired.
  const wiring = comfyUI.assertIdentityWorkflowWired(injected, {
    referenceImageName,
    identityEngine
  });
  const modelInfo = comfyUI.inspectFluxCheckpoint(injected);

  if (logger) {
    logger('[IdentityGen] Character detected — using identity-conditioned ComfyUI path');
    logger(`[IdentityGen] Workflow: ${workflowPath}`);
    logger(`[IdentityGen] Uploaded Character Sheet to ComfyUI as: ${referenceImageName}`);
    logger(`[IdentityGen] Wiring OK: LoadImage(${wiring.loadImageId}) → ${wiring.applyClass}(${wiring.applyId}) → KSampler`);
    logger(`[IdentityGen] Model: unet=${modelInfo.unetName || 'n/a'} ckpt=${modelInfo.checkpointName || 'n/a'}`);
    logger(`[IdentityGen] Embedding token: ${identityPackage.embeddingPath || 'n/a'}`);
    logger('[IdentityGen] Gemini is NOT used for this character scene');
  }

  const promptId = await comfyUI.queuePrompt(injected);
  if (logger) logger(`[IdentityGen] ComfyUI prompt queued: ${promptId}`);

  const imageResult = await comfyUI.waitForImage(promptId);
  if (!imageResult?.dataUrl) {
    throw new Error('ComfyUI returned no image');
  }

  const proof = {
    at: new Date().toISOString(),
    engine: `comfyui-${identityEngine}`,
    identityConditioned: true,
    geminiUsed: false,
    characterId: identityPackage.characterId,
    referencePath: identityPackage.referencePath,
    uploadedReferenceName: referenceImageName,
    embeddingPath: identityPackage.embeddingPath || null,
    workflowPath,
    wiring,
    modelInfo,
    promptId,
    seed: effectiveSeed,
    outputFilename: imageResult.filename,
    sceneId: scene?.sceneId || null
  };
  await writeGenerationProof(identityPackage, proof, logger);

  return {
    imageSource: imageResult.dataUrl,
    engine: `comfyui-${identityEngine}`,
    seed: effectiveSeed,
    identityConditioned: true,
    geminiUsed: false,
    proof
  };
}

async function generateWithGeminiReference({
  prompt,
  identityPackage = null,
  logger = null,
  brandContext = {}
}) {
  if (identityPackage) {
    if (logger) {
      logger('[IdentityGen] BLOCKED: Gemini cannot identity-condition Character Sheet scenes');
    }
    throw new Error(
      'Gemini fallback blocked for Character Sheet scenes. Start ComfyUI with PuLID/IPAdapter or set ALLOW_GEMINI_FALLBACK_WITHOUT_IDENTITY=true (not recommended).'
    );
  }

  if (logger) logger('[IdentityGen] No Character Sheet — using Gemini (non-identity scene)');

  const { generateCampaignImageNanoBanana } = require('./geminiAI');
  const result = await generateCampaignImageNanoBanana(prompt, {
    aspectRatio: '9:16',
    characterReferenceImage: null,
    originalCharacterImage: null,
    isCinematic: true,
    tone: brandContext.tone || 'professional',
    brandName: brandContext.brandName,
    industry: brandContext.industry,
    preserveCharacterIdentity: false,
    consistencyStrength: 'standard'
  });

  if (typeof result === 'string') {
    return { imageSource: result, engine: 'gemini', identityConditioned: false, geminiUsed: true };
  }
  if (result?.imageUrl) {
    return { imageSource: result.imageUrl, engine: 'gemini', identityConditioned: false, geminiUsed: true };
  }
  throw new Error(result?.error || 'Gemini image generation failed');
}

async function generateIdentityConditionedSceneImage({
  prompt,
  scene = null,
  identityPackage = null,
  plan = null,
  identityInstruction = '',
  rawPrompt = false,
  seed = null,
  logger = null,
  brandContext = {}
}) {
  const effectivePrompt = buildSceneGenerationPrompt({
    scene,
    prompt,
    identityPackage,
    plan,
    identityInstruction,
    rawPrompt
  });

  const charId = identityPackage?.characterId || identityPackage?.id || 'None';
  const memId = identityPackage?.identityMemoryId || identityPackage?.characterId || 'None';
  const refStatus = identityPackage?.referencePath || identityPackage?.referenceDataUrl ? 'Loaded ✅' : 'None ❌';

  console.log('\n====================================================');
  console.log('[IdentityGen] 🔍 SCENE GENERATION IDENTITY LOCK VERIFICATION:');
  console.log(`[IdentityGen] Character ID: ${charId}`);
  console.log(`[IdentityGen] Identity Memory ID: ${memId}`);
  console.log(`[IdentityGen] Reference Image Status: ${refStatus}`);
  console.log(`[IdentityGen] Target Engine: ${config.IMAGE_ENGINE === 'comfyui' || config.AUTO_COMFYUI_FOR_IDENTITY ? 'ComfyUI (PuLID/IPAdapter)' : 'Cloud AI'}`);
  console.log('====================================================\n');

  if (logger) {
    logger(`[IdentityGen] Scene Gen Verification -> CharID: ${charId} | MemID: ${memId} | Reference: ${refStatus}`);
  }

  // No Character Sheet → Gemini is fine.
  if (!identityPackage) {
    return generateWithGeminiReference({
      prompt: effectivePrompt,
      identityPackage: null,
      logger,
      brandContext
    });
  }

  // Character Sheet present → ComfyUI identity conditioning ONLY.
  const shouldUseComfyUI = config.IMAGE_ENGINE === 'comfyui' || config.AUTO_COMFYUI_FOR_IDENTITY;
  if (!shouldUseComfyUI && !config.ALLOW_GEMINI_FALLBACK_WITHOUT_IDENTITY) {
    throw new Error(
      'Character Sheet scenes require IMAGE_ENGINE=comfyui (or AUTO_COMFYUI_FOR_IDENTITY=true).'
    );
  }

  if (shouldUseComfyUI) {
    try {
      return await generateWithComfyUIIdentity({
        prompt: effectivePrompt,
        negativePrompt: DEFAULT_NEGATIVE,
        identityPackage,
        scene,
        seed,
        logger
      });
    } catch (comfyErr) {
      if (config.ALLOW_GEMINI_FALLBACK_WITHOUT_IDENTITY) {
        if (logger) {
          logger(`[IdentityGen] ComfyUI unavailable (${comfyErr.message}) — falling back to Cloud AI generation`);
        }
        console.warn(`[IdentityGen] ComfyUI error (${comfyErr.message}). Falling back to Cloud AI.`);
        const { generateCampaignImageNanoBanana } = require('./geminiAI');
        const result = await generateCampaignImageNanoBanana(effectivePrompt, {
          aspectRatio: '9:16',
          characterReferenceImage: identityPackage.referenceDataUrl,
          originalCharacterImage: identityPackage.referenceDataUrl,
          isCinematic: true,
          tone: brandContext.tone || 'professional',
          brandName: brandContext.brandName,
          industry: brandContext.industry,
          preserveCharacterIdentity: true,
          consistencyStrength: 'strict'
        });
        const imageSource = typeof result === 'string' ? result : result?.imageUrl;
        if (!imageSource) throw new Error(result?.error || 'Cloud AI fallback image generation failed');
        return {
          imageSource,
          engine: 'gemini-fallback',
          identityConditioned: false,
          geminiUsed: true
        };
      }
      throw new Error(
        `Identity-preserving scene generation is unavailable because ComfyUI is offline or unreachable at ${config.COMFYUI_URL}. Please ensure ComfyUI (with PuLID/IPAdapter models) is running to maintain identical face matching across scenes.`
      );
    }
  }

  // Explicit escape hatch only.
  if (config.ALLOW_GEMINI_FALLBACK_WITHOUT_IDENTITY) {
    if (logger) {
      logger('[IdentityGen] WARNING: ALLOW_GEMINI_FALLBACK_WITHOUT_IDENTITY=true — identity conditioning disabled');
    }
    const { generateCampaignImageNanoBanana } = require('./geminiAI');
    const result = await generateCampaignImageNanoBanana(effectivePrompt, {
      aspectRatio: '9:16',
      characterReferenceImage: identityPackage.referenceDataUrl,
      originalCharacterImage: identityPackage.referenceDataUrl,
      isCinematic: true,
      tone: brandContext.tone || 'professional',
      brandName: brandContext.brandName,
      industry: brandContext.industry,
      preserveCharacterIdentity: true,
      consistencyStrength: 'strict'
    });
    const imageSource = typeof result === 'string' ? result : result?.imageUrl;
    if (!imageSource) throw new Error(result?.error || 'Gemini image generation failed');
    return {
      imageSource,
      engine: 'gemini-fallback',
      identityConditioned: false,
      geminiUsed: true
    };
  }

  throw new Error('Character identity generation requires ComfyUI PuLID/IPAdapter or Cloud AI fallback.');
}

module.exports = {
  DEFAULT_NEGATIVE,
  buildSceneGenerationPrompt,
  generateIdentityConditionedSceneImage,
  generateWithComfyUIIdentity
};
