/**
 * promptBuilder.js
 * 
 * Synthesizes the Deep Production Bible with the Screenplay fields
 * to create hyper-detailed, strictly constrained image and video prompts.
 */

function resolveCharacterText(characterIds, productionBible) {
  if (!characterIds || !characterIds.length || !productionBible?.characterBible) return "";
  const resolved = [];
  const chars = Array.isArray(productionBible.characterBible) ? productionBible.characterBible : [];
  
  for (const cid of characterIds) {
    const char = chars.find((c) => c.characterId === cid);
    if (char) {
      const face = char.appearance ? Object.values(char.appearance).join(", ") : "";
      const hair = char.hair ? Object.values(char.hair).join(", ") : "";
      resolved.push(`Character (${char.name}): ${face}. Hair: ${hair}`);
    }
  }
  return resolved.join("\n");
}

function resolveWardrobeText(wardrobeIds, productionBible) {
  if (!wardrobeIds || !wardrobeIds.length || !productionBible?.wardrobeBible) return "";
  const resolved = [];
  const wardrobes = Array.isArray(productionBible.wardrobeBible) ? productionBible.wardrobeBible : [];
  
  for (const wid of wardrobeIds) {
    const w = wardrobes.find((wd) => wd.wardrobeId === wid);
    if (w) {
      resolved.push(`Wardrobe: ${w.type} in ${w.primaryColor} and ${w.secondaryColor}. ${w.fabric}. Border: ${w.border?.width} ${w.border?.design}. Pallu: ${w.pallu?.style}. Blouse: ${w.blouse?.color} ${w.blouse?.sleeves}.`);
    }
  }
  return resolved.join("\n");
}

function resolveLocationText(locationId, productionBible) {
  if (!locationId || !productionBible?.locationBible) return "";
  const locs = Array.isArray(productionBible.locationBible) ? productionBible.locationBible : [];
  const loc = locs.find((l) => l.locationId === locationId);
  if (loc) {
    return `Location (${loc.name}): ${loc.architecture}. Colors: ${Array.isArray(loc.colors) ? loc.colors.join(", ") : loc.colors}.`;
  }
  return "";
}

function getLocationRestrictions(locationId, productionBible) {
  if (!locationId || !productionBible?.locationBible) return [];
  const locs = Array.isArray(productionBible.locationBible) ? productionBible.locationBible : [];
  const loc = locs.find((l) => l.locationId === locationId);
  if (loc && Array.isArray(loc.restrictions)) {
    return loc.restrictions;
  }
  return [];
}

function buildSceneImagePrompt(scene, plan = null) {
  const parts = [];
  const bible = plan?.productionBible;

  // 1. Location definition (Deep from Bible)
  const locText = resolveLocationText(scene.locationId, bible);
  if (locText) {
    parts.push(`SETTING: ${locText}`);
  } else if (scene.location) {
    parts.push(`SETTING: ${scene.location}`);
  }

  // 2. Character & Wardrobe definition (Deep from Bible)
  const charText = resolveCharacterText(scene.characterIds, bible);
  if (charText) parts.push(`CHARACTERS: ${charText}`);
  
  const wardrobeText = resolveWardrobeText(scene.wardrobeIds, bible);
  if (wardrobeText) parts.push(`WARDROBE: ${wardrobeText}`);

  // 3. Cinematography & Lighting
  const cinematography = [];
  if (scene.camera) cinematography.push(scene.camera);
  if (scene.lighting) cinematography.push(scene.lighting);
  if (cinematography.length > 0) {
    parts.push(`CINEMATOGRAPHY: ${cinematography.join(", ")}`);
  }

  // 4. Core Action (from the Screenplay)
  if (scene.action) {
    parts.push(`ACTION: ${scene.action}`);
  }

  // 5. Emotion/Vibe
  if (scene.emotion) {
    parts.push(`MOOD: ${scene.emotion}`);
  }

  // 6. Hardcoded framing constraints for realism
  parts.push("FRAMING: Both hands fully visible, natural human anatomy, realistic fabric folds, no body clipping, perfectly framed.");
  parts.push("COMPOSITION: Single cinematic shot, full-screen composition, one camera angle, one frame only, 9:16 vertical commercial frame. Strictly no split screen, no collage, no storyboard, no grid layout, no multiple views.");

  return parts.filter(Boolean).join("\n\n");
}

function buildSceneNegativePrompt(scene, plan = null) {
  const negatives = [
    "cropped", "out of frame", "deformed", "mutated", "extra fingers", 
    "missing limbs", "poorly drawn hands", "bad anatomy", "watermark", 
    "signature", "text", "blurry", "low resolution", "cartoon", 
    "illustration", "3d render",
    "split screen", "collage", "storyboard", "grid layout", "multiple views", 
    "montage", "contact sheet", "multi-panel", "picture-in-picture", "diptych", 
    "triptych", "quad", "panels", "multiple angles"
  ];

  // Contextual negative constraints
  const content = `${scene.location || ""} ${scene.action || ""}`.toLowerCase();
  if (content.includes("traditional") || content.includes("heritage") || content.includes("village") || content.includes("saree") || content.includes("temple")) {
    negatives.push("modern furniture", "computers", "mobile phones", "office environment", "desks", "laptops", "tablets", "western clothing");
  }

  // Deep Location Restrictions from Production Bible
  const bibleRestrictions = getLocationRestrictions(scene.locationId, plan?.productionBible);
  if (bibleRestrictions.length > 0) {
    negatives.push(...bibleRestrictions);
  }

  return negatives.join(", ");
}

function buildSceneVideoPrompt(scene, plan = null) {
  const parts = [];
  if (scene.camera) parts.push(`Camera Motion: ${scene.camera}`);
  if (scene.action) parts.push(`Subject Motion: ${scene.action}`);
  parts.push("Cinematic, high quality motion, smooth slow motion");
  parts.push("COMPOSITION CONSTRAINTS: Single cinematic shot, full-screen composition, one camera angle, one frame only, 9:16 vertical commercial frame. Strictly no split screen, no collage, no storyboard, no grid layout, no multiple views, no montage.");
  return parts.filter(Boolean).join(". \n");
}

module.exports = {
  buildSceneImagePrompt,
  buildSceneNegativePrompt,
  buildSceneVideoPrompt
};