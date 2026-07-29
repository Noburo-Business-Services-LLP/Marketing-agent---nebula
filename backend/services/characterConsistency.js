
const fs = require('fs').promises;
const path = require('path');
const faceapi = require('@vladmandic/face-api');
const { Canvas, Image, ImageData } = require('canvas');

// Patch face-api.js to use canvas
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const CHARACTER_MEMORY_PATH = path.resolve(__dirname, '..', 'storage', 'character-memory');
const SIMILARITY_THRESHOLD = process.env.SIMILARITY_THRESHOLD || 0.9;
const MAX_RETRIES = process.env.MAX_RETRIES || 3;

const faceRecognitionModelPath = path.resolve(__dirname, '..', 'face-models');

let modelsLoaded = false;
async function loadModels() {
  if (modelsLoaded) return;
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(faceRecognitionModelPath);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(faceRecognitionModelPath);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(faceRecognitionModelPath);
  modelsLoaded = true;
}

async function createCharacterMemory(characterId, characterSheet) {
    const characterPath = path.join(CHARACTER_MEMORY_PATH, characterId);
    await fs.mkdir(characterPath, { recursive: true });

    const metadata = {
        characterId,
        ...characterSheet.metadata,
        createdAt: new Date().toISOString()
    };

    await fs.writeFile(path.join(characterPath, 'metadata.json'), JSON.stringify(metadata, null, 2));
    await fs.copyFile(characterSheet.path, path.join(characterPath, 'character_sheet.png'));

    const embedding = await extractFaceEmbedding(characterSheet.path);
    await fs.writeFile(path.join(characterPath, 'embedding.bin'), embedding);

    return {
        path: characterPath,
        embedding
    };
}


async function extractFaceEmbedding(imagePath) {
    await loadModels();
    const image = await loadImage(imagePath);
    const detections = await faceapi.detectAllFaces(image).withFaceLandmarks().withFaceDescriptors();
    if (!detections.length) {
        throw new Error('No face detected in the character sheet.');
    }
    return detections[0].descriptor;
}


async function validateScene(scene, characterMemory) {
    let currentImage = scene.imagePath;
    let similarity = 0;
    let accepted = false;
    let attempts = 0;

    for (let i = 0; i < MAX_RETRIES; i++) {
        attempts = i + 1;
        const generatedEmbedding = await extractFaceEmbedding(currentImage);
        similarity = faceapi.euclideanDistance(characterMemory.embedding, generatedEmbedding);
        
        // Lower distance means more similar. We convert to a percentage-like score.
        const similarityScore = (1 - similarity) * 100;

        if (similarityScore >= SIMILARITY_THRESHOLD * 100) {
            accepted = true;
            break;
        }

        // The regeneration logic will be handled outside this function
    }
    
    // Log the results
    const logPath = path.resolve(__dirname, '..', 'storage', 'logs', `${scene.sceneId}.log`);
    const logMessage = `Scene: ${scene.sceneId}, Similarity: ${similarity.toFixed(2)}, Accepted: ${accepted}, Attempts: ${attempts}
`;
    await fs.appendFile(logPath, logMessage);

    return { ...scene, imagePath: currentImage, similarity, accepted, attempts };
}


async function loadImage(imagePath) {
    const buffer = await fs.readFile(imagePath);
    const image = new Image();
    image.src = buffer;
    return image;
}


module.exports = {
    createCharacterMemory,
    validateScene,
    extractFaceEmbedding,
    euclideanDistance: (a, b) => faceapi.euclideanDistance(a, b),
    SIMILARITY_THRESHOLD,
    MAX_RETRIES
};
