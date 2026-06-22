const fs = require('fs');
const path = require('path');

const socialApiPath = path.join(__dirname, 'backend', 'services', 'socialMediaAPI.js');
let content = fs.readFileSync(socialApiPath, 'utf8');

// 1. Rewrite generateAyrshareJWT to accept user and generate proper payload
const oldGenerateJwt = `function generateAyrshareJWT(profileKey, options = {}) {
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

const newGenerateJwt = `function generateAyrshareJWT(user, options = {}) {
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

content = content.replace(oldGenerateJwt, newGenerateJwt);

// If it wasn't there because the previous script format, do an aggressive replace
if (!content.includes('function generateAyrshareJWT(user')) {
    // Just find generateAyrshareJWT and replace it
    const start = content.indexOf('function generateAyrshareJWT(');
    const end = content.indexOf('}', content.indexOf('catch (err)')) + 1;
    if (start !== -1 && end !== -1) {
        content = content.substring(0, start) + newGenerateJwt + content.substring(end);
    }
}


// 2. Rewrite getAyrshareConnectUrl
const oldConnectUrl = `function getAyrshareConnectUrl(platform, redirectUrl) {
  try {
    // Ayrshare dashboard URL for connecting accounts
    const baseUrl = process.env.AYRSHARE_BASE_URL + '/social-accounts';
    const connectUrl = \`\${baseUrl}?platform=\${platform.toLowerCase()}&redirect=\${encodeURIComponent(redirectUrl || '')}\`;
    return { success: true, connectUrl };
  } catch (error) {
    return { success: false, error: error.message };
  }
}`;

const newConnectUrl = `function getAyrshareConnectUrl(platform, redirectUrl, user) {
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

content = content.replace(oldConnectUrl, newConnectUrl);

fs.writeFileSync(socialApiPath, content);

// 3. Update routes/social.js to pass user instead of profileKey
const socialRoutesPath = path.join(__dirname, 'backend', 'routes', 'social.js');
let routeContent = fs.readFileSync(socialRoutesPath, 'utf8');

routeContent = routeContent.replace(
  'const result = await getAyrshareConnectUrl(platform, redirectUrl, profileKey);',
  'const result = await getAyrshareConnectUrl(platform, redirectUrl, user);'
);
// replace second occurrence as well
routeContent = routeContent.replace(
  'const result = await getAyrshareConnectUrl(platform, redirectUrl, profileKey);',
  'const result = await getAyrshareConnectUrl(platform, redirectUrl, user);'
);

fs.writeFileSync(socialRoutesPath, routeContent);

console.log("Fixed socialMediaAPI.js and routes/social.js");
