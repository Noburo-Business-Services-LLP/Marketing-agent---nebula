const mongoose = require('mongoose');
const Campaign = require('./models/Campaign');

async function checkAudioUrls() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/nebula');

    const campaigns = await Campaign.find({
      platforms: 'instagram',
      ayrshareStatus: 'error'
    }).select('name creative.instagramAudio createdAt').sort({ createdAt: -1 }).limit(5);

    console.log('Instagram campaigns with errors - checking audio URLs:');
    campaigns.forEach(campaign => {
      console.log(`- ${campaign.name}:`);
      console.log(`  Audio URL: ${campaign.creative?.instagramAudio?.url || 'null'}`);
      console.log(`  Audio duration: ${campaign.creative?.instagramAudio?.durationSeconds || 'null'}`);
      console.log(`  Created: ${campaign.createdAt}`);
      console.log('');
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

checkAudioUrls();
