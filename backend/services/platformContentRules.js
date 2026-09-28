const RULES = {
  x: {
    platform: 'x',
    structure: 'micro',
    lengthGuidance: 'STRICT 280 characters including hashtags',
    hardCharLimit: 280,
    emojiGuidance: 'none — single impactful statement',
    hashtagCount: '4',
    promptBlock:
      '- STRICT 280 character limit (including hashtags). Keep it punchy and concise.\n' +
      '- Use exactly 4 hashtags, placed at the end.\n' +
      '- No line breaks or long paragraphs — single impactful statement.'
  },
  instagram: {
    platform: 'instagram',
    structure: 'short-form',
    lengthGuidance: 'up to 2200 characters but 150-300 ideal',
    hardCharLimit: null,
    emojiGuidance: 'generous',
    hashtagCount: '4',
    promptBlock:
      '- Caption can be up to 2200 characters but keep it engaging (150-300 chars ideal for feed).\n' +
      '- Use exactly 4 relevant hashtags.\n' +
      '- Include line breaks for readability.\n' +
      '- Start with a hook in the first line (visible before "more").\n' +
      '- Use emojis generously.'
  },
  facebook: {
    platform: 'facebook',
    structure: 'short-form',
    lengthGuidance: '100-250 characters ideal',
    hardCharLimit: null,
    emojiGuidance: 'moderate',
    hashtagCount: '4',
    promptBlock:
      '- Medium length (100-250 chars ideal for engagement).\n' +
      '- Conversational and relatable tone.\n' +
      '- Exactly 4 hashtags.\n' +
      '- Include a question or CTA to drive comments.\n' +
      '- Emojis OK but moderate.'
  },
  linkedin: {
    platform: 'linkedin',
    structure: 'long-form',
    lengthGuidance: '150-300+ words — longer when real numbers, a case study or a specific story genuinely support it',
    hardCharLimit: null,
    emojiGuidance: 'minimal — 1-2 max',
    hashtagCount: '3-5',
    promptBlock:
      '- Do not write the hook first. Draft the CONTEXT, BREAKDOWN, ANALYSIS/POV and CTA (below) first, then find the single sharpest line in that draft and turn it into the BOLD HOOK — the hook must come from the real substance, not be invented as a generic opener.\n' +
      '- Write 150-300+ words in this 5-part structure:\n' +
      '  1. BOLD HOOK (1-2 lines): the sharpest line from your own draft — a specific, concrete claim or observation, not a question, not a generic statement. No emoji.\n' +
      '  2. CONTEXT (1-2 lines): why this matters right now, briefly.\n' +
      '  3. BREAKDOWN: the substance — real numbers, a specific example, or a case study where the brand context provides one. Short, punchy, one-idea-per-sentence paragraphs. Bold the 2-3 words that matter most in a key sentence.\n' +
      '  4. ANALYSIS / POV: a specific belief that contradicts a common assumption in this brand\'s industry — not a summary of the breakdown, not a safe hedge.\n' +
      '  5. CTA: a real question or observation to close on — never "Sign up here" or "link in bio," and never a generic "What do you think?"\n' +
      '- 1-2 emoji maximum across the whole post, never one per section.\n' +
      '- 3-5 hashtags, lowercase preferred.\n' +
      '- Never invent a statistic or case study that is not grounded in the brand context provided — use a real one from Brand Memory, or write the point without a fabricated number.'
  }
};

function getPlatformRules(platform) {
  const key = String(platform || '').toLowerCase();
  const normalized = key === 'twitter' ? 'x' : key;
  return RULES[normalized] || RULES.instagram;
}

module.exports = { getPlatformRules };
