const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { STORAGE_ROOT } = require('./videoGenerationPipeline');

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
  const draftPath = draftPathForJob(draft.jobId);
  const payload = {
    ...draft,
    updatedAt: new Date().toISOString()
  };
  await fs.promises.writeFile(draftPath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

async function readDraft(jobId) {
  const draftPath = draftPathForJob(jobId);
  const text = await fs.promises.readFile(draftPath, 'utf8');
  return JSON.parse(text);
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

function resolveDraftStatus(draft = {}) {
  const scheduleStatus = String(draft?.schedule?.status || '').toLowerCase();
  if (scheduleStatus.includes('published')) return 'posted';
  if (scheduleStatus === 'scheduled') return 'scheduled';
  if (draft?.merge?.finalOutputUrl || draft?.merge?.finalVideoUrl) return 'created';
  return 'draft';
}

async function listDraftsForUser(userId = null) {
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
      // Ignore incomplete job folders.
    }
  }

  return drafts.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
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
      sourceImage,
      product: input.product || null,
      productId: input.productId || null
    },
    prompt: null,
    scenes: null,
    images: null,
    clips: null,
    audio: null,
    mix: null,
    merge: null,
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
  updateDraft,
  saveDataUrlToJob,
  createDraft
};
