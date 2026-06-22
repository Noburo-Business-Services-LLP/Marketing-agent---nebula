const https = require('https');
require('dotenv').config({ path: 'backend/.env' });

const data = JSON.stringify({
  domain: process.env.AYRSHARE_DOMAIN,
  privateKey: process.env.AYRSHARE_PRIVATE_KEY,
  profileKey: "8D55F6DB-6D0841EB-98A584D2-18B63CFA",
  allowedSocial: ["instagram"]
});

const req = https.request('https://api.ayrshare.com/api/profiles/generateJWT', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.AYRSHARE_API_KEY}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => console.log('Response:', body));
});

req.write(data);
req.end();
