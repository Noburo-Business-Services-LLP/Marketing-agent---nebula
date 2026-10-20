const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { URL } = require('url');

const {
  extractVideoMetadata,
  validateInstagramVideoRequirements
} = require('./mediaComposer');

const DEFAULT_TIMEOUT_MS = 120000;

function sanitizeFileName(input = '') {
  const cleaned = String(input || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();

  if (!cleaned) {
    return `instagram-video-${Date.now()}.mp4`;
  }

  return cleaned.toLowerCase().endsWith('.mp4') ? cleaned : `${cleaned}.mp4`;
}

function buildDefaultFileName(videoUrl) {
  try {
    const parsed = new URL(videoUrl);
    const baseName = path.basename(parsed.pathname || '').split('?')[0];
    return sanitizeFileName(baseName || `instagram-video-${Date.now()}.mp4`);
  } catch (_) {
    return sanitizeFileName(`instagram-video-${Date.now()}.mp4`);
  }
}

async function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (_) {}
}

async function ensureDirectory(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function resolveUniqueFilePath(directory, requestedName) {
  const parsed = path.parse(requestedName);
  let counter = 0;

  while (true) {
    const suffix = counter === 0 ? '' : `-${counter}`;
    const nextName = `${parsed.name}${suffix}${parsed.ext || '.mp4'}`;
    const candidate = path.join(directory, nextName);
    try {
      await fs.promises.access(candidate, fs.constants.F_OK);
      counter += 1;
    } catch (_) {
      return candidate;
    }
  }
}

// SSRF-safe streamed download (services/safeFetch.js, hardening C4): public https only (http only with
// ALLOW_HTTP_FETCH=1), every address public, the connection pinned to the checked address, redirects re-checked
// (at most 3), one overall time limit and a streamed size cap.
const VIDEO_MAX_BYTES = 750 * 1024 * 1024;
async function requestRemoteStream(videoUrl, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const sf = require('./safeFetch');
  let remote;
  try {
    remote = await sf.safeFetchStream(videoUrl, {
      timeoutMs: Math.max(DEFAULT_TIMEOUT_MS, Number(timeoutMs) || 0) * 2.5,
      maxBytes: VIDEO_MAX_BYTES,
      headers: { 'User-Agent': 'Nebula-Video-Downloader/1.0' }
    });
  } catch (error) {
    if (error && error.code === 'too_many_redirects') throw new Error('Too many redirects while downloading video.');
    if (error && error.code === 'timeout') throw new Error('Video download timed out.');
    throw new Error(`Invalid video URL: ${error && error.message}`);
  }
  if (remote.status < 200 || remote.status >= 300) {
    if (remote.stream) remote.stream.destroy();
    remote.done();
    throw new Error(`Video download failed with HTTP ${remote.status}`);
  }
  return { stream: remote.stream, finalUrl: remote.finalUrl, headers: remote.headers, statusCode: remote.status };
}

async function inspectVideoFile(filePath) {
  const metadata = await extractVideoMetadata(filePath);
  const validation = validateInstagramVideoRequirements(metadata);
  const hasAudio = Boolean(metadata?.audio && !metadata.audio.error);

  return {
    metadata,
    validation,
    summary: {
      hasAudio,
      durationSeconds: metadata?.durationSeconds || null,
      resolution: metadata?.video?.resolution || null,
      videoCodec: metadata?.video?.codec || null,
      audioCodec: metadata?.audio?.codec || null,
      format: metadata?.format || null
    }
  };
}

async function downloadVideoFromUrl(videoUrl, options = {}) {
  if (!videoUrl || typeof videoUrl !== 'string') {
    throw new Error('A public Cloudinary video URL is required.');
  }

  const downloadsDir = options.downloadsDir || path.join(__dirname, '..', 'downloads');
  const requestedName = sanitizeFileName(options.fileName || buildDefaultFileName(videoUrl));

  await ensureDirectory(downloadsDir);
  const targetPath = await resolveUniqueFilePath(downloadsDir, requestedName);
  const tempPath = `${targetPath}.part`;

  try {
    const remote = await requestRemoteStream(videoUrl, { timeoutMs: options.timeoutMs });
    const contentType = String(remote.headers['content-type'] || '').toLowerCase();

    if (contentType && !contentType.startsWith('video/') && !contentType.includes('application/octet-stream')) {
      throw new Error(`Remote URL did not return video content. Received content-type: ${contentType}`);
    }

    await pipeline(remote.stream, fs.createWriteStream(tempPath));
    await fs.promises.rename(tempPath, targetPath);

    const stats = await fs.promises.stat(targetPath);
    if (!stats.size) {
      throw new Error('Downloaded video file is empty.');
    }

    return {
      success: true,
      videoUrl,
      filePath: targetPath,
      fileName: path.basename(targetPath),
      bytes: stats.size,
      contentType: contentType || 'video/mp4'
    };
  } catch (error) {
    await safeUnlink(tempPath);
    throw error;
  }
}

async function downloadAndInspectVideoFromUrl(videoUrl, options = {}) {
  const download = await downloadVideoFromUrl(videoUrl, options);
  const inspection = options.inspect === false ? null : await inspectVideoFile(download.filePath);

  return {
    ...download,
    inspection
  };
}

async function streamRemoteVideoAsDownload(videoUrl, res, options = {}) {
  if (!videoUrl || typeof videoUrl !== 'string') {
    throw new Error('A public Cloudinary video URL is required.');
  }

  const remote = await requestRemoteStream(videoUrl, { timeoutMs: options.timeoutMs });
  const fileName = sanitizeFileName(options.fileName || buildDefaultFileName(videoUrl));
  const contentType = String(remote.headers['content-type'] || '').toLowerCase() || 'video/mp4';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Cache-Control', 'no-store');

  const contentLength = remote.headers['content-length'];
  if (contentLength) {
    res.setHeader('Content-Length', contentLength);
  }

  await pipeline(remote.stream, res);
}

module.exports = {
  downloadAndInspectVideoFromUrl,
  downloadVideoFromUrl,
  inspectVideoFile,
  sanitizeFileName,
  streamRemoteVideoAsDownload
};
