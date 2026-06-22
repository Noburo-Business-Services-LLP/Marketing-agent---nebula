const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'backend', 'services', 'socialMediaAPI.js');
let content = fs.readFileSync(filePath, 'utf8');

if (!content.includes('const jwt = require("jsonwebtoken");')) {
  content = 'const jwt = require("jsonwebtoken");\n' + content;
}

const getAyrshareConnectUrlStart = content.indexOf('function getAyrshareConnectUrl(');
const getAyrshareConnectUrlEnd = content.indexOf('}', content.indexOf('catch (error) {', getAyrshareConnectUrlStart)) + 1;

if (getAyrshareConnectUrlStart > -1) {
  const newGetAyrshareConnectUrl = `function getAyrshareConnectUrl(platform, redirectUrl, user) {
  try {
    const jwtResult = generateAyrshareJWT(user, {
      redirect: redirectUrl,
      allowedSocial: [platform.toLowerCase()]
    });

    if (!jwtResult.success) {
      return { success: false, error: jwtResult.error || 'Failed to generate JWT for connect URL' };
    }

    console.log("Connect URL:", jwtResult.url);
    return { success: true, connectUrl: jwtResult.url };
  } catch (error) {
    return { success: false, error: error.message };
  }
}`;
  content = content.substring(0, getAyrshareConnectUrlStart) + newGetAyrshareConnectUrl + content.substring(getAyrshareConnectUrlEnd);
}

const generateAyrshareJWTStart = content.indexOf('async function generateAyrshareJWT(');
const generateAyrshareJWTEnd = content.indexOf('}', content.indexOf('catch (error) {', generateAyrshareJWTStart)) + 1;

if (generateAyrshareJWTStart > -1) {
  const newGenerateAyrshareJWT = `function generateAyrshareJWT(user, options = {}) {
  try {
    const token = jwt.sign(
      {
        profileKey: user.ayrshare?.profileKey || user.profileKey,
        domain: process.env.AYRSHARE_DOMAIN,
        sub: user._id.toString(),
        email: user.email,
        ...options
      },
      process.env.AYRSHARE_PRIVATE_KEY,
      {
        algorithm: "RS256",
        expiresIn: "10m"
      }
    );

    const url = \`https://app.ayrshare.com/sso?token=\${token}\`;
    console.log("Generated JWT:", token);
    
    return { success: true, url: url };
  } catch (err) {
    return { success: false, error: err.message };
  }
}`;
  content = content.substring(0, generateAyrshareJWTStart) + newGenerateAyrshareJWT + content.substring(generateAyrshareJWTEnd);
}

fs.writeFileSync(filePath, content);
console.log('Done!');
