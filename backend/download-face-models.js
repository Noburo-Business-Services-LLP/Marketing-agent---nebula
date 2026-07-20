const fs = require('fs');
const path = require('path');
const https = require('https');

const modelsDir = path.join(__dirname, 'face-models');

if (!fs.existsSync(modelsDir)) {
  fs.mkdirSync(modelsDir, { recursive: true });
}

const baseUrl = 'https://raw.githubusercontent.com/vladmandic/face-api/master/model/';
const files = [
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model.bin',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model.bin',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model.bin'
];

async function downloadFile(filename) {
  const filePath = path.join(modelsDir, filename);
  if (fs.existsSync(filePath)) {
    console.log(`Skipping ${filename}, already exists.`);
    return;
  }
  
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${filename}...`);
    const file = fs.createWriteStream(filePath);
    https.get(baseUrl + filename, response => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to get '${filename}' (${response.statusCode})`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`Downloaded ${filename}`);
        resolve();
      });
    }).on('error', err => {
      fs.unlink(filePath, () => {});
      reject(err);
    });
  });
}

async function main() {
  try {
    for (const file of files) {
      await downloadFile(file);
    }
    console.log('All models downloaded successfully!');
  } catch (err) {
    console.error('Error downloading models:', err);
  }
}

main();
