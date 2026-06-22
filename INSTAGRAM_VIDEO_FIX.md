# Instagram-Safe Video Encoding Implementation

## Overview
This implementation fixes Instagram Error 138 by ensuring videos are encoded with Instagram's strict requirements for Reels.

## Changes Made

### 1. Updated Video Encoding Standards
- **Video Bitrate**: Changed from 3500k to 3000k (constant bitrate)
- **Audio Sample Rate**: Changed from 48000Hz to 44100Hz
- **Container**: MP4
- **Video Codec**: H.264 (libx264)
- **Resolution**: 1080x1920 (9:16 aspect ratio)
- **FPS**: 30
- **Pixel Format**: yuv420p
- **Audio Codec**: AAC
- **Audio Bitrate**: 128k
- **Audio Channels**: 2 (stereo)
- **Flags**: +faststart

### 2. Removed Cloudinary Transformations
- Removed `INSTAGRAM_SAFE_VIDEO_TRANSFORMATION` that applied:
  - `b_black` (background black)
  - `c_pad` (crop pad)
  - `ac_aac` (audio codec AAC)
  - `br_3500k` (bitrate 3500k)
- Now uses raw uploaded video URL: `/video/upload/v12345/video.mp4`

### 3. Updated FFmpeg Command
The final ffmpeg command for combining image + audio:

```bash
ffmpeg -y \
  -loop 1 \
  -i image.jpg \
  -stream_loop -1 \
  -i audio.mp3 \
  -c:v libx264 \
  -preset medium \
  -profile:v high \
  -level 4.0 \
  -pix_fmt yuv420p \
  -r 30 \
  -g 60 \
  -keyint_min 60 \
  -sc_threshold 0 \
  -b:v 3000k \
  -maxrate 3000k \
  -bufsize 6000k \
  -t 30 \
  -shortest \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p" \
  -c:a aac \
  -b:a 128k \
  -ar 44100 \
  -ac 2 \
  -movflags +faststart \
  output.mp4
```

### 4. Added Validation Before Posting
- Duration: 3-90 seconds
- Audio track presence
- Video codec: H.264/AVC
- Audio codec: AAC

### 5. Added Debug Logging
- Final video URL sent to Ayrshare
- Encoding details (codec, bitrate, resolution)
- Cloudinary transformation status
- Pre-posting validation results

### 6. Backend Pipeline Updates
- Always sends video posts as `type: "reel"`
- Added 8-second delay before posting
- Comprehensive error handling

## Files Modified

1. `backend/services/mediaComposer.js`
   - Updated `INSTAGRAM_VIDEO_TARGET` constants
   - Modified ffmpeg command for constant bitrate
   - Added `validateVideoForInstagramPosting()` function

2. `backend/services/imageUploader.js`
   - Removed `INSTAGRAM_SAFE_VIDEO_TRANSFORMATION`
   - Modified `uploadInstagramSafeVideoFile()` to return raw URLs

3. `backend/routes/campaigns.js`
   - Added debug logging for Instagram posting
   - Added pre-posting validation
   - Added delay before posting
   - Updated imports

## Validation Function

```javascript
/**
 * Quick validation for video before posting to Instagram
 * @param {object} metadata - Video metadata
 * @returns {object} - { valid: boolean, errors: string[] }
 */
function validateVideoForInstagramPosting(metadata) {
  const errors = [];
  
  if (!metadata) {
    errors.push('Video metadata is missing');
    return { valid: false, errors };
  }
  
  // Duration check
  const duration = metadata.durationSeconds;
  if (!duration || duration < 3 || duration > 90) {
    errors.push(`Duration ${duration || 'unknown'}s is outside Instagram Reel limits (3-90 seconds)`);
  }
  
  // Audio check
  if (!metadata.audio || metadata.audio.error) {
    errors.push('Video has no audio track - Instagram Reels require audio');
  } else {
    const audioCodec = String(metadata.audio.codec || '').toLowerCase();
    if (!audioCodec.includes('aac')) {
      errors.push(`Audio codec ${metadata.audio.codec || 'unknown'} is not AAC - Instagram requires AAC`);
    }
  }
  
  // Video codec check
  if (!metadata.video || metadata.video.error) {
    errors.push('Video stream missing or corrupted');
  } else {
    const videoCodec = String(metadata.video.codec || '').toLowerCase();
    if (!videoCodec.includes('h264') && !videoCodec.includes('h.264') && videoCodec !== 'avc1') {
      errors.push(`Video codec ${metadata.video.codec || 'unknown'} is not H.264 - Instagram requires H.264/AVC`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
```

## Node.js Integration Example

```javascript
const { composeImageToVideoWithAudio, validateVideoForInstagramPosting } = require('./services/mediaComposer');

// 1. Compose video from image + audio
const result = await composeImageToVideoWithAudio({
  imageUrl: 'https://example.com/image.jpg',
  audioUrl: 'https://example.com/audio.mp3',
  requestedDurationSeconds: 30
});

if (!result.success) {
  console.error('Video composition failed:', result.error);
  return;
}

// 2. Validate before posting
const validation = validateVideoForInstagramPosting(result.metadata);
if (!validation.valid) {
  console.error('Video validation failed:', validation.errors);
  return;
}

// 3. Post to Ayrshare
const ayrsharePayload = {
  post: 'Your caption here',
  platforms: ['instagram'],
  mediaUrls: [result.videoUrl],
  type: 'reel',
  isVideo: true,
  mediaType: 'video'
};

// Add delay before posting
await new Promise(resolve => setTimeout(resolve, 8000));

const ayrshareResponse = await postToSocialMedia(['instagram'], caption, {
  mediaUrls: [result.videoUrl],
  type: 'reel',
  isVideo: true,
  mediaType: 'video'
});
```

## Expected Outcome
- Instagram accepts videos without Error 138
- Videos post successfully as Reels
- No retry or rejection occurs
- Comprehensive logging for debugging