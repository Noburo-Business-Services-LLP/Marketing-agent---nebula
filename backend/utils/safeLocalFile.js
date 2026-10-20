'use strict';
/**
 * Local media files are read only from the app's own storage (D108). A scene or media field can come from a request
 * body, so a path is never trusted: it must resolve INSIDE `storage` or `temp` after symlinks are resolved.
 */
const fs = require('fs');
const path = require('path');

const LOCAL_MEDIA_ROOTS = [path.resolve(__dirname, '../storage'), path.resolve(__dirname, '../temp')];

/**
 * Real path of a local media file, only when it is a file inside one of the allowed roots AFTER symlinks are resolved.
 * No `..` segments, no NUL, no symlink out of a root, no directory; anything else throws a plain error.
 */
async function resolveAllowedLocalFile(raw, roots = LOCAL_MEDIA_ROOTS) {
  const refuse = () => new Error('That media file is not available.');
  const text = String(raw || '');
  if (!text || text.includes('\0') || text.split(/[\\/]+/).includes('..')) throw refuse();
  let real;
  try { real = await fs.promises.realpath(path.resolve(text)); } catch (_) { throw refuse(); }
  for (const root of roots) {
    let realRoot;
    try { realRoot = await fs.promises.realpath(root); } catch (_) { continue; }
    if (real !== realRoot && real.startsWith(`${realRoot}${path.sep}`)) {
      let stat;
      try { stat = await fs.promises.stat(real); } catch (_) { throw refuse(); }
      if (!stat.isFile()) throw refuse();
      return real;
    }
  }
  throw refuse();
}

module.exports = { resolveAllowedLocalFile, LOCAL_MEDIA_ROOTS };
