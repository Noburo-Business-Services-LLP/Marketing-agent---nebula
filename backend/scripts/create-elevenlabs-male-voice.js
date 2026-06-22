require('dotenv').config();

const fs = require('fs');
const path = require('path');

async function main() {
  const apiKey = String(process.env.ELEVENLABS_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Set ELEVENLABS_API_KEY in backend/.env before creating a cloned male voice.');
  }

  const samplePath = path.resolve(
    process.argv[2] ||
      process.env.ELEVENLABS_MALE_REFERENCE_AUDIO_PATH ||
      ''
  );
  if (!samplePath || !fs.existsSync(samplePath)) {
    throw new Error('Pass the reference MP3 path as an argument, or set ELEVENLABS_MALE_REFERENCE_AUDIO_PATH.');
  }

  if (typeof fetch !== 'function' || typeof FormData !== 'function' || typeof Blob !== 'function') {
    throw new Error('This script needs Node 18+ with fetch, FormData, and Blob support.');
  }

  const form = new FormData();
  const buffer = await fs.promises.readFile(samplePath);
  const fileName = path.basename(samplePath);
  form.append('name', process.env.ELEVENLABS_MALE_VOICE_NAME || 'Nebulaa Dark Gamer Male');
  form.append('description', 'Dark cinematic gamer-style male narration voice for Nebulaa video TTS.');
  form.append('remove_background_noise', 'false');
  form.append('files[]', new Blob([buffer], { type: 'audio/mpeg' }), fileName);

  const response = await fetch('https://api.elevenlabs.io/v1/voices/add', {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey
    },
    body: form
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ElevenLabs voice clone failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const data = JSON.parse(text);
  if (!data.voice_id) {
    throw new Error(`ElevenLabs did not return a voice_id: ${text.slice(0, 500)}`);
  }

  console.log('Voice clone created.');
  console.log(`ELEVENLABS_MALE_VOICE_ID=${data.voice_id}`);
  console.log(`requires_verification=${Boolean(data.requires_verification)}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
