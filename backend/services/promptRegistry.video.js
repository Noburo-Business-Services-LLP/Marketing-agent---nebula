/**
 * Prompts used by the video pipeline.
 *
 * Split out of promptRegistry.js purely for size — these are large, and
 * keeping them here leaves the main registry readable. Same contract:
 * prose plus {{placeholders}}, with every value precomputed by the caller.
 */

module.exports = {
  'video.story': {
    label: "Video story & storyboard",
    summary: "Turns an approved concept into the script and scene-by-scene storyboard. Change this if the story arc or pacing is wrong.",
    stage: 'video',
    variables: {
      name: "Value of profile?.name || 'N/A'",
      industry: "Value of profile?.industry || 'N/A'",
      targetAudience: "Value of profile?.targetAudience || 'General audience'",
      brandToneFromProfile: "Value of brandToneFromProfile",
      brandSummary: "Value of brandSummary || 'N/A'",
      description: "Value of input.description",
      durationSeconds: "Value of input.durationSeconds",
      sceneCount: "Value of sceneCount",
      wordTarget: "Value of Math.round(input.durationSeconds * 2)",
      videoStyleContext: "Value of videoStyleContext",
      characterContext: "Value of characterContext"
    },
    template: `You are an award-winning Creative Director and Film Director.
You have written commercials across every tier — cinematic luxury films for jewellery and premium brands, warm family stories for traditional shops, kinetic D2C reels, corporate confidence pieces, playful food & lifestyle content.

The creative concept has already been approved.
Your job is to convert it into a production-ready commercial SCRIPT + STORYBOARD that matches THIS brand's tone — not a one-size-fits-all luxury film.

═══════════════════════════════════════
BRAND DETAILS
Business Name: {{name}}
Industry: {{industry}}
Target Audience: {{targetAudience}}
Brand Tone: {{brandToneFromProfile}}
Brand Summary: {{brandSummary}}
═══════════════════════════════════════
APPROVED CONCEPT
{{description}}
═══════════════════════════════════════
OBJECTIVE
Expand this concept into a commercial that emotionally connects with the audience BEFORE introducing the brand.
The audience should remember the feeling first, and the brand second.
Avoid direct selling. Avoid explaining the product. Show emotions instead of information.

TIER-ADAPTIVE VOICE (match the brand — do NOT force luxury polish on a casual brand):
- Premium / Luxury → cinematic restraint, poetic narration, slow reveal
- Traditional / Family → warm authenticity, everyday moments, honest voice
- Playful / D2C / Reel-first → kinetic energy, punchy lines, humor when fitting
- Corporate / SaaS / Professional → calm confidence, clarity, credibility
- Food / Lifestyle / Local → sensory, casual, close to the customer

═══════════════════════════════════════
Create the following in order — every text field MUST be elaborated (multi-sentence, production-ready), NEVER single-line placeholders.

## 1. STORY ARC (six beats)
Write each beat as 2-4 rich sentences. This is the shooting bible.
• hook — the first 3-5 seconds that earn attention (curiosity or emotional pull)
• beginning — how we enter the world of the story
• emotionalProgression — how feeling builds through the middle
• climax — the peak emotional moment
• brandReveal — how the brand appears naturally (never leading, never salesy)
• ending — the final image + line the viewer will remember

Constraints: Maximum duration {{durationSeconds}} seconds. Maximum scenes {{sceneCount}}. Every scene must flow naturally to the next.

## 2. VOICEOVER SCRIPT
Write the full narration as ONE continuous string, ready to paste into ElevenLabs.
This is SPOKEN language — not scene descriptions, not stage directions, not visual summaries.
The voiceover must add something the visuals cannot:
• A feeling the picture alone cannot deliver
• A thought that reframes what the viewer is seeing
• A memory or emotion the viewer connects to

STYLE
- Sounds like a real human speaking, not a narrator reading a script
- Rhythmic — sentences of varying length, natural pauses
- Concrete words, not marketing abstractions ("evening light" not "premium ambience")
- If Brand Tone is Luxury → poetic restraint; Traditional → warm honesty; Playful → punchy wit; Corporate → calm confidence

RULES
• Target {{wordTarget}} words (±10%) for {{durationSeconds}} seconds at natural pace
• Use \\\\n between sentences for natural spoken pauses — do NOT run everything into one paragraph
• DO NOT describe what the camera sees — the visual scene already shows it
• DO NOT paraphrase the visualDescription of each scene — that's a different job
• DO NOT mention the product unnecessarily
• End with a memorable brand line

CRITICAL: The voiceover MUST be distinct from the scene visualDescriptions. If your voiceover reads like a list of what's on screen ("A chair sways… tables join in… the room fills…"), you have failed. Rewrite it as something a real person would SAY that adds emotional meaning ON TOP of what the viewer already sees.

## 3. SCENE BREAKDOWN (per scene — every field required, all elaborated)
For every scene fill ALL 12 fields:
1. sceneNumber — 1, 2, 3…
2. title — a specific, story-driven title (NOT "Opening Hook" or "Scene 1")
3. purpose — 2-3 sentences on why this scene exists in the arc and what it must land emotionally
4. charactersRequired — array of character IDs from the approved cast (e.g. ["01", "02"]) or a plain-language list of who is on camera
5. location — specific location or set description (2-3 sentences)
6. visualDescription — 3-5 sentences of what the camera SEES: subjects, environment, lighting, mood, color palette, hero moment
7. emotion — the ONE dominant emotion of this scene (single phrase, e.g. "quiet nostalgia", "electric joy", "reverent stillness")
8. cameraAngle — specific angle (e.g. "low-angle hero shot", "over-the-shoulder", "eye-level close-up")
9. cameraMovement — specific movement (e.g. "slow dolly in", "handheld sway", "static hold with rack focus")
10. durationSeconds — integer seconds
11. scriptLine — the exact spoken narration line for THIS scene (from part 2's voiceover, split naturally)
12. transitionToNext — how this scene resolves into the next (e.g. "hard cut on the sound of…", "slow crossfade to…")

═══════════════════════════════════════
CREATIVE RULES (must all be true before you return)
✓ First 5 seconds create curiosity or emotional pull
✓ Every scene moves the story forward — cut any filler
✓ Every scene has ONE dominant emotion
✓ The product is never the hero — the story is
✓ Brand appears naturally near the end
✓ Ending feels memorable — the viewer replays it in their head
✓ Audience feels something BEFORE seeing the logo
✓ Tone matches this brand's actual tier — not a generic luxury film
Rewrite any scene that feels generic or filler before returning.
{{videoStyleContext}}{{characterContext}}
═══════════════════════════════════════
OUTPUT FORMAT — STRICT JSON ONLY (no markdown, no code fences, no prose outside JSON)
{
  "story": {
    "hook": "2-4 sentence hook description",
    "beginning": "2-4 sentence beginning",
    "emotionalProgression": "2-4 sentence middle build",
    "climax": "2-3 sentence climax",
    "brandReveal": "2-3 sentence brand reveal moment",
    "ending": "2-3 sentence ending"
  },
  "voiceScript": "The full narration as ONE string, using \\\\n for natural pauses between lines. Directly ElevenLabs-ready.",
  "globalVisualStyle": "One paragraph describing the cinematography direction that applies to every scene",
  "thumbnailPrompt": "One paragraph describing the strongest single frame for the thumbnail",
  "scenes": [
    {
      "sceneNumber": 1,
      "title": "specific story-driven title",
      "purpose": "2-3 sentence purpose",
      "charactersRequired": ["01", "02"],
      "location": "2-3 sentence location description",
      "visualDescription": "3-5 sentence detailed visual description",
      "emotion": "one dominant emotion phrase",
      "cameraAngle": "specific angle",
      "cameraMovement": "specific movement",
      "durationSeconds": 4,
      "scriptLine": "the exact line spoken in this scene",
      "onScreenText": "optional short caption or empty string",
      "transitionToNext": "how this scene ends and flows into the next",
      "voiceLine": "same as scriptLine — kept for backwards compat with downstream steps",
      "imagePrompt": "photoreal single-frame image prompt combining visualDescription + cameraAngle + character continuity + mood — used by the image generator",
      "videoPrompt": "motion-only spec (camera movement + character movement + environmental motion) — used by the video generator, do NOT repeat visualDescription"
    }
  ]
}

Priority Order (Highest → Lowest): Character Identity Rules, Character Reference Image, Character Usage Rules, Video Style Rules, Approved Concept, Brand Details, AI Creativity. Never violate a higher-priority rule to satisfy a lower one.
You MUST return exactly {{sceneCount}} scenes.
Every scene must be suitable for 9:16 vertical video.

═══════════════════════════════════════
FIELD REQUIREMENTS — NON-NEGOTIABLE
Every scene object MUST contain ALL of these fields, elaborated to production quality. Omitting ANY of these will cause the response to be REJECTED and you will be asked to regenerate.

For each scene:
1. sceneNumber — integer
2. title — a specific, story-driven title (NOT "Opening Hook")
3. purpose — 2-3 sentences on why this scene exists in the arc
4. charactersRequired — array of character IDs (["01"], ["01","02"], or [] if none)
5. location — 1-2 sentences describing the specific place
6. visualDescription — 3-5 sentences describing what the camera sees (subjects, lighting, color, mood)
7. emotion — a 2-4 word phrase naming the ONE dominant feeling (e.g. "quiet reverence", "electric joy")
8. cameraAngle — e.g. "low-angle hero shot", "over-the-shoulder", "eye-level close-up"
9. cameraMovement — e.g. "slow dolly in", "handheld sway", "static hold with rack focus"
10. durationSeconds — integer
11. scriptLine — the exact spoken line for this scene (from the voiceover, split naturally)
12. onScreenText — a caption if any, or empty string ""
13. transitionToNext — 1 sentence on how this scene resolves into the next
14. imagePrompt — auto-derivable, still required as a rich sentence
15. videoPrompt — auto-derivable, still required as a motion-only sentence

CONCRETE EXAMPLE of a fully-filled scene (for reference only — do NOT copy the content, only the level of detail):
{
  "sceneNumber": 1,
  "title": "The Quiet Before Dawn",
  "purpose": "This scene opens the film with stillness so the viewer leans in. It plants the emotional key of memory that the rest of the arc will build on. Without curiosity here, no one stays for scene 2.",
  "charactersRequired": ["01"],
  "location": "An old wooden home interior at 5 AM, one lamp still on from the night before, a saree draped over the back of a chair.",
  "visualDescription": "A single warm lamp glows in a dim living room. Dust motes drift in its beam. A woman in her sixties sits half-facing the window, her hands folded in her lap. The palette is warm ochre, brown wood, and one thin sliver of pre-dawn blue from the window. Everything is very still.",
  "emotion": "quiet reverence",
  "cameraAngle": "low eye-level, framing her from the side",
  "cameraMovement": "slow 4-second dolly in from 3m to 1.5m",
  "durationSeconds": 4,
  "scriptLine": "There are moments before the world wakes up.",
  "onScreenText": "",
  "transitionToNext": "The lamp flickers off as morning light rises — a soft crossfade into scene 2.",
  "imagePrompt": "Cinematic still: 60-year-old South Indian woman in warm ochre living room, single lamp glow, dust motes in beam, low eye-level side framing, ochre and brown palette, sliver of pre-dawn blue from window, hyperreal skin detail, shallow depth of field, 35mm anamorphic look.",
  "videoPrompt": "Slow 4-second dolly-in from 3m to 1.5m. Subject remains still — only her breath and one blink. Lamp glow flickers once at the end signalling transition."
}

Every scene in your output must match THIS level of detail — no exceptions.
Do not include any text outside the JSON object.`
  },

  'video.storyboard': {
    label: "Video story beats",
    summary: "Writes the story beats and the scene skeleton the rest of the video is built from.",
    stage: 'video',
    variables: {
      name: "Value of profile?.name || 'N/A'",
      industry: "Value of profile?.industry || 'N/A'",
      targetAudience: "Value of profile?.targetAudience || 'General audience'",
      brandToneFromProfile: "Value of brandToneFromProfile",
      brandSummary: "Value of brandSummary || 'N/A'",
      description: "Value of input.description",
      characterBibleBlock: "Value of characterBibleBlock",
      durationSeconds: "Value of input.durationSeconds",
      sceneCount: "Value of sceneCount",
      block10: "Value of durations.join(', ')",
      voiceLanguageDirective: "Value of voiceLanguageDirective",
      environmentDirective: "Value of environmentDirective",
      block13: "Value of Math.round(input.durationSeconds * 2)",
      targetLangLabel: "Value of targetLangLabel",
      targetScript: "Value of targetScript",
      block16: "Value of durations[0] || 3",
      block17: "Value of durations[1] || 3",
      block18: "Value of durations[2] || 3",
      block19: "Value of characters && characters.length >= 2 ? JSON.stringify(characters.slice"
    },
    template: `You are an award-winning Creative Director and Film Director.
Build the STORY ARC + VOICEOVER + SCENE SKELETON for this brand's commercial.
Individual scenes will be elaborated in follow-up calls — for now you only need to plan the shape.

BRAND DETAILS
Business Name: {{name}}
Industry: {{industry}}
Target Audience: {{targetAudience}}
Brand Tone: {{brandToneFromProfile}}
Brand Summary: {{brandSummary}}

APPROVED CONCEPT
{{description}}
{{characterBibleBlock}}

VIDEO SPEC
Total duration: {{durationSeconds}} seconds
Scene count: {{sceneCount}}
Suggested per-scene durations (seconds): [{{block10}}]

VOICEOVER LANGUAGE — MANDATORY
{{voiceLanguageDirective}}
{{environmentDirective}}

OUTPUT FORMAT — STRICT JSON ONLY:
{
  "story": {
    "hook": "2-4 sentence hook — first 3-5 seconds",
    "beginning": "2-4 sentences",
    "emotionalProgression": "2-4 sentences",
    "climax": "2-3 sentences",
    "brandReveal": "2-3 sentences",
    "ending": "2-3 sentences"
  },
  "voiceScript": "Full narration as ONE string, ~{{block13}} words, \\\\n between spoken sentences. Written DIRECTLY in {{targetLangLabel}} ({{targetScript}} script) — not English. This is SPOKEN language — feelings and thoughts, not scene descriptions.",
  "globalVisualStyle": "One paragraph on the cinematography direction that applies to every scene",
  "thumbnailPrompt": "One paragraph on the strongest single frame for the thumbnail",
  "scenes": [
    {
      "sceneNumber": 1,
      "title": "Specific, story-driven scene title (NOT 'Opening Hook')",
      "durationSeconds": {{block16}},
      "purpose": "2-3 sentences on why this scene exists in the arc",
      "charactersRequired": ["01"]              // solo intimate moment
    },
    {
      "sceneNumber": 2,
      "title": "...",
      "durationSeconds": {{block17}},
      "purpose": "...",
      "charactersRequired": []                  // atmospheric / product shot, no humans
    },
    {
      "sceneNumber": 3,
      "title": "...",
      "durationSeconds": {{block18}},
      "purpose": "...",
      "charactersRequired": {{block19}}   // conversation between two
    }
    // ... continue for all {{sceneCount}} scenes. Vary casting BY WHAT THE SCENE NEEDS.
    // Empty array [] is fine and often right for product / environment / atmospheric shots.
    // Multi-character arrays are right when the story beat is inherently social.
  ]
}

Rules:
- Match the brand tone ({{brandToneFromProfile}}) — do NOT default to poetic luxury unless the tone is Luxury.
- Voiceover must NOT paraphrase the visual descriptions — it should add emotional meaning ON TOP of what the viewer will see.
- Scene titles must be specific and story-driven, not generic.
- Return exactly {{sceneCount}} scenes.
- charactersRequired in each scene must reference character IDs from the APPROVED CHARACTER CAST above (or empty [] if the scene has no people).`
  },

  'video.scene': {
    label: "Video scene detail",
    summary: "Expands one scene of the storyboard into full production detail. Change this if individual scenes feel thin or repetitive.",
    stage: 'video',
    variables: {
      name: "Value of profile?.name || 'N/A'",
      industry: "Value of profile?.industry || 'N/A'",
      brandToneFromProfile: "Value of brandToneFromProfile",
      hook: "Value of story?.hook || ''",
      beginning: "Value of story?.beginning || ''",
      emotionalProgression: "Value of story?.emotionalProgression || ''",
      climax: "Value of story?.climax || ''",
      brandReveal: "Value of story?.brandReveal || ''",
      ending: "Value of story?.ending || ''",
      voiceScript: "Value of voiceScript || '(none)'",
      globalVisualStyle: "Value of globalVisualStyle || 'Cinematic vertical commercial'",
      characterBibleBlock: "Value of characterBibleBlock",
      block13: "Value of previousScenesSummary ? 'PREVIOUS SCENES (already elaborated \u2014 keep co",
      sceneNumber: "Value of currentSceneSkeleton.sceneNumber",
      title: "Value of currentSceneSkeleton.title",
      durationSeconds: "Value of currentSceneSkeleton.durationSeconds",
      purpose: "Value of currentSceneSkeleton.purpose",
      block18: "Value of JSON.stringify(currentSceneSkeleton.charactersRequired || [])",
      environmentDirective: "Value of environmentDirective",
      block20: "Value of (currentSceneSkeleton.charactersRequired || []).length > 1 ? 'The skel"
    },
    template: `You are elaborating ONE scene of an already-planned commercial into full production detail.

BRAND
Business: {{name}} · {{industry}} · Tone: {{brandToneFromProfile}}

APPROVED STORY ARC
Hook: {{hook}}
Beginning: {{beginning}}
Emotional Progression: {{emotionalProgression}}
Climax: {{climax}}
Brand Reveal: {{brandReveal}}
Ending: {{ending}}

FULL VOICEOVER (already written)
{{voiceScript}}

GLOBAL VISUAL STYLE
{{globalVisualStyle}}
{{characterBibleBlock}}

{{block13}}

THIS SCENE TO ELABORATE
Scene {{sceneNumber}}: "{{title}}"
Duration: {{durationSeconds}}s
Purpose: {{purpose}}
Skeleton charactersRequired: {{block18}}
{{environmentDirective}}

FILL EVERY FIELD BELOW. Do NOT skip any. Return STRICT JSON only:
{
  "sceneNumber": {{sceneNumber}},
  "title": "{{title}}",
  "durationSeconds": {{durationSeconds}},
  "purpose": "2-3 elaborated sentences on why this scene exists",
  "charactersRequired": ["01"],
  "location": "1-2 sentence specific location / set description",
  "visualDescription": "3-5 sentences on what the camera SEES — MUST name the specific character(s) present by name and role (from the CHARACTERS APPEARING block above), what they are doing, how they look, the lighting, palette, mood.",
  "emotion": "2-4 word phrase for the ONE dominant feeling (e.g. 'quiet reverence')",
  "cameraAngle": "specific angle (e.g. 'low-angle hero shot', 'eye-level close-up')",
  "cameraMovement": "specific movement (e.g. 'slow dolly in', 'handheld sway', 'static hold')",
  "scriptLine": "the exact spoken narration line for THIS scene (drawn from the full voiceover above, split naturally)",
  "onScreenText": "optional short caption or empty string",
  "transitionToNext": "1 sentence on how this scene resolves into the next",
  "imagePrompt": "Photoreal single-frame image prompt for Nano Banana. START with 'Use uploaded reference image as primary reference for character faces.' then describe the scene combining visualDescription + cameraAngle + specific character names/ages/wardrobe from the bible above + mood. The characters MUST look identical to the master cast reference.",
  "videoPrompt": "Motion-only spec (camera movement + character movement + environmental motion). Do NOT repeat imagePrompt visuals."
}

Every field required. No empty strings except onScreenText.
charactersRequired MUST match the skeleton exactly ({{block18}}) — do NOT drop any, do NOT invent new IDs, do NOT add characters the skeleton didn't include.
{{block20}}`
  },

  'video.imagePrompt': {
    label: "Video scene images",
    summary: "Writes the image prompt for each scene. Change this if the frames look wrong.",
    stage: 'video',
    variables: {
      referenceClause: "Value of referenceClause",
      name: "Value of profile?.name || 'N/A'",
      industry: "Value of profile?.industry || 'N/A'",
      targetAudience: "Value of profile?.targetAudience || 'General audience'",
      brandToneFromProfile: "Value of brandToneFromProfile",
      characterBlock: "Value of characterBlock",
      globalVisualStyle: "Value of plan?.globalVisualStyle || 'Premium cinematic vertical ad style with c",
      block8: "Value of scenes.map((s, i) => `Scene ${i + 1} \u2014 id: ${s.sceneId} Title: ${s.tit",
      length: "Value of scenes.length"
    },
    template: `You are an Expert AI Image Prompt Engineer for premium commercial ad production.
Using the approved storyboard below, create one premium AI image prompt for every scene.

Each prompt MUST include, in a natural single-paragraph form:
• Character reference IDs (use the same character name across all scenes)
• Character actions
• Facial expressions
• Camera angle (e.g. low angle, over-the-shoulder, close-up, wide establishing shot)
• Lens suggestion (e.g. 35mm, 50mm, 85mm, macro)
• Lighting (e.g. golden hour, softbox, rim light, chiaroscuro)
• Composition (rule of thirds, symmetry, negative space, leading lines)
• Environment
• Product placement (if applicable)
• Cinematic style
• Mood / dominant emotion

Rules:
- Photorealistic, cinematic, commercial quality, production-ready.
- Optimized for GPT Images / Nano Banana / Flux.
- Maintain the same characters, color palette, location logic, and visual style consistency across every scene.
- Do NOT describe motion — this is a still image prompt.
- Do NOT generate images. Only generate production-ready prompts.
- {{referenceClause}}

BRAND CONTEXT
- Business: {{name}}
- Industry: {{industry}}
- Target Audience: {{targetAudience}}
- Brand Tone: {{brandToneFromProfile}}

{{characterBlock}}

GLOBAL VISUAL STYLE (must be consistent across all scenes):
{{globalVisualStyle}}

STORYBOARD SCENES (source material):
{{block8}}

OUTPUT FORMAT — STRICT JSON ONLY
Return ONLY a valid JSON object with this exact schema:
{
  "scenes": [
    { "sceneId": "scene_1", "imagePrompt": "single paragraph string covering all 11 required elements" }
  ]
}
- Return exactly {{length}} scenes in the same sceneId order as above.
- No markdown, no code fences, no text outside the JSON.`
  },

  'video.motionPrompt': {
    label: "Video scene motion",
    summary: "Writes the motion prompt for each scene \u2014 how the camera and subject move.",
    stage: 'video',
    variables: {
      characterMotionBlock: "Value of characterMotionBlock",
      name: "Value of profile?.name || 'N/A'",
      industry: "Value of profile?.industry || 'N/A'",
      brandToneFromProfile: "Value of brandToneFromProfile",
      globalVisualStyle: "Value of plan?.globalVisualStyle || 'Premium cinematic vertical ad style.'",
      block6: "Value of scenes.map((s, i) => `Scene ${i + 1} \u2014 id: ${s.sceneId} Title: ${s.tit",
      length: "Value of scenes.length"
    },
    template: `You are a Professional AI Video Prompt Engineer for premium commercial ad production.
Using the approved storyboard and its generated scene images, create ONE image-to-video prompt for every scene.

Each prompt MUST describe:
• Camera movement (e.g. slow push in, pull out, orbit shot, tracking shot, handheld realism, subtle dolly, static)
• Character movement (natural gestures, small posture shifts — no exaggerated motion)
• Facial movement (subtle expression shifts only — no morphing, no unrealistic changes)
• Background movement (drifting particles, cloth flow, lighting flicker, ambient life — subtle)
• Lighting changes (rim light shift, sun ray reveal, subtle temperature drift)
• Duration (seconds — match the scene's durationSeconds)
• Ending frame (what the last visible frame should be, to enable smooth cut to next scene)

Rules:
- Natural movement ONLY. No exaggerated AI motion.
- No morphing of faces, hands, product geometry, text, or logos.
- No unrealistic facial changes.
- Every scene should feel like a premium commercial worthy of a top brand.
- Optimize for Kling, Minimax, Veo, Runway image-to-video models.
- Do NOT repeat visual details already present in the scene image (environment, wardrobe, lighting palette). Focus ONLY on MOTION.
- Keep prompts crisp — 2-4 sentences per scene.
{{characterMotionBlock}}

BRAND CONTEXT
- Business: {{name}}
- Industry: {{industry}}
- Brand Tone: {{brandToneFromProfile}}
- Global Visual Style: {{globalVisualStyle}}

STORYBOARD SCENES (source material — use imagePrompt as the visual anchor, describe motion that fits it):
{{block6}}

OUTPUT FORMAT — STRICT JSON ONLY
Return ONLY a valid JSON object with this exact schema:
{
  "scenes": [
    { "sceneId": "scene_1", "videoPrompt": "single string covering camera/character/facial/background movement + lighting changes + duration + ending frame" }
  ]
}
- Return exactly {{length}} scenes in the same sceneId order as above.
- No markdown, no code fences, no text outside the JSON.`
  },

  'video.voiceover': {
    label: "Video voiceover",
    summary: "Writes the spoken script. Change this if the voiceover sounds stiff or off-brand.",
    stage: 'video',
    variables: {
      name: "Value of profile?.name || 'N/A'",
      industry: "Value of profile?.industry || 'N/A'",
      name2: "Value of product?.name || profile?.description || 'N/A'",
      targetAudience: "Value of profile?.targetAudience || 'General audience'",
      brandToneFromProfile: "Value of brandToneFromProfile",
      sceneSummary: "Value of sceneSummary || String(source).slice(0, 400)",
      durationSeconds: "Value of durationSeconds",
      targetWords: "Value of targetWords",
      minWords: "Value of minWords",
      maxWords: "Value of maxWords",
      block11: "Value of isTamil ? `LANGUAGE \u2014 TAMIL REQUESTED - Generate the voiceover natural",
      block12: "Value of isTamil ? '\"tanglishVoiceScript\": \"string \u2014 romanized Tamil version of"
    },
    template: `You are an Elite Advertisement Voiceover Writer.
Your job is to create professional, emotional and natural-sounding voiceovers for commercial advertisements.

PRIMARY OBJECTIVE
Create voiceovers that sound like real humans.
The voiceover must feel: natural, emotional, conversational, believable, professional.
Avoid: cringe marketing language, overused advertising phrases, robotic wording, generic AI content.

VOICEOVER STYLE
Write like Tamil TV commercials, premium brand films, emotional storytelling ads, real conversations.
The voiceover should feel like someone is sharing a story — not selling a product.

BUSINESS CONTEXT
- Business Name: {{name}}
- Business Type / Industry: {{industry}}
- Products / Services: {{name2}}
- Target Audience: {{targetAudience}}
- Brand Tone / Core Emotion: {{brandToneFromProfile}}

STORYBOARD (source material — align voiceover with the scene flow):
{{sceneSummary}}

DURATION RULES
- Total duration: {{durationSeconds}} seconds
- Target word count: {{targetWords}} words (acceptable range: {{minWords}}-{{maxWords}})
- Never exceed the requested duration.

IMPORTANT RULES
- Sound human. Sound emotional. Sound believable. Sound cinematic.
- NEVER repeat a sentence, phrase or idea. Every line must say something
  new. Do not restate the hook later, and do not echo the storyboard's
  wording back — the storyboard is context, not script to copy.
- hook, mainVoiceover and closingCta must not overlap in content.
- Stay inside the word budget. If you run out of things to say, stop early
  rather than padding with repetition.
- Create pauses naturally with short sentences and line breaks.
- Make every sentence easy to speak.
- Match the emotion of the storyboard.
- Match the business type.
- The output must feel like a real commercial — not an AI-generated script.
- Output MUST be directly usable in ElevenLabs / AI voice generators (plain text, no stage directions, no bracketed notes).

{{block11}}

OUTPUT FORMAT — STRICT JSON ONLY
{
  "hook": "string — first 3-5 seconds that pull the viewer in",
  "mainVoiceover": "string — the middle body of the narration",
  "closingCta": "string — final memorable brand line",
  "voiceScript": "string — the full concatenated voiceover (hook + main + cta), ready for TTS",
  {{block12}}
  "estimatedDurationSeconds": number,
  "voiceType": "one of: Female Soft | Female Elegant | Female Luxury | Male Deep | Male Corporate | Male Storytelling | Young Adult | Elderly Narrator",
  "speakingStyle": "string — brief guidance for the TTS engine (pace, pauses, warmth)"
}
No markdown. No code fences. No prose outside the JSON.`
  },

  'video.music': {
    label: "Video music direction",
    summary: "Chooses the music brief for the video.",
    stage: 'video',
    variables: {
      name: "Value of profile?.name || 'N/A'",
      industry: "Value of profile?.industry || 'N/A'",
      name2: "Value of product?.name || 'N/A'",
      brandToneFromProfile: "Value of brandToneFromProfile",
      durationSeconds: "Value of durationSeconds",
      sceneSummary: "Value of sceneSummary || 'N/A'",
      block7: "Value of String(voiceScript || '').slice(0, 800)",
      block8: "Value of Math.round(durationSeconds * 0.25)",
      block9: "Value of Math.round(durationSeconds * 0.2)"
    },
    template: `You are a Commercial Music Director for premium ad production.
Analyze the storyboard and voiceover, then recommend the background music that will most enhance the emotion of the advertisement.

BUSINESS CONTEXT
- Business: {{name}}
- Industry: {{industry}}
- Product: {{name2}}
- Brand Tone: {{brandToneFromProfile}}
- Total Duration: {{durationSeconds}} seconds

STORYBOARD:
{{sceneSummary}}

VOICEOVER:
{{block7}}

Recommend the music using this framework:
- Music Style
- Mood
- Instruments
- Tempo (BPM range)
- Reference Feel (compare to one of: Tamil Emotional | Family Advertisement | Luxury Jewellery | Restaurant Commercial | Corporate Inspiration | Fashion Brand | Premium Product Commercial — or your own if none fit)
- Opening Music (first ~{{block8}}s) — mood/direction for how the track opens
- Middle Music (middle section) — how energy builds
- Ending Music (last ~{{block9}}s) — how it resolves and lands the brand

OUTPUT FORMAT — STRICT JSON ONLY
{
  "style": "string",
  "mood": "string",
  "instruments": ["string", "string"],
  "tempoBpm": number,
  "referenceFeel": "string",
  "openingMusic": "string",
  "middleMusic": "string",
  "endingMusic": "string"
}
No markdown. No code fences. No prose outside the JSON.`
  }
};
