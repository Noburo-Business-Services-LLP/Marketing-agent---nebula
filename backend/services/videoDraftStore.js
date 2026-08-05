const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { STORAGE_ROOT } = require('./videoGenerationPipeline');
const VideoDraft = require('../models/VideoDraft');
const Draft = require('../models/Draft');

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

async function writeDraft(draft) {
  const payload = {
    ...draft,
    updatedAt: new Date().toISOString()
  };

  // 1. Persist to MongoDB
  try {
    await VideoDraft.findOneAndUpdate(
      { jobId: draft.jobId },
      payload,
      { upsert: true, new: true }
    );
  } catch (dbError) {
    console.error('⚠️ Failed to save draft to MongoDB:', dbError.message);
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

  if (dbDraft && !diskDraft) return dbDraft;
  if (!dbDraft && diskDraft) return diskDraft;
  if (!dbDraft && !diskDraft) {
    const error = new Error('Draft not found');
    error.statusCode = 404;
    throw error;
  }

  const dbUpdatedAt = new Date(String(dbDraft.updatedAt || dbDraft.updated_at || dbDraft.createdAt || 0)).getTime();
  const diskUpdatedAt = new Date(String(diskDraft.updatedAt || diskDraft.updated_at || diskDraft.createdAt || 0)).getTime();

  // Prefer the most recently updated draft.
  if (Number.isFinite(diskUpdatedAt) && Number.isFinite(dbUpdatedAt)) {
    return diskUpdatedAt >= dbUpdatedAt ? diskDraft : dbDraft;
  }

  // If timestamps are missing/unparseable on either side, prefer disk (written on every updateDraft call).
  return diskDraft || dbDraft;
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

async function updateDraft(jobId, userId = null, updater = null) {
  const existing = await loadDraftForUser(jobId, userId);
  const next = typeof updater === 'function' ? await updater(existing) : existing;
  return writeDraft({ ...existing, ...next, jobId: existing.jobId, userId: existing.userId });
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
    createdAt: nowIso,
    updatedAt: nowIso,
    currentStep: 1,
    input: {
      description: String(input.description || '').trim(),
      durationSeconds: Number.parseInt(String(input.durationSeconds || 60), 10) || 60,
      sceneCount: Number.parseInt(String(input.sceneCount || 0), 10) || null,
      aspectRatio: (['9:16','16:9','1:1','4:5'].includes(String(input.aspectRatio || '').trim())
        ? String(input.aspectRatio).trim()
        : '9:16'),
      languageCode: (['en','hi','ta','te','kn','ml'].includes(String(input.languageCode || '').toLowerCase())
        ? String(input.languageCode).toLowerCase()
        : 'en'),
      sourceImage,
      product: input.product || null,
      productId: input.productId || null
    },
    // Env definition (Step 3 of wizard). When enabled=false, all
    // scene/image/clip prompts run without env constraints as before.
    // When enabled=true, referenceImages + notes are threaded into
    // every LLM prompt AND every Nano Banana / Kling call so the
    // whole video renders IN that specific space.
    environment: {
      enabled: !!input.environment?.enabled,
      referenceImages: Array.isArray(input.environment?.referenceImages)
        ? input.environment.referenceImages
            .filter((r) => r && (r.url || r.dataUrl))
            .map((r) => ({
              url: String(r.url || '').trim(),
              dataUrl: String(r.dataUrl || '').trim(),
              source: r.source === 'brand-asset' ? 'brand-asset' : 'upload'
            }))
            .slice(0, 5)
        : [],
      notes: String(input.environment?.notes || '').trim().slice(0, 500)
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
  saveDataUrlToJob,
  createDraft
};
