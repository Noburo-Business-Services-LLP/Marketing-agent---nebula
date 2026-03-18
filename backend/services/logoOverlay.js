/**
 * Logo Overlay Service
 * Composites logos onto images using Sharp for high-quality results
 */

const sharp = require('sharp');
const fetch = require('node-fetch');

/**
 * Position mapping for logo placement
 */
const POSITION_MAP = {
  'top-left': { gravity: 'northwest', x: 20, y: 20 },
  'top-right': { gravity: 'northeast', x: 20, y: 20 },
  'bottom-left': { gravity: 'southwest', x: 20, y: 20 },
  'bottom-right': { gravity: 'southeast', x: 20, y: 20 },
  'center': { gravity: 'center', x: 0, y: 0 }
};

/**
 * Size mapping for logo dimensions (percentage of image width)
 */
const SIZE_MAP = {
  'small': 0.10,   // 10% of image width
  'medium': 0.15,  // 15% of image width
  'large': 0.20    // 20% of image width
};

/**
 * Fetch image from URL and return as buffer
 */
async function fetchImageBuffer(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error('Error fetching image:', error.message);
    throw error;
  }
}

/**
 * Convert base64 data URL to buffer
 */
function base64ToBuffer(base64Data) {
  // Remove data URL prefix if present
  const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
  return Buffer.from(base64, 'base64');
}

/**
 * Get image buffer from URL or base64
 */
async function getImageBuffer(imageSource) {
  if (imageSource.startsWith('data:')) {
    return base64ToBuffer(imageSource);
  } else if (imageSource.startsWith('http')) {
    return await fetchImageBuffer(imageSource);
  }
  throw new Error('Invalid image source - must be URL or base64 data');
}

/**
 * Overlay a logo onto an image
 * @param {string} baseImageSource - Base image URL or base64
 * @param {string} logoSource - Logo URL or base64
 * @param {object} options - Overlay options
 * @returns {Promise<Buffer>} - Composited image as PNG buffer
 */
async function overlayLogo(baseImageSource, logoSource, options = {}) {
  const {
    position = 'bottom-right',
    size = 'medium',
    opacity = 0.9,
    padding = 20
  } = options;

  try {
    console.log('🎨 Starting logo overlay...');
    console.log(`   Position: ${position}, Size: ${size}, Opacity: ${opacity}`);

    // Get image buffers
    const [baseBuffer, logoBuffer] = await Promise.all([
      getImageBuffer(baseImageSource),
      getImageBuffer(logoSource)
    ]);

    // Get base image metadata
    const baseMetadata = await sharp(baseBuffer).metadata();
    const baseWidth = baseMetadata.width || 1080;
    const baseHeight = baseMetadata.height || 1080;

    console.log(`   Base image: ${baseWidth}x${baseHeight}`);

    // Calculate logo size
    const sizeMultiplier = SIZE_MAP[size] || SIZE_MAP['medium'];
    const targetLogoWidth = Math.round(baseWidth * sizeMultiplier);

    // Resize logo maintaining aspect ratio
    const resizedLogo = await sharp(logoBuffer)
      .resize(targetLogoWidth, null, { fit: 'inside' })
      .ensureAlpha()
      .png()
      .toBuffer();

    // Get resized logo dimensions
    const logoMetadata = await sharp(resizedLogo).metadata();
    const logoWidth = logoMetadata.width;
    const logoHeight = logoMetadata.height;

    console.log(`   Logo resized to: ${logoWidth}x${logoHeight}`);

    // Calculate position
    const posConfig = POSITION_MAP[position] || POSITION_MAP['bottom-right'];
    let left, top;

    switch (position) {
      case 'top-left':
        left = padding;
        top = padding;
        break;
      case 'top-right':
        left = baseWidth - logoWidth - padding;
        top = padding;
        break;
      case 'bottom-left':
        left = padding;
        top = baseHeight - logoHeight - padding;
        break;
      case 'bottom-right':
        left = baseWidth - logoWidth - padding;
        top = baseHeight - logoHeight - padding;
        break;
      case 'center':
        left = Math.round((baseWidth - logoWidth) / 2);
        top = Math.round((baseHeight - logoHeight) / 2);
        break;
      default:
        left = baseWidth - logoWidth - padding;
        top = baseHeight - logoHeight - padding;
    }

    // Apply opacity to logo if not 100%
    let finalLogo = resizedLogo;
    if (opacity < 1) {
      // Create semi-transparent version
      const { data, info } = await sharp(resizedLogo)
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      // Modify alpha channel
      const channels = info.channels;
      if (channels === 4) {
        for (let i = 3; i < data.length; i += 4) {
          data[i] = Math.round(data[i] * opacity);
        }
        finalLogo = await sharp(data, {
          raw: { width: info.width, height: info.height, channels: 4 }
        }).png().toBuffer();
      }
    }

    // Composite the images
    const result = await sharp(baseBuffer)
      .composite([{
        input: finalLogo,
        left: Math.max(0, left),
        top: Math.max(0, top)
      }])
      .png({ quality: 90 })
      .toBuffer();

    console.log('✅ Logo overlay complete');
    return result;

  } catch (error) {
    console.error('❌ Logo overlay error:', error.message);
    throw error;
  }
}

/**
 * Overlay logo and return as base64 data URL
 */
async function overlayLogoBase64(baseImageSource, logoSource, options = {}) {
  const buffer = await overlayLogo(baseImageSource, logoSource, options);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

/**
 * Overlay logo, upload to Cloudinary, and return URL
 */
async function overlayLogoAndUpload(baseImageSource, logoSource, options = {}) {
  const { uploadBase64Image } = require('./imageUploader');
  
  const buffer = await overlayLogo(baseImageSource, logoSource, options);
  const base64 = `data:image/png;base64,${buffer.toString('base64')}`;
  
  const uploadResult = await uploadBase64Image(base64, 'nebula-posters');
  
  if (uploadResult.success) {
    return {
      success: true,
      url: uploadResult.url,
      publicId: uploadResult.publicId
    };
  }
  
  return {
    success: false,
    error: uploadResult.error || 'Upload failed'
  };
}

/**
 * Replace logo at detected bounding box coordinates
 * @param {string} baseImageSource - Base image URL or base64
 * @param {string} logoSource - New logo URL or base64
 * @param {object} bbox - Bounding box {x, y, width, height} as percentages (0-100)
 * @returns {Promise<Buffer>} - Composited image as PNG buffer
 */
async function replaceLogoAtBbox(baseImageSource, logoSource, bbox) {
  try {
    console.log('🔄 Replacing logo at detected position...');
    console.log(`   Bbox: x=${bbox.x}%, y=${bbox.y}%, w=${bbox.width}%, h=${bbox.height}%`);

    // Get image buffers
    const [baseBuffer, logoBuffer] = await Promise.all([
      getImageBuffer(baseImageSource),
      getImageBuffer(logoSource)
    ]);

    // Get base image metadata
    const baseMetadata = await sharp(baseBuffer).metadata();
    const baseWidth = baseMetadata.width || 1080;
    const baseHeight = baseMetadata.height || 1080;

    console.log(`   Base image: ${baseWidth}x${baseHeight}`);

    // Convert percentage bbox to pixel coordinates
    const targetX = Math.round((bbox.x / 100) * baseWidth);
    const targetY = Math.round((bbox.y / 100) * baseHeight);
    const targetWidth = Math.round((bbox.width / 100) * baseWidth);
    const targetHeight = Math.round((bbox.height / 100) * baseHeight);

    console.log(`   Target position: (${targetX}, ${targetY}), size: ${targetWidth}x${targetHeight}`);

    // Resize logo to fit the detected bbox while maintaining aspect ratio
    const resizedLogo = await sharp(logoBuffer)
      .resize(targetWidth, targetHeight, { 
        fit: 'inside',
        withoutEnlargement: false
      })
      .ensureAlpha()
      .png()
      .toBuffer();

    // Get actual resized logo dimensions
    const logoMetadata = await sharp(resizedLogo).metadata();
    const logoWidth = logoMetadata.width;
    const logoHeight = logoMetadata.height;

    // Center the logo within the bbox
    const offsetX = targetX + Math.round((targetWidth - logoWidth) / 2);
    const offsetY = targetY + Math.round((targetHeight - logoHeight) / 2);

    console.log(`   Logo resized to: ${logoWidth}x${logoHeight}, placed at (${offsetX}, ${offsetY})`);

    // Composite the new logo onto the image
    const result = await sharp(baseBuffer)
      .composite([{
        input: resizedLogo,
        left: Math.max(0, offsetX),
        top: Math.max(0, offsetY)
      }])
      .png({ quality: 90 })
      .toBuffer();

    console.log('✅ Logo replacement complete');
    return result;

  } catch (error) {
    console.error('❌ Logo replacement error:', error.message);
    throw error;
  }
}

/**
 * Replace logo at detected bbox, upload to Cloudinary, and return URL
 */
async function replaceLogoAtBboxAndUpload(baseImageSource, logoSource, bbox) {
  const { uploadBase64Image } = require('./imageUploader');
  
  const buffer = await replaceLogoAtBbox(baseImageSource, logoSource, bbox);
  const base64 = `data:image/png;base64,${buffer.toString('base64')}`;
  
  const uploadResult = await uploadBase64Image(base64, 'nebula-posters');
  
  if (uploadResult.success) {
    return {
      success: true,
      url: uploadResult.url,
      publicId: uploadResult.publicId,
      imageBase64: base64
    };
  }
  
  return {
    success: false,
    error: uploadResult.error || 'Upload failed'
  };
}

module.exports = {
  overlayLogo,
  overlayLogoBase64,
  overlayLogoAndUpload,
  replaceLogoAtBbox,
  replaceLogoAtBboxAndUpload,
  getImageBuffer,
  POSITION_MAP,
  SIZE_MAP
};
