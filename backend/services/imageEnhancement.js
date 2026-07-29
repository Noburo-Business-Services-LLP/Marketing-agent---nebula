const fs = require('fs');
const path = require('path');
const config = require('./identityLockConfig');
const insightFace = require('./identityInsightFace');

async function enhanceImage(inputPath, outputPath, { logger } = {}) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Enhancement input missing: ${inputPath}`);
  }

  const shouldEnhance = config.ENABLE_GFPGAN || config.ENABLE_CODEFORMER || config.ENABLE_REALESRGAN;
  if (!shouldEnhance) {
    await fs.promises.copyFile(inputPath, outputPath);
    return { success: true, outputPath, skipped: true };
  }

  try {
    const result = await insightFace.enhanceImageFile(inputPath, outputPath, {
      enableGfpgan: config.ENABLE_GFPGAN,
      enableCodeformer: config.ENABLE_CODEFORMER,
      enableRealesrgan: config.ENABLE_REALESRGAN
    });
    if (logger && !result.skipped) {
      logger(`[Enhancement] Applied post-processing to ${path.basename(outputPath)}`);
    }
    return result;
  } catch (error) {
    if (logger) logger(`[Enhancement] Skipped (${error.message})`);
    await fs.promises.copyFile(inputPath, outputPath);
    return { success: true, outputPath, skipped: true, error: error.message };
  }
}

module.exports = {
  enhanceImage
};
