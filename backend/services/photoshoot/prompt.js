'use strict';
/**
 * Photoshoot prompts, written by code only. The customer chooses from fixed lists (pack, scene, background, shape, their
 * own place photo); the only customer words that reach the image model are the product name, cleaned by cleanName().
 * Every prompt ends with RULES, so v1 is product only: no people, no added logos or text, no symbols.
 */
const caps = require('../../config/photoshoot');
const { BACKGROUNDS } = require('../../config/photoshootPacks');

const RULES = [
  'Rules for this photo:',
  '- Show only the product and the setting. No people, no faces, no hands, no arms, no bodies, no silhouettes and no mannequins.',
  '- The product must look exactly like the one in the first reference photo: the same shape, colours, materials, size and label.',
  '- Keep only the markings that are already printed on the product. Do not add any logo, brand name, words, letters, numbers, price, watermark or sticker anywhere in the picture.',
  '- Do not show any other company\'s products, logos or trademarks.',
  '- No religious figures or symbols, no flags, no political or national emblems, no alcohol, tobacco or weapons.',
  '- Photorealistic professional product photography, sharp focus on the product, natural colours, no illustration or cartoon style.'
].join('\n');

/** One line, letters of any script kept, quotes and control characters removed, at most PROMPT_NAME_MAX characters. */
function cleanName(name) {
  const flat = String(name || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/["'`‘’“”<>{}[\]\\|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(flat);
  return (chars.length > caps.PROMPT_NAME_MAX ? chars.slice(0, caps.PROMPT_NAME_MAX).join('') : flat).trim();
}

const SHAPE = { '1:1': 'a square photo', '4:5': 'a portrait photo (4 by 5)', '9:16': 'a tall story photo (9 by 16)', '16:9': 'a wide photo (16 by 9)' };

/**
 * The prompt for one photo.
 * scene: one scene of the pack; background: a key of BACKGROUNDS or ''; productName: as typed; inPlace: true when the
 * second reference photo is the customer's own space and this scene may be set there.
 */
function buildPhotoPrompt({ scene, background = '', productName = '', inPlace = false, aspectRatio = '1:1' }) {
  const bg = BACKGROUNDS[background] ? BACKGROUNDS[background].prompt : 'a clean, simple backdrop that suits the product';
  const name = cleanName(productName);
  const what = name ? `the product in the first reference photo (it is called ${name})` : 'the product in the first reference photo';
  const setting = String((scene && scene.prompt) || '').replace(/\{background\}/g, bg);
  const lines = [
    `Make ${SHAPE[aspectRatio] || SHAPE['1:1']} of ${what}, ${setting}.`,
    inPlace ? 'Set it in the space shown in the second reference photo, keeping that space recognisable and tidy, with nobody in it.' : '',
    RULES
  ];
  return lines.filter(Boolean).join('\n');
}

module.exports = { RULES, cleanName, buildPhotoPrompt };
