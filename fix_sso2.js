const fs = require('fs');
const path = require('path');

const socialApiPath = path.join(__dirname, 'backend', 'services', 'socialMediaAPI.js');
let content = fs.readFileSync(socialApiPath, 'utf8');

const startIdx = content.indexOf('function getAyrshareConnectUrl(');
const endIdx = content.indexOf('}', content.indexOf('catch (error) {', startIdx)) + 1;

if (startIdx !== -1 && endIdx !== -1) {
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

  content = content.substring(0, startIdx) + newConnectUrl + content.substring(endIdx);
  fs.writeFileSync(socialApiPath, content);
  console.log("Successfully replaced getAyrshareConnectUrl!");
} else {
  console.error("Could not find getAyrshareConnectUrl block.");
}
