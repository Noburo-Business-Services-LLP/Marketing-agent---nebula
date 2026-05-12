const { rememberVideoGeneration } = require('./aiMemoryService');

async function learnVideoStep(payload = {}) {
  return rememberVideoGeneration(payload);
}

async function learnReelGeneration(payload = {}) {
  return rememberVideoGeneration({
    ...payload,
    action: 'reel_generation'
  });
}

module.exports = {
  learnVideoStep,
  learnReelGeneration
};
