const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./identityLockConfig');
const comfyUI = require('./comfyUIClient');

const DEFAULT_NEGATIVE = [
  'different person',
  'wrong face',
  'face swap artifact',
  'multiple faces',
  'duplicate people',
  'storyboard',
  'collage',
  'split screen',
  'text',
  'watermark',
  'low quality',
  'blurry face'
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
  const camera = scene.cameraStyle || scene.camera || 'Cinematic framing';
  const pose = scene.action || scene.pose || 'Natural pose';
  const environment = scene.location || scene.environment || 'Commercial environment';
  const lighting = scene.lighting || scene.lightingStyle || 'Professional cinematic lighting';
  const wardrobe = scene.wardrobe || '';

  const identityBlock = identityPackage
    ? [
      'Use the exact same person from the Character Sheet reference image.',
      'Preserve face geometry, skin tone, age, ethnicity, and facial hair.',
      'Only change clothing, pose, expression, camera angle, environment, and lighting as described.',
      identityInstruction
    ].filter(Boolean).join(' ')
    : '';

  return [
    identityBlock,
    scenePrompt,
    `Camera: ${camera}`,
    `Pose: ${pose}`,
    `Environment: ${environment}`,
    `Lighting: ${lighting}`,
    wardrobe ? `Wardrobe: ${wardrobe}` : '',
    plan?.globalVisualStyle ? `Style: ${plan.globalVisualStyle}` : '',
    'Single 9:16 cinematic frame. No collage. No storyboard. No text.'
  ].filter(Boolean).join('\n');
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
    return generateWithComfyUIIdentity({
      prompt: effectivePrompt,
      negativePrompt: DEFAULT_NEGATIVE,
      identityPackage,
      scene,
      seed,
      logger
    });
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

  throw new Error('Character identity generation requires ComfyUI PuLID/IPAdapter.');
}

module.exports = {
  DEFAULT_NEGATIVE,
  buildSceneGenerationPrompt,
  generateIdentityConditionedSceneImage,
  generateWithComfyUIIdentity
};
