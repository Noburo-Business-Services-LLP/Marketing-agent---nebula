# Nebulaa app voice, pass 2: before and after

Branch `nebulaa-redesign`. Display text only; keys, routes, values the code compares, API fields and logic are unchanged. Each table lists every changed string. Scripts in the form `x` are shown without surrounding quotes where the string was part of a longer line. Pass 2 also confirmed TrialExpired.tsx, UnifiedInbox.tsx, SEOAssistant.tsx, AutoReplySettingsPage.tsx, AIHistory.tsx and AIPerformance.tsx as already plain (no change) and added them to the scanner scope. The video style slugs and values are unchanged; only the `blurb` display text changed.

## pages/ReelGenerator.tsx (84 strings)

| Before | After |
|---|---|
| blurb: 'Filmic grade, shallow depth, dramatic light' | blurb: 'Film-style colour grading, shallow depth of field and dramatic lighting' |
| blurb: 'Narrative arc with characters and emotional beats' | blurb: 'A story with characters and clear emotional moments' |
| blurb: 'Clean studio focus on the product itself' | blurb: 'A clean studio look that keeps the focus on the product' |
| blurb: 'Handheld, casual, first-person energy' | blurb: 'Handheld, casual footage filmed from a first-person view' |
| blurb: 'Observational, grounded, real-world texture' | blurb: 'Observational footage with a realistic, natural look' |
| blurb: 'Clear explainer pacing with visual aids' | blurb: 'A clear, steady pace with visuals that support the explanation' |
| blurb: 'Rising energy, aspirational imagery' | blurb: 'Building momentum with uplifting, aspirational imagery' |
| blurb: 'Polished, professional, data-forward' | blurb: 'A polished, professional look that puts data first' |
| blurb: 'Customer to camera, trust-building' | blurb: 'A customer speaking to the camera to build trust' |
| blurb: 'Hero product on a lit stage' | blurb: 'The product shown prominently on a lit set' |
| blurb: 'Broadcast framing with lower-third titling' | blurb: 'News-broadcast framing with lower-third titles' |
| blurb: 'Fast cuts, vertical-first, punchy hooks' | blurb: 'Fast cuts, vertical format and a strong opening moment' |
| blurb: 'Restrained, premium, gold and black' | blurb: 'A restrained, premium look in gold and black' |
| label: 'Auto — let Nebulaa decide' | label: 'Auto (Nebulaa decides)' |
| throw new Error('No scenes yet — generate Script + Scenes first.') | throw new Error('There are no scenes yet. Generate the script and scenes first.') |
| console.log('🎭 Sequential image gen | console.log('Sequential image gen |
| throw new Error('No scenes to render — generate scenes + images first.') | throw new Error('There are no scenes to render. Generate the scenes and scene images first.') |
| 'Loaded from your calendar — edit before continuing…' | 'Loaded from your calendar. Edit it before you continue.' |
| 'e.g. A 30-second walkthrough of our new filter coffee — close-ups of the pour, steam rising, ending on the storefront at golden hour.' | 'For example: A 30-second walkthrough of our new filter coffee, with close-ups of the pour and the steam, ending on the storefront at golden hour.' |
| ✓ Accepted — you can proceed | Concept accepted. You can continue. |
| Click a name below to make that character the lead the video follows — the rest stay in the cast for scene consistency. | Select a name below to make that character the lead of the video. The other characters stay in the cast so that the scenes remain consistent. |
| (generatedCharacters.length > 0 ? '↻ Regenerate' : '✨ Generate') | (generatedCharacters.length > 0 ? 'Regenerate' : 'Generate') |
| Hit Generate above when you are — it costs Quarks, so nothing runs until you ask. | Select Generate above to begin. This costs Quarks, so nothing runs until you ask. |
| Character bible — full details | Character bible: full details |
| — helps the model disambiguate what to preserve" | This helps Nebulaa identify what to preserve." |
| "Tone matches this brand's tier — not a generic luxury film" | "The tone suits this brand's price tier and does not read as a generic luxury film" |
| Story arc · Voiceover · Scene-by-scene breakdown — production-ready and editable. | Includes the story arc, the voiceover and a scene-by-scene breakdown. All of it can be edited. |
| (scenes.length > 0 ? '↻ Regenerate all' : '✨ Generate Script + Scenes') | (scenes.length > 0 ? 'Regenerate all' : 'Generate script and scenes') |
| placeholder="Or write your own narration here — one line per sentence, natural pauses." | placeholder="Or write your own narration here. Use one line per sentence so that the voice pauses naturally." |
| placeholder="The full narration, one line per sentence — will be spoken by ElevenLabs / your chosen TTS voice." | placeholder="The full narration, one line per sentence. It will be spoken by ElevenLabs or the text-to-speech voice you choose." |
| ✨ AI-Composed (ElevenLabs) | AI-composed (ElevenLabs) |
| You can enable multilingual fallback — voices that aren't native but can speak | You can enable multilingual voices. These are voices that are not native to this language but can speak |
| Leave empty to auto-derive from voice script + scene emotions. Or type your own — e.g. 'warm sentimental Indian classical instrumental, gentle strings, tabla rhythm, no vocals' | Leave this empty to base the music on the voice script and the scene emotions, or describe your own. For example: 'warm, sentimental Indian classical instrumental with gentle strings and tabla rhythm, no vocals'. |
| headline={<>Bring your brand to <GravityEmphasis>life</GravityEmphasis></>} | headline={<>Create videos for your <GravityEmphasis>brand</GravityEmphasis></>} |
| headline={<>What are we <GravityEmphasis>filming</GravityEmphasis>?</>} | headline={<>Describe your <GravityEmphasis>video</GravityEmphasis></>} |
| Describe the video once. Nebulaa writes the script, casts the voice, and renders every scene. | Describe the video once. Nebulaa then writes the script, chooses the voice and creates every scene. |
| Pick one to build the video around. Recommendation highlighted in gold. | Choose one concept to build the video around. The recommended concept is highlighted in gold. |
| The Character Designer builds characters specifically for the story you approve. | Nebulaa designs the characters for the story you approve. |
| Head back to Step 1 and accept a creative concept first. | Go back to Step 1 and accept a creative concept first. |
| Designing characters that match your concept… | Designing characters that match your concept. |
| Ready to design your cast from “{acceptedConcept?.title \|\| 'your concept'}”. | The cast is ready to be designed from “{acceptedConcept?.title \|\| 'your concept'}”. |
| <div className="gravity-label text-[#F5A623] mb-2">Ready when you are</div> | <div className="gravity-label text-[#F5A623] mb-2">Script not yet generated</div> |
| Click <b>Generate Script + Scenes</b> to build the story arc, full voiceover, and scene-by-scene breakdown from your approved concept. | Select <b>Generate script and scenes</b> to create the story arc, the full voiceover and a scene-by-scene breakdown from your approved concept. |
| {isRegen ? 'Regenerating scene...' : `Writing scene ${idx + 1}...`} | {isRegen ? 'Regenerating this scene.' : `Writing scene ${idx + 1}.`} |
| Lock every scene to your actual space (shop, showroom, workshop, storefront). Every image + clip will render inside this exact environment. | Keep every scene in your real space, such as a shop, showroom, workshop or storefront. Every image and clip is created inside this environment. |
| Wide shot of the space + a detail or two. Same lighting / angle-of-day as you want the video to feel like. | A wide shot of the space and one or two detail shots. Use the same lighting and time of day that you want the video to have. |
| Add at least one reference image, or toggle OFF to skip | Add at least one reference image, or turn the environment off to skip this step. |
| Nano Banana · consistent characters + locked environment | Characters and environment stay consistent across scenes |
| Kling v2.5 Turbo Pro · characters performing to scene direction | Characters act out the scene direction |
| Click "Load Voices" to fetch ElevenLabs voices | Select "Load voices" to fetch ElevenLabs voices |
| 'Load Voices' | 'Load voices' |
| Leave empty to auto-pick a track for this video duration. | Leave this empty and Nebulaa chooses a track that fits the video length. |
| ✓ Cast approved | Cast approved |
| ✓ Selected for this video | Selected for this video |
| {isAccepted ? '✓ Accepted' : 'Accept this concept'} | {isAccepted ? 'Accepted' : 'Accept this concept'} |
| '↻ Regenerate with tweak' : '↻ Regenerate cast image' | 'Regenerate with tweak' : 'Regenerate cast image' |
| {scene.logoApplied ? '✓ Logo On' : 'Use Logo'} | {scene.logoApplied ? 'Logo on' : 'Use logo'} |
| Tweak the cast image: e.g. 'warmer lighting', 'traditional attire', 'add glasses to father' | Adjust the cast image, for example 'warmer lighting', 'traditional attire' or 'add glasses to the father' |
| Tweak (e.g. 'slower dolly-in, character smiles') | Adjust this clip, for example 'slower push-in, the character smiles' |
| Save & Next (Environment) | Save and continue (Environment) |
| Save & Next (Script + Scenes) | Save and continue (Script and scenes) |
| Save & Next (Scene Images) | Save and continue (Scene images) |
| 'Resume / Continue' | 'Resume' |
| 'Generate All Clips' | 'Generate all clips' |
| 'Regenerate All Scene Images' : 'Generate All Scene Images' | 'Regenerate all scene images' : 'Generate all scene images' |
| Apply Logo to All | Apply logo to all |
| Remove Logo from All | Remove logo from all |
| 'Generate Audio Preview' | 'Generate audio preview' |
| 'Merge Video + Audio' | 'Merge video and audio' |
| 'Generate Thumbnail + Caption + Hashtags' | 'Generate thumbnail, caption and hashtags' |
| 'Post / Schedule' | 'Post or schedule' |
| Start New Wizard | Start a new video |
| 'Draft missing' (16 places) | The draft could not be found. Please start again from step 1. |
| Draft missing. Complete step 1 first. | The draft could not be found. Complete step 1 first. |
| Job cancelled by user. | The task was cancelled. |
| Something went wrong | Something went wrong. Please try again. |
| Failed to save favourite audio | The audio could not be saved to your favourites. |
| Failed to save favourite voice | The voice could not be saved to your favourites. |
| Description is required | Please add a description of the video. |
| Select at least one platform | Select at least one platform. |
| Select date and time | Select a date and a time. |
| Saved to Drafts. Video is generating in background. | Saved to Drafts. The video is being generated in the background. |
| Scene not found for regeneration | The scene to regenerate could not be found. |
| Describe the video first. | Describe the video first, then generate concepts. |

## pages/EnvironmentAssets.tsx (2 strings)

| Before | After |
|---|---|
| your real space instead of inventing one — pick these in the Videos Environment step. | your real space instead of creating an imaginary one. You can choose these photos in the Environment step of the Videos wizard. |
| A wide shot of the space plus a detail or two works best — shot in the light you want your videos to feel like. | A wide shot of the space and one or two detail shots work best. Take them in the lighting you want your videos to have. |

## pages/Analytics.tsx (6 strings)

| Before | After |
|---|---|
| Take your first snapshot to unlock performance insights. | Take your first snapshot to see performance insights. |
| % — consider refreshing your strategy` | %. Consider refreshing your strategy.` |
| 'More snapshots will unlock trend comparisons — data auto-collects every 12 hours' | 'More snapshots are needed to compare trends. Data is collected automatically every 12 hours.' |
| Metrics not available yet — check back in a few hours | Metrics are not available yet. Please check again in a few hours. |
| 'No analytics yet — metrics appear a few hours after posting' | 'There are no analytics yet. Metrics appear a few hours after posting.' |
| Boost a published post from the Campaigns page to see your ads here | Promote a published post from the Campaigns page and your ads will appear here. |

## pages/Inventory.tsx (7 strings)

| Before | After |
|---|---|
| the image is skipped silently — uploading is more reliable. | the image is skipped without a warning. Uploading the image is more reliable. |
| Upload a CSV or Excel file — up to 500 products at once | Upload a CSV or Excel file with up to 500 products at once. |
| {' '}— Optional: description, currency, stockQuantity, category, tags, imageUrl | {' '}Optional columns: description, currency, stockQuantity, category, tags, imageUrl |
| Accepts .csv, .xls, .xlsx — max 5 MB | Accepted file types: .csv, .xls and .xlsx. Maximum size: 5 MB. |
| failed — click to review | failed. Select to review. |
| Ready to Launch? | Ready to generate |
| Click generate to create an agency-grade marketing image for | Select Generate to create a professional marketing image for |

## pages/Drafts.tsx (1 strings)

| Before | After |
|---|---|
| <div className="text-3xl text-slate-700">🖼️</div> | <div className="text-xs text-slate-500">No image available</div> |

## pages/ContentCalendar.tsx (4 strings)

| Before | After |
|---|---|
| No plans found. Generate your first plan! | No plans were found. Generate your first plan to see it here. |
| <span className="text-xl">⚠️</span>  |  |
| <div className="text-3xl text-slate-700">🖼️</div> | <div className="text-xs text-slate-500">No image available</div> |
| <span>Generation Failed</span> | <span>Generation failed</span> |

## pages/AdCampaigns.tsx (6 strings)

| Before | After |
|---|---|
| '🔴 Ad Campaign Failed to Launch' | 'The ad campaign could not be launched' |
| '🟡 Ad Created with Issues' | 'The ad was created with issues' |
| '🟢 Ad Campaign Created and Running' | 'The ad campaign was created and is running' |
| '🟢 Active' : summaryState === 'failed' ? '🔴 Failed' : '🟡 Partial' | 'Active' : summaryState === 'failed' ? 'Failed' : 'Partial' |
| ❌ {platformLabel(summaryFailure.platform)} Failed | {platformLabel(summaryFailure.platform)} failed |
| ❌ {platformLabel(primaryFailure.platform)} Failed | {platformLabel(primaryFailure.platform)} failed |

## pages/Influencers.tsx (4 strings)

| Before | After |
|---|---|
| '🔍 Finding influencers across Instagram, YouTube, Facebook & more...' | 'Finding influencers across Instagram, YouTube, Facebook and other platforms.' |
| `✅ Found ${res.discovered \|\| res.influencers.length} influencers! ` + | `Found ${res.discovered \|\| res.influencers.length} influencers. ` + |
| '⚠️ No influencers found. Please complete your onboarding first.' | 'No influencers were found. Please complete your onboarding first.' |
| '❌ Discovery failed. Please try again.' | 'Influencer discovery failed. Please try again.' |
