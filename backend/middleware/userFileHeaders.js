'use strict';
/**
 * Headers for files served to users from this origin (/generated-media, /audio): express.static's setHeaders.
 *  - Content-Security-Policy: sandbox  the file is opened as a sandboxed document: no script, no same-origin access
 *  - X-Content-Type-Options: nosniff   the browser never guesses another type than the one sent
 *  - Content-Disposition                inline for pictures, video and audio (they still play in the page), attachment
 *                                       for anything else
 */
const path = require('path');

const INLINE = /\.(mp4|m4v|mov|webm|mp3|m4a|wav|ogg|aac|png|jpe?g|webp|gif)$/i;

function userFileHeaders(res, filePath) {
  const name = path.basename(String(filePath || 'file')).replace(/[^\w.-]/g, '_').slice(0, 120) || 'file';
  res.setHeader('Content-Security-Policy', 'sandbox');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${INLINE.test(name) ? 'inline' : 'attachment'}; filename="${name}"`);
}

module.exports = { userFileHeaders };
