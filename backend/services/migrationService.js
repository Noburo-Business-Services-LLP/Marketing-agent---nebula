/**
 * Migration Service — Transfers ALL user data from demo DB (nebulaa_demo) to prod DB (nebulaa)
 * 
 * Handles all 18 collections with proper ObjectId remapping for cross-references.
 * BrandAsset uses `user` field (not `userId`) — handled explicitly.
 * User.password/otp are `select: false` — fetched with .select('+password +otp').
 */
const mongoose = require('mongoose');

// Collection configs: { modelName, userRefField, crossRefs: [{ field, targetCollection }] }
const COLLECTIONS = [
  { name: 'users', userRef: null }, // User doc itself
  { name: 'analyticssnapshots', userRef: 'userId', crossRefs: [] },
  { name: 'brandassets', userRef: 'user', crossRefs: [] }, // NOTE: 'user' not 'userId'
  { name: 'brandprofiles', userRef: 'userId', crossRefs: [] },
  { name: 'cachedcampaigns', userRef: 'userId', crossRefs: [] },
  { name: 'campaigns', userRef: 'userId', crossRefs: [] },
  { name: 'campaignplans', userRef: 'userId', crossRefs: [{ field: 'relatedBrand', source: 'brandprofiles' }] },
  { name: 'competitors', userRef: 'userId', crossRefs: [] },
  { name: 'contentdrafts', userRef: 'userId', crossRefs: [{ field: 'relatedBrand', source: 'brandprofiles' }, { field: 'relatedCampaign', source: 'campaigns' }] },
  { name: 'emailcampaigns', userRef: 'userId', crossRefs: [] },
  { name: 'influencers', userRef: 'userId', crossRefs: [] },
  { name: 'insights', userRef: 'userId', crossRefs: [{ field: 'relatedBrand', source: 'brandprofiles' }, { field: 'relatedCompetitors', source: 'competitors', isArray: true }, { field: 'relatedCampaign', source: 'campaigns' }] },
  { name: 'notifications', userRef: 'userId', crossRefs: [{ field: 'campaignId', source: 'campaigns' }] },
  { name: 'onboardingcontexts', userRef: 'userId', crossRefs: [] },
  { name: 'reminders', userRef: 'userId', crossRefs: [{ field: 'campaignId', source: 'campaigns' }] },
  { name: 'scrapejobs', userRef: 'userId', crossRefs: [] },
  { name: 'socialsnapshots', userRef: 'userId', crossRefs: [] },
  { name: 'trends', userRef: 'userId', crossRefs: [{ field: 'relatedBrand', source: 'brandprofiles' }] },
];

/**
 * Migrate a single user's data from demo → prod
 * @param {string} demoUserId - The user's _id in the demo database
 * @returns {{ success: boolean, prodUserId: string, summary: object, error?: string }}
 */
async function migrateUserData(demoUserId, paidCredits = 100) {
  let demoConn = null;
  let prodConn = null;

  try {
    const demoUri = process.env.MONGODB_URI;          // Demo DB (this server's own DB)
    const prodUri = process.env.PROD_MONGODB_URI;      // Prod DB (migration target)

    if (!demoUri || !prodUri) {
      throw new Error('Missing MONGODB_URI or PROD_MONGODB_URI environment variables');
    }

    console.log(`🚀 Starting migration for demo user: ${demoUserId}`);

    // Create separate connections to demo and prod databases
    demoConn = await mongoose.createConnection(demoUri).asPromise();
    prodConn = await mongoose.createConnection(prodUri).asPromise();

    console.log('✅ Connected to both demo and prod databases');

    // Step 1: Fetch the user doc from demo (include select:false fields)
    const demoDB = demoConn.db;
    const prodDB = prodConn.db;

    const demoUser = await demoDB.collection('users').findOne({ 
      _id: new mongoose.Types.ObjectId(demoUserId) 
    });

    if (!demoUser) {
      throw new Error(`User ${demoUserId} not found in demo database`);
    }

    console.log(`📋 Found demo user: ${demoUser.email}`);

    // Step 2: Check if user already exists in prod (by email)
    const existingProdUser = await prodDB.collection('users').findOne({ email: demoUser.email });
    if (existingProdUser) {
      throw new Error(`User with email ${demoUser.email} already exists in production database`);
    }

    // Step 3: Create user in prod with fresh production credit values
    const prodUser = { ...demoUser };
    delete prodUser._id; // Let MongoDB generate new _id

    // Set credits to the amount the user paid for
    const now = new Date();
    const cycleEnd = new Date(now);
    cycleEnd.setMonth(cycleEnd.getMonth() + 1);

    prodUser.credits = {
      balance: paidCredits,
      monthlyAllowance: paidCredits,
      totalUsed: 0,
      cycleStart: now,
      cycleEnd: cycleEnd,
      lastLoginBonus: null,
      history: [{
        action: 'migration_bonus',
        cost: -paidCredits,
        balanceAfter: paidCredits,
        timestamp: now,
        description: `Welcome to Nebulaa Gravity Production — ${paidCredits} credits`
      }]
    };

    // Set subscription to active paid
    prodUser.subscription = {
      plan: 'pro',
      status: 'active',
      expiresAt: cycleEnd
    };

    // Remove trial fields (not needed in prod)
    delete prodUser.trial;

    const insertResult = await prodDB.collection('users').insertOne(prodUser);
    const prodUserId = insertResult.insertedId;

    console.log(`✅ Created prod user: ${prodUserId}`);

    // Step 4: Migrate all other collections
    // We need to track old→new ObjectId mappings for cross-references
    const idMap = {
      users: { [demoUserId]: prodUserId },
    };

    const summary = { 'users': 1 };

    // First pass: migrate collections WITHOUT cross-refs (to build idMap)
    const noCrossRefCollections = COLLECTIONS.filter(c => c.name !== 'users' && (!c.crossRefs || c.crossRefs.length === 0));
    const crossRefCollections = COLLECTIONS.filter(c => c.crossRefs && c.crossRefs.length > 0);

    for (const col of noCrossRefCollections) {
      const count = await migrateCollection(demoDB, prodDB, col, demoUserId, prodUserId, idMap);
      summary[col.name] = count;
    }

    // Second pass: migrate collections WITH cross-refs (idMap is now populated)
    for (const col of crossRefCollections) {
      const count = await migrateCollection(demoDB, prodDB, col, demoUserId, prodUserId, idMap);
      summary[col.name] = count;
    }

    console.log('✅ Migration complete! Summary:', summary);

    return { 
      success: true, 
      prodUserId: prodUserId.toString(), 
      email: demoUser.email,
      summary 
    };

  } catch (error) {
    console.error('❌ Migration error:', error);
    return { success: false, error: error.message };
  } finally {
    if (demoConn) await demoConn.close();
    if (prodConn) await prodConn.close();
  }
}

/**
 * Migrate a single collection's documents for one user
 */
async function migrateCollection(demoDB, prodDB, colConfig, demoUserId, prodUserId, idMap) {
  const { name, userRef, crossRefs } = colConfig;

  // Build query to find user's documents
  const query = {};
  if (userRef) {
    query[userRef] = new mongoose.Types.ObjectId(demoUserId);
  }

  // Special case: trends can have null userId (global) — skip those
  if (name === 'trends') {
    query.userId = new mongoose.Types.ObjectId(demoUserId);
  }

  const docs = await demoDB.collection(name).find(query).toArray();
  if (docs.length === 0) return 0;

  // Initialize idMap for this collection
  if (!idMap[name]) idMap[name] = {};

  const newDocs = docs.map(doc => {
    const oldId = doc._id;
    const newDoc = { ...doc };
    delete newDoc._id; // Let MongoDB generate new _id

    // Update user reference to point to prod user
    if (userRef) {
      newDoc[userRef] = prodUserId;
    }

    // Remap cross-references if idMap has entries for the source collection
    if (crossRefs) {
      for (const ref of crossRefs) {
        if (ref.isArray && Array.isArray(newDoc[ref.field])) {
          newDoc[ref.field] = newDoc[ref.field].map(oldRef => {
            const mapped = idMap[ref.source]?.[oldRef?.toString()];
            return mapped || oldRef;
          });
        } else if (newDoc[ref.field]) {
          const mapped = idMap[ref.source]?.[newDoc[ref.field]?.toString()];
          if (mapped) {
            newDoc[ref.field] = mapped;
          }
        }
      }
    }

    // Store mapping: old _id → will be filled after insert
    newDoc._oldId = oldId;
    return newDoc;
  });

  // Insert into prod
  const insertResult = await prodDB.collection(name).insertMany(newDocs.map(d => {
    const { _oldId, ...rest } = d;
    return rest;
  }));

  // Build id mapping (old → new) for cross-reference resolution
  const insertedIds = Object.values(insertResult.insertedIds);
  newDocs.forEach((doc, i) => {
    if (doc._oldId) {
      idMap[name][doc._oldId.toString()] = insertedIds[i];
    }
  });

  console.log(`  📦 ${name}: migrated ${docs.length} documents`);
  return docs.length;
}

module.exports = { migrateUserData };
