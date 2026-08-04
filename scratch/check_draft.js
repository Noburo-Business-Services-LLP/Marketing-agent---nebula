const mongoose = require('mongoose');

async function run() {
  await mongoose.connect('mongodb://localhost:27017/gravity_production');
  console.log('Connected to MongoDB');
  const db = mongoose.connection.db;
  const draft = await db.collection('video_drafts').findOne({ jobId: '837a86af-8522-4423-bbbf-dbb579c0a902' });
  console.log('Draft scenes:', JSON.stringify(draft?.scenes, null, 2));
  console.log('Draft input:', JSON.stringify(draft?.input, null, 2));
  console.log('Draft useLogo:', draft?.useLogo);
  await mongoose.disconnect();
}

run().catch(console.error);
