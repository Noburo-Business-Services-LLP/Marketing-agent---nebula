const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_ROOT = path.resolve(__dirname, '../storage/ai-videos');
const VideoDraft = require('../models/VideoDraft');
const Draft = require('../models/Draft');
const { normalizeDirectorAutosavePayload } = require('./directorDraftFields');
const { logAutosave, logMongoSave } = require('./directorLogger');

function sanitizeSegment(value, fallback = 'asset') {
  const raw = String(value || '').trim();
  const normalized = raw
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || fallback;
}

function detectExtFromMime(mimeType = '', fallback = '.bin') {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('mp3') || mime.includes('mpeg')) return '.mp3';
  if (mime.includes('wav')) return '.wav';
  return fallback;
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64')
  };
}

function buildMediaUrl(baseUrl, jobId, parts = []) {
  const root = String(baseUrl || '').replace(/\/+$/, '') || 'http://localhost:5000';
  const clean = [sanitizeSegment(jobId)].concat(parts.map((item) => sanitizeSegment(item, 'file')));
  return `${root}/generated-media/${clean.join('/')}`;
}

function toUserId(user) {
  if (!user) return null;
  if (user._id) return String(user._id);
  if (user.id) return String(user.id);
  return null;
}

function ensureJobDirectories(jobId) {
  const safeJobId = sanitizeSegment(jobId);
  const root = path.join(STORAGE_ROOT, safeJobId);
  const dirs = {
    root,
    images: path.join(root, 'images'),
    clips: path.join(root, 'clips'),
    audio: path.join(root, 'audio'),
    final: path.join(root, 'final'),
    temp: path.join(root, 'temp')
  };
  Object.values(dirs).forEach((dirPath) => fs.mkdirSync(dirPath, { recursive: true }));
  return { jobId: safeJobId, dirs };
}

function draftPathForJob(jobId) {
  const { dirs } = ensureJobDirectories(jobId);
  return path.join(dirs.root, 'draft.json');
}

function enforceSceneIntegrity(draft) {
  if (!draft || !draft.storySnapshot) return draft;
  const snapshot = draft.storySnapshot;

  // 1. Restore top-level immutable fields if missing or empty
  if (snapshot.productionBible && (!draft.productionBible || Object.keys(draft.productionBible).length === 0)) {
    draft.productionBible = snapshot.productionBible;
  }
  if (snapshot.voiceScript && !draft.voiceScript) {
    draft.voiceScript = snapshot.voiceScript;
  }
  if (snapshot.storyTitle && !draft.storyTitle) {
    draft.storyTitle = snapshot.storyTitle;
  }

  // 2. Scene integrity check
  const snapScenes = Array.isArray(snapshot.scenes) ? snapshot.scenes : [];
  let scenes = draft.scenes;

  // Normalize current scenes if it was saved as an index-keyed object (bug recovery)
  if (scenes && typeof scenes === 'object' && !Array.isArray(scenes)) {
    const keys = Object.keys(scenes).filter(k => /^\d+$/.test(k));
    if (keys.length > 0) {
      scenes = keys.sort((a, b) => Number(a) - Number(b)).map(k => scenes[k]);
    }
  }

  if (!Array.isArray(scenes) || scenes.length !== snapScenes.length) {
    console.log(`[Scene Integrity Check] Restoring scenes array from storySnapshot (count discrepancy).`);
    draft.scenes = JSON.parse(JSON.stringify(snapScenes));
    return draft;
  }

  // Verify and restore screenplay fields on every scene
  const restoredScenes = scenes.map((scene, idx) => {
    const snapScene = snapScenes[idx];
    if (!snapScene) return scene;

    const updatedScene = { ...scene };

    // Fields to protect: title, action, description, voiceLine, audio, businessObjective, marketingMessage
    const fieldsToVerify = ['title', 'action', 'description', 'voiceLine', 'audio', 'businessObjective', 'marketingMessage'];
    fieldsToVerify.forEach(field => {
      // If the field is missing or empty or different in the updated scene, restore from the snapshot
      if (snapScene[field] && updatedScene[field] !== snapScene[field]) {
        updatedScene[field] = snapScene[field];
      }
    });

    return updatedScene;
  });

  draft.scenes = restoredScenes;
  return draft;
}

async function writeDraft(draft, meta = {}) {
  const protectedDraft = enforceSceneIntegrity(draft);
  const nowIso = new Date().toISOString();
  const payload = {
    ...protectedDraft,
    version: Number.isFinite(protectedDraft.version) ? protectedDraft.version : 0,
    updatedAt: nowIso
  };
  if (meta.lastModifiedBy) {
    payload.lastModifiedBy = meta.lastModifiedBy;
  }

  // 1. Persist to MongoDB (authoritative)
  try {
    await VideoDraft.findOneAndUpdate(
      { jobId: protectedDraft.jobId },
      { $set: payload },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    logMongoSave({ jobId: protectedDraft.jobId, userId: protectedDraft.userId }, { version: payload.version });
  } catch (dbError) {
    console.error('⚠️ Failed to save draft to MongoDB, falling back to disk:', dbError.message);
  }

  // 2. Persist to Disk (local folder backup)
  try {
    const draftPath = draftPathForJob(draft.jobId);
    await fs.promises.writeFile(draftPath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (fsError) {
    console.error('⚠️ Failed to save draft to disk:', fsError.message);
  }

  // 3. Sync to Global Draft
  try {
    const isProcessing = Object.values(payload.jobs || {}).some(
      (j) => j && (j.status === 'processing' || j.status === 'queued')
    );
    let status = 'draft';
    if (isProcessing) {
      status = 'processing';
    } else if (payload.merge?.finalOutputUrl || payload.merge?.finalVideoUrl) {
      status = 'completed';
    }

    const updateFields = {
      status,
      creative: {
        ...(payload.input || {}),
        prompt: payload.prompt || null,
        scenes: payload.scenes || null,
        images: payload.images || null,
        audio: payload.audio || null,
        clips: payload.clips || null,
        mix: payload.mix || null,
        merge: payload.merge || null
      },
      generationProgress: {
        ...(payload.jobs || {}),
        jobId: payload.jobId,
        currentStep: payload.currentStep
      }
    };

    if (payload.userId) {
      await Draft.findOneAndUpdate(
        { 'generationProgress.jobId': payload.jobId, userId: payload.userId },
        { $set: updateFields },
        { upsert: false } // We don't upsert here to avoid creating drafts without title etc.
      );
    }
  } catch (syncError) {
    console.error('⚠️ Failed to sync draft to Global Draft:', syncError.message);
  }

  return payload;
}

function normalizeDraftScenes(draft) {
  if (!draft) return draft;
  if (draft.scenes && typeof draft.scenes === 'object' && !Array.isArray(draft.scenes)) {
    const keys = Object.keys(draft.scenes).filter(k => /^\d+$/.test(k));
    if (keys.length > 0) {
      draft.scenes = keys.sort((a, b) => Number(a) - Number(b)).map(k => draft.scenes[k]);
    }
  }
  return draft;
}

async function readDraft(jobId) {
  let dbDraft = null;
  let diskDraft = null;

  // 1) Try reading from MongoDB (fast, but can be stale if writes fail intermittently)
  try {
    dbDraft = await VideoDraft.findOne({ jobId }).lean();
  } catch (dbError) {
    console.error('⚠️ Failed to read draft from MongoDB:', dbError.message);
  }

  // 2) Try reading from Disk (backup source of truth)
  try {
    const draftPath = draftPathForJob(jobId);
    const text = await fs.promises.readFile(draftPath, 'utf8');
    diskDraft = JSON.parse(text);
  } catch (_) {
    // ignore (disk draft might not exist in some environments)
  }

  let resolved = null;
  if (dbDraft && !diskDraft) resolved = dbDraft;
  else if (!dbDraft && diskDraft) resolved = diskDraft;
  else if (!dbDraft && !diskDraft) {
    const error = new Error('Draft not found');
    error.statusCode = 404;
    throw error;
  } else {
    const dbUpdatedAt = new Date(String(dbDraft.updatedAt || dbDraft.updated_at || dbDraft.createdAt || 0)).getTime();
    const diskUpdatedAt = new Date(String(diskDraft.updatedAt || diskDraft.updated_at || diskDraft.createdAt || 0)).getTime();

    // Prefer the most recently updated draft.
    if (Number.isFinite(diskUpdatedAt) && Number.isFinite(dbUpdatedAt)) {
      resolved = diskUpdatedAt >= dbUpdatedAt ? diskDraft : dbDraft;
    } else {
      // If timestamps are missing/unparseable on either side, prefer disk (written on every updateDraft call).
      resolved = diskDraft || dbDraft;
    }
  }

  return enforceSceneIntegrity(normalizeDraftScenes(resolved));
}

async function loadDraftForUser(jobId, userId = null) {
  const draft = await readDraft(jobId);
  if (userId && draft.userId && String(userId) !== String(draft.userId)) {
    const error = new Error('Draft not found');
    error.statusCode = 404;
    throw error;
  }
  return draft;
}

async function deleteDraftForUser(jobId, userId = null) {
  const safeJobId = sanitizeSegment(jobId);
  const draft = await loadDraftForUser(safeJobId, userId);

  // 1. Delete from MongoDB
  try {
    await VideoDraft.deleteOne({ jobId: safeJobId });
  } catch (dbError) {
    console.error('⚠️ Failed to delete draft from MongoDB:', dbError.message);
  }

  // 2. Delete from Disk
  try {
    const root = path.resolve(STORAGE_ROOT);
    const target = path.resolve(path.join(root, safeJobId));

    if (target === root || !target.startsWith(`${root}${path.sep}`)) {
      throw new Error('Invalid draft path');
    }

    await fs.promises.rm(target, { recursive: true, force: true });
  } catch (fsError) {
    console.error('⚠️ Failed to delete draft from disk:', fsError.message);
  }

  return draft;
}

function resolveDraftStatus(draft = {}) {
  const scheduleStatus = String(draft?.schedule?.status || '').toLowerCase();
  if (scheduleStatus.includes('published')) return 'posted';
  if (scheduleStatus === 'scheduled') return 'scheduled';
  if (draft?.merge?.finalOutputUrl || draft?.merge?.finalVideoUrl) return 'created';
  return 'draft';
}

async function listDraftsForUser(userId = null) {
  // 1. Try listing from MongoDB (instant query)
  try {
    const query = userId ? { userId } : {};
    const dbDrafts = await VideoDraft.find(query).sort({ updatedAt: -1 }).lean();
    if (dbDrafts && dbDrafts.length > 0) {
      return dbDrafts.map((draft) => ({
        jobId: draft.jobId,
        title: String(draft?.input?.description || 'AI Video').slice(0, 90),
        status: resolveDraftStatus(draft),
        currentStep: draft.currentStep || 1,
        durationSeconds: draft?.input?.durationSeconds || null,
        sceneCount: draft?.input?.sceneCount || draft?.scenes?.sceneData?.length || null,
        finalVideoUrl: draft?.merge?.finalOutputUrl || draft?.merge?.finalVideoUrl || null,
        thumbnailUrl: draft?.content?.thumbnailUrl || draft?.images?.sceneData?.[0]?.imageUrl || null,
        caption: draft?.content?.caption || '',
        hashtags: Array.isArray(draft?.content?.hashtags) ? draft.content.hashtags : [],
        scheduledAt: draft?.schedule?.scheduledAt || null,
        platforms: draft?.platform?.selectedPlatforms || [],
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt
      }));
    }
  } catch (dbError) {
    console.error('⚠️ Failed to list drafts from MongoDB, falling back to disk:', dbError.message);
  }

  // 2. Fallback to scanning disk directory
  try {
    await fs.promises.mkdir(STORAGE_ROOT, { recursive: true });
    const entries = await fs.promises.readdir(STORAGE_ROOT, { withFileTypes: true });
    const drafts = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const draft = await readDraft(entry.name);
        if (userId && draft.userId && String(draft.userId) !== String(userId)) continue;
        drafts.push({
          jobId: draft.jobId,
          title: String(draft?.input?.description || 'AI Video').slice(0, 90),
          status: resolveDraftStatus(draft),
          currentStep: draft.currentStep || 1,
          durationSeconds: draft?.input?.durationSeconds || null,
          sceneCount: draft?.input?.sceneCount || draft?.scenes?.sceneData?.length || null,
          finalVideoUrl: draft?.merge?.finalOutputUrl || draft?.merge?.finalVideoUrl || null,
          thumbnailUrl: draft?.content?.thumbnailUrl || draft?.images?.sceneData?.[0]?.imageUrl || null,
          caption: draft?.content?.caption || '',
          hashtags: Array.isArray(draft?.content?.hashtags) ? draft.content.hashtags : [],
          scheduledAt: draft?.schedule?.scheduledAt || null,
          platforms: draft?.platform?.selectedPlatforms || [],
          createdAt: draft.createdAt,
          updatedAt: draft.updatedAt
        });
      } catch (_) {
        // Ignore incomplete folders
      }
    }
    return drafts.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  } catch (fsError) {
    console.error('⚠️ Failed to list drafts from disk:', fsError.message);
    return [];
  }
}

async function updateDraft(jobId, userId = null, updater = null, meta = {}) {
  const existing = await loadDraftForUser(jobId, userId);
  const next = typeof updater === 'function' ? await updater(existing) : existing;
  const version = (Number(existing.version) || 0) + 1;
  return writeDraft({
    ...existing,
    ...next,
    jobId: existing.jobId,
    userId: existing.userId,
    version
  }, meta);
}

function safeMerge(existingVal, patchVal) {
  if (existingVal && typeof existingVal === 'object' && patchVal && typeof patchVal === 'object' && !Array.isArray(existingVal) && !Array.isArray(patchVal)) {
    return { ...existingVal, ...patchVal };
  }
  return patchVal !== undefined ? patchVal : existingVal;
}

async function patchDraft(jobId, userId = null, rawPatch = {}, options = {}) {
  const existing = await loadDraftForUser(jobId, userId);
  const expectedVersion = options.expectedVersion;
  if (expectedVersion !== undefined && expectedVersion !== null) {
    const currentVersion = Number(existing.version) || 0;
    if (Number(expectedVersion) !== currentVersion) {
      const error = new Error(`Draft version conflict: expected ${expectedVersion}, current ${currentVersion}`);
      error.statusCode = 409;
      error.currentVersion = currentVersion;
      error.draft = existing;
      throw error;
    }
  }

  const patch = normalizeDirectorAutosavePayload(rawPatch);
  const version = (Number(existing.version) || 0) + 1;

  // Safe nested merge for objects to prevent partial updates from deleting data
  const keysToMerge = ['audio', 'images', 'clips', 'jobs', 'mix', 'merge', 'input', 'prompt', 'audioConfig', 'publishSettings', 'schedule'];
  const mergedPatch = { ...patch };
  keysToMerge.forEach(key => {
    if (existing[key] !== undefined && patch[key] !== undefined) {
      mergedPatch[key] = safeMerge(existing[key], patch[key]);
    }
  });

  const merged = {
    ...existing,
    ...mergedPatch,
    directorStudio: {
      ...(existing.directorStudio || {}),
      ...(mergedPatch.directorStudio || {}),
      ...mergedPatch
    },
    jobId: existing.jobId,
    userId: existing.userId,
    version,
    updatedAt: new Date().toISOString()
  };

  if (patch.storySnapshot) {
    // Keep as is
  } else if (merged.storySnapshot) {
    if (patch.scenes) {
      let scenesArr = patch.scenes;
      if (scenesArr && typeof scenesArr === 'object' && !Array.isArray(scenesArr)) {
        const keys = Object.keys(scenesArr).filter(k => /^\d+$/.test(k));
        if (keys.length > 0) {
          scenesArr = keys.sort((a, b) => Number(a) - Number(b)).map(k => scenesArr[k]);
        }
      }
      if (Array.isArray(scenesArr)) {
        merged.storySnapshot.scenes = JSON.parse(JSON.stringify(scenesArr));
      }
    }
    if (patch.voiceScript !== undefined) {
      merged.storySnapshot.voiceScript = patch.voiceScript;
    }
    if (patch.productionBible !== undefined) {
      merged.storySnapshot.productionBible = JSON.parse(JSON.stringify(patch.productionBible));
    }
    if (patch.storyTitle !== undefined) {
      merged.storySnapshot.storyTitle = patch.storyTitle;
    }
  }

  logAutosave({ jobId, userId }, { version, fields: Object.keys(patch) });

  return writeDraft(merged, { lastModifiedBy: userId });
}

async function saveDataUrlToJob({
  jobId,
  dataUrl,
  folder = 'images',
  fileName = 'uploaded'
}) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed?.buffer?.length) {
    throw new Error('Invalid data URL payload');
  }

  const { dirs } = ensureJobDirectories(jobId);
  const ext = detectExtFromMime(parsed.mimeType, '.bin');
  const safeName = sanitizeSegment(fileName, 'asset');
  const dirPath = dirs[folder] || dirs.images;
  const relativePath = [folder, `${safeName}${ext}`];
  const absolutePath = path.join(dirPath, `${safeName}${ext}`);

  await fs.promises.writeFile(absolutePath, parsed.buffer);

  return {
    absolutePath,
    relativePath,
    mimeType: parsed.mimeType
  };
}

async function createDraft({
  user = null,
  input = {},
  baseUrl = ''
}) {
  const userId = toUserId(user);
  const jobId = sanitizeSegment(crypto.randomUUID());
  const nowIso = new Date().toISOString();
  const { dirs } = ensureJobDirectories(jobId);

  let sourceImage = null;
  if (typeof input.imageData === 'string' && input.imageData.startsWith('data:')) {
    const saved = await saveDataUrlToJob({
      jobId,
      dataUrl: input.imageData,
      folder: 'images',
      fileName: 'source_uploaded'
    });
    sourceImage = {
      type: 'uploaded',
      url: buildMediaUrl(baseUrl, jobId, saved.relativePath)
    };
  } else if (typeof input.imageUrl === 'string' && input.imageUrl.trim()) {
    sourceImage = {
      type: 'uploaded_url',
      url: input.imageUrl.trim()
    };
  }

  const draft = {
    jobId,
    userId,
    version: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    currentStep: input.currentStep || 1,
    businessName: input.businessName || '',
    industry: input.industry || '',
    targetAudience: input.targetAudience || '',
    brandSummary: input.brandSummary || input.description || '',
    brandTone: input.brandTone || '',
    commercialObjective: input.commercialObjective || '',
    storyDirection: input.storyDirection || '',
    videoStyle: input.videoStyle || null,
    durationSeconds: Number.parseInt(String(input.durationSeconds || 60), 10) || 60,
    useCharacters: input.useCharacters !== undefined ? input.useCharacters : true,
    useLogo: input.useLogo !== undefined ? input.useLogo : false,
    selectedProductId: input.selectedProductId || input.productId || null,
    imageDataUrl: sourceImage?.url || null,
    completedSteps: input.completedSteps || [],
    uiState: input.uiState || {},
    input: {
      description: String(input.description || '').trim(),
      durationSeconds: Number.parseInt(String(input.durationSeconds || 60), 10) || 60,
      sceneCount: Number.parseInt(String(input.sceneCount || 0), 10) || null,
      sourceImage,
      product: input.product || null,
      productId: input.productId || null
    },
    prompt: null,
    scenes: null,
    images: null,
    clips: null,
    subtitles: null,
    audio: null,
    thumbnails: null,
    mix: null,
    merge: null,
    mergeProgress: null,
    content: null,
    platform: null,
    schedule: null,
    outputs: {
      directories: {
        images: dirs.images,
        clips: dirs.clips,
        audio: dirs.audio,
        final: dirs.final
      }
    }
  };

  await writeDraft(draft);
  return draft;
}

module.exports = {
  STORAGE_ROOT,
  buildMediaUrl,
  toUserId,
  listDraftsForUser,
  ensureJobDirectories,
  draftPathForJob,
  writeDraft,
  readDraft,
  loadDraftForUser,
  deleteDraftForUser,
  updateDraft,
  patchDraft,
  saveDataUrlToJob,
  createDraft
};
