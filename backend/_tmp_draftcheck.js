const { MongoClient } = require('mongodb');
require('dotenv').config();
const JOB = '46eec4eb-1db8-4ee4-93bb-e8862792959e';
(async () => {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  for (const dbName of ['nebulaa_dev','nebulaa_demo']) {
    const db = c.db(dbName);
    const cols = (await db.listCollections().toArray()).map(x=>x.name);
    const out = {};
    for (const name of ['video_drafts','videodrafts','drafts']) {
      if (!cols.includes(name)) { out[name]='(collection absent)'; continue; }
      const total = await db.collection(name).countDocuments();
      const hit = await db.collection(name).findOne({ $or:[{jobId:JOB},{_id:JOB},{id:JOB}] });
      out[name] = { total, foundThisJob: !!hit };
    }
    console.log(dbName, JSON.stringify(out));
  }
  await c.close(); process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
