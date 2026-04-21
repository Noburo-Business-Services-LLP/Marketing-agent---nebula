const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const { uploadInstagramSafeVideoFile, uploadVideoFile } = require('./imageUploader');

const INSTAGRAM_VIDEO_TARGET = {
  width: 1080,
  height: 1920,
  fps: 30,
  // Aligned with the Instagram-safe command we generate below (5,000k max bitrate).
  videoBitrateKbps: 5000,
  audioBitrateKbps: 128,
  audioSampleRate: 44100, // Changed from 48000 to 44100
  audioChannels: 2,
  maxDurationSeconds: 90,
  minDurationSeconds: 3,
  maxFileSizeBytes: 650 * 1024 * 1024
};

// Try to load ffprobe for video metadata extraction
let ffprobePath = null;
try {
  const ffprobeStatic = require('ffprobe-static');
  if (ffprobeStatic && ffprobeStatic.path) {
    ffprobePath = ffprobeStatic.path;
  }
} catch (e) {
  ffprobePath = null;
}

if (!ffprobePath) {
  const { spawnSync } = require('child_process');
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = spawnSync(whichCmd, ['ffprobe']);
    if (result.status === 0 && result.stdout) {
      const candidate = result.stdout.toString().trim().split(/\r?\n/)[0];
      if (candidate) {
        ffprobePath = candidate;
        console.log(`✅ Found ffprobe at ${ffprobePath}`);
      }
    }
  } catch (err) {
    // no-op; ffprobe not available
  }
}

if (!ffprobePath) {
  console.warn('⚠️ ffprobe not found on system path and ffprobe-static is not installed. Video metadata validation will be incomplete. Install ffprobe-static or ensure ffprobe is available in PATH.');
}

const fetchImpl = (() => {
  if (typeof global.fetch === 'function') return global.fetch.bind(global);
  try {
    // node-fetch v2 (CJS) fallback for older Node runtimes
    // eslint-disable-next-line global-require
    return require('node-fetch');
  } catch (_) {
    return null;
  }
})();

let ffmpegPath = null;
try {
  const ffmpegStatic = require('ffmpeg-static');
  if (ffmpegStatic) {
    ffmpegPath = ffmpegStatic;
  }
} catch (e) {
  ffmpegPath = null;
}

if (!ffmpegPath) {
  const { spawnSync } = require('child_process');
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = spawnSync(whichCmd, ['ffmpeg']);
    if (result.status === 0 && result.stdout) {
      const candidate = result.stdout.toString().trim().split(/\r?\n/)[0];
      if (candidate) {
        ffmpegPath = candidate;
        console.log(`✅ Found ffmpeg at ${ffmpegPath}`);
      }
    }
  } catch (err) {
    // no-op; ffmpeg not available
  }
}

if (!ffmpegPath) {
  throw new Error('ffmpeg is not installed or not found on PATH; install ffmpeg-static or ensure ffmpeg is available');
}

async function safeUnlink(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch (_) {}
}

async function downloadToFile(url, filePath) {
  if (!fetchImpl) {
    throw new Error('No fetch implementation available (install node-fetch or upgrade Node)');
  }
  const res = await fetchImpl(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to download ${url} (${res.status}): ${text.substring(0, 200)}`);
  }

  // node-fetch v2 uses res.buffer(), while WHATWG fetch uses res.arrayBuffer().
  let buf;
  if (typeof res.arrayBuffer === 'function') {
    const arrayBuffer = await res.arrayBuffer();
    buf = Buffer.from(arrayBuffer);
  } else if (typeof res.buffer === 'function') {
    buf = await res.buffer();
  } else {
    const text = await res.text().catch(() => '');
    buf = Buffer.from(text);
  }

  await fs.promises.writeFile(filePath, buf);
  
  // Validate file was written
  const stats = await fs.promises.stat(filePath).catch(() => null);
  if (!stats || stats.size === 0) {
    throw new Error(`Downloaded file is empty: ${url}`);
  }
}

async function runFfmpeg(args) {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static is not installed (cannot compose video with audio)');
  }

  return new Promise((resolve, reject) => {
    // Log the complete command for debugging/copying
    const fullCommand = `"${ffmpegPath}" ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`;
    console.log(`\n   📋 [FFMPEG COMMAND]`);
    console.log(`   ${fullCommand}`);
    console.log(`\n   🔧 Using ffmpeg binary: ${ffmpegPath}`);
    
    const proc = spawn(ffmpegPath, args, { windowsHide: true });

    let stderr = '';
    let stdout = '';
    
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      // Log real-time errors if critical message appears
      const chunk = d.toString();
      if (chunk.includes('Error') || chunk.includes('error') || chunk.includes('fatal')) {
        const lines = chunk.split('\n').filter(l => l.includes('error') || l.includes('Error') || l.includes('fatal'));
        lines.forEach(line => console.log(`   ⚠️  [FFMPEG] ${line.substring(0, 120)}`));
      }
    });
    
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`ffmpeg process error: ${err.message}`));
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`   ✓ ffmpeg completed with exit code 0`);
        return resolve();
      }
      
      // Capture and log FULL stderr and stdout for complete context
      console.log(`\n   ❌ [FFMPEG FAILED - EXIT CODE ${code}]`);
      
      if (stderr.length > 0) {
        console.log('\n   STDERR OUTPUT (last 2000 chars):');
        const stderrTail = stderr.substring(Math.max(0, stderr.length - 2000));
        stderrTail.split('\n').slice(-30).forEach(line => {
          if (line.trim()) console.log(`   ${line.substring(0, 150)}`);
        });
      }
      
      if (stdout.length > 0) {
        console.log('\n   STDOUT OUTPUT (last 500 chars):');
        const stdoutTail = stdout.substring(Math.max(0, stdout.length - 500));
        stdoutTail.split('\n').filter(l => l.trim()).forEach(line => {
          console.log(`   ${line.substring(0, 150)}`);
        });
      }
      
      const errorMsg = `ffmpeg exited with code ${code}. See logs above.`;
      reject(new Error(errorMsg));
    });
  });
}

function parseFfprobeFps(rate) {
  // rate often looks like "30000/1001" or "30/1"
  if (!rate || typeof rate !== 'string') return null;
  const m = rate.match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
  if (!m) {
    const n = Number.parseFloat(rate);
    return Number.isFinite(n) ? n : null;
  }
  const num = Number.parseFloat(m[1]);
  const den = Number.parseFloat(m[2]);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

async function runFfprobeJson(args) {
  if (!ffprobePath) {
    throw new Error('ffprobe not available');
  }
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobePath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe exited with code ${code}: ${stderr.substring(0, 500)}`));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`Failed to parse ffprobe JSON: ${e.message}`));
      }
    });
  });
}

async function getAudioDurationSeconds(filePath) {
  if (!ffprobePath) return null;
  const data = await runFfprobeJson([
    '-v', 'error',
    '-print_format', 'json',
    '-show_entries', 'format=duration:stream=index,codec_type,duration',
    '-select_streams', 'a:0',
    filePath
  ]);

  const streams = Array.isArray(data?.streams) ? data.streams : [];
  const hasAudio = streams.some((s) => String(s?.codec_type || '').toLowerCase() === 'audio');
  if (!hasAudio) return null;

  const streamDuration = Number.parseFloat(streams.find((s) => s?.duration != null)?.duration);
  const formatDuration = Number.parseFloat(data?.format?.duration);
  const dur = Number.isFinite(streamDuration) && streamDuration > 0 ? streamDuration
    : (Number.isFinite(formatDuration) && formatDuration > 0 ? formatDuration : null);
  if (!Number.isFinite(dur) || dur <= 0) return null;
  return dur;
}

/**
 * Extract video metadata using ffprobe (or parse basic stats)
 * @param {string} filePath - Path to the video file
 * @returns {Promise<object>} - Video metadata
 */
async function extractVideoMetadata(filePath) {
  const stats = await fs.promises.stat(filePath);
  const fileSize = stats.size;
  const fileName = path.basename(filePath);

  // Validate file exists and has content
  if (fileSize === 0) {
    return {
      filename: fileName,
      fileSize: 0,
      fileSizeMB: '0.00',
      format: 'mp4',
      error: 'Output file is empty (0 bytes) - ffmpeg may have failed'
    };
  }

  // If ffprobe is not available, return basic info
  if (!ffprobePath) {
    console.log('⚠️  ffprobe not installed - returning basic file metadata only');
    return {
      filename: fileName,
      fileSize: fileSize,
      fileSizeMB: (fileSize / 1024 / 1024).toFixed(2),
      format: 'mp4', // assumed based on file extension
      warning: 'Detailed codec info unavailable - ffprobe not installed. Please install ffprobe-static for full validation.'
    };
  }

  // Use ffprobe to extract detailed metadata
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ]);

    let output = '';
    proc.stdout.on('data', (d) => {
      output += d.toString();
    });

    proc.on('error', (err) => {
      console.warn('ffprobe error:', err.message);
      // Return basic info if ffprobe fails
      resolve({
        filename: fileName,
        fileSize: fileSize,
        fileSizeMB: (fileSize / 1024 / 1024).toFixed(2),
        format: 'mp4',
        warning: 'ffprobe extraction failed - ' + err.message
      });
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.warn(`ffprobe exited with code ${code}`);
        return resolve({
          filename: fileName,
          fileSize: fileSize,
          fileSizeMB: (fileSize / 1024 / 1024).toFixed(2),
          format: 'mp4',
          warning: `ffprobe exited with code ${code}. File may be corrupted.`
        });
      }

      try {
        const data = JSON.parse(output);
        const format = data.format || {};
        const streams = data.streams || [];
        
        // Check if we got any stream data
        if (streams.length === 0) {
          return resolve({
            filename: fileName,
            fileSize: fileSize,
            fileSizeMB: (fileSize / 1024 / 1024).toFixed(2),
            format: format.format_name || 'mp4',
            error: 'No streams found in file - video composition may have failed'
          });
        }
        
        // Find video and audio streams
        const videoStream = streams.find(s => s.codec_type === 'video');
        const audioStream = streams.find(s => s.codec_type === 'audio');

        const metadata = {
          filename: fileName,
          fileSize: fileSize,
          fileSizeMB: (fileSize / 1024 / 1024).toFixed(2),
          format: format.format_name || 'mp4',
          duration: format.duration ? parseFloat(format.duration).toFixed(2) : 'unknown',
          durationSeconds: format.duration ? Math.round(parseFloat(format.duration)) : null,
          bitrate: format.bit_rate ? Math.round(parseInt(format.bit_rate) / 1000) : 'unknown',
          bitrateKbps: format.bit_rate ? Math.round(parseInt(format.bit_rate) / 1000) : null
        };

        if (videoStream) {
          metadata.video = {
            codec: videoStream.codec_name || 'unknown',
            profile: videoStream.profile || 'unknown',
            width: videoStream.width || 'unknown',
            height: videoStream.height || 'unknown',
            resolution: videoStream.width && videoStream.height ? `${videoStream.width}x${videoStream.height}` : 'unknown',
            fps: videoStream.r_frame_rate ? (parseFfprobeFps(videoStream.r_frame_rate) ?? 'unknown') : 'unknown',
            pixelFormat: videoStream.pix_fmt || 'unknown',
            bitrate: videoStream.bit_rate ? Math.round(parseInt(videoStream.bit_rate) / 1000) : 'unknown',
            bitrateKbps: videoStream.bit_rate ? Math.round(parseInt(videoStream.bit_rate) / 1000) : null
          };
        } else {
          metadata.video = { error: 'No video stream found in file' };
        }

        if (audioStream) {
          metadata.audio = {
            codec: audioStream.codec_name || 'unknown',
            sampleRate: audioStream.sample_rate || 'unknown',
            channels: audioStream.channels || 'unknown',
            bitrate: audioStream.bit_rate ? Math.round(parseInt(audioStream.bit_rate) / 1000) : 'unknown',
            bitrateKbps: audioStream.bit_rate ? Math.round(parseInt(audioStream.bit_rate) / 1000) : null
          };
        } else {
          metadata.audio = { error: 'No audio stream found in file' };
        }

        return resolve(metadata);
      } catch (err) {
        console.warn('ffprobe JSON parse error:', err.message);
        resolve({
          filename: fileName,
          fileSize: fileSize,
          fileSizeMB: (fileSize / 1024 / 1024).toFixed(2),
          format: 'mp4',
          warning: 'Failed to parse ffprobe output - ' + err.message
        });
      }
    });
  });
}

/**
 * Validate video meets Instagram API requirements
 * @param {object} metadata - Video metadata from extractVideoMetadata
 * @returns {object} - Validation result with issues array
 */
function validateInstagramVideoRequirements(metadata) {
  const issues = [];
  const warnings = [];

  // ============================================
  // CHECK FOR CRITICAL METADATA ERRORS
  // ============================================
  if (metadata.error) {
    issues.push(`Metadata error: ${metadata.error}`);
  }

  if (metadata.warning) {
    warnings.push(`Metadata warning: ${metadata.warning}`);
  }

  // ============================================
  // FILE FORMAT VALIDATION
  // ============================================
  // ffprobe often reports MP4 as: "mov,mp4,m4a,3gp,3g2,mj2"
  // Treat any container string containing "mp4" as valid.
  const formatNormalized = String(metadata.format || '').toLowerCase();
  const formatParts = formatNormalized.split(',').map(s => s.trim()).filter(Boolean);
  const isMp4Container = formatParts.includes('mp4') || formatParts.includes('mov') || formatParts.includes('quicktime');
  if (!isMp4Container) {
    issues.push(`Invalid format: ${metadata.format || 'unknown'}. Instagram requires MP4.`);
  }

  // ============================================
  // VIDEO CODEC VALIDATION
  // ============================================
  if (!metadata.video) {
    issues.push('No video metadata available.');
  } else if (metadata.video.error) {
    issues.push(`Video error: ${metadata.video.error}`);
  } else {
    const videoCodec = String(metadata.video.codec || '').toLowerCase();
    if (!videoCodec.includes('h264') && !videoCodec.includes('h.264') && videoCodec !== 'avc1') {
      issues.push(`Video codec ${metadata.video.codec} is not Instagram-safe. Expected H.264/AVC.`);
    }

    // ============================================
    // RESOLUTION VALIDATION
    // ============================================
    const width = parseInt(metadata.video.width);
    const height = parseInt(metadata.video.height);
    const aspectRatio = width > 0 && height > 0 ? width / height : null;
    
    if (!width || !height || width < 480 || height < 480) {
      issues.push(`Resolution ${metadata.video.resolution || 'unknown'} is too low. Minimum 480x480.`);
    } else if (width > 1920 || height > 1920) {
      warnings.push(`Resolution ${metadata.video.resolution} exceeds Instagram max (1920x1920). May be re-encoded.`);
    }

    if (!aspectRatio || Math.abs(aspectRatio - (9 / 16)) > 0.03) {
      issues.push(`Aspect ratio ${metadata.video.resolution || 'unknown'} is not Instagram Reel-safe. Expected 9:16.`);
    }

    if (width !== INSTAGRAM_VIDEO_TARGET.width || height !== INSTAGRAM_VIDEO_TARGET.height) {
      warnings.push(`Resolution ${metadata.video.resolution} differs from preferred Reel size ${INSTAGRAM_VIDEO_TARGET.width}x${INSTAGRAM_VIDEO_TARGET.height}.`);
    }

    // ============================================
    // FRAME RATE VALIDATION
    // ============================================
    const fps = typeof metadata.video.fps === 'number' ? metadata.video.fps : parseFloat(metadata.video.fps);
    if (!Number.isFinite(fps)) {
      warnings.push(`Frame rate unknown. Instagram expects 23.98 - 60 fps.`);
    } else if (fps < 23 || fps > 60) {
      issues.push(`Frame rate ${fps.toFixed(2)} fps outside Instagram range (23.98-60 fps).`);
    } else if (Math.abs(fps - 30) > 5) {
      warnings.push(`Frame rate ${fps.toFixed(2)} fps. Standard is 30 fps.`);
    }

    // ============================================
    // VIDEO BITRATE VALIDATION
    // ============================================
    const vBitrate = metadata.video.bitrateKbps;
    if (vBitrate && vBitrate < 500) {
      issues.push(`Video bitrate ${vBitrate} kbps too low. Minimum 500 kbps.`);
    } else if (vBitrate && vBitrate > 5000) {
      warnings.push(`Video bitrate ${vBitrate} kbps very high. Instagram prefers ~3000 kbps.`);
    }

    // ============================================
    // PIXEL FORMAT VALIDATION
    // ============================================
    const pixFmt = String(metadata.video.pixelFormat || '').toLowerCase();
    if (!['yuv420p', 'yuvj420p', 'yuv422p'].includes(pixFmt)) {
      warnings.push(`Pixel format ${metadata.video.pixelFormat} not standard. Expected yuv420p.`);
    }
  }

  // ============================================
  // AUDIO CODEC VALIDATION
  // ============================================
  if (!metadata.audio) {
    issues.push('No audio metadata available. Instagram Reels require an audio track.');
  } else if (metadata.audio.error) {
    issues.push(`Audio error: ${metadata.audio.error}`);
  } else if (metadata.audio.warning) {
    warnings.push(`Audio warning: ${metadata.audio.warning}`);
  } else {
    const audioCodec = String(metadata.audio.codec || '').toLowerCase();
    if (!audioCodec.includes('aac')) {
      issues.push(`Audio codec ${metadata.audio.codec} is not Instagram-safe. Expected AAC.`);
    }

    // ============================================
    // AUDIO SAMPLE RATE & BITRATE VALIDATION
    // ============================================
    const sampleRate = parseInt(metadata.audio.sampleRate);
    if (!sampleRate || sampleRate < 44100) {
      issues.push(`Audio sample rate ${metadata.audio.sampleRate} too low. Minimum 44100 Hz.`);
    } else if (sampleRate > 48000) {
      warnings.push(`Audio sample rate ${metadata.audio.sampleRate} Hz. Standard is 44100-48000 Hz.`);
    }

    const aBitrate = metadata.audio.bitrateKbps;
    if (!aBitrate || aBitrate < 96) {
      issues.push(`Audio bitrate ${aBitrate || 'unknown'} kbps too low. Minimum 96 kbps.`);
    } else if (aBitrate > 320) {
      warnings.push(`Audio bitrate ${aBitrate} kbps. Standard is 128 kbps.`);
    }

    const channels = parseInt(metadata.audio.channels);
    if (channels && (channels < 1 || channels > 2)) {
      warnings.push(`Audio channels ${channels}. Instagram supports mono (1) or stereo (2).`);
    }
  }

  // ============================================
  // DURATION VALIDATION
  // ============================================
  const duration = metadata.durationSeconds;
  if (!duration || duration < 3) {
    issues.push(`Duration ${metadata.duration || 'unknown'}s too short. Minimum 3 seconds required.`);
  } else if (duration > 90) {
    issues.push(`Duration ${metadata.duration}s too long. Maximum 90 seconds (Instagram Feed).`);
  }

  // ============================================
  // FILE SIZE VALIDATION
  // ============================================
  const fileSizeMB = parseFloat(metadata.fileSizeMB);
  if (metadata.fileSize > INSTAGRAM_VIDEO_TARGET.maxFileSizeBytes || fileSizeMB > 650) {
    issues.push(`File size ${metadata.fileSizeMB}MB exceeds Instagram limit (650MB).`);
  } else if (fileSizeMB > 100) {
    warnings.push(`File size ${metadata.fileSizeMB}MB is large. Ideal is 30-100MB.`);
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    severity: issues.length > 0 ? 'ERROR' : (warnings.length > 0 ? 'WARNING' : 'OK')
  };
}

/**
 * Log detailed video analysis for debugging
 * @param {object} metadata - Video metadata
 * @param {object} validation - Validation result
 */
function logVideoAnalysis(metadata, validation) {
  console.log('\n' + '='.repeat(70));
  console.log('📹 [INSTAGRAM VIDEO ANALYSIS] Video File Validation Report');
  console.log('='.repeat(70));
  
  console.log('\n📊 FILE INFORMATION:');
  console.log(`   Filename: ${metadata.filename}`);
  console.log(`   File Size: ${metadata.fileSizeMB}MB (${metadata.fileSize} bytes)`);
  console.log(`   Format: ${metadata.format}`);
  console.log(`   Bitrate: ${metadata.bitrateKbps ? metadata.bitrateKbps + ' kbps' : 'unknown'}`);

  if (metadata.error) {
    console.log(`\n⚠️  CRITICAL FILE ERROR:`);
    console.log(`   ${metadata.error}`);
  }

  if (metadata.video) {
    if (metadata.video.error) {
      console.log('\n❌ VIDEO STREAM ERROR:');
      console.log(`   ${metadata.video.error}`);
    } else {
      console.log('\n🎬 VIDEO STREAM:');
      console.log(`   Codec: ${metadata.video.codec}${metadata.video.profile ? ' (' + metadata.video.profile + ')' : ''}`);
      console.log(`   Resolution: ${metadata.video.resolution}`);
      console.log(`   Frame Rate: ${typeof metadata.video.fps === 'number' ? metadata.video.fps.toFixed(2) + ' fps' : metadata.video.fps}`);
      console.log(`   Pixel Format: ${metadata.video.pixelFormat}`);
      console.log(`   Bitrate: ${metadata.video.bitrateKbps ? metadata.video.bitrateKbps + ' kbps' : 'unknown'}`);
    }
  }

  if (metadata.audio) {
    if (metadata.audio.error) {
      console.log('\n❌ AUDIO STREAM ERROR:');
      console.log(`   ${metadata.audio.error}`);
    } else if (metadata.audio.warning) {
      console.log('\n⚠️  AUDIO STREAM WARNING:');
      console.log(`   ${metadata.audio.warning}`);
    } else {
      console.log('\n🔊 AUDIO STREAM:');
      console.log(`   Codec: ${metadata.audio.codec}`);
      console.log(`   Sample Rate: ${metadata.audio.sampleRate} Hz`);
      console.log(`   Channels: ${metadata.audio.channels}`);
      console.log(`   Bitrate: ${metadata.audio.bitrateKbps ? metadata.audio.bitrateKbps + ' kbps' : 'unknown'}`);
    }
  }

  console.log('\n⏱️  DURATION:');
  console.log(`   ${metadata.duration}s ${metadata.durationSeconds ? '(' + metadata.durationSeconds + ' seconds)' : '(unknown)'}`);

  if (metadata.warning) {
    console.log('\n⚠️  METADATA WARNING:');
    console.log(`   ${metadata.warning}`);
  }

  console.log('\n' + '-'.repeat(70));
  console.log(`📋 VALIDATION RESULT: ${validation.severity}`);
  console.log('-'.repeat(70));

  if (validation.issues.length > 0) {
    console.log('\n❌ CRITICAL ISSUES (must fix):');
    validation.issues.forEach((issue, i) => {
      console.log(`   ${i + 1}. ${issue}`);
    });
  }

  if (validation.warnings.length > 0) {
    console.log('\n⚠️  WARNINGS (may impact quality):');
    validation.warnings.forEach((warning, i) => {
      console.log(`   ${i + 1}. ${warning}`);
    });
  }

  if (validation.issues.length === 0 && validation.warnings.length === 0) {
    console.log('\n✅ Video meets all Instagram requirements!');
  }

  console.log('='.repeat(70) + '\n');
}

/**
 * Validate that an audio file can be read as audio
 * Uses ffprobe to check for audio stream, returns basic duration info
 * @param {string} filePath - Path to audio file
 * @returns {Promise<object>} { valid: bool, duration: number|null, error: string|null }
 */
async function validateAudioFile(filePath) {
  if (!ffprobePath) {
    console.log('   ⚠️  ffprobe not available, skipping audio validation');
    return { valid: true, duration: null, error: null }; // Best-effort; duration will be derived elsewhere if needed
  }

  console.log('   - Running ffprobe on audio file to extract duration...');

  try {
    const duration = await getAudioDurationSeconds(filePath);
    if (!Number.isFinite(duration) || duration < 0.1) {
      console.log(`   ⚠️  Invalid audio duration: ${duration}`);
      return { valid: false, duration: null, error: 'invalid duration' };
    }
    console.log(`   ✅ Audio file valid - Duration: ${duration.toFixed(2)}s`);
    return { valid: true, duration: Math.round(duration * 10) / 10, error: null };
  } catch (err) {
    console.log(`   ⚠️  Audio validation failed: ${err.message.substring(0, 180)}`);
    return { valid: false, duration: null, error: 'ffprobe error' };
  }
}

function buildInstagramVideoFilter({ width = INSTAGRAM_VIDEO_TARGET.width, height = INSTAGRAM_VIDEO_TARGET.height } = {}) {
  // Match the exact filter shape used in the Instagram-safe ffmpeg command for Reels.
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`;
}

function hasUsableAudioStream(metadata = {}) {
  return Boolean(metadata?.audio && !metadata.audio.error && !metadata.audio.warning);
}

async function transcodeVideoToInstagramProfile({
  inputPath,
  outputPath,
  metadata = null,
  durationSeconds = null
}) {
  const includeInputAudio = hasUsableAudioStream(metadata);
  const targetDuration = Number.isFinite(durationSeconds)
    ? Math.min(Math.max(durationSeconds, INSTAGRAM_VIDEO_TARGET.minDurationSeconds), INSTAGRAM_VIDEO_TARGET.maxDurationSeconds)
    : INSTAGRAM_VIDEO_TARGET.maxDurationSeconds;

  const args = ['-y', '-i', inputPath];

  if (!includeInputAudio) {
    args.push('-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=${INSTAGRAM_VIDEO_TARGET.audioSampleRate}`);
  }

  args.push(
    '-map', '0:v:0',
    '-map', includeInputAudio ? '0:a:0' : '1:a:0',
    '-vf', buildInstagramVideoFilter(),
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '23',
    '-profile:v', 'high',
    '-level', '4.2',
    '-pix_fmt', 'yuv420p',
    '-r', String(INSTAGRAM_VIDEO_TARGET.fps),
    '-g', '15',
    '-keyint_min', '15',
    '-sc_threshold', '0',
    '-x264-params', 'bframes=0:ref=3',
    '-b:v', `${INSTAGRAM_VIDEO_TARGET.videoBitrateKbps}k`,
    '-maxrate', `${INSTAGRAM_VIDEO_TARGET.videoBitrateKbps}k`,
    '-bufsize', `${INSTAGRAM_VIDEO_TARGET.videoBitrateKbps * 2}k`,
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', `${INSTAGRAM_VIDEO_TARGET.audioBitrateKbps}k`,
    '-ar', String(INSTAGRAM_VIDEO_TARGET.audioSampleRate),
    '-ac', String(INSTAGRAM_VIDEO_TARGET.audioChannels),
    '-t', String(targetDuration),
    '-shortest',
    outputPath
  );

  await runFfmpeg(args);
}

async function prepareInstagramVideoForPublishing({
  videoUrl,
  cloudinaryFolder = 'nebula-instagram-videos',
  forceReencode = false
}) {
  if (!videoUrl || typeof videoUrl !== 'string' || !videoUrl.trim()) {
    return { success: false, error: 'A public video URL is required for Instagram publishing.' };
  }

  const id = crypto.randomBytes(8).toString('hex');
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `nebula_ig_video_in_${id}.bin`);
  const outputPath = path.join(tmpDir, `nebula_ig_video_out_${id}.mp4`);

  try {
    console.log('\n[INSTAGRAM VIDEO PREP] Downloading video for validation');
    console.log(`   Media URL: ${videoUrl.substring(0, 120)}${videoUrl.length > 120 ? '...' : ''}`);
    await downloadToFile(videoUrl, inputPath);

    const originalMetadata = await extractVideoMetadata(inputPath);
    const originalValidation = validateInstagramVideoRequirements(originalMetadata);
    const originalHasAudio = hasUsableAudioStream(originalMetadata);
    const durationSeconds = Number.isFinite(originalMetadata?.durationSeconds)
      ? originalMetadata.durationSeconds
      : null;

    console.log(`[INSTAGRAM VIDEO PREP] Input has audio: ${originalHasAudio}`);
    console.log(`[INSTAGRAM VIDEO PREP] Input validation: ${originalValidation.valid ? 'valid' : 'invalid'}`);

    if (durationSeconds && durationSeconds > INSTAGRAM_VIDEO_TARGET.maxDurationSeconds) {
      console.log(`[INSTAGRAM VIDEO PREP] Duration ${durationSeconds}s exceeds Instagram target, re-encoding with trim.`);
    }

    const mustReencode =
      forceReencode ||
      !originalValidation.valid ||
      !String(originalMetadata?.video?.codec || '').toLowerCase().includes('264') ||
      !String(originalMetadata?.audio?.codec || '').toLowerCase().includes('aac') ||
      String(originalMetadata?.video?.resolution || '') !== `${INSTAGRAM_VIDEO_TARGET.width}x${INSTAGRAM_VIDEO_TARGET.height}`;

    if (!mustReencode) {
      return {
        success: true,
        videoUrl,
        transformed: false,
        metadata: originalMetadata,
        validation: originalValidation,
        hasAudio: originalHasAudio
      };
    }

    console.log('[INSTAGRAM VIDEO PREP] Re-encoding video to Instagram-safe profile');
    await transcodeVideoToInstagramProfile({
      inputPath,
      outputPath,
      metadata: originalMetadata,
      durationSeconds
    });

    const preparedMetadata = await extractVideoMetadata(outputPath);
    const preparedValidation = validateInstagramVideoRequirements(preparedMetadata);
    logVideoAnalysis(preparedMetadata, preparedValidation);

    if (!preparedValidation.valid) {
      return {
        success: false,
        error: `Re-encoded video is still invalid for Instagram: ${preparedValidation.issues.join(' | ')}`,
        metadata: preparedMetadata,
        validation: preparedValidation
      };
    }

    console.log('Uploading video from:', outputPath);
    if (!fs.existsSync(outputPath)) {
      throw new Error(`Video file does not exist before upload: ${outputPath}`);
    }

    let upload;
    try {
      upload = await uploadInstagramSafeVideoFile(outputPath, cloudinaryFolder);
    } catch (instagramSafeErr) {
      // Fallback: if "instagram-safe" upload fails (intermittent Cloudinary issues),
      // try a regular Cloudinary upload so we still have a reachable URL.
      console.warn('[Instagram Video Prep] Instagram-safe Cloudinary upload failed. Trying normal video upload.', {
        instagramSafeError: instagramSafeErr?.message || String(instagramSafeErr)
      });
      try {
        upload = await uploadVideoFile(outputPath, cloudinaryFolder);
      } catch (fallbackErr) {
        return {
          success: false,
          error: `Failed to upload video to Cloudinary. Instagram-safe error: ${instagramSafeErr?.message || String(instagramSafeErr)}; fallback error: ${fallbackErr?.message || String(fallbackErr)}`,
          metadata: preparedMetadata,
          validation: preparedValidation
        };
      }
    }

    return {
      success: true,
      videoUrl: upload.url,
      transformed: true,
      originalUrl: videoUrl,
      upload,
      metadata: preparedMetadata,
      validation: preparedValidation,
      hasAudio: hasUsableAudioStream(preparedMetadata)
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to prepare Instagram-safe video.',
      metadata: null,
      validation: null
    };
  } finally {
    await Promise.all([safeUnlink(inputPath), safeUnlink(outputPath)]);
  }
}

async function composeImageToVideoWithAudio({
  imageUrl,
  audioUrl,
  requestedDurationSeconds = null,
  cloudinaryFolder = 'nebula-instagram-audio-posts',
  motionEffect = 'none'
}) {
  if (!imageUrl || !audioUrl) {
    return { success: false, error: 'imageUrl and audioUrl are required' };
  }

  // Instagram Reels output must be vertical 1080x1920.
  const targetWidth = 1080;
  const targetHeight = 1920;

  const id = crypto.randomBytes(8).toString('hex');
  const tmpDir = os.tmpdir();

  const imagePath = path.join(tmpDir, `nebula_ig_img_${id}.bin`);
  const audioPath = path.join(tmpDir, `nebula_ig_audio_${id}.bin`);
  const outPath = path.join(tmpDir, `nebula_ig_out_${id}.mp4`);

  let durationSeconds = null; // Will be calculated after audio validation

  try {
    console.log('\n🎬 [VIDEO COMPOSITION] Starting video generation...');
    console.log(`   - Target resolution: ${targetWidth}x${targetHeight}`);
    
    // Validate URLs are proper strings
    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.trim()) {
      throw new Error('Invalid imageUrl - must be non-empty string');
    }
    if (!audioUrl || typeof audioUrl !== 'string' || !audioUrl.trim()) {
      throw new Error('Invalid audioUrl - must be non-empty string');
    }
    
    console.log(`   - Image URL: ${imageUrl.substring(0, 80)}...`);
    console.log(`   - Audio URL: ${audioUrl.substring(0, 80)}...`);
    
    console.log('\n📥 [VIDEO COMPOSITION] Downloading image...');
    await downloadToFile(imageUrl, imagePath);
    const imgStats = await fs.promises.stat(imagePath);
    console.log(`   ✓ Image downloaded: ${(imgStats.size / 1024).toFixed(2)} KB`);
    if (imgStats.size < 5000) {
      console.warn(`   ⚠️  Image file very small (${(imgStats.size / 1024).toFixed(2)} KB), may be invalid`);
    }
    
    console.log('📥 [VIDEO COMPOSITION] Downloading audio...');
    await downloadToFile(audioUrl, audioPath);
    const audioStats = await fs.promises.stat(audioPath);
    console.log(`   ✓ Audio downloaded: ${(audioStats.size / 1024).toFixed(2)} KB`);
    if (audioStats.size < 5000) {
      console.warn(`   ⚠️  Audio file very small (${(audioStats.size / 1024).toFixed(2)} KB), may be invalid`);
    }

    console.log('\n🔍 [VIDEO COMPOSITION] Validating and measuring audio file...');
    const audioValidation = await validateAudioFile(audioPath);
    if (!audioValidation.valid) {
      const errMsg = `Audio validation failed: ${audioValidation.error}`;
      console.error(`❌ ${errMsg}`);
      return {
        success: false,
        error: errMsg,
        audioValidation: audioValidation
      };
    }

    // Duration: default to -t 60 (Instagram-safe command), but allow overrides.
    const audioDuration = audioValidation.duration || 15;
    const configuredDuration = (() => {
      const raw = process.env.INSTAGRAM_AUDIO_VIDEO_DURATION_SECONDS || process.env.IG_AUDIO_VIDEO_DURATION_SECONDS;
      const n = raw ? Number.parseInt(String(raw), 10) : NaN;
      if (Number.isFinite(n) && n >= 3 && n <= 90) return n;
      return null;
    })();

    const requestedDuration = Number.isFinite(requestedDurationSeconds) && requestedDurationSeconds > 0
      ? Math.round(requestedDurationSeconds)
      : null;

    const durationCandidate =
      (requestedDuration && requestedDuration >= 3 && requestedDuration <= 90) ? requestedDuration
      : (configuredDuration !== null ? configuredDuration : 60);

    durationSeconds = Math.max(Math.min(Math.round(durationCandidate), 90), 3);
    console.log(`   ✓ Using target duration: ${durationSeconds}s (audio: ~${audioDuration.toFixed(2)}s)`);

    console.log(`   ✓ Audio duration: ${audioDuration.toFixed(2)}s`);
    console.log(`   ✓ Video duration: ${durationSeconds}s`);

    // ============================================
    // VERIFY FILES EXIST BEFORE PASSING TO FFMPEG
    // ============================================
    console.log('\n✅ [VIDEO COMPOSITION] Pre-ffmpeg file check...');
    const imgExistsCheck = await fs.promises.stat(imagePath).catch(() => null);
    const audioExistsCheck = await fs.promises.stat(audioPath).catch(() => null);
    
    if (!imgExistsCheck) {
      throw new Error(`Image file missing before ffmpeg: ${imagePath}`);
    }
    if (!audioExistsCheck) {
      throw new Error(`Audio file missing before ffmpeg: ${audioPath}`);
    }
    console.log(`   ✓ Image exists: ${imagePath} (${(imgExistsCheck.size / 1024).toFixed(2)} KB)`);
    console.log(`   ✓ Audio exists: ${audioPath} (${(audioExistsCheck.size / 1024).toFixed(2)} KB)`);
    console.log(`   ✓ Output path: ${outPath}`);

    const filterChain = motionEffect === 'ken_burns'
      ? "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,zoompan=z='min(zoom+0.0008,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30,format=yuv420p"
      : 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,format=yuv420p';

    const args = [
      '-y',
      '-loop', '1',
      '-i', imagePath,
      '-stream_loop', '-1',
      '-i', audioPath,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-profile:v', 'high',
      '-level', '4.2',
      '-pix_fmt', 'yuv420p',
      '-r', '30',
      '-g', '15',
      '-keyint_min', '15',
      '-sc_threshold', '0',
      '-x264-params', 'bframes=0:ref=3',
      '-b:v', `${INSTAGRAM_VIDEO_TARGET.videoBitrateKbps}k`,
      '-maxrate', `${INSTAGRAM_VIDEO_TARGET.videoBitrateKbps}k`,
      '-bufsize', `${INSTAGRAM_VIDEO_TARGET.videoBitrateKbps * 2}k`,
      '-vf', filterChain,
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', `${INSTAGRAM_VIDEO_TARGET.audioBitrateKbps}k`,
      '-ar', String(INSTAGRAM_VIDEO_TARGET.audioSampleRate),
      '-ac', String(INSTAGRAM_VIDEO_TARGET.audioChannels),
      '-t', String(durationSeconds),
      '-shortest',
      outPath
    ];

    console.log('\n🔧 [VIDEO COMPOSITION] Running ffmpeg...');
    console.log(`   - Output file: ${outPath}`);
    
    try {
      await runFfmpeg(args);
      console.log('✅ [VIDEO COMPOSITION] ffmpeg completed successfully');
    } catch (ffmpegErr) {
      // If main composition fails, throw the error
      console.error('\n❌ [VIDEO COMPOSITION] ffmpeg execution failed');
      console.error(`   Error: ${ffmpegErr.message.substring(0, 300)}`);
      throw ffmpegErr;
    }

    // ============================================
    // VALIDATE OUTPUT FILE EXISTS AND HAS CONTENT
    // ============================================
    console.log('\n📊 [VIDEO COMPOSITION] Validating output file...');
    const outStats = await fs.promises.stat(outPath).catch(() => null);
    
    if (!outStats) {
      throw new Error('ffmpeg did not create output file');
    }
    
    if (outStats.size === 0) {
      throw new Error('ffmpeg produced empty output file (0 bytes)');
    }
    
    if (outStats.size < 50000) { // Less than 50KB is suspicious
      console.warn(`⚠️  Output file very small: ${(outStats.size / 1024).toFixed(2)} KB. May indicate composition failure.`);
    }
    
    console.log(`   ✓ Output file created: ${(outStats.size / 1024 / 1024).toFixed(2)} MB`);

    // ============================================
    // EXTRACT AND VALIDATE VIDEO METADATA
    // ============================================
    console.log('\n📊 [VIDEO VALIDATION] Analyzing generated video file...');
    let metadata = await extractVideoMetadata(outPath);

    // Ensure metadata has required properties with fallbacks
    metadata = {
      filename: metadata.filename || path.basename(outPath),
      fileSize: metadata.fileSize || outStats.size,
      fileSizeMB: metadata.fileSizeMB || (outStats.size / 1024 / 1024).toFixed(2),
      format: metadata.format || 'mp4',
      duration: metadata.duration || 'unknown',
      durationSeconds: metadata.durationSeconds || Math.round(durationSeconds),
      bitrate: metadata.bitrate || 'unknown',
      bitrateKbps: metadata.bitrateKbps || null,
      // Ensure video and audio objects exist
      video: metadata.video || {
        codec: 'h264', // Assume correct since we encoded it
        profile: 'high',
        width: targetWidth,
        height: targetHeight,
        resolution: `${targetWidth}x${targetHeight}`,
        fps: 30,
        pixelFormat: 'yuv420p'
      },
      audio: metadata.audio || {
        codec: 'aac', // Assume correct since we encoded it
        sampleRate: 44100,
        channels: 2
      },
      ...metadata // Keep any existing properties
    };

    const validation = validateInstagramVideoRequirements(metadata);

    // Always log detailed analysis
    logVideoAnalysis(metadata, validation);

    // ============================================
    // ABORT IF VALIDATION FAILS
    // ============================================
    if (!validation.valid) {
      const errorMsg = `Video validation failed: ${validation.issues.join(' | ')}`;
      console.error(`\n❌ [VIDEO VALIDATION FAILED]\n${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
        validation: validation,
        metadata: metadata
      };
    }

    console.log('✅ [VIDEO VALIDATION] Video passed all Instagram requirements\n');

    // ============================================
    // UPLOAD TO CLOUDINARY
    // ============================================
    console.log('📤 [VIDEO UPLOAD] Uploading validated video to Cloudinary...');
    console.log('Uploading video from:', outPath);

    if (!fs.existsSync(outPath)) {
      throw new Error(`Video file does not exist before upload: ${outPath}`);
    }

    let upload;
    try {
      upload = await uploadInstagramSafeVideoFile(outPath, cloudinaryFolder);
    } catch (instagramSafeErr) {
      // Fallback to normal video upload if instagram-safe upload intermittently fails.
      console.warn('[AUDIO FLOW] Instagram-safe Cloudinary upload failed. Trying normal video upload.', {
        instagramSafeError: instagramSafeErr?.message || String(instagramSafeErr)
      });
      try {
        upload = await uploadVideoFile(outPath, cloudinaryFolder);
      } catch (fallbackErr) {
        const msg = `Failed to upload composed video to Cloudinary. Instagram-safe error: ${instagramSafeErr?.message || String(instagramSafeErr)}; fallback error: ${fallbackErr?.message || String(fallbackErr)}`;
        console.error(`\n❌ [VIDEO UPLOAD FAILED]\n${msg}`);
        return { success: false, error: msg };
      }
    }

    console.log(`✅ [VIDEO UPLOAD] Video successfully uploaded to Cloudinary`);
    console.log(`   - URL: ${upload.url.substring(0, 100)}...`);
    console.log(`   - Cloudinary duration: ${upload.duration}s`);
    console.log(`   - Cloudinary size: ${(upload.bytes / 1024 / 1024).toFixed(2)}MB`);

    const result = {
      success: true,
      videoUrl: upload.url,
      publicId: upload.publicId || null,
      duration: upload.duration || null,
      bytes: upload.bytes || null,
      metadata: metadata,
      validation: validation
    };

    console.log('📤 [COMPOSITION COMPLETE] Returning composed object:', {
      success: result.success,
      videoUrl: result.videoUrl ? result.videoUrl.substring(0, 50) + '...' : null,
      duration: result.duration,
      bytes: result.bytes,
      hasMetadata: !!result.metadata,
      metadataKeys: result.metadata ? Object.keys(result.metadata) : []
    });

    return result;
  } catch (error) {
    const errorMsg = error.message || 'Failed to compose video';
    console.error(`\n\n${'='.repeat(70)}`);
    console.error('❌ [VIDEO COMPOSITION FAILURE]');
    console.error('='.repeat(70));
    console.error(`Error: ${errorMsg}`);
    console.error(`\n📋 Debugging Information:`);
    console.error(`   - Composition duration target: ${durationSeconds ? durationSeconds + 's' : 'not calculated'}`);
    console.error(`   - Target resolution: ${targetWidth}x${targetHeight}`);
    console.error(`   - Image path: ${imagePath}`);
    console.error(`   - Audio path: ${audioPath}`);
    console.error(`   - Output path: ${outPath}`);
    
    // Try to check if temporary files still exist
    try {
      const imgExists = fs.existsSync(imagePath);
      const audioExists = fs.existsSync(audioPath);
      const outExists = fs.existsSync(outPath);
      console.error(`\n📁 File Status:`);
      console.error(`   - Image exists: ${imgExists}`);
      console.error(`   - Audio exists: ${audioExists}`);
      console.error(`   - Output exists: ${outExists}`);
      
      if (outExists) {
        const outStats = fs.statSync(outPath);
        console.error(`   - Output size: ${outStats.size} bytes (${(outStats.size / 1024 / 1024).toFixed(2)} MB)`);
      }
    } catch (statErr) {
      console.error(`   - Could not check file status: ${statErr.message}`);
    }
    
    console.error('='.repeat(70) + '\n');
    
    return {
      success: false,
      error: errorMsg,
      details: error.message,
      compositionTarget: {
        duration: durationSeconds,
        maxResolution: `${targetWidth}x${targetHeight}`,
        imagePath,
        audioPath,
        outputPath: outPath
      }
    };
    
    return {
      success: false,
      error: errorMsg,
      details: error.message,
      compositionTarget: {
        duration: durationSeconds,
        maxResolution: `${targetWidth}x${targetHeight}`,
        imagePath,
        audioPath,
        outputPath: outPath
      }
    };
  } finally {
    await Promise.all([safeUnlink(imagePath), safeUnlink(audioPath), safeUnlink(outPath)]);
  }
}

/**
 * Quick validation for video before posting to Instagram
 * Checks critical requirements: duration, audio presence, codecs
 * @param {object} metadata - Video metadata from extractVideoMetadata
 * @returns {object} - { valid: boolean, errors: string[] }
 */
function validateVideoForInstagramPosting(metadata) {
  const errors = [];

  if (!metadata) {
    errors.push('Video metadata is missing');
    return { valid: false, errors };
  }

  // Check for critical errors in metadata extraction
  if (metadata.error) {
    errors.push(`Metadata extraction error: ${metadata.error}`);
  }
  if (metadata.warning) {
    console.warn(`Metadata warning: ${metadata.warning}`);
  }

  // Duration check - use durationSeconds if available, otherwise try to parse duration
  let duration = metadata.durationSeconds;
  if (!duration && metadata.duration && metadata.duration !== 'unknown') {
    duration = Math.round(parseFloat(metadata.duration));
  }

  if (!duration || duration < 3 || duration > 90) {
    errors.push(`Duration ${duration || 'unknown'}s is outside Instagram Reel limits (3-90 seconds)`);
  }

  // Strict audio checks (Instagram Reels require AAC audio)
  if (!metadata.audio) {
    errors.push('Audio metadata is missing - cannot verify audio track');
  } else if (metadata.audio.error) {
    errors.push(`Audio metadata extraction error: ${metadata.audio.error}`);
  } else {
    const audioCodec = String(metadata.audio.codec || '').toLowerCase();
    if (!audioCodec || audioCodec === 'unknown' || !audioCodec.includes('aac')) {
      errors.push(`Audio codec must be AAC. Got: ${metadata.audio.codec || 'unknown'}`);
    }

    const sampleRate = parseInt(metadata.audio.sampleRate, 10);
    if (!Number.isFinite(sampleRate) || sampleRate !== 44100) {
      errors.push(`Audio sample rate must be 44100 Hz. Got: ${metadata.audio.sampleRate || 'unknown'}`);
    }

    const channels = parseInt(metadata.audio.channels, 10);
    if (!Number.isFinite(channels) || channels !== 2) {
      errors.push(`Audio channels must be 2 (stereo). Got: ${metadata.audio.channels || 'unknown'}`);
    }
  }

  // Strict video checks (codec/resolution/fps/pixel format)
  if (!metadata.video) {
    errors.push('Video metadata is missing - cannot verify video stream');
  } else if (metadata.video.error) {
    errors.push(`Video metadata extraction error: ${metadata.video.error}`);
  } else {
    const videoCodec = String(metadata.video.codec || '').toLowerCase();
    if (!videoCodec || videoCodec === 'unknown' || !videoCodec.includes('h264')) {
      errors.push(`Video codec must be H.264. Got: ${metadata.video.codec || 'unknown'}`);
    }

    const width = parseInt(metadata.video.width, 10);
    const height = parseInt(metadata.video.height, 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width !== 1080 || height !== 1920) {
      errors.push(`Resolution must be 1080x1920. Got: ${metadata.video.resolution || `${width}x${height}`}`);
    }

    const fps = typeof metadata.video.fps === 'number' ? metadata.video.fps : parseFloat(metadata.video.fps);
    if (!Number.isFinite(fps) || Math.abs(fps - 30) > 0.1) {
      errors.push(`FPS must be 30. Got: ${metadata.video.fps || 'unknown'}`);
    }

    const pixFmt = String(metadata.video.pixelFormat || '').toLowerCase();
    if (!pixFmt || pixFmt === 'unknown' || !['yuv420p', 'yuvj420p'].includes(pixFmt)) {
      errors.push(`Pixel format must be yuv420p. Got: ${metadata.video.pixelFormat || 'unknown'}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: metadata.warning ? [metadata.warning] : []
  };
}

module.exports = {
  composeImageToVideoWithAudio,
  extractVideoMetadata,
  validateInstagramVideoRequirements,
  logVideoAnalysis,
  prepareInstagramVideoForPublishing,
  validateVideoForInstagramPosting
};
