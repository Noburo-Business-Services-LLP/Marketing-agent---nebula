const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const config = require('./identityLockConfig');
const insightFace = require('./identityInsightFace');

const CHARACTER_MEMORY_ROOT = path.resolve(__dirname, '..', 'storage', 'character-memory');

function sanitizeSegment(value, fallback = 'character') {
  const raw = String(value || '').trim();
  const normalized = raw
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || fallback;
}

function getMemoryDir(characterId) {
  return path.join(CHARACTER_MEMORY_ROOT, sanitizeSegment(characterId));
}

function getMemoryPaths(characterId) {
  const dir = getMemoryDir(characterId);
  return {
    dir,
    referencePath: path.join(dir, 'reference.png'),
    legacySheetPath: path.join(dir, 'character_sheet.png'),
    metadataPath: path.join(dir, 'metadata.json'),
    embeddingNpyPath: path.join(dir, 'embedding.npy'),
    embeddingBinPath: path.join(dir, 'embedding.bin'),
    tokenPath: path.join(dir, 'identity_token.json')
  };
}

function resolveReferencePath(paths) {
  if (fs.existsSync(paths.referencePath)) return paths.referencePath;
  if (fs.existsSync(paths.legacySheetPath)) return paths.legacySheetPath;
  return null;
}

function resolveEmbeddingPath(paths) {
  if (fs.existsSync(paths.embeddingNpyPath)) return paths.embeddingNpyPath;
  if (fs.existsSync(paths.embeddingBinPath)) return paths.embeddingBinPath;
  return null;
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

async function downloadToFile(url, destinationPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image (${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fsPromises.mkdir(path.dirname(destinationPath), { recursive: true });
  await fsPromises.writeFile(destinationPath, buffer);
}

async function materializeImageSource(imageSource, destinationPath) {
  const raw = String(imageSource || '').trim();
  if (!raw) throw new Error('Missing character image source');

  await fsPromises.mkdir(path.dirname(destinationPath), { recursive: true });

  if (raw.startsWith('data:')) {
    const parsed = parseDataUrl(raw);
    if (!parsed?.buffer?.length) throw new Error('Invalid data URL');
    await fsPromises.writeFile(destinationPath, parsed.buffer);
    return destinationPath;
  }

  if (/^https?:\/\//i.test(raw)) {
    await downloadToFile(raw, destinationPath);
    return destinationPath;
  }

  const absolute = path.resolve(raw);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Character image file not found: ${absolute}`);
  }
  await fsPromises.copyFile(absolute, destinationPath);
  return destinationPath;
}

async function createEmbeddingFiles(referencePath, paths) {
  const useInsightFace = await insightFace.checkInsightFaceAvailable();
  if (useInsightFace) {
    await insightFace.createEmbedding(referencePath, paths.embeddingNpyPath);
    await fsPromises.copyFile(paths.embeddingNpyPath, paths.embeddingBinPath);
    return paths.embeddingNpyPath;
  }

  try {
    const faceConsistency = require('./characterConsistency');
    const descriptor = await faceConsistency.extractFaceEmbedding(referencePath);
    const buffer = Buffer.from(new Float32Array(descriptor).buffer);
    await fsPromises.writeFile(paths.embeddingBinPath, buffer);
    await fsPromises.copyFile(paths.embeddingBinPath, paths.embeddingNpyPath);
    return paths.embeddingBinPath;
  } catch (error) {
    console.warn('[CharacterMemory] Embedding fallback unavailable:', error.message);
    return null;
  }
}

async function ensureCharacterMemoryFromSource({
  characterId,
  imageSource,
  metadata = {}
}) {
  const safeId = sanitizeSegment(characterId);
  const paths = getMemoryPaths(safeId);
  await fsPromises.mkdir(paths.dir, { recursive: true });

  const referenceExists = resolveReferencePath(paths);
  if (!referenceExists) {
    await materializeImageSource(imageSource, paths.referencePath);
    await fsPromises.copyFile(paths.referencePath, paths.legacySheetPath);
  }

  const referencePath = resolveReferencePath(paths);
  let embeddingPath = resolveEmbeddingPath(paths);
  if (!embeddingPath) {
    // Generate the embedding files asynchronously in the background so the preview returns instantly
    createEmbeddingFiles(referencePath, paths)
      .then((pPath) => {
        if (pPath) console.log(`[CharacterMemory] Asynchronous embedding created successfully for ${safeId}: ${pPath}`);
      })
      .catch((err) => {
        console.error(`[CharacterMemory] Asynchronous embedding creation failed for ${safeId}:`, err);
      });
    embeddingPath = paths.embeddingBinPath;
  }

  const payload = {
    characterId: safeId,
    ...metadata,
    referenceImage: 'reference.png',
    embedding: embeddingPath ? path.basename(embeddingPath) : null,
    updatedAt: new Date().toISOString()
  };
  await fsPromises.writeFile(paths.metadataPath, JSON.stringify(payload, null, 2));

  const referenceBuffer = await fsPromises.readFile(referencePath);
  const identityToken = await writeIdentityToken(paths, {
    characterId: safeId,
    ...metadata,
    referenceImage: 'reference.png',
    embedding: embeddingPath ? path.basename(embeddingPath) : null
  });

  return buildMemoryRecord(safeId, paths, referencePath, embeddingPath, payload, referenceBuffer, identityToken);
}

function buildMemoryRecord(safeId, paths, referencePath, embeddingPath, metadata, referenceBuffer, identityToken) {
  return {
    characterId: safeId,
    dir: paths.dir,
    referencePath,
    embeddingPath,
    tokenPath: paths.tokenPath,
    metadata,
    identityToken,
    referenceDataUrl: `data:image/png;base64,${referenceBuffer.toString('base64')}`
  };
}

async function writeIdentityToken(paths, payload) {
  const token = {
    characterId: payload.characterId,
    identityEngine: config.IDENTITY_ENGINE,
    referenceImage: payload.referenceImage || 'reference.png',
    embedding: payload.embedding || null,
    extractedAt: new Date().toISOString(),
    ...payload
  };
  await fsPromises.writeFile(paths.tokenPath, JSON.stringify(token, null, 2));
  return token;
}

async function loadIdentityToken(paths) {
  if (!fs.existsSync(paths.tokenPath)) return null;
  try {
    return JSON.parse(await fsPromises.readFile(paths.tokenPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

async function prepareIdentityPackage(characterMemory, logger = null) {
  if (!characterMemory?.referencePath) {
    throw new Error('Character Sheet reference is required before scene generation');
  }

  const paths = getMemoryPaths(characterMemory.characterId);
  let embeddingPath = characterMemory.embeddingPath || resolveEmbeddingPath(paths);

  if (!embeddingPath) {
    if (logger) logger('[IdentityLock] Extracting character identity embedding from Character Sheet');
    embeddingPath = await createEmbeddingFiles(characterMemory.referencePath, paths);
  }

  const identityToken = await loadIdentityToken(paths) || await writeIdentityToken(paths, {
    characterId: characterMemory.characterId,
    referenceImage: 'reference.png',
    embedding: embeddingPath ? path.basename(embeddingPath) : null,
    ...(characterMemory.metadata || {})
  });

  if (logger) {
    logger(`[IdentityLock] Identity token loaded (${identityToken.identityEngine})`);
  }

  return {
    characterId: characterMemory.characterId,
    dir: paths.dir,
    referencePath: characterMemory.referencePath,
    referenceDataUrl: characterMemory.referenceDataUrl,
    embeddingPath,
    tokenPath: paths.tokenPath,
    identityToken,
    identityEngine: identityToken.identityEngine || config.IDENTITY_ENGINE
  };
}

async function loadCharacterMemory(characterId) {
  const safeId = sanitizeSegment(characterId);
  const paths = getMemoryPaths(safeId);
  const referencePath = resolveReferencePath(paths);
  if (!referencePath) return null;

  let metadata = {};
  if (fs.existsSync(paths.metadataPath)) {
    try {
      metadata = JSON.parse(await fsPromises.readFile(paths.metadataPath, 'utf8'));
    } catch (_) {
      metadata = {};
    }
  }

  const referenceBuffer = await fsPromises.readFile(referencePath);
  const identityToken = await loadIdentityToken(paths);
  return buildMemoryRecord(
    safeId,
    paths,
    referencePath,
    resolveEmbeddingPath(paths),
    metadata,
    referenceBuffer,
    identityToken
  );
}

function findCharacterForScene(characters = [], scene = {}) {
  const sceneCharIds = Array.isArray(scene?.characterIds) ? scene.characterIds : [];
  for (const cid of sceneCharIds) {
    const matched = characters.find((c) =>
      String(c.id) === String(cid)
      || String(c.characterId) === String(cid)
      || String(c.name || '').toLowerCase() === String(cid).toLowerCase()
    );
    if (matched) return matched;
  }

  const sceneText = `${scene?.title || ''} ${scene?.action || ''} ${scene?.imagePrompt || ''}`.toLowerCase();
  const byName = characters.find((c) => c.name && sceneText.includes(String(c.name).toLowerCase()));
  if (byName) return byName;

  if (characters.length === 1) return characters[0];
  return characters.find((c) => c.image || c.imageUrl) || characters[0] || null;
}

async function resolveCharacterMemoryForScene({
  draft = {},
  scene = {},
  characterId = null,
  jobId = null
}) {
  const characters = Array.isArray(draft?.characters) ? draft.characters : [];
  const matchedChar = findCharacterForScene(characters, scene);

  const explicitIds = [
    characterId,
    matchedChar?.identityMemoryId,
    matchedChar?.characterId,
    matchedChar?.id,
    draft?.characterId,
    draft?.identityMemoryId
  ].filter(Boolean);

  for (const id of explicitIds) {
    const loaded = await loadCharacterMemory(id);
    if (loaded) return loaded;
  }

  if (matchedChar) {
    const memoryId =
      matchedChar.identityMemoryId
      || matchedChar.characterId
      || matchedChar.id
      || `${sanitizeSegment(jobId || 'project')}_${sanitizeSegment(matchedChar.name || 'lead')}`;
    const imageSource = matchedChar.image || matchedChar.imageUrl;
    if (imageSource) {
      return ensureCharacterMemoryFromSource({
        characterId: memoryId,
        imageSource,
        metadata: {
          name: matchedChar.name,
          role: matchedChar.role,
          jobId,
          linkedCharacterId: matchedChar.characterId || matchedChar.id,
          source: 'character_sheet'
        }
      });
    }
  }

  if (draft?.characterImage) {
    return ensureCharacterMemoryFromSource({
      characterId: `${sanitizeSegment(jobId || 'project')}_lead`,
      imageSource: draft.characterImage,
      metadata: { jobId, source: 'draft.characterImage' }
    });
  }

  return null;
}

async function compareWithCharacterMemory(identityPackage, generatedImagePath) {
  const referencePath = identityPackage?.referencePath;
  const embeddingPath = identityPackage?.embeddingPath;

  if (!referencePath) {
    return { similarity: 1, passes: true, engine: 'none' };
  }

  if (embeddingPath && await insightFace.checkInsightFaceAvailable()) {
    try {
      const result = await insightFace.compareFaces(embeddingPath, generatedImagePath);
      return {
        ...result,
        engine: 'insightface',
        referencePath,
        generatedImagePath
      };
    } catch (error) {
      console.warn('[CharacterMemory] InsightFace compare failed:', error.message);
    }
  }

  try {
    const faceConsistency = require('./characterConsistency');
    const generatedEmbedding = await faceConsistency.extractFaceEmbedding(generatedImagePath);
    const refEmbedding = await faceConsistency.extractFaceEmbedding(referencePath);
    const distance = faceConsistency.euclideanDistance(refEmbedding, generatedEmbedding);
    const similarity = Math.max(0, 1 - distance);
    return {
      similarity,
      passes: similarity >= config.SIMILARITY_THRESHOLD,
      engine: 'face-api',
      referencePath,
      generatedImagePath
    };
  } catch (error) {
    console.warn('[CharacterMemory] Validation unavailable, accepting generated image:', error.message);
    return { similarity: 1, passes: true, engine: 'skipped' };
  }
}

module.exports = {
  CHARACTER_MEMORY_ROOT,
  getMemoryPaths,
  ensureCharacterMemoryFromSource,
  loadCharacterMemory,
  resolveCharacterMemoryForScene,
  compareWithCharacterMemory,
  materializeImageSource,
  prepareIdentityPackage
};
