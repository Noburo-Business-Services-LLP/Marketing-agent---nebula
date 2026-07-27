// Run from /app/backend so node_modules are available
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const VideoDraft = require('./models/VideoDraft');

  // Search current 7-scene draft
  const current = await VideoDraft.findOne({ jobId: '37708df5-3dc3-4235-a54d-24ce824a536b' }).lean();
  if (current) {
    console.log('=== CURRENT 7-SCENE DRAFT IN MONGODB ===');
    const scenes = current.scenes || [];
    console.log('Scenes:', scenes.length);
    const withClips = scenes.filter(s => s.clipUrl || s.videoUrl || s.generatedVideoUrl);
    console.log('With video clips:', withClips.length);
    withClips.forEach(s => console.log('  clip:', s.clipUrl || s.videoUrl || s.generatedVideoUrl));
    console.log('Has .mp4 anywhere?', JSON.stringify(current).includes('.mp4'));
  } else {
    console.log('Current draft NOT in MongoDB');
  }

  // Search ALL drafts for Murugan/bridal/saree
  console.log('\n=== ALL MURUGAN/BRIDAL DRAFTS ===');
  const allDrafts = await VideoDraft.find({}).lean();
  allDrafts.forEach(d => {
    const raw = JSON.stringify(d);
    if (raw.toLowerCase().includes('murugan') || raw.toLowerCase().includes('bridal') || raw.toLowerCase().includes('saree') || raw.toLowerCase().includes('dreaming of the day')) {
      const scenes = d.scenes || [];
      const withClips = scenes.filter(s => s.clipUrl || s.videoUrl || s.generatedVideoUrl);
      console.log('---');
      console.log('jobId:', d.jobId);
      console.log('  desc:', (d.description || d.title || '').substring(0, 80));
      console.log('  scenes:', scenes.length, '| with clips:', withClips.length);
      if (withClips.length) withClips.forEach(s => console.log('    clip:', (s.clipUrl || s.videoUrl || s.generatedVideoUrl)));
    }
  });

  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
