'use strict';
/**
 * Response compression (hardening A8): gzip/deflate for JSON and text over 1 KB, never for server-sent events
 * (compression buffers a stream, which would hold the events back) and never for a client that asks not to
 * ("x-no-compression" header, as the compression module itself supports).
 */
const compression = require('compression');

const THRESHOLD = 1024;

function filter(req, res) {
  const type = String(res.getHeader('Content-Type') || '');
  if (/text\/event-stream/i.test(type)) return false;
  if (/text\/event-stream/i.test(String(req.headers.accept || '')) && !type) return false; // a stream route that has not set its type yet
  return compression.filter(req, res);
}

const createCompression = () => compression({ threshold: THRESHOLD, filter });

module.exports = { createCompression, filter, THRESHOLD };
