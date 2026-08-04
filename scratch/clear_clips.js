const mongoose = require('mongoose');
const fs = require('fs');

const JOB_ID = '37708df5-3dc3-4235-a54d-24ce824a536b';

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const VideoDraft = require('./models/VideoDraft');

  const draftPath = './storage/ai-videos/' + JOB_ID + '/draft.json';
  let draft;
  try {
    draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
  } catch (e) {
    draft = await VideoDraft.findOne({ jobId: JOB_ID }).lean();
  }

  if (!draft) {
    console.error('Draft not found!');
    process.exit(1);
  }

  // Clear video clip URLs from scenes
  const cleanedScenes = (draft.scenes || []).map(s => ({
    ...s,
    clipUrl: '',
    videoUrl: '',
    generatedVideoUrl: ''
  }));

  draft.scenes = cleanedScenes;
  draft.clips = {
    sceneData: cleanedScenes,
    clipUrls: [],
    generatedAt: null
  };
  draft.updatedAt = new Date().toISOString();

  // Save to disk
  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2));
  console.log('✅ Cleared clips from disk draft');

  // Save to MongoDB
  const mongoDoc = await VideoDraft.findOne({ jobId: JOB_ID });
  if (mongoDoc) {
    mongoDoc.scenes = cleanedScenes;
    mongoDoc.clips = draft.clips;
    mongoDoc.updatedAt = new Date();
    mongoDoc.markModified('scenes');
    mongoDoc.markModified('clips');
    await mongoDoc.save();
    console.log('✅ Cleared clips from MongoDB draft');
  }

  await mongoose.disconnect();
})().catch(e => {
  console.error('Error clearing clips:', e.message);
  process.exit(1);
});
