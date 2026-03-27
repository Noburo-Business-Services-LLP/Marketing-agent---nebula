/**
 * fix-instagram-lock.js
 * Unlinks Instagram from the old "hello" test Ayrshare sub-profile
 * so the account can be reconnected to bobbyabinesh07's profile.
 */

require('dotenv').config();

const AYRSHARE_API_KEY = process.env.AYRSHARE_API_KEY;

// The "hello" test user's profile key — confirmed from logs (Nebula-41fe0945-hello)
const HELLO_PROFILE_KEY = 'B3907714-BAF24D9E-AA09EABF-758B43CF';
const BOBBY_PROFILE_KEY = '8B46A401-0CEE4DD9-9CE611AA-6CBD4581';

async function checkProfile(profileKey, label) {
  console.log(`\n📊 Checking ${label} profile (${profileKey.substring(0,8)}...)...`);
  const res = await fetch('https://api.ayrshare.com/api/user', {
    headers: {
      'Authorization': `Bearer ${AYRSHARE_API_KEY}`,
      'Profile-Key': profileKey
    }
  });
  const data = await res.json();
  console.log(`   Title: ${data.title}`);
  console.log(`   Active accounts: ${JSON.stringify(data.activeSocialAccounts || [])}`);
  console.log(`   Display names: ${(data.displayNames || []).map(d => d.platform + ':' + d.username).join(', ')}`);
  return data;
}

async function unlinkInstagram(profileKey, label) {
  console.log(`\n🔓 Unlinking Instagram from ${label} profile...`);
  const res = await fetch('https://api.ayrshare.com/api/profiles/social', {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${AYRSHARE_API_KEY}`,
      'Profile-Key': profileKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ platform: 'instagram' })
  });
  const data = await res.json();
  console.log(`   Result:`, JSON.stringify(data, null, 2));
  return data;
}

async function main() {
  if (!AYRSHARE_API_KEY) {
    console.error('❌ AYRSHARE_API_KEY not found in .env');
    process.exit(1);
  }

  console.log('🔍 Starting Instagram lock fix...\n');

  // Step 1: Check current state of both profiles
  const helloProfile = await checkProfile(HELLO_PROFILE_KEY, '"hello" test user');
  const bobbyProfile = await checkProfile(BOBBY_PROFILE_KEY, 'bobbyabinesh07');

  // Step 2: Unlink Instagram from the "hello" profile if it's locked there
  const helloAccounts = helloProfile.activeSocialAccounts || [];
  if (helloAccounts.includes('instagram')) {
    console.log('\n⚠️  Instagram is locked to the "hello" profile. Unlinking...');
    await unlinkInstagram(HELLO_PROFILE_KEY, '"hello" test user');
    
    // Verify the unlink worked
    await new Promise(r => setTimeout(r, 2000));
    console.log('\n✅ Verification after unlink:');
    await checkProfile(HELLO_PROFILE_KEY, '"hello" test user (after unlink)');
    
    console.log('\n✅ Done! Instagram is now FREE.');
    console.log('   → Go to Nebulaa Connect Socials page');
    console.log('   → Click "Connect Instagram"');
    console.log('   → Complete the connection in the popup');
    console.log('   → Instagram should now connect to bobbyabinesh07\'s account!');
  } else {
    console.log('\n✅ Instagram is NOT locked to the "hello" profile.');
    console.log('   Something else may be preventing the connection.');
    console.log('   Bobby profile accounts:', JSON.stringify(helloAccounts));
  }
}

main().catch(console.error);
