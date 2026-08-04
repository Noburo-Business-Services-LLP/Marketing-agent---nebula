const { generateIdentityConditionedSceneImage } = require('./identityConditionedGenerator');

async function generateSceneImage(options) {
  const result = await generateIdentityConditionedSceneImage(options);
  return result.imageSource;
}

module.exports = {
  generateSceneImage,
  generateIdentityConditionedSceneImage
};
