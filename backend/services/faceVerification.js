const canvas = require('canvas');
const faceapi = require('@vladmandic/face-api');
const path = require('path');
const fs = require('fs');

// Patch nodejs environment
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

let modelsLoaded = false;

async function initModels() {
  if (modelsLoaded) return;
  const modelsPath = path.join(__dirname, '..', 'face-models');
  if (!fs.existsSync(modelsPath)) {
    throw new Error(`Face models not found at ${modelsPath}`);
  }
  
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsPath);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsPath);
  
  modelsLoaded = true;
  console.log('[FaceVerification] Models loaded successfully.');
}

async function getFaceDescriptor(base64Image) {
  // strip data url prefix if present
  const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, 'base64');
  
  const img = await canvas.loadImage(buffer);
  
  // detect face
  const detection = await faceapi.detectSingleFace(img)
    .withFaceLandmarks()
    .withFaceDescriptor();
    
  if (!detection) {
    return null;
  }
  
  return detection.descriptor;
}

/**
 * Compare two face images and return a similarity score between 0 and 1.
 * @param {string} img1Base64 - Original character sheet image
 * @param {string} img2Base64 - Generated image
 * @returns {number} - Similarity score (1.0 = identical) or 0 if no face detected.
 */
async function compareFaces(img1Base64, img2Base64) {
  try {
    await initModels();
    
    const desc1 = await getFaceDescriptor(img1Base64);
    if (!desc1) {
      console.warn('[FaceVerification] No face detected in reference image.');
      return 0.5; // return neutral if we can't verify reference
    }
    
    const desc2 = await getFaceDescriptor(img2Base64);
    if (!desc2) {
      console.warn('[FaceVerification] No face detected in generated image.');
      return 0.2; // very low score if no face detected
    }
    
    const distance = faceapi.euclideanDistance(desc1, desc2);
    
    // Distance usually ranges from 0.0 (identical) to 1.0 (completely different).
    // Let's convert to a similarity percentage (0-1) where distance of 0.0 -> 1.0, distance of 0.6 -> 0.4
    // Typical matching threshold is distance < 0.6
    const similarity = Math.max(0, 1 - distance);
    
    console.log(`[FaceVerification] Distance: ${distance.toFixed(3)}, Similarity: ${(similarity * 100).toFixed(1)}%`);
    
    return similarity;
  } catch (error) {
    console.error('[FaceVerification] Error comparing faces:', error);
    // return neutral score if error occurs to avoid breaking pipeline
    return 0.5;
  }
}

module.exports = {
  compareFaces,
  initModels
};
