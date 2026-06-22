const fs = require('fs');
const path = require('path');

const socialApiPath = path.join(__dirname, 'backend', 'services', 'socialMediaAPI.js');
let content = fs.readFileSync(socialApiPath, 'utf8');

// Add log for generateAyrshareJWT
content = content.replace(
  'const url = `${process.env.AYRSHARE_BASE_URL}/sso?token=${token}`;',
  'const url = `${process.env.AYRSHARE_BASE_URL}/sso?token=${token}`;\n    console.log("Generated Ayrshare JWT:", token);'
);

// Add log for getAyrshareConnectUrl
content = content.replace(
  'return { success: true, connectUrl: jwtResult.url };',
  'console.log("SSO URL:", jwtResult.url);\n    return { success: true, connectUrl: jwtResult.url };'
);

fs.writeFileSync(socialApiPath, content);

// Also add console.log to verifyWebhookRequest in socialInboxController.js
const controllerPath = path.join(__dirname, 'backend', 'controllers', 'socialInboxController.js');
let controllerContent = fs.readFileSync(controllerPath, 'utf8');

controllerContent = controllerContent.replace(
  'return true;\n  } catch (err) {',
  'console.log("Webhook signature verified");\n    return true;\n  } catch (err) {'
);

// Also add console.log for raw webhook payload in socialInboxController.js
controllerContent = controllerContent.replace(
  'exports.receiveWebhook = async (req, res) => {',
  'exports.receiveWebhook = async (req, res) => {\n  console.log("RAW WEBHOOK:", JSON.stringify(req.body, null, 2));'
);

fs.writeFileSync(controllerPath, controllerContent);

// Add log for registered webhook url
const socialRoutePath = path.join(__dirname, 'backend', 'routes', 'social.js');
let routeContent = fs.readFileSync(socialRoutePath, 'utf8');
routeContent = routeContent.replace(
  'const webhookResult = await setAyrshareWebhook(profileKey, webhookUrl);',
  'console.log("Webhook URL Registered:", webhookUrl);\n      const webhookResult = await setAyrshareWebhook(profileKey, webhookUrl);'
);
fs.writeFileSync(socialRoutePath, routeContent);

console.log("Logs added");
