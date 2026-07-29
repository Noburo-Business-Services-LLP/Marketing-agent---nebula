#!/usr/bin/env node
/**
 * Runtime verification for Character Identity Lock wiring.
 *
 * Usage:
 *   node scripts/verify-identity-pipeline.js
 *   node scripts/verify-identity-pipeline.js --character-sheet path/to/reference.png
 *   node scripts/verify-identity-pipeline.js --dry-run
 */

const fs = require('fs');
const path = require('path');

const config = require('../services/identityLockConfig');
const comfyUI = require('../services/comfyUIClient');
const { ensureCharacterMemoryFromSource, prepareIdentityPackage, compareWithCharacterMemory } = require('../services/characterMemoryStore');
const { generateIdentityConditionedSceneImage } = require('../services/identityConditionedGenerator');

function parseArgs(argv) {
  const args = { dryRun: false, characterSheet: '', scenePrompt: 'A woman standing in a Tokyo street at night, cinematic lighting' };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    if (argv[i] === '--character-sheet') args.characterSheet = argv[++i] || '';
    if (argv[i] === '--prompt') args.scenePrompt = argv[++i] || args.scenePrompt;
  }
  return args;
}

function check(label, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

async function verifyWorkflowTemplate() {
  const engine = config.IDENTITY_ENGINE;
  const { workflow, workflowPath } = await comfyUI.loadWorkflowTemplate(engine);
  const fakeRef = 'character_test_reference.png';
  const injected = comfyUI.injectIdentityWorkflow(workflow, {
    prompt: 'test scene prompt',
    negativePrompt: 'bad quality',
    referenceImageName: fakeRef,
    seed: 12345,
    pulidWeight: config.PULID_WEIGHT
  });
  const wiring = comfyUI.assertIdentityWorkflowWired(injected, {
    referenceImageName: fakeRef,
    identityEngine: engine
  });
  const modelInfo = comfyUI.inspectFluxCheckpoint(injected);
  return {
    workflowPath,
    wiring,
    modelInfo
  };
}

async function main() {
  const args = parseArgs(process.argv);
  console.log('\n=== Character Identity Pipeline Verification ===\n');

  console.log('Config:');
  console.log(`  IMAGE_ENGINE=${config.IMAGE_ENGINE}`);
  console.log(`  IDENTITY_ENGINE=${config.IDENTITY_ENGINE}`);
  console.log(`  AUTO_COMFYUI_FOR_IDENTITY=${config.AUTO_COMFYUI_FOR_IDENTITY}`);
  console.log(`  ALLOW_GEMINI_FALLBACK_WITHOUT_IDENTITY=${config.ALLOW_GEMINI_FALLBACK_WITHOUT_IDENTITY}`);
  console.log(`  COMFYUI_URL=${config.COMFYUI_URL}`);
  console.log('');

  let allPass = true;

  // 1) Workflow wiring (offline)
  try {
    const wf = await verifyWorkflowTemplate();
    allPass = check('Workflow template exists', true, wf.workflowPath) && allPass;
    allPass = check('LoadImage → PuLID/IPAdapter → KSampler wired', true, `${wf.wiring.applyClass}(${wf.wiring.applyId})`) && allPass;
    allPass = check('FLUX model declared', Boolean(wf.modelInfo.unetName || wf.modelInfo.checkpointName), wf.modelInfo.unetName || wf.modelInfo.checkpointName || 'none') && allPass;
  } catch (error) {
    allPass = check('Workflow wiring', false, error.message) && allPass;
  }

  // 2) ComfyUI reachable (required only for live generation)
  const comfyReady = await comfyUI.checkComfyUIAvailable(true);
  if (!args.characterSheet || args.dryRun) {
    check('ComfyUI reachable', comfyReady, comfyReady ? config.COMFYUI_URL : 'not running (OK for offline wiring check)');
  } else {
    allPass = check('ComfyUI reachable', comfyReady, config.COMFYUI_URL) && allPass;
  }

  if (!args.characterSheet) {
    console.log('\nSkip live generation test (pass --character-sheet path/to/reference.png)');
    console.log(allPass ? '\nResult: wiring checks passed (live ComfyUI test skipped)\n' : '\nResult: wiring checks failed\n');
    process.exit(allPass ? 0 : 1);
  }

  if (!fs.existsSync(args.characterSheet)) {
    console.error(`Character sheet not found: ${args.characterSheet}`);
    process.exit(1);
  }

  const memory = await ensureCharacterMemoryFromSource({
    characterId: `verify_${Date.now()}`,
    imageSource: args.characterSheet,
    metadata: { source: 'verify-identity-pipeline' }
  });
  const identityPackage = await prepareIdentityPackage(memory, console.log);

  allPass = check('Character memory created', Boolean(identityPackage.referencePath), identityPackage.referencePath) && allPass;
  allPass = check('Identity embedding present', Boolean(identityPackage.embeddingPath), identityPackage.embeddingPath || 'missing') && allPass;
  allPass = check('Identity token present', Boolean(identityPackage.tokenPath && fs.existsSync(identityPackage.tokenPath)), identityPackage.tokenPath) && allPass;

  if (args.dryRun) {
    console.log('\nDry run complete (no ComfyUI generation).');
    process.exit(allPass ? 0 : 1);
  }

  if (!comfyReady) {
    console.error('\nComfyUI is not running. Start ComfyUI before live generation test.');
    process.exit(1);
  }

  console.log('\nLive generation test (character scene — Gemini must NOT be used):\n');
  const generation = await generateIdentityConditionedSceneImage({
    prompt: args.scenePrompt,
    scene: { sceneId: 'VERIFY_001', title: 'Verification Scene' },
    identityPackage,
    logger: (line) => console.log(`  ${line}`),
    seed: 424242
  });

  allPass = check('Generation engine is ComfyUI', String(generation.engine || '').startsWith('comfyui-'), generation.engine) && allPass;
  allPass = check('identityConditioned=true', generation.identityConditioned === true) && allPass;
  allPass = check('Gemini NOT used', generation.geminiUsed !== true) && allPass;
  allPass = check('Generation proof recorded', Boolean(generation.proof?.uploadedReferenceName), generation.proof?.uploadedReferenceName) && allPass;

  const outPath = path.join(identityPackage.dir, 'verify_generated_scene.png');
  const base64 = String(generation.imageSource || '').replace(/^data:image\/\w+;base64,/, '');
  await fs.promises.writeFile(outPath, Buffer.from(base64, 'base64'));

  const validation = await compareWithCharacterMemory(identityPackage, outPath);
  allPass = check(
    'Validation compares reference vs generated scene',
    validation.engine !== 'none',
    `similarity=${validation.similarity?.toFixed?.(3) ?? validation.similarity} via ${validation.engine}`
  ) && allPass;

  console.log(`\nGenerated image saved: ${outPath}`);
  console.log(allPass ? '\nResult: LIVE identity pipeline verification PASSED\n' : '\nResult: LIVE verification FAILED\n');
  process.exit(allPass ? 0 : 1);
}

main().catch((error) => {
  console.error('\nVerification crashed:', error.message);
  process.exit(1);
});
