'use strict';
/**
 * The real pictures of the demo brand, as the seed sees them. They are made by scripts/generate-demo-photos.js into a folder in the
 * owner's home (outside the repository): <PHOTOS_DIR>/final/<same path as the drawn picture>. The seed lays them over the drawn
 * pictures when it makes the demo folder, so a slot with no real photo keeps its drawing and nothing breaks.
 * Pure file reads: no network, no image library, no database. `remove` only ever deletes the demo folder, never this one.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SLOTS, relOk } = require('./photoPrompts');

const PHOTOS_DIR = path.join(os.homedir(), 'nebulaa-demo-photos');
const finalDir = (dir = PHOTOS_DIR) => path.join(dir, 'final');

const RELS = Object.freeze(SLOTS.map((s) => s.rel));

/** The real photo file for a path under the demo folder, or '' when there is none (or the path is not a slot). */
function realFile(rel, dir = PHOTOS_DIR) {
  if (!RELS.includes(rel) || !relOk(rel)) return '';
  const file = path.join(finalDir(dir), rel);
  try { return fs.statSync(file).size > 0 ? file : ''; } catch (e) { return ''; }
}

const hasReal = (rel, dir = PHOTOS_DIR) => Boolean(realFile(rel, dir));

/**
 * Put the real photo (when there is one) at `demoDir/rel`, replacing the drawn one. Returns { buffer, made:false, real:true } or
 * null when the slot has no real photo. Idempotent: an identical file is left alone.
 */
function applyReal(rel, demoDir, dir = PHOTOS_DIR) {
  const src = realFile(rel, dir);
  if (!src) return null;
  const buffer = fs.readFileSync(src);
  const dest = path.join(demoDir, rel);
  const same = fs.existsSync(dest) && fs.readFileSync(dest).equals(buffer);
  if (!same) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, buffer); }
  return { buffer, made: false, real: true, replaced: !same };
}

/** How many of the slots have a real photo, and how many of those are in the demo folder now. */
function summary(demoDir, dir = PHOTOS_DIR) {
  let real = 0; let inDemo = 0;
  for (const rel of RELS) {
    const src = realFile(rel, dir);
    if (!src) continue;
    real += 1;
    try { if (fs.readFileSync(path.join(demoDir, rel)).equals(fs.readFileSync(src))) inDemo += 1; } catch (e) { /* not there yet */ }
  }
  return { total: RELS.length, real, drawn: RELS.length - real, inDemo };
}

module.exports = { PHOTOS_DIR, finalDir, RELS, realFile, hasReal, applyReal, summary };
