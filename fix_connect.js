const fs = require('fs');
const path = require('path');

const socialApiPath = path.join(__dirname, 'backend', 'services', 'socialMediaAPI.js');
let content = fs.readFileSync(socialApiPath, 'utf8');

const replacement = `  }
}

/**
 * Generate Ayrshare connect URL for a specific platform
 * This opens Ayrshare's OAuth flow for the platform
 */
function getAyrshareConnectUrl(platform, redirectUrl, profileKey) {
  try {
    const jwtResult = generateAyrshareJWT(profileKey, {
      redirect: redirectUrl,
      allowedSocial: [platform.toLowerCase()]
    });

    if (!jwtResult.success) {
      return { success: false, error: jwtResult.error || 'Failed to generate JWT for connect URL' };
    }

    return { success: true, connectUrl: jwtResult.url };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Create a new Ayrshare User Profile
 * Required for Business Plan integration`;

// The broken file currently has:
//   }
// }
// 
//  * Required for Business Plan integration - each user needs their own profile
// Let's just find " * Required for Business Plan integration"

content = content.replace(/  \}\n\}\n\n \*\s+Required for Business Plan integration/g, replacement);

fs.writeFileSync(socialApiPath, content);
console.log("Fixed connect url");
