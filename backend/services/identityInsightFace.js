const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const config = require('./identityLockConfig');

const IDENTITY_DIR = path.resolve(__dirname, 'identity');
const EMBEDDING_SCRIPT = path.join(IDENTITY_DIR, 'embedding.py');
const COMPARE_SCRIPT = path.join(IDENTITY_DIR, 'compare.py');
const FACE_SWAP_SCRIPT = path.join(IDENTITY_DIR, 'face_swap.py');
const ENHANCE_SCRIPT = path.join(IDENTITY_DIR, 'enhance.py');

let insightFaceAvailability = null;

function runPython(scriptPath, args = [], timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.PYTHON_BIN, [scriptPath, ...args], {
      cwd: IDENTITY_DIR,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Python script timed out: ${path.basename(scriptPath)}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(stderr || stdout || `Python exited with code ${code}`));
      }
    });
  });
}

async function checkInsightFaceAvailable() {
  if (insightFaceAvailability !== null) return insightFaceAvailability;
  if (!config.INSIGHTFACE_ENABLED) {
    insightFaceAvailability = false;
    return false;
  }
  try {
    if (!fs.existsSync(EMBEDDING_SCRIPT) || !fs.existsSync(COMPARE_SCRIPT)) {
      insightFaceAvailability = false;
      return false;
    }
    await runPython(EMBEDDING_SCRIPT, ['--check'], 15000);
    insightFaceAvailability = true;
  } catch (_) {
    insightFaceAvailability = false;
  }
  return insightFaceAvailability;
}

async function createEmbedding(imagePath, outputPath) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await runPython(EMBEDDING_SCRIPT, [imagePath, outputPath]);
  return outputPath;
}

async function compareFaces(embeddingPath, imagePath) {
  const { stdout } = await runPython(COMPARE_SCRIPT, [embeddingPath, imagePath]);
  try {
    const parsed = JSON.parse(stdout);
    return {
      similarity: Number(parsed.similarity) || 0,
      passes: Number(parsed.similarity) >= config.SIMILARITY_THRESHOLD
    };
  } catch (_) {
    const match = stdout.match(/similarity["\s:]+([0-9.]+)/i);
    const similarity = match ? Number(match[1]) : 0;
    return { similarity, passes: similarity >= config.SIMILARITY_THRESHOLD };
  }
}

async function applyFaceSwap({ referenceImagePath, targetImagePath, outputPath }) {
  if (!fs.existsSync(FACE_SWAP_SCRIPT)) {
    return { success: false, error: 'face_swap.py not found' };
  }
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await runPython(FACE_SWAP_SCRIPT, [referenceImagePath, targetImagePath, outputPath], 180000);
  return { success: fs.existsSync(outputPath), outputPath };
}

async function enhanceImageFile(inputPath, outputPath, options = {}) {
  if (!fs.existsSync(ENHANCE_SCRIPT)) {
    await fs.promises.copyFile(inputPath, outputPath);
    return { success: true, outputPath, skipped: true };
  }

  const flags = [];
  if (options.enableGfpgan) flags.push('--gfpgan');
  if (options.enableCodeformer) flags.push('--codeformer');
  if (options.enableRealesrgan) flags.push('--realesrgan');

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await runPython(ENHANCE_SCRIPT, [inputPath, outputPath, ...flags], 240000);
  return { success: fs.existsSync(outputPath), outputPath };
}

module.exports = {
  checkInsightFaceAvailable,
  createEmbedding,
  compareFaces,
  applyFaceSwap,
  enhanceImageFile
};
