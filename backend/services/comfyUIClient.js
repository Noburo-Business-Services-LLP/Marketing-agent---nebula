const fs = require('fs');
const path = require('path');
const config = require('./identityLockConfig');

let comfyAvailabilityCache = { checkedAt: 0, available: false };

const PULID_APPLY_TYPES = new Set(['ApplyPulidFlux', 'ApplyPulid', 'ApplyPuLID', 'PulidApply']);
const IPADAPTER_APPLY_TYPES = new Set(['IPAdapter', 'IPAdapterAdvanced', 'IPAdapterApply', 'IPAdapterModelHelper']);
const SAMPLER_TYPES = new Set(['KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced']);

async function checkComfyUIAvailable(force = false) {
  const now = Date.now();
  if (!force && now - comfyAvailabilityCache.checkedAt < 15000) {
    return comfyAvailabilityCache.available;
  }

  try {
    const response = await fetch(`${config.COMFYUI_URL}/system_stats`, {
      signal: AbortSignal.timeout(5000)
    });
    comfyAvailabilityCache = { checkedAt: now, available: response.ok };
    return response.ok;
  } catch (_) {
    try {
      const response = await fetch(`${config.COMFYUI_URL}/queue`, {
        signal: AbortSignal.timeout(5000)
      });
      comfyAvailabilityCache = { checkedAt: now, available: response.ok };
      return response.ok;
    } catch (__) {
      comfyAvailabilityCache = { checkedAt: now, available: false };
      return false;
    }
  }
}

async function uploadImageToComfyUI(filePath, filename = 'character_reference.png') {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Character Sheet file missing for ComfyUI upload: ${filePath}`);
  }

  const buffer = await fs.promises.readFile(filePath);
  if (!buffer.length) {
    throw new Error(`Character Sheet file is empty: ${filePath}`);
  }

  const form = new FormData();
  form.append('image', new Blob([buffer], { type: 'image/png' }), filename);
  form.append('overwrite', 'true');

  const response = await fetch(`${config.COMFYUI_URL}/upload/image`, {
    method: 'POST',
    body: form
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`ComfyUI image upload failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const payload = await response.json();
  const uploadedName = payload.name || payload.filename || filename;
  if (!uploadedName) {
    throw new Error('ComfyUI upload returned no image name');
  }
  return uploadedName;
}

async function queuePrompt(workflow) {
  const response = await fetch(`${config.COMFYUI_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ComfyUI prompt failed (${response.status}): ${text.slice(0, 400)}`);
  }
  const payload = await response.json();
  const promptId = payload.prompt_id || payload.promptId;
  if (!promptId) {
    throw new Error('ComfyUI did not return a prompt_id');
  }
  return promptId;
}

async function waitForImage(promptId, timeoutMs = config.COMFYUI_TIMEOUT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const historyRes = await fetch(`${config.COMFYUI_URL}/history/${promptId}`);
    if (!historyRes.ok) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    const history = await historyRes.json();
    const entry = history?.[promptId];
    if (entry?.status?.status_str === 'error') {
      throw new Error(`ComfyUI job failed: ${JSON.stringify(entry.status).slice(0, 300)}`);
    }
    const outputs = entry?.outputs || {};
    for (const node of Object.values(outputs)) {
      const image = Array.isArray(node?.images) ? node.images[0] : null;
      if (image?.filename) {
        const params = new URLSearchParams({
          filename: image.filename,
          subfolder: image.subfolder || '',
          type: image.type || 'output'
        });
        const viewRes = await fetch(`${config.COMFYUI_URL}/view?${params.toString()}`);
        if (!viewRes.ok) continue;
        const buffer = Buffer.from(await viewRes.arrayBuffer());
        if (!buffer.length) continue;
        return {
          dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
          filename: image.filename,
          subfolder: image.subfolder || ''
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('ComfyUI generation timed out');
}

function replacePlaceholders(value, replacements) {
  if (typeof value !== 'string') return value;
  let next = value;
  for (const [token, replacement] of Object.entries(replacements)) {
    next = next.split(token).join(String(replacement));
  }
  return next;
}

function coerceNumericInputs(node) {
  if (!node?.inputs || typeof node.inputs !== 'object') return;
  for (const key of ['seed', 'noise_seed', 'steps', 'cfg', 'weight', 'start_at', 'end_at', 'denoise', 'guidance']) {
    if (node.inputs[key] === undefined || node.inputs[key] === null) continue;
    if (typeof node.inputs[key] === 'number') continue;
    const parsed = Number(node.inputs[key]);
    if (Number.isFinite(parsed)) node.inputs[key] = parsed;
  }
}

/**
 * Fail fast if the workflow is not actually identity-conditioned.
 * Required graph:
 *   LoadImage (reference) → PuLID/IPAdapter apply → Sampler.model
 */
function assertIdentityWorkflowWired(workflow, { referenceImageName, identityEngine = 'pulid' } = {}) {
  const nodes = Object.entries(workflow || {});
  if (!nodes.length) {
    throw new Error('ComfyUI workflow is empty');
  }

  const loadImageNodes = nodes.filter(([, node]) => node?.class_type === 'LoadImage');
  if (!loadImageNodes.length) {
    throw new Error('Identity workflow missing LoadImage (Character Sheet cannot enter the graph)');
  }

  const loadImageId = loadImageNodes[0][0];
  const loadImageNode = loadImageNodes[0][1];
  const loadedImage = String(loadImageNode?.inputs?.image || '');
  if (!loadedImage || loadedImage.includes('{{REFERENCE_IMAGE}}')) {
    throw new Error('LoadImage still has placeholder; Character Sheet was not injected');
  }
  if (referenceImageName && loadedImage !== referenceImageName) {
    throw new Error(`LoadImage reference mismatch: expected ${referenceImageName}, got ${loadedImage}`);
  }

  const applyTypes = identityEngine === 'ipadapter' ? IPADAPTER_APPLY_TYPES : PULID_APPLY_TYPES;
  // Also accept either for mixed workflows.
  const applyNodes = nodes.filter(([, node]) =>
    PULID_APPLY_TYPES.has(node?.class_type) || IPADAPTER_APPLY_TYPES.has(node?.class_type)
  );
  if (!applyNodes.length) {
    throw new Error(
      `Identity workflow missing PuLID/IPAdapter apply node (found no ${[...applyTypes].join('|')})`
    );
  }

  const applyId = applyNodes[0][0];
  const applyNode = applyNodes[0][1];
  const imageInput = applyNode.inputs?.image;
  const imageLinkedFromLoad = Array.isArray(imageInput) && String(imageInput[0]) === String(loadImageId);
  if (!imageLinkedFromLoad) {
    throw new Error('PuLID/IPAdapter image input is not connected to LoadImage — Character Sheet has no effect');
  }

  const samplerNodes = nodes.filter(([, node]) => SAMPLER_TYPES.has(node?.class_type));
  if (!samplerNodes.length) {
    throw new Error('Identity workflow missing KSampler');
  }

  const samplerUsesIdentityModel = samplerNodes.some(([, node]) => {
    const modelInput = node.inputs?.model;
    return Array.isArray(modelInput) && String(modelInput[0]) === String(applyId);
  });
  if (!samplerUsesIdentityModel) {
    throw new Error('KSampler.model is not connected to PuLID/IPAdapter output — identity conditioning is bypassed');
  }

  return {
    loadImageId,
    applyId,
    applyClass: applyNode.class_type,
    referenceImage: loadedImage,
    samplerCount: samplerNodes.length
  };
}

function injectIdentityWorkflow(workflow, {
  prompt,
  negativePrompt = '',
  referenceImageName,
  seed,
  pulidWeight
}) {
  if (!referenceImageName) {
    throw new Error('referenceImageName is required for identity-conditioned ComfyUI generation');
  }

  const clone = JSON.parse(JSON.stringify(workflow));
  const replacements = {
    '{{PROMPT}}': prompt,
    '{{NEGATIVE_PROMPT}}': negativePrompt,
    '{{REFERENCE_IMAGE}}': referenceImageName,
    '{{SEED}}': seed,
    '{{PULID_WEIGHT}}': pulidWeight
  };

  for (const node of Object.values(clone)) {
    if (!node?.inputs || typeof node.inputs !== 'object') continue;

    for (const [key, value] of Object.entries(node.inputs)) {
      if (typeof value === 'string') {
        node.inputs[key] = replacePlaceholders(value, replacements);
      }
    }

    if (node.class_type === 'LoadImage') {
      node.inputs.image = referenceImageName;
    }

    if (PULID_APPLY_TYPES.has(node.class_type) || IPADAPTER_APPLY_TYPES.has(node.class_type)) {
      if (node.inputs.weight === undefined || node.inputs.weight === '{{PULID_WEIGHT}}') {
        node.inputs.weight = pulidWeight;
      }
    }

    if (SAMPLER_TYPES.has(node.class_type) && seed !== undefined) {
      node.inputs.seed = seed;
      if (node.inputs.noise_seed !== undefined) node.inputs.noise_seed = seed;
    }

    if (
      (node.class_type === 'CLIPTextEncode' || node.class_type === 'CLIPTextEncodeFlux')
      && node._meta?.role === 'negative'
    ) {
      node.inputs.text = negativePrompt;
    } else if (
      (node.class_type === 'CLIPTextEncode' || node.class_type === 'CLIPTextEncodeFlux')
      && (node._meta?.role === 'positive' || String(node.inputs.text || '').includes('{{PROMPT}}'))
    ) {
      node.inputs.text = prompt;
    }

    coerceNumericInputs(node);
  }

  return clone;
}

function resolveWorkflowPath(identityEngine) {
  if (config.COMFYUI_WORKFLOW_PATH) return config.COMFYUI_WORKFLOW_PATH;
  if (identityEngine === 'ipadapter' && config.COMFYUI_IPADAPTER_WORKFLOW_PATH) {
    return config.COMFYUI_IPADAPTER_WORKFLOW_PATH;
  }
  if (config.COMFYUI_PULID_WORKFLOW_PATH) return config.COMFYUI_PULID_WORKFLOW_PATH;

  const defaultName = identityEngine === 'ipadapter'
    ? 'scene-ipadapter-flux.json'
    : 'scene-pulid-flux.json';
  return path.resolve(__dirname, 'comfyui-workflows', defaultName);
}

async function loadWorkflowTemplate(identityEngine = 'pulid') {
  const workflowPath = resolveWorkflowPath(identityEngine);
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`ComfyUI workflow not found: ${workflowPath}`);
  }
  const raw = await fs.promises.readFile(workflowPath, 'utf8');
  return { workflow: JSON.parse(raw), workflowPath };
}

function inspectFluxCheckpoint(workflow) {
  const unet = Object.values(workflow || {}).find((node) => node?.class_type === 'UNETLoader');
  const ckpt = Object.values(workflow || {}).find((node) => node?.class_type === 'CheckpointLoaderSimple');
  return {
    unetName: unet?.inputs?.unet_name || null,
    checkpointName: ckpt?.inputs?.ckpt_name || null
  };
}

module.exports = {
  checkComfyUIAvailable,
  uploadImageToComfyUI,
  queuePrompt,
  waitForImage,
  injectIdentityWorkflow,
  assertIdentityWorkflowWired,
  loadWorkflowTemplate,
  inspectFluxCheckpoint,
  resolveWorkflowPath
};
