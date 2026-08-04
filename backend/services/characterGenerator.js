/**
 * characterGenerator.js
 * 
 * Generates Master Reference assets for Characters from the Production Bible.
 */
const { generateCampaignImageNanoBanana } = require('./geminiAI');

async function generateCharacterSheet(character, globalVisualStyle, input) {
  // We want to generate a multi-view reference sheet for the character.
  // Using NanoBanana or equivalent image generation model.
  const prompt = `A professional character reference sheet of a ${character.appearance}, role: ${character.role}. 
Include Front View, Left 45 degree, Right 45 degree, Profile, Back View, Full Body, and various facial expressions (Happy, Neutral, Sad, Serious). 
Plain white background. High resolution, high detail. Style: ${globalVisualStyle || 'photorealistic cinematic'}. ${character.masterPrompt || ''}`;

  console.log(`Generating character reference sheet for ${character.characterId}...`);
  
  const result = await generateCampaignImageNanoBanana(prompt, {
    aspectRatio: '16:9',
    tone: 'professional',
    isCinematic: true,
    originalCharacterImage: input?.characterEnabled ? input.originalCharacterImage : undefined,
    characterReferenceImage: input?.characterEnabled ? input.characterImage : undefined
  });

  return {
    characterId: character.characterId,
    name: character.name,
    sheetUrl: result && result.imageUrl ? result.imageUrl : null,
    status: result && result.imageUrl ? 'success' : 'failed'
  };
}

async function runCharacterGenerator(productionBible, globalVisualStyle, input) {
  const characters = productionBible?.characterBible || [];
  if (!characters.length) return [];

  const results = [];
  for (const char of characters) {
    const sheet = await generateCharacterSheet(char, globalVisualStyle, input);
    results.push(sheet);
  }
  
  return results;
}

module.exports = {
  runCharacterGenerator,
  generateCharacterSheet
};
