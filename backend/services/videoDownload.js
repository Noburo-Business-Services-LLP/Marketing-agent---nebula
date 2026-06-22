const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { pipeline } = require('stream/promises');
const { URL } = require('url');

const {
  extractVideoMetadata,
  validateInstagramVideoRequirements
} = require('./mediaComposer');

const MAX_REDIRECTS = 5;
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

function isRedirect(statusCode) {
  return [301, 302, 303, 307, 308].includes(Number(statusCode));
}

function requestRemoteStream(videoUrl, { timeoutMs = DEFAULT_TIMEOUT_MS, redirectCount = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(videoUrl);
    } catch (error) {
      reject(new Error(`Invalid video URL: ${error.message}`));
      return;
    }

    const client = parsedUrl.protocol === 'https:' ? https : http;
    const req = client.get(parsedUrl, {
      headers: {
        'User-Agent': 'Nebula-Video-Downloader/1.0'
      },
      timeout: timeoutMs
    }, (res) => {
      if (isRedirect(res.statusCode) && res.headers.location) {
        if (redirectCount >= MAX_REDIRECTS) {
          res.resume();
          reject(new Error('Too many redirects while downloading video.'));
          return;
        }

        const redirectedUrl = new URL(res.headers.location, parsedUrl).toString();
        res.resume();
        resolve(requestRemoteStream(redirectedUrl, {
          timeoutMs,
          redirectCount: redirectCount + 1
        }));
        return;
      }

      if (Number(res.statusCode) < 200 || Number(res.statusCode) >= 300) {
        const statusMessage = res.statusMessage || 'Request failed';
        res.resume();
        reject(new Error(`Video download failed with HTTP ${res.statusCode}: ${statusMessage}`));
        return;
      }

      resolve({
        stream: res,
        finalUrl: parsedUrl.toString(),
        headers: res.headers,
        statusCode: res.statusCode
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Video download timed out.'));
    });

    req.on('error', reject);
  });
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
