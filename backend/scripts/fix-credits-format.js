require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  try {
    console.log('Connecting to database %s...', process.env.MONGODB_URI);
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    const users = db.collection('users');

    console.log('Finding users with invalid credits (not an object)...');
    const allUsers = await users.find({}).toArray();
    
    let foundInvalid = 0;
    for (const user of allUsers) {
      if (typeof user.credits === 'number') {
        console.log(`Found invalid credits for user ${user.email || user._id}: value is ${user.credits}`);
        
        // Fix it
        await users.updateOne(
          { _id: user._id },
          { 
            $set: { 
              credits: { 
                balance: user.credits,
                totalUsed: 0,
                history: [{
                  action: 'converted_from_number',
                  amount: 0,
                  cost: 0,
                  description: 'Fixed credits from number to object',
                  balanceAfter: user.credits,
                  timestamp: new Date()
                }]
              } 
            } 
          }
        );
        foundInvalid++;
      }
    }

    console.log(`Fixed ${foundInvalid} users with invalid credits format.`);
    
    // Check for users missing credits entirely
    const res = await users.updateMany(
      { credits: { $exists: false } },
      { 
        $set: { 
          credits: { 
            balance: 100, 
            totalUsed: 0, 
            history: [{ action: 'initialized', amount: 0, cost: 0, balanceAfter: 100, timestamp: new Date() }] 
          } 
        } 
      }
    );
    console.log(`Initialized credits for ${res.modifiedCount} users missing the field.`);

    await mongoose.disconnect();
    console.log('Done.');
  } catch (err) {
    console.error('Error during database check:', err);
    process.exit(1);
  }
})();
