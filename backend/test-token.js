const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const User = require('./models/User');
  
  // Get user: rajnikanth@rajnikanthconstructions.com (has 71 leads per stats)
  const user = await User.findOne({ email: 'rajnikanth@rajnikanthconstructions.com' });
  if (!user) {
    console.log('User not found!');
    mongoose.disconnect();
    return;
  }
  
  console.log('User:', user._id.toString(), user.email, user.businessName);
  
  // Generate fresh token
  const token = jwt.sign(
    { id: user._id.toString() },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  
  console.log('\nFresh token for testing:');
  console.log(token);
  
  mongoose.disconnect();
});
