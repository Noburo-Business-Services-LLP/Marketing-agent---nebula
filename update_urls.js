const fs = require('fs');
const path = require('path');

const socialApiPath = path.join(__dirname, 'backend', 'services', 'socialMediaAPI.js');
let content = fs.readFileSync(socialApiPath, 'utf8');

// 1. URL Replacements
content = content.replace(/'https:\/\/api\.ayrshare\.com/g, "process.env.AYRSHARE_BASE_URL + '");
content = content.replace(/`https:\/\/api\.ayrshare\.com/g, "`${process.env.AYRSHARE_BASE_URL}");
content = content.replace(/"https:\/\/api\.ayrshare\.com/g, 'process.env.AYRSHARE_BASE_URL + "');

// Fix the enforceRateLimit check
content = content.replace(
  "if (!url.includes('api.ayrshare.com')) return;",
  "if (!url.includes(process.env.AYRSHARE_BASE_URL) && !url.includes('api.ayrshare.com')) return;"
);

// 2. Replace generateAyrshareJWT
const jwtCodeRegex = /async function generateAyrshareJWT\(profileKey, options = \{\}\) \{[\s\S]*?^  \} catch \(error\) \{\s*console\.error\('Ayrshare generate JWT error:', error\);\s*return \{ success: false, error: error\.message \};\s*\}\s*\}/m;

const newJwtCode = `const jwt = require("jsonwebtoken");

function generateAyrshareJWT(profileKey, options = {}) {
  try {
    const token = jwt.sign(
      {
        domain: process.env.AYRSHARE_DOMAIN,
        profileKey: profileKey,
        ...options
      },
      process.env.AYRSHARE_PRIVATE_KEY,
      {
        algorithm: "RS256",
        expiresIn: "10m"
      }
    );

    const url = \`\${process.env.AYRSHARE_BASE_URL}/sso?token=\${token}\`;
    
    return { success: true, url: url };
  } catch (err) {
    return { success: false, error: err.message };
  }
}`;

content = content.replace(jwtCodeRegex, newJwtCode);

// Write back
fs.writeFileSync(socialApiPath, content);
console.log('Done!');
