/**
 * Image Upload Service
 * Uploads images to Cloudinary for public hosting
 * Required for Ayrshare which needs externally accessible URLs
 */

const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

function isRetriableCloudinaryError(error) {
  const code = error?.code;
  const msg = (error?.message || error?.toString?.() || '').toLowerCase();
  const retriableCodes = new Set([
    'ECONNRESET',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ENOTFOUND',
    'ECONNREFUSED',
    'UND_ERR_CONNECT_TIMEOUT'
  ]);
  return (code && retriableCodes.has(code)) || msg.includes('timeout') || msg.includes('econnreset');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Upload a base64 image to Cloudinary
 * @param {string} base64Data - Base64 encoded image data (with or without data URL prefix)
 * @param {string} folder - Optional folder name in Cloudinary
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
async function uploadBase64Image(base64Data, folder = 'nebula-campaigns') {
  const maxRetries = 2;
  const baseDelayMs = 500;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Ensure the base64 string has the proper data URL prefix
      let uploadData = base64Data;
      if (!base64Data.startsWith('data:')) {
        // Assume it's a JPEG if no prefix
        uploadData = `data:image/jpeg;base64,${base64Data}`;
      }

      const result = await cloudinary.uploader.upload(uploadData, {
        folder: folder,
        resource_type: 'image',
        timeout: 60000,
        transformation: [
          { quality: 'auto:good' },
          { fetch_format: 'auto' }
        ]
      });

      console.log('✅ Image uploaded to Cloudinary:', result.secure_url);

      return {
        success: true,
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
        format: result.format
      };
    } catch (error) {
      const errMsg = error?.message
        || (typeof error === 'string' ? error : null)
        || error?.toString?.()
        || 'Cloudinary upload failed (no message)';

      console.error('❌ Cloudinary upload error:', errMsg, {
        attempt: attempt + 1,
        maxRetries: maxRetries + 1,
        name: error?.name,
        code: error?.code,
        stack: error?.stack
      });

      if (attempt < maxRetries && isRetriableCloudinaryError(error)) {
        const waitMs = baseDelayMs * (attempt + 1);
        await sleep(waitMs);
        continue;
      }

      return {
        success: false,
        error: errMsg
      };
    }
  }

  return { success: false, error: 'Cloudinary upload failed after retries' };
}

/**
 * Upload multiple base64 images
 * @param {string[]} base64Images - Array of base64 encoded images
 * @param {string} folder - Optional folder name
 * @returns {Promise<string[]>} - Array of uploaded URLs
 */
async function uploadMultipleImages(base64Images, folder = 'nebula-campaigns') {
  const uploadPromises = base64Images.map(img => uploadBase64Image(img, folder));
  const results = await Promise.all(uploadPromises);
  
  // Return only successful uploads
  return results
    .filter(r => r.success)
    .map(r => r.url);
}

/**
 * Check if a URL is a base64 data URL
 * @param {string} url - The URL to check
 * @returns {boolean}
 */
function isBase64DataUrl(url) {
  return url && (url.startsWith('data:image') || url.startsWith('data:application'));
}

/**
 * Check if a URL is a base64 audio data URL
 * @param {string} url - The URL to check
 * @returns {boolean}
 */
function isBase64AudioDataUrl(url) {
  return url && url.startsWith('data:audio');
}

/**
 * Upload a base64 audio file to Cloudinary (stored as resource_type: video)
 * @param {string} base64Data - Base64 encoded audio (with or without data URL prefix)
 * @param {string} folder - Optional folder name in Cloudinary
 * @returns {Promise<{success: boolean, url?: string, publicId?: string, bytes?: number, format?: string, error?: string}>}
 */
async function uploadBase64Audio(base64Data, folder = 'nebula-audio') {
  const maxRetries = 2;
  const baseDelayMs = 500;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      let uploadData = base64Data;
      if (!base64Data.startsWith('data:')) {
        // Assume mp3 if no prefix
        uploadData = `data:audio/mpeg;base64,${base64Data}`;
      }

      const result = await cloudinary.uploader.upload(uploadData, {
        folder: folder,
        resource_type: 'video',
        timeout: 60000
      });

      console.log('✅ Audio uploaded to Cloudinary:', result.secure_url);

      return {
        success: true,
        url: result.secure_url,
        publicId: result.public_id,
        bytes: result.bytes,
        format: result.format,
        duration: result.duration
      };
    } catch (error) {
      const errMsg = error?.message
        || (typeof error === 'string' ? error : null)
        || error?.toString?.()
        || 'Cloudinary audio upload failed (no message)';
      console.error('❌ Cloudinary audio upload error:', errMsg, {
        attempt: attempt + 1,
        maxRetries: maxRetries + 1,
        name: error?.name,
        code: error?.code,
        stack: error?.stack
      });

      if (attempt < maxRetries && isRetriableCloudinaryError(error)) {
        const waitMs = baseDelayMs * (attempt + 1);
        await sleep(waitMs);
        continue;
      }

      return {
        success: false,
        error: errMsg
      };
    }
  }

  return { success: false, error: 'Cloudinary audio upload failed after retries' };
}

/**
 * Ensure an audio reference is publicly accessible.
 * If it's already a hosted URL, return as-is.
 * If it's a base64 audio data URL, upload to Cloudinary first.
 * @param {string} audioUrl - Audio URL or base64 data URL
 * @returns {Promise<string|null>} - Publicly accessible URL
 */
async function ensurePublicAudioUrl(audioUrl) {
  if (!audioUrl) return null;

  if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
    return audioUrl;
  }

  if (isBase64AudioDataUrl(audioUrl)) {
    const result = await uploadBase64Audio(audioUrl);
    return result.success ? result.url : null;
  }

  console.warn('Unknown audio format:', audioUrl.substring(0, 50));
  return null;
}

/**
 * Upload a local video file (mp4) to Cloudinary for public hosting
 * @param {string} filePath - Path to the file on disk
 * @param {string} folder - Optional folder name in Cloudinary
 * @returns {Promise<{success: boolean, url?: string, publicId?: string, bytes?: number, format?: string, error?: string}>}
 */
async function uploadVideoFile(filePath, folder = 'nebula-videos') {
  try {
    const absPath = path.resolve(filePath);

    if (!fs.existsSync(absPath)) {
      throw new Error(`Video file does not exist before upload: ${absPath}`);
    }

    console.log('Uploading video from:', absPath);

    const result = await cloudinary.uploader.upload(absPath, {
      folder: folder,
      resource_type: 'video',
      timeout: 60000
    });

    if (!result || !result.secure_url) {
      throw new Error('Cloudinary upload failed - no URL returned');
    }

    console.log('✅ Video uploaded to Cloudinary:', result.secure_url);

    return {
      success: true,
      url: result.secure_url,
      publicId: result.public_id,
      bytes: result.bytes,
      format: result.format,
      duration: result.duration
    };
  } catch (error) {
    console.error('Upload failed:', error);
    throw error;
  }
}

/**
 * Upload a local video file and return the raw Cloudinary URL without transformations.
 * No transformations are applied to ensure Instagram-safe encoding is preserved.
 * @param {string} filePath - Path to the file on disk
 * @param {string} folder - Optional folder name in Cloudinary
 * @returns {Promise<{success: boolean, url?: string, originalUrl?: string, publicId?: string, bytes?: number, format?: string, duration?: number, error?: string}>}
 */
async function uploadInstagramSafeVideoFile(filePath, folder = 'nebula-instagram-videos') {
  try {
    const absPath = path.resolve(filePath);

    if (!fs.existsSync(absPath)) {
      throw new Error(`Video file does not exist before upload: ${absPath}`);
    }

    console.log('Uploading video from:', absPath);

    const result = await cloudinary.uploader.upload(absPath, {
      folder,
      resource_type: 'video',
      format: 'mp4',
      // Removed eager transformations - using raw uploaded video URL only
      timeout: 60000
    });

    // Return the raw uploaded URL without any transformations
    if (!result || !result.secure_url) {
      throw new Error('Cloudinary upload failed - no URL returned');
    }

    const rawVideoUrl = result.secure_url;

    console.log('✅ Instagram-safe video uploaded to Cloudinary (no transformations):', rawVideoUrl);
    console.log('   - Raw URL format: /video/upload/v' + result.version + '/' + result.public_id + '.mp4');

    return {
      success: true,
      url: rawVideoUrl,
      originalUrl: rawVideoUrl, // Same as url since no transformations
      publicId: result.public_id,
      bytes: result.bytes,
      format: 'mp4',
      duration: result.duration
    };
  } catch (error) {
    console.error('Upload failed:', error);
    throw error;
  }
}

/**
 * Convert image URL to Cloudinary URL if needed
 * If it's already a hosted URL, return as-is
 * If it's a base64 data URL, upload to Cloudinary first
 * @param {string} imageUrl - The image URL to process
 * @returns {Promise<string|null>} - Publicly accessible URL
 */
async function ensurePublicUrl(imageUrl, { strict = false } = {}) {
  if (!imageUrl) return null;
  
  // If it's already a hosted URL, return as-is
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }
  
  // If it's a base64 data URL, upload to Cloudinary
  if (isBase64DataUrl(imageUrl)) {
    const result = await uploadBase64Image(imageUrl);
    if (result.success) return result.url;
    const msg = result.error || 'Cloudinary base64 image upload failed';
    if (strict) {
      throw new Error(msg);
    }
    return null;
  }
  
  // Unknown format
  console.warn('Unknown image format:', imageUrl.substring(0, 50));
  return null;
}

/**
 * Upload a logo and return its public ID for overlay operations
 * Automatically removes background from the logo
 * @param {string} logoData - Base64 or URL of the logo
 * @param {boolean} removeBackground - Whether to remove background (default: true)
 * @returns {Promise<{success: boolean, publicId?: string, url?: string, error?: string}>}
 */
async function uploadLogo(logoData, removeBackground = true) {
  try {
    let uploadData = logoData;
    if (!logoData.startsWith('data:') && !logoData.startsWith('http')) {
      uploadData = `data:image/png;base64,${logoData}`;
    }

    // Build transformations
    const transformations = [
      { quality: 'auto:best' },
      { fetch_format: 'png' }
    ];
    
    // Add background removal if requested
    // Cloudinary's AI-based background removal
    if (removeBackground) {
      transformations.unshift({ background: 'transparent' });
      transformations.unshift({ effect: 'background_removal' });
    }

    // For URLs, we need to upload them to get a public_id
    const result = await cloudinary.uploader.upload(uploadData, {
      folder: 'nebula-logos',
      resource_type: 'image',
      transformation: transformations
    });

    console.log('✅ Logo uploaded to Cloudinary (bg removed:', removeBackground, '):', result.public_id);

    return {
      success: true,
      url: result.secure_url,
      publicId: result.public_id,
      backgroundRemoved: removeBackground
    };
  } catch (error) {
    console.error('❌ Logo upload error:', error.message);
    // If background removal fails, try without it
    if (removeBackground && error.message.includes('background_removal')) {
      console.log('⚠️ Background removal failed, retrying without it...');
      return uploadLogo(logoData, false);
    }
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Upload an image and overlay a logo on it
 * @param {string} imageData - Base64 or URL of the main image
 * @param {string} logoPublicId - Cloudinary public ID of the logo
 * @param {object} options - Overlay options (position, size, opacity)
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
async function uploadImageWithLogoOverlay(imageData, logoPublicId, options = {}) {
  try {
    const {
      position = 'south_east', // bottom-right by default
      width = 120,
      opacity = 90,
      margin = 20
    } = options;

    let uploadData = imageData;
    if (!imageData.startsWith('data:') && !imageData.startsWith('http')) {
      uploadData = `data:image/png;base64,${imageData}`;
    }

    // Upload with logo overlay transformation
    const result = await cloudinary.uploader.upload(uploadData, {
      folder: 'nebula-campaigns',
      resource_type: 'image',
      transformation: [
        { quality: 'auto:good' },
        { 
          overlay: logoPublicId.replace('/', ':'),
          gravity: position,
          width: width,
          opacity: opacity,
          x: margin,
          y: margin
        }
      ]
    });

    console.log('✅ Image with logo overlay uploaded:', result.secure_url);

    return {
      success: true,
      url: result.secure_url,
      publicId: result.public_id
    };
  } catch (error) {
    console.error('❌ Image with logo overlay error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Delete an image from Cloudinary
 * @param {string} publicId - Cloudinary public ID of the image
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteImage(publicId) {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    console.log('🗑️ Image deleted from Cloudinary:', publicId, result);
    return {
      success: result.result === 'ok',
      result: result.result
    };
  } catch (error) {
    console.error('❌ Cloudinary delete error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  uploadBase64Image,
  uploadMultipleImages,
  isBase64DataUrl,
  isBase64AudioDataUrl,
  ensurePublicUrl,
  ensurePublicAudioUrl,
  uploadBase64Audio,
  uploadVideoFile,
  uploadInstagramSafeVideoFile,
  uploadLogo,
  uploadImageWithLogoOverlay,
  deleteImage
};
