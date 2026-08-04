const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://CFO-Login:qzJExUAezWWY87Z1@portfolio.blg8lko.mongodb.net/nebulaa_demo?retryWrites=true&w=majority&appName=Portfolio';

async function run() {
  console.log('Connecting to:', MONGODB_URI);
  await mongoose.connect(MONGODB_URI);
  
  // Define a simple Schema for VideoDraft to query
  const VideoDraftSchema = new mongoose.Schema({}, { strict: false, collection: 'videodrafts' });
  const VideoDraft = mongoose.model('VideoDraft', VideoDraftSchema);
  
  const drafts = await VideoDraft.find({}).sort({ updatedAt: -1 }).limit(10);
  console.log(`Found ${drafts.length} drafts:`);
  
  for (const d of drafts) {
    console.log('----------------------------------------------------');
    console.log(`jobId: ${d.get('jobId')}`);
    console.log(`title: ${d.get('title')}`);
    console.log(`updatedAt: ${d.get('updatedAt')}`);
    console.log(`scenes length: ${d.get('scenes')?.length || 0}`);
    if (d.get('scenes') && d.get('scenes').length > 0) {
      console.log(`First Scene URL: ${d.get('scenes')[0].imageUrl || d.get('scenes')[0].generatedImageUrl || 'None'}`);
    }
  }
  
  await mongoose.disconnect();
}

run().catch(console.error);
