# Hero Studio — build the hero from the wizard's story, cast, environment and brand

Status: draft for review. Branch: `dev-dk`. **Amends** `2026-10-03-hero-video-quality-design.md` (prompt v2 + finishing layer) and `2026-10-03-hero-video-design.md` (pipeline). Where they conflict, this document wins.

## Problem

The first Hero version branched straight off the accepted concept. It had no cast, no environment, no brand assets and no scene breakdown, so the model invented everything: generic characters, an invented office, no client logo, no client look. A client video must be made from the client's world.

## Intent and success

A CSM (or client) finishes the normal wizard preproduction — concept, cast, environment, script and scenes, optionally scene keyframes — and presses **Make this a Hero video**. The system turns that story into one 15 s Seedance clip in which:
- the **characters** are the accepted cast (same faces, wardrobe) — seeded from the client's ideal customer;
- the **location** is the client's real space (their environment photos) or the chosen environment;
- the **brand** appears for real (logo, product image, colours, CTA) rather than being invented;
- the **story** is the scene breakdown compressed to a 15 s hero cut with a hook, tension, turn, payoff and CTA;
- sound, performance and finish follow the quality spec.

Judged by the user watching test runs against the previous result. Still 2 hero clips per client per month at 720p; the 729-Quark price, quota and money path are unchanged.

## What the wizard already provides (verified in code)

- Step 1: `acceptedConcept` (title, storySummary, coreEmotion, visualStyle), `aspectRatio`, language.
- Step 2: `generatedCharacters[]` (id, name, age, gender, role, appearance, clothing, hairStyle, hairColor, personality, `portraitUrl`), `acceptedCharacterId`, cast sheet `castImageUrl`. Images are Cloudinary https URLs.
- Step 3: `environmentEnabled`, `environmentRefs[]` (`url` or `dataUrl`, source `brand-asset|upload`), `environmentNotes`.
- Step 4: `scenes[]` (script, visuals, duration, `charactersRequired`, ids); Step 5 adds `scene.imageUrl` keyframes.
- Business profile (server side, `User.businessProfile`): name, website, industry, `targetAudience`, `targetCustomerProfile`, `brandVoice`, `heroProduct`, `brandAssets.logoUrl`, `brandAssets.brandColors`, brand asset images (BrandAsset collection).

## Design

### 1. Entry
`ReelGenerator.tsx` shows **Make this a Hero video** from Step 4 onward (replacing the concept-step button). If the cast or the script/scenes are missing, the button explains what to complete first and links to that step. Scene keyframes (Step 5) are optional and improve consistency. Clicking it navigates to `/reels/hero` with a compact **hero brief** built from wizard state (router state, no new persisted store).

### 2. Hero brief (client -> server)
```
heroBrief = {
  concept:{title,storySummary,coreEmotion,visualStyle}, aspectRatio, language,
  cast:[{id,name,age,gender,role,appearance,clothing,hairStyle,hairColor,personality,portraitUrl}],
  castSheetUrl?, 
  environment:{enabled, notes, images:[{url? , dataUrl?, alt?}]},
  scenes:[{sceneId,title?,script,visual,durationSeconds,charactersRequired?,imageUrl?}]
}
```
Server validates and caps (cast <= 4, scenes <= 12, images <= 5, strings capped, URLs https). Brand data is NOT trusted from the client: the server loads it for the authenticated user (logo, colours, website, hero product, ICP, brand-asset product/logo images).

### 3. Reference staging (the new core)
`selectReferences(brief, brand) -> [{ tag:'@image1', kind:'cast'|'environment'|'brand'|'keyframe', label, url }]`, at most 9 (the model's limit), in this priority:
1. cast portraits, accepted/required characters first (<= 3), else the cast sheet;
2. environment photos (<= 2);
3. logo or product image (<= 2, product first when the story shows it; logo only when it is an image the brand supplied);
4. scene keyframes of the scenes kept in the hero cut (<= 3), as composition anchors.
`stageReferences` guarantees every reference is a public https image fetchable by fal: `dataUrl` images are uploaded to Cloudinary (existing `uploadBase64Image`); non-https or private-host URLs are dropped with a note; size is capped. The result is shown in the UI so the user can remove or reorder references before generating.

### 4. Hero cut + planner
`POST /plan` receives the hero brief and the staged references and returns the quality-spec JSON plus `heroCut: [{sceneId, keep, reason, time}]` — which scenes carry the story (typically 3-4, always including the opening hook scene and the resolution) and how they are re-timed into 15 s. The planner prompt (director's brief + compression rules from the quality spec) receives: story, cast block (identity + wardrobe + personality), environment block, brand block (name, ICP, tone, CTA, product), scene list with durations, and the reference list with tags and roles. Its REFS block must assign each reference a role ("@image1 is Maya — appearance only, ignore her background"), and CAST / STAGING must use the cast and place from the references. The user can untick scenes and rebuild.

### 5. Generate
`/generate` takes the final prompt, the confirmed reference URLs (re-validated server side) and finish options; with references it uses the reference-to-video endpoint (already built). Tag syntax and role handling are verified in the first reference run.

### 6. Finish (quality spec Part B) and sound/performance (quality spec Part A)
Unchanged: realism grade, brand mark, fades, CTA end card, optional captions, loudness, raw-clip fallback; native music/SFX by default; no legible screens.

### 7. Hero Studio page
One page, in order: Story (concept + hero cut with scene toggles) -> Cast (portraits with names) -> Place (environment photos/notes) -> Brand (logo, product, CTA, website, colour) -> References (the staged set, removable) -> Prompt (editable, with the story/shot list) -> Finish options -> Generate (with affordability preflight). Gold-glow, film-strip styling comes with the later showpiece work.

## Out of scope
Chaining two clips into a 30 s film; real-person likeness capture beyond the existing "upload a photo as a cast member" (consent is the CSM's responsibility, stated in the UI); TTS voice-over; the Videos-page showpiece redesign; 1080p.

## Testing and verification
- Unit tests: brief validation and caps; `selectReferences` priority, caps and tag numbering; `stageReferences` (dataUrl upload fake, non-https dropped, private hosts dropped, size cap); hero-cut parsing in `normalizePlan`; prompt template includes the cast/environment/brand/reference blocks and role assignments.
- Route tests for `/plan` and `/generate` with fakes (references re-validated, reference endpoint chosen).
- Frontend: type-check + build; visual check in light/dark/phone.
- Live (user approves each spend, about 4.55 USD list): run 1 with the full reference set to verify tag syntax, identity fidelity and logo/product appearance; run 2 after prompt tuning; run 3 with the finishing layer; compare each to the previous.

## Risks
- Reference handling in Seedance (tag syntax, how many references are honoured, face fidelity) is unverified until run 1.
- Logos and product text may still render imperfectly even with a reference; the end card carries the reliable brand mark.
- Compressing a 60 s story into 15 s may drop beats the client likes; the scene toggles and rebuild are the control.
- More inputs make longer planner prompts and slightly higher LLM cost per plan (cents).
