const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const config = require('./identityLockConfig');
const comfyUI = require('./comfyUIClient');
const { STORAGE_ROOT } = require('./videoDraftStore');
const { CHARACTER_MEMORY_ROOT } = require('./characterMemoryStore');
const { videoGenerationQueue } = require('./videoGenerationQueue');

const IDENTITY_TEMP_MAX_AGE_MS = Number(process.env.IDENTITY_TEMP_MAX_AGE_MS || 24 * 60 * 60 * 1000);
const FAILED_GEN_MAX_AGE_MS = Number(process.env.FAILED_GEN_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000);

async function getDiskUsageBytes(dirPath) {
  let total = 0;
  if (!fs.existsSync(dirPath)) return 0;
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDiskUsageBytes(full);
    } else {
      const stat = await fs.promises.stat(full);
      total += stat.size;
    }
  }
  return total;
}

async function cleanupIdentityTemp() {
  const root = STORAGE_ROOT;
  if (!fs.existsSync(root)) return { removed: 0 };
  let removed = 0;
  const jobs = await fs.promises.readdir(root, { withFileTypes: true });
  const cutoff = Date.now() - IDENTITY_TEMP_MAX_AGE_MS;
  for (const job of jobs) {
    if (!job.isDirectory()) continue;
    const tempDir = path.join(root, job.name, 'identity-temp');
    if (!fs.existsSync(tempDir)) continue;
    const files = await fs.promises.readdir(tempDir);
    for (const file of files) {
      const filePath = path.join(tempDir, file);
      const stat = await fs.promises.stat(filePath);
      if (stat.mtimeMs < cutoff) {
        await fs.promises.rm(filePath, { force: true });
        removed += 1;
      }
    }
  }
  return { removed };
}

async function cleanupOrphanCharacterMemory(linkedIds = new Set()) {
  if (!fs.existsSync(CHARACTER_MEMORY_ROOT)) return { removed: 0 };
  let removed = 0;
  const entries = await fs.promises.readdir(CHARACTER_MEMORY_ROOT, { withFileTypes: true });
  const cutoff = Date.now() - FAILED_GEN_MAX_AGE_MS;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (linkedIds.has(entry.name)) continue;
    const dir = path.join(CHARACTER_MEMORY_ROOT, entry.name);
    const metaPath = path.join(dir, 'metadata.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf8'));
      const created = new Date(meta.extractedAt || meta.createdAt || 0).getTime();
      if (created && created < cutoff) {
        await fs.promises.rm(dir, { recursive: true, force: true });
        removed += 1;
      }
    } catch (_) {
      // ignore
    }
  }
  return { removed };
}

async function runDirectorStorageCleanup({ linkedCharacterIds = [] } = {}) {
  const linked = new Set(linkedCharacterIds);
  const identityTemp = await cleanupIdentityTemp();
  const characterMemory = await cleanupOrphanCharacterMemory(linked);
  return { identityTemp, characterMemory };
}

module.exports = {
  getDiskUsageBytes,
  runDirectorStorageCleanup,
  cleanupIdentityTemp,
  cleanupOrphanCharacterMemory
};
