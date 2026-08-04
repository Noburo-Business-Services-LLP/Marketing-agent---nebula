/**
 * VIDEO STYLE-AWARE PROMPT ENGINEERING SYSTEM
 * 
 * Generates cinematography-aware prompts for:
 * - Image Generation (Step 3)
 * - Video Generation (Step 4)
 * - Audio Generation (Step 5)
 * 
 * Based on:
 * - User description
 * - Selected video style
 * - Character info
 * - Product/context
 */

const styleDefinitions = {
  'Ads': {
    name: 'Ads',
    cameraStyle: 'dynamic, high-energy, fast-paced, high-quality commercial look',
    characterMovement: 'energetic, expressive, engaging directly with the viewer',
    audioTone: 'upbeat, enthusiastic, persuasive, clear and catchy',
    colorGrade: 'bright, vibrant, high-contrast, modern advertisement look',
    pacing: 'fast-paced, quick cuts, high retention edits',
    cameraAngles: 'dynamic angles, product focus, tight close-ups for emphasis',
    prompt: `Create a high-performing advertisement scene with:
    - High-energy, engaging visuals designed to capture attention
    - Clear focus on the value proposition or product
    - Bright, vibrant lighting with high contrast
    - Professional, modern commercial aesthetic`
  },
  'Cinematic Commercial': {
    name: 'Cinematic Commercial',
    cameraStyle: 'cinematic 4K, film-grade color grading, dramatic lighting, shallow depth of field',
    characterMovement: 'natural, purposeful movements with dramatic pauses, professional posture',
    audioTone: 'professional, sophisticated, inspiring, warm voiceover with cinematic background music',
    colorGrade: 'warm golden hour lighting, high contrast, saturated colors, film noir aesthetic',
    pacing: 'slow, deliberate camera movements, smooth transitions, 24fps cinematic feel',
    cameraAngles: 'wide establishing shots, close-ups for emotion, over-shoulder angles for engagement',
    prompt: `Create a cinematic commercial scene with:
    - Film-grade cinematography (4K, shallow DOF, f/2.8 aesthetic)
    - Dramatic 3-point lighting with golden hour warmth
    - Smooth camera movements (dolly, subtle pan)
    - Professional color grading (warm tones, high saturation)
    - Character with purposeful, natural movements
    - Production value equivalent to TV/streaming commercial`
  },

  'Storytelling': {
    name: 'Storytelling',
    cameraStyle: 'narrative cinema, warm naturalistic lighting, emotional close-ups, documentary-style realism',
    characterMovement: 'emotional, expressive, authentic reactions, intimate moments',
    audioTone: 'warm, conversational voiceover, emotional background score, sound design for storytelling',
    colorGrade: 'natural, warm, slightly desaturated for nostalgic feel, soft focus for emotion',
    pacing: 'medium pacing, focus on character moments, meaningful transitions',
    cameraAngles: 'close-ups for emotions, wide shots for context, handheld for authenticity',
    prompt: `Create a storytelling scene with:
    - Warm, naturalistic lighting that feels intimate
    - Documentary-style cinematography with character focus
    - Emotional expressions and authentic reactions
    - Soft color grading for warmth and nostalgia
    - Medium pacing with character-driven moments
    - Authentic, relatable production style`
  },

  'Product Advertisement': {
    name: 'Product Advertisement',
    cameraStyle: 'product-focused, bright clean lighting, sharp focus, professional product showcase',
    characterMovement: 'interacting with product, confident gestures, smooth product reveals',
    audioTone: 'energetic, upbeat, professional announcement style, modern soundtrack',
    colorGrade: 'bright, clean, saturated product colors, white/neutral backgrounds, high-key lighting',
    pacing: 'fast, dynamic, emphasizing product features and benefits',
    cameraAngles: '360-degree product shots, close-ups of details, character demonstrating use',
    prompt: `Create a product advertisement scene with:
    - High-key bright lighting with sharp product focus
    - Clean professional backdrop, minimal distractions
    - Product prominently featured in hero shots
    - Character confidently demonstrating product
    - Dynamic camera movements highlighting features
    - Energetic, commercial-ready aesthetic`
  },

  'Daily Life Vlog': {
    name: 'Daily Life Vlog',
    cameraStyle: 'casual vlog style, natural lighting, handheld camera feel, authentic real-world',
    characterMovement: 'casual, relatable, spontaneous-looking, genuine interactions',
    audioTone: 'friendly, conversational, casual music, vlog-style commentary',
    colorGrade: 'natural, slightly saturated, warm tones, smartphone camera feel',
    pacing: 'natural pacing, real-world speed, authentic moments',
    cameraAngles: 'selfie/handheld, POV shots, casual framing, vlog-style coverage',
    prompt: `Create a daily life vlog scene with:
    - Casual natural lighting (daylight or indoor ambient)
    - Handheld camera aesthetic, authentic framing
    - Relatable everyday moments and activities
    - Natural character interactions and movements
    - Smartphone-era color science
    - Authentic, unpolished production style`
  },

  'Documentary': {
    name: 'Documentary',
    cameraStyle: 'documentary realism, natural lighting, medium depth, informative framing',
    characterMovement: 'authentic, informative, professional yet natural, expert positioning',
    audioTone: 'authoritative voiceover, informative narration, subtle documentary score',
    colorGrade: 'neutral, documentary-realistic, muted tones, factual presentation',
    pacing: 'measured, informative, allowing viewer to absorb details',
    cameraAngles: 'establishing shots, interview-style framing, detail shots for education',
    prompt: `Create a documentary scene with:
    - Natural, realistic lighting (documentary style)
    - Informative framing with medium depth of field
    - Authentic character positioning for authority
    - Neutral color grading for factual presentation
    - Educational detail shots and context
    - Professional documentary aesthetic`
  },

  'Educational': {
    name: 'Educational',
    cameraStyle: 'clear educational presentation, bright lighting, organized framing, learning-focused',
    characterMovement: 'teaching gestures, clear demonstrations, pointing/explaining actions',
    audioTone: 'clear educational narration, helpful explanations, learning-supportive music',
    colorGrade: 'bright, clean, high contrast for readability, primary color emphasis',
    pacing: 'measured for learning, time for comprehension, structured progression',
    cameraAngles: 'demonstration angles, before/after shots, zooms on key elements',
    prompt: `Create an educational scene with:
    - Bright, clear lighting optimized for learning
    - Organized composition focusing on key elements
    - Teaching gestures and clear demonstrations
    - High contrast, readable color grading
    - Structured presentation of information
    - Professional educational aesthetic`
  },

  'Motivational': {
    name: 'Motivational',
    cameraStyle: 'inspirational cinema, dynamic lighting, powerful composition, uplifting visuals',
    characterMovement: 'energetic, powerful poses, inspiring expressions, motivational gestures',
    audioTone: 'inspiring voiceover, motivational music, empowering sound design',
    colorGrade: 'vibrant, energetic, saturated, golden/warm tones, uplifting atmosphere',
    pacing: 'dynamic, energetic, building momentum, inspiring transitions',
    cameraAngles: 'low-angle power shots, wide inspiring vistas, dynamic camera moves',
    prompt: `Create a motivational scene with:
    - Dynamic lighting with inspiring warm tones
    - Powerful composition with impressive backdrop
    - Energetic character poses and expressions
    - Vibrant, saturated color grading for energy
    - Cinematic camera movements building momentum
    - Inspirational, uplifting production aesthetic`
  },

  'Corporate Presentation': {
    name: 'Corporate Presentation',
    cameraStyle: 'professional corporate, bright even lighting, polished framing, business-ready',
    characterMovement: 'professional posture, confident gestures, formal yet approachable',
    audioTone: 'professional voiceover, corporate background music, trustworthy delivery',
    colorGrade: 'professional, corporate colors, white/blue tones, polished finish',
    pacing: 'professional pacing, structured information flow, business tempo',
    cameraAngles: 'corporate headshot, presentation angle, chart/data visualization angles',
    prompt: `Create a corporate presentation scene with:
    - Professional even lighting (broadcast quality)
    - Polished corporate backdrop and framing
    - Professional character posture and gestures
    - Corporate color grading (blues, whites, silvers)
    - Structured, professional pacing
    - Business-ready production aesthetic`
  },

  'Testimonial': {
    name: 'Testimonial',
    cameraStyle: 'sincere conversational, warm lighting, intimate framing, authentic connection',
    characterMovement: 'genuine, sincere expressions, relatable body language, authentic emotion',
    audioTone: 'genuine testimonial voice, warm background, authentic delivery',
    colorGrade: 'warm, welcoming, slightly soft focus, genuine authentic feel',
    pacing: 'natural conversational pacing, allowing genuine emotion',
    cameraAngles: 'close-ups for sincerity, eye contact with camera, intimate framing',
    prompt: `Create a testimonial scene with:
    - Warm, sincere lighting (intimate and welcoming)
    - Close-ups capturing genuine emotion
    - Authentic character expressions and body language
    - Soft, warm color grading for connection
    - Natural conversational pacing
    - Genuine, heartfelt testimonial aesthetic`
  },

  'Product Showcase': {
    name: 'Product Showcase',
    cameraStyle: 'luxury product showcase, premium lighting, detailed close-ups, luxury aesthetic',
    characterMovement: 'elegant product handling, refined gestures, luxury product presentation',
    audioTone: 'sophisticated voiceover, premium background score, luxury positioning',
    colorGrade: 'premium colors, luxury tones (blacks, golds), sophisticated palette',
    pacing: 'measured luxury pacing, emphasizing product beauty and details',
    cameraAngles: '360-degree product rotation, macro detail shots, luxury lifestyle context',
    prompt: `Create a product showcase scene with:
    - Premium luxury lighting (studio-quality highlights)
    - Close-up detail shots showing craftsmanship
    - Elegant product handling and presentation
    - Luxury color palette (blacks, golds, silvers)
    - Measured pacing emphasizing product beauty
    - High-end luxury product showcase aesthetic`
  },

  'News Update': {
    name: 'News Update',
    cameraStyle: 'news broadcast style, professional lighting, news studio aesthetic, clear framing',
    characterMovement: 'news anchor professionalism, clear delivery, authoritative presence',
    audioTone: 'news anchor voice, broadcast-quality narration, news theme music',
    colorGrade: 'broadcast professional, neutral tones, news graphics integration',
    pacing: 'news broadcast pacing, information-focused, authoritative delivery',
    cameraAngles: 'news desk angle, interview framing, news graphic overlays',
    prompt: `Create a news update scene with:
    - Professional news studio lighting
    - News desk or broadcast backdrop
    - Authoritative character presence and professionalism
    - Professional news color grading
    - News broadcast pacing and information flow
    - Professional broadcast news aesthetic`
  },

  'Social Media Reel': {
    name: 'Social Media Reel',
    cameraStyle: 'viral social media, dynamic, trending style, quick cuts, phone-optimized vertical',
    characterMovement: 'trendy movements, engaging gestures, viral-worthy actions, entertaining',
    audioTone: 'trending audio, catchy sounds, viral-style music, entertainment-focused',
    colorGrade: 'vibrant, trendy, saturated, social media aesthetic, eye-catching',
    pacing: 'fast-paced, quick cuts, attention-grabbing, scroll-stopping transitions',
    cameraAngles: 'vertical phone framing, quick pans, trending shot types, dynamic composition',
    prompt: `Create a social media reel scene with:
    - Vibrant, eye-catching colors (trending aesthetic)
    - Fast-paced dynamic shots with quick transitions
    - Entertaining, engaging character movements
    - Vertical phone-optimized framing
    - Viral-worthy composition and energy
    - Trending social media production style`
  },

  'Luxury Advertisement': {
    name: 'Luxury Advertisement',
    cameraStyle: 'ultra-luxury cinema, premium lighting, artistic framing, exclusive aesthetic',
    characterMovement: 'luxury lifestyle movements, refined elegance, exclusive positioning',
    audioTone: 'luxury voiceover, high-end classical/modern music, exclusive atmosphere',
    colorGrade: 'luxurious tones, selective color, premium blacks, gold accents, sophisticated',
    pacing: 'slow, luxurious, contemplative, allowing appreciation of details',
    cameraAngles: 'wide luxury lifestyle shots, intimate luxury details, artistic composition',
    prompt: `Create a luxury advertisement scene with:
    - Ultra-premium lighting (high-end studio quality)
    - Artistic, sophisticated composition
    - Exclusive luxury lifestyle setting
    - Premium color palette (blacks, golds, jewel tones)
    - Slow, contemplative pacing for appreciation
    - Ultra-luxury, exclusive production aesthetic`
  }
};

/**
 * Generate optimized prompts for image, video, and audio
 * Based on video style and user description
 */
const generateStyledPrompts = (userDescription, videoStyle, characterName, productName = null) => {
  const style = styleDefinitions[videoStyle] || styleDefinitions['Cinematic Commercial'];
  
  if (!style) {
    throw new Error(`Video style "${videoStyle}" not found`);
  }

  console.log(`\n🎬 PROMPT ENGINEERING: ${videoStyle}`);
  console.log(`   Description: ${userDescription}`);
  console.log(`   Character: ${characterName}`);
  if (productName) console.log(`   Product: ${productName}`);

  // IMAGE PROMPT - Focused on visual composition
  const imagePrompt = `${style.prompt}

Scene Context: ${userDescription}
Character: ${characterName}${productName ? ` (with ${productName})` : ''}

Visual Requirements:
- ${style.cameraStyle}
- ${style.colorGrade}
- Lighting: ${style.audioTone.split(',')[0]}
- Character Movement: ${style.characterMovement}
- Overall Mood: ${style.name} aesthetic

Technical: Professional quality, high resolution, perfect for video production.`;

  // VIDEO PROMPT - Focused on motion and dynamics
  const videoPrompt = `${userDescription}

Motion Direction for ${videoStyle}:
- Camera Movement: ${style.pacing}
- Character Actions: ${style.characterMovement}
- Dynamic Elements: ${style.cameraAngles}

Production Style: ${style.name}
- Lighting Mood: ${style.colorGrade}
- Pacing: ${style.pacing}
- Emotion/Energy: Inspired by ${style.audioTone}

Keep the character (${characterName})${productName ? ` interacting with ${productName}` : ''} at the center of action.
Generate smooth, professional video with natural transitions.`;

  // AUDIO PROMPT - Focused on sound design and voiceover
  const audioPrompt = `Create audio for a ${videoStyle} scene:

Voiceover Style: ${style.audioTone}
Content: ${userDescription}
Character Representation: ${characterName}${productName ? ` + ${productName} context` : ''}

Audio Components:
1. VOICEOVER:
   - Tone: ${style.audioTone}
   - Delivery: ${style.characterMovement}
   - Pacing: ${style.pacing}

2. BACKGROUND MUSIC:
   - Genre: Matching ${videoStyle} aesthetic
   - Mood: ${style.colorGrade}
   - Intensity: ${style.pacing.includes('dynamic') ? 'High' : style.pacing.includes('slow') ? 'Low' : 'Medium'}

3. SOUND DESIGN:
   - Ambient sounds reflecting ${videoStyle}
   - Environmental audio matching ${userDescription}
   - Production quality: Professional broadcast

Overall: ${style.audioTone}`;

  return {
    imagePrompt,
    videoPrompt,
    audioPrompt,
    style: style.name,
    cameraDirections: {
      angles: style.cameraAngles,
      lighting: style.colorGrade,
      movement: style.pacing,
      characterActions: style.characterMovement
    }
  };
};

/**
 * Generate multiple scene variations for a video
 * Creates prompts for each scene in the storyboard
 */
const generateScenePrompts = (userDescription, videoStyle, characterName, sceneCount, productName = null) => {
  const style = styleDefinitions[videoStyle] || styleDefinitions['Cinematic Commercial'];
  
  const sceneTypes = getSceneTypes(videoStyle, sceneCount);
  const scenes = [];

  for (let i = 0; i < sceneCount; i++) {
    const sceneType = sceneTypes[i];
    
    const imagePrompt = `[${videoStyle} - Scene ${i + 1}] ${sceneType.description}

${style.prompt}

Specific Scene Details:
- Scene Type: ${sceneType.type}
- Setting: ${sceneType.setting}
- Focus: ${sceneType.focus}
- Character State: ${sceneType.characterState}
- Context: ${userDescription}

Visual Style:
- Cinematography: ${style.cameraStyle}
- Color Grade: ${style.colorGrade}
- Lighting: ${sceneType.lighting}
- Composition: ${sceneType.composition}

Character: ${characterName} - ${sceneType.characterAction}
${productName ? `Product Focus: ${sceneType.productFocus || 'Naturally integrated'}` : ''}`;

    const videoPrompt = `Motion Design for ${videoStyle} - Scene ${i + 1}:

Description: ${sceneType.description}
Action: ${sceneType.characterAction}
Movement Type: ${sceneType.movement}

${style.name} Style:
- Pacing: ${style.pacing}
- Camera Movement: ${style.cameraAngles}
- Character Motion: ${style.characterMovement}
- Dynamics: ${sceneType.dynamics}

Duration: ~${Math.ceil(((i + 1) / sceneCount) * 100) - Math.ceil((i / sceneCount) * 100)} seconds of total video
Keep character (${characterName}) engaged and expressive.`;

    scenes.push({
      sceneNumber: i + 1,
      sceneType: sceneType.type,
      setting: sceneType.setting,
      imagePrompt,
      videoPrompt,
      audioStyle: `${videoStyle} - ${sceneType.type}`,
      duration: sceneType.duration,
      emphasis: sceneType.emphasis
    });
  }

  return scenes;
};

/**
 * Determine scene types based on video style
 */
const getSceneTypes = (videoStyle, sceneCount) => {
  const sceneTemplates = {
    'Cinematic Commercial': [
      { type: 'Opening Hook', description: 'Cinematic introduction with dramatic lighting', setting: 'premium environment', focus: 'character introduction', characterState: 'intriguing, mysterious', lighting: 'dramatic 3-point with shadows', composition: 'wide establishing shot', characterAction: 'makes eye contact or enigmatic gesture', movement: 'slow confident walk or pause', dynamics: 'slow push-in camera', duration: 4, emphasis: 'establish brand identity', productFocus: 'hint at product benefit' },
      { type: 'Problem Insight', description: 'Show the character\'s challenge or need', setting: 'relatable yet premium', focus: 'emotional connection', characterState: 'thoughtful, considering', lighting: 'warm spotlight on character', composition: 'close-up with depth of field', characterAction: 'shows concern or realization', movement: 'subtle hand gestures, head tilt', dynamics: 'slow dolly with slight pan', duration: 5, emphasis: 'build emotional connection', productFocus: 'subtle problem hint' },
      { type: 'Product Introduction', description: 'Introduce the solution with impact', setting: 'product showcase space', focus: 'product and character reaction', characterState: 'discovering, impressed', lighting: 'hero lighting on product', composition: '360 product reveal', characterAction: 'reaches for or examines product', movement: 'natural product interaction', dynamics: 'dramatic reveal with lighting', duration: 5, emphasis: 'product star moment', productFocus: 'center stage' },
      { type: 'Benefit Demonstration', description: 'Show product benefits in action', setting: 'lifestyle context', focus: 'product in use', characterState: 'satisfied, confident', lighting: 'natural lifestyle lighting', composition: 'product in environment', characterAction: 'uses product naturally', movement: 'flowing action sequence', dynamics: 'dynamic cuts showcasing benefits', duration: 5, emphasis: 'prove value', productFocus: 'hero of action' },
      { type: 'Call to Action', description: 'Powerful closing statement', setting: 'premium final shot', focus: 'character with product', characterState: 'confident, satisfied', lighting: 'cinematic closing light', composition: 'hero shot with product', characterAction: 'confident smile or gesture toward camera', movement: 'held pose or final emphasis move', dynamics: 'slow final push-in', duration: 3, emphasis: 'brand recall and CTA', productFocus: 'integrated lifestyle' }
    ],

    'Storytelling': [
      { type: 'Setting & Context', description: 'Establish the story world', setting: 'meaningful location', focus: 'environment and character', characterState: 'curious, present', lighting: 'natural warm lighting', composition: 'wide establishing shot', characterAction: 'looks around or enters space', movement: 'walking with purpose', dynamics: 'reveal the environment', duration: 4, emphasis: 'build immersion', productFocus: 'background element' },
      { type: 'Character Introduction', description: 'Introduce character and their journey', setting: 'intimate character space', focus: 'close character moments', characterState: 'authentic, relatable', lighting: 'warm close-up lighting', composition: 'facial close-ups', characterAction: 'authentic expression, thought', movement: 'natural subtle movements', dynamics: 'emotional close-ups', duration: 5, emphasis: 'emotional connection', productFocus: 'personal item' },
      { type: 'Rising Action', description: 'Build tension or engagement', setting: 'dynamic story location', focus: 'character progression', characterState: 'engaged, growing', lighting: 'dynamic based on mood', composition: 'varied framing', characterAction: 'active story engagement', movement: 'purposeful progression', dynamics: 'building momentum', duration: 5, emphasis: 'narrative progression', productFocus: 'supporting role' },
      { type: 'Climax/Revelation', description: 'Peak emotional moment', setting: 'powerful location', focus: 'character reaction', characterState: 'surprised, moved', lighting: 'impactful emotional lighting', composition: 'intense framing', characterAction: 'strong emotional response', movement: 'powerful gesture or realization', dynamics: 'dramatic moment', duration: 5, emphasis: 'memorable peak', productFocus: 'supporting climax' },
      { type: 'Resolution/Reflection', description: 'Closure and meaning', setting: 'reflective space', focus: 'character wisdom', characterState: 'peaceful, fulfilled', lighting: 'soft reflective light', composition: 'intimate wide shot', characterAction: 'looks toward future or smiles', movement: 'calm reflective pose', dynamics: 'contemplative final moment', duration: 3, emphasis: 'emotional resolution', productFocus: 'integrated learning' }
    ],

    'Product Advertisement': [
      { type: 'Problem Statement', description: 'Show the problem clearly', setting: 'everyday scenario', focus: 'problem visualization', characterState: 'frustrated or lacking', lighting: 'bright revealing light', composition: 'clear problem display', characterAction: 'demonstrates problem', movement: 'frustrated or seeking gestures', dynamics: 'quick revealing cuts', duration: 3, emphasis: 'problem clarity', productFocus: 'none yet' },
      { type: 'Product Hero Shot', description: 'Dramatic product introduction', setting: 'product showcase space', focus: '360 product reveal', characterState: 'discovering', lighting: 'bright product spotlight', composition: 'rotating product view', characterAction: 'reaches for or unboxes', movement: 'smooth reveal motion', dynamics: 'dramatic 360 spin or reveal', duration: 4, emphasis: 'product star', productFocus: 'hero lighting' },
      { type: 'Features Showcase', description: 'Show key features in action', setting: 'lifestyle settings', focus: 'product features', characterState: 'impressed, confident', lighting: 'bright lifestyle light', composition: 'feature-focused angles', characterAction: 'uses features naturally', movement: 'quick dynamic actions', dynamics: 'cuts between features', duration: 5, emphasis: 'feature highlights', productFocus: 'close-up details' },
      { type: 'Benefit Proof', description: 'Show the result/transformation', setting: 'success scenario', focus: 'before-after or success', characterState: 'satisfied, happy', lighting: 'warm success lighting', composition: 'results celebration', characterAction: 'shows satisfaction', movement: 'celebratory or confident', dynamics: 'uplifting transitions', duration: 4, emphasis: 'transformation proof', productFocus: 'integrated benefit' },
      { type: 'Call to Action', description: 'Strong finishing statement', setting: 'branded final shot', focus: 'product + CTA message', characterState: 'confident recommendation', lighting: 'clean bright light', composition: 'product with messaging', characterAction: 'points to product or speaks directly', movement: 'confident gesture', dynamics: 'final emphasis', duration: 3, emphasis: 'purchase motivation', productFocus: 'full product with branding' }
    ],

    'Daily Life Vlog': [
      { type: 'Opening Vibe', description: 'Set casual daily mood', setting: 'everyday location', focus: 'vibe and energy', characterState: 'casual, relatable', lighting: 'natural daylight', composition: 'casual framing', characterAction: 'natural greeting or activity start', movement: 'casual natural walk', dynamics: 'casual handheld feel', duration: 3, emphasis: 'relatable opening', productFocus: 'background if at all' },
      { type: 'Activity Sequence', description: 'Show main daily activity', setting: 'activity space', focus: 'what they\'re doing', characterState: 'engaged in activity', lighting: 'natural ambient', composition: 'activity-focused', characterAction: 'performs activity', movement: 'natural activity movements', dynamics: 'vlog-style coverage', duration: 6, emphasis: 'activity showcase', productFocus: 'if relevant to activity' },
      { type: 'Interaction Moment', description: 'Interaction or dialogue', setting: 'relatable setting', focus: 'interaction and chemistry', characterState: 'social, friendly', lighting: 'natural social lighting', composition: 'conversational framing', characterAction: 'talks or interacts', movement: 'natural social gestures', dynamics: 'dialogue and reaction', duration: 5, emphasis: 'connection', productFocus: 'natural integration' },
      { type: 'Daily Experience', description: 'Show experience or emotion', setting: 'experiential space', focus: 'feeling of moment', characterState: 'authentic reaction', lighting: 'natural mixed lighting', composition: 'moment capture', characterAction: 'reacts authentically', movement: 'genuine spontaneous moves', dynamics: 'authentic documentation', duration: 5, emphasis: 'authentic moment', productFocus: 'supporting role' },
      { type: 'Closing Reflection', description: 'Wrap up day/thought', setting: 'casual reflection space', focus: 'ending vibe', characterState: 'satisfied, ready for next', lighting: 'natural farewell light', composition: 'casual goodbye framing', characterAction: 'signs off or smiles', movement: 'casual farewell gesture', dynamics: 'warm closing', duration: 3, emphasis: 'connection goodbye', productFocus: 'subtle if relevant' }
    ],

    'Motivational': [
      { type: 'Current State', description: 'Show starting point or challenge', setting: 'relatable struggle space', focus: 'current reality', characterState: 'determined, focused', lighting: 'powerful low-key light', composition: 'empowering angle', characterAction: 'faces camera or looks forward', movement: 'powerful standing pose', dynamics: 'low angle power shot', duration: 4, emphasis: 'relate to struggle', productFocus: 'none' },
      { type: 'Realization Moment', description: 'The turning point inspiration', setting: 'illuminated space', focus: 'moment of clarity', characterState: 'awakening, inspired', lighting: 'breakthrough lighting', composition: 'opening composition', characterAction: 'realizes or looks up', movement: 'rising motion', dynamics: 'inspiring light reveal', duration: 4, emphasis: 'inspiration spark', productFocus: 'motivation source' },
      { type: 'Action & Commitment', description: 'Taking steps forward', setting: 'active space', focus: 'determined action', characterState: 'committed, energized', lighting: 'powerful forward lighting', composition: 'action composition', characterAction: 'moves forward with purpose', movement: 'powerful forward motion', dynamics: 'momentum building', duration: 5, emphasis: 'action taking', productFocus: 'support for journey' },
      { type: 'Progress & Growth', description: 'Show evolution and improvement', setting: 'growth space', focus: 'progress visualization', characterState: 'growing stronger', lighting: 'uplifting lighting', composition: 'ascending composition', characterAction: 'demonstrates strength/capability', movement: 'powerful uplifting moves', dynamics: 'building intensity', duration: 5, emphasis: 'transformation', productFocus: 'enabler of growth' },
      { type: 'Peak Achievement', description: 'Powerful finish and inspiration', setting: 'peak location', focus: 'ultimate achievement', characterState: 'triumphant, inspired', lighting: 'golden triumph light', composition: 'hero composition', characterAction: 'powerful triumphant pose', movement: 'celebratory powerful stance', dynamics: 'inspiring finale', duration: 4, emphasis: 'peak inspiration', productFocus: 'success integration' }
    ]
  };

  if (!sceneTemplates[videoStyle]) {
    return Array.from({ length: sceneCount }, (_, i) => ({
      type: `Scene ${i + 1}`,
      description: `Scene ${i + 1} of ${videoStyle}`,
      setting: 'professional setting',
      focus: 'content delivery',
      characterState: 'professional',
      lighting: 'professional studio lighting',
      composition: 'professional framing',
      characterAction: 'engages with content',
      movement: 'professional movement',
      dynamics: 'smooth professional transitions',
      duration: Math.ceil(30 / sceneCount),
      emphasis: 'professional delivery',
      productFocus: 'natural integration'
    }));
  }

  const templates = sceneTemplates[videoStyle];
  const scenes = [];
  
  for (let i = 0; i < sceneCount; i++) {
    const templateIndex = Math.min(i, templates.length - 1);
    scenes.push({
      ...templates[templateIndex],
      sceneNumber: i + 1
    });
  }

  return scenes;
};

module.exports = {
  styleDefinitions,
  generateStyledPrompts,
  generateScenePrompts,
  getSceneTypes
};
