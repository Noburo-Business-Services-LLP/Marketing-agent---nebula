const fs = require('fs');
const path = require('path');
const { updateDraft, buildMediaUrl } = require('./videoDraftStore');
const { resolveCharacterMemoryForScene, generateSceneImageWithIdentityLock } = require('./sceneImageIdentityPipeline');
const { logDirector, logJobStarted, logJobFinished, logJobFailed } = require('./directorLogger');

function sanitizeSceneData(scenes, durationSeconds = 60) {
  const list = Array.isArray(scenes) ? scenes : [];
  return list.map((scene, index) => ({
    ...scene,
    sceneId: scene.sceneId || `SC_${String(index + 1).padStart(3, '0')}`,
    sceneNumber: scene.sceneNumber ?? index + 1,
    durationSeconds: scene.durationSeconds || Math.max(3, Math.floor(durationSeconds / Math.max(list.length, 1)))
  }));
}

async function runDirectorImageGeneration({
  jobId,
  userId,
  draft,
  baseUrl,
  action = 'generateAll',
  sceneId = null,
  imagePrompt = '',
  characterId = null,
  sceneData = null,
  brandContext = {},
  onProgress = null,
  onLog = null,
  onSceneSaved = null
}) {
  const logger = (line) => {
    if (onLog) onLog(line);
    logDirector('image_generation', line, { jobId, userId, characterId });
  };

  logJobStarted({ jobId, userId, characterId }, { action, sceneId });

  const durationSeconds = Number(draft?.input?.durationSeconds || 60);
  const sourceScenes = sanitizeSceneData(
    sceneData ||
    draft?.images?.sceneData ||
    (Array.isArray(draft?.scenes) ? draft.scenes : null) ||
    draft?.scenes?.sceneData ||
    [],
    durationSeconds
  );

  if (!sourceScenes.length) {
    throw new Error('No scene data available. Generate scenes first.');
  }

  const characterMemory = await resolveCharacterMemoryForScene({
    draft,
    scene: sourceScenes.find((item) => action === 'regenerate' && sceneId ? String(item.sceneId) === String(sceneId) : true) || sourceScenes[0],
    characterId: characterId || draft.characterId,
    jobId
  });

  let nextScenes = [...sourceScenes];
  const scenesToGenerate = action === 'regenerate' && sceneId
    ? sourceScenes.filter((s) => s.sceneId === sceneId)
    : sourceScenes;

  const total = scenesToGenerate.length;
  let completed = 0;

  for (const scene of scenesToGenerate) {
    if (!scene) continue;

    const scenePrompt = String(imagePrompt || scene.imagePrompt || draft?.prompt?.promptText || '').trim();
    const sceneMemory = await resolveCharacterMemoryForScene({
      draft,
      scene,
      characterId: characterId || draft.characterId,
      jobId
    }) || characterMemory;

    const localOutputPath = path.join(
      __dirname,
      '..',
      'storage',
      'ai-videos',
      jobId,
      'images',
      `${scene.sceneId}.png`
    );
    fs.mkdirSync(path.dirname(localOutputPath), { recursive: true });

    const identityResult = await generateSceneImageWithIdentityLock({
      scene,
      prompt: scenePrompt,
      characterMemory: sceneMemory,
      draft,
      jobId,
      sceneId: scene.sceneId,
      localOutputPath,
      logger,
      brandContext
    });

    const finalImageUrl = buildMediaUrl(baseUrl, jobId, ['images', `${scene.sceneId}.png`]);
    const idx = nextScenes.findIndex((s) => s.sceneId === scene.sceneId);
    if (idx !== -1) {
      nextScenes[idx] = {
        ...nextScenes[idx],
        imageUrl: finalImageUrl,
        generatedImageUrl: finalImageUrl,
        imagePrompt: scenePrompt || nextScenes[idx].imagePrompt,
        identityLock: {
          similarity: identityResult.similarity,
          attempts: identityResult.attempts,
          faceSwapApplied: identityResult.faceSwapApplied,
          enhanced: identityResult.enhanced,
          identityConditioned: identityResult.identityConditioned,
          generationEngine: identityResult.generationEngine,
          characterMemoryId: identityResult.characterMemoryId
        }
      };
    }

    completed += 1;
    const progress = Math.round((completed / total) * 90);

    const saved = await updateDraft(jobId, userId, (current) => ({
      ...current,
      currentStep: Math.max(Number(current.currentStep || 1), 5),
      scenes: nextScenes,
      images: {
        sceneData: nextScenes,
        generatedAt: new Date().toISOString(),
        lastSceneId: scene.sceneId
      },
      imageJobs: {
        ...(current.imageJobs || {}),
        lastCompletedSceneId: scene.sceneId,
        completedCount: completed,
        totalCount: total,
        status: completed >= total ? 'completed' : 'processing',
        updatedAt: new Date().toISOString()
      }
    }));

    if (onSceneSaved) await onSceneSaved(saved, scene.sceneId);
    if (onProgress) {
      await onProgress({
        progress,
        currentStep: `generate_images_scene_${scene.sceneId}`,
        metadata: { completedScenes: completed, totalScenes: total, sceneId: scene.sceneId }
      });
    }
    logger(`Saved scene ${scene.sceneId} (${completed}/${total})`);
  }

  logJobFinished({ jobId, userId }, { completedScenes: completed, totalScenes: total });

  return {
    success: true,
    jobId,
    sceneData: nextScenes,
    draft: await updateDraft(jobId, userId, (current) => ({
      ...current,
      scenes: nextScenes,
      images: {
        sceneData: nextScenes,
        generatedAt: new Date().toISOString()
      },
      imageJobs: {
        ...(current.imageJobs || {}),
        status: 'completed',
        completedAt: new Date().toISOString(),
        completedCount: completed,
        totalCount: total
      },
      jobs: {
        ...(current.jobs || {}),
        images: {
          ...(current.jobs?.images || {}),
          status: 'completed',
          completedAt: new Date().toISOString()
        }
      }
    }))
  };
}

module.exports = {
  runDirectorImageGeneration,
  sanitizeSceneData
};
