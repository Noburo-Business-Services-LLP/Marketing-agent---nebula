const mongoose = require('mongoose');
const fs = require('fs');

// These are the 6 Cloudinary video clip URLs from the old Murugan Silks draft
// They were found in file storage earlier and are still live on Cloudinary
const CLIP_URLS = [
  'https://res.cloudinary.com/dhe8jowyt/video/upload/v1784615940/nebula-scene-clips/nbhfsppwpjbl6srbd4di.mp4',
  'https://res.cloudinary.com/dhe8jowyt/video/upload/v1784616403/nebula-scene-clips/hdrzqrhbuxatjaudtv2t.mp4',
  'https://res.cloudinary.com/dhe8jowyt/video/upload/v1784616553/nebula-scene-clips/kmjihkqtp9o58obvc9oi.mp4',
  'https://res.cloudinary.com/dhe8jowyt/video/upload/v1784616690/nebula-scene-clips/vzsgmlsonputsgpehd4k.mp4',
  'https://res.cloudinary.com/dhe8jowyt/video/upload/v1784616832/nebula-scene-clips/nlvrct1qekdzihtjo5cr.mp4',
  'https://res.cloudinary.com/dhe8jowyt/video/upload/v1784616944/nebula-scene-clips/itaiaai0leiyavzvyhxt.mp4'
];

const NEW_JOB = '37708df5-3dc3-4235-a54d-24ce824a536b';

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const VideoDraft = require('./models/VideoDraft');

  // Load new draft from disk first, MongoDB as fallback
  const newDraftPath = './storage/ai-videos/' + NEW_JOB + '/draft.json';
  let newDraft;
  try {
    newDraft = JSON.parse(fs.readFileSync(newDraftPath, 'utf8'));
    console.log('Loaded draft from disk');
  } catch (e) {
    const mongoNew = await VideoDraft.findOne({ jobId: NEW_JOB }).lean();
    if (!mongoNew) { console.error('Draft not found anywhere!'); process.exit(1); }
    newDraft = mongoNew;
    console.log('Loaded draft from MongoDB');
  }

  const newScenes = Array.isArray(newDraft.scenes) ? newDraft.scenes : [];
  console.log('Current scenes:', newScenes.length);

  // Map clip URLs to scenes
  const updatedScenes = newScenes.map((scene, idx) => {
    if (idx < CLIP_URLS.length) {
      return {
        ...scene,
        clipUrl: CLIP_URLS[idx],
        videoUrl: CLIP_URLS[idx],
        generatedVideoUrl: CLIP_URLS[idx]
      };
    }
    return scene;
  });

  const allClipUrls = updatedScenes.map(s => s.clipUrl || '').filter(Boolean);

  // Update draft object
  newDraft.scenes = updatedScenes;
  newDraft.clips = {
    sceneData: updatedScenes,
    clipUrls: allClipUrls,
    generatedAt: new Date().toISOString()
  };
  newDraft.updatedAt = new Date().toISOString();

  // Save to disk
  const dirPath = './storage/ai-videos/' + NEW_JOB;
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(newDraftPath, JSON.stringify(newDraft, null, 2));
  console.log('Disk updated!');

  // Save to MongoDB
  const mongoDoc = await VideoDraft.findOne({ jobId: NEW_JOB });
  if (mongoDoc) {
    mongoDoc.scenes = updatedScenes;
    mongoDoc.clips = newDraft.clips;
    mongoDoc.updatedAt = new Date();
    mongoDoc.markModified('scenes');
    mongoDoc.markModified('clips');
    await mongoDoc.save();
    console.log('MongoDB updated!');
  }

  // Verify by re-reading
  const verify = JSON.parse(fs.readFileSync(newDraftPath, 'utf8'));
  const verifyScenes = verify.scenes || [];
  console.log('\n=== VERIFIED: ' + allClipUrls.length + ' clips ===');
  verifyScenes.forEach((s, i) => {
    console.log('  Scene ' + (i + 1) + ' (' + (s.title || 'untitled') + '): ' + (s.generatedVideoUrl || s.clipUrl || 'NO CLIP'));
  });

  await mongoose.disconnect();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
