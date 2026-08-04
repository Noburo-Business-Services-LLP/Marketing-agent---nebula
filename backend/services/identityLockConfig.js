function readBool(name, defaultValue = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function readNumber(name, defaultValue) {
  const parsed = Number.parseFloat(String(process.env[name] ?? ''));
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function readInt(name, defaultValue) {
  const parsed = Number.parseInt(String(process.env[name] ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

const IMAGE_ENGINE = String(process.env.IMAGE_ENGINE || 'comfyui').trim().toLowerCase();

module.exports = {
  IMAGE_ENGINE,
  IDENTITY_ENGINE: String(process.env.IDENTITY_ENGINE || 'pulid').trim().toLowerCase(),
  SIMILARITY_THRESHOLD: readNumber('SIMILARITY_THRESHOLD', 0.9),
  MAX_RETRIES: Math.max(1, readInt('MAX_RETRIES', 3)),
  ENABLE_FACE_SWAP_FALLBACK: readBool('ENABLE_FACE_SWAP_FALLBACK', true),
  ENABLE_GFPGAN: readBool('ENABLE_GFPGAN', true),
  ENABLE_CODEFORMER: readBool('ENABLE_CODEFORMER', false),
  ENABLE_REALESRGAN: readBool('ENABLE_REALESRGAN', false),
  COMFYUI_URL: String(process.env.COMFYUI_URL || 'http://127.0.0.1:8188').replace(/\/+$/, ''),
  COMFYUI_WORKFLOW_PATH: String(process.env.COMFYUI_WORKFLOW_PATH || '').trim(),
  COMFYUI_PULID_WORKFLOW_PATH: String(process.env.COMFYUI_PULID_WORKFLOW_PATH || '').trim(),
  COMFYUI_IPADAPTER_WORKFLOW_PATH: String(process.env.COMFYUI_IPADAPTER_WORKFLOW_PATH || '').trim(),
  PYTHON_BIN: String(process.env.PYTHON_BIN || 'python').trim(),
  INSIGHTFACE_ENABLED: readBool('INSIGHTFACE_ENABLED', true),
  // When a Character Sheet exists, use ComfyUI identity conditioning automatically.
  AUTO_COMFYUI_FOR_IDENTITY: readBool('AUTO_COMFYUI_FOR_IDENTITY', true),
  // Strict face matching mode: Require ComfyUI for character scene identity conditioning.
  // Set ALLOW_GEMINI_FALLBACK_WITHOUT_IDENTITY=true ONLY if cloud image fallback without PuLID identity is explicitly desired.
  ALLOW_GEMINI_FALLBACK_WITHOUT_IDENTITY: readBool('ALLOW_GEMINI_FALLBACK_WITHOUT_IDENTITY', false),
  COMFYUI_TIMEOUT_MS: Math.max(30000, readInt('COMFYUI_TIMEOUT_MS', 180000)),
  PULID_WEIGHT: readNumber('PULID_WEIGHT', 1.0)
};
