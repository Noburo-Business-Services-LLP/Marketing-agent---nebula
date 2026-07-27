const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'backend', 'routes', 'videoGeneration.js');
let content = fs.readFileSync(filePath, 'utf8');

// Find the FIRST generateThumbnailFromDraft function end (the one in the original block)
// and the createVideo route that should follow it

// The problem: There's a corrupted block between the first generateThumbnailFromDraft end 
// and the REAL createVideo route. We need to:
// 1. Find where the first generateThumbnailFromDraft function's closing brace is
// 2. Find where the REAL createVideo route body starts (with "if (!userId)")
// 3. Replace everything between with a clean createVideo route header

// Split into lines for easier processing
const lines = content.split('\n');

console.log('Total lines:', lines.length);

// Find the pattern: lines with "return firstSceneImage;" followed by corrupt code
// We need to find the FIRST occurrence of the thumbnail function end
let firstThumbnailEnd = -1;
let realCreateVideoBody = -1;

for (let i = 0; i < lines.length; i++) {
  const trimmed = lines[i].trim();
  
  // Find "return firstSceneImage;" - first occurrence after line 850
  if (i >= 850 && firstThumbnailEnd === -1 && trimmed === 'return firstSceneImage;') {
    firstThumbnailEnd = i;
    console.log(`Found first "return firstSceneImage;" at line ${i + 1}: "${lines[i]}"`);
  }
}

// Now find the line with "if (!userId)" that's part of the createVideo route body
// It should be after the duplicated functions section
for (let i = firstThumbnailEnd + 1; i < lines.length; i++) {
  const trimmed = lines[i].trim();
  if (trimmed === 'if (!userId) {') {
    // Check if next line has "return res.status(401)"
    const nextTrimmed = (lines[i + 1] || '').trim();
    if (nextTrimmed.includes('401') && nextTrimmed.includes('Authentication required')) {
      realCreateVideoBody = i;
      console.log(`Found real createVideo body "if (!userId)" at line ${i + 1}: "${lines[i]}"`);
      break;
    }
  }
}

if (firstThumbnailEnd === -1 || realCreateVideoBody === -1) {
  console.error('Could not find the corruption boundaries!');
  console.log('firstThumbnailEnd:', firstThumbnailEnd, 'realCreateVideoBody:', realCreateVideoBody);
  process.exit(1);
}

// Now rebuild the file:
// Keep lines 0..firstThumbnailEnd (inclusive - "return firstSceneImage;")
// Add the closing braces for the catch and function
// Add the createVideo route header
// Then keep lines from realCreateVideoBody onwards

const beforeCorruption = lines.slice(0, firstThumbnailEnd + 1);
const afterCorruption = lines.slice(realCreateVideoBody);

const fixedContent = [
  ...beforeCorruption,
  '  }',
  '}',
  '',
  '// -----------------------------------------------------------------------------',
  '// Existing one-shot pipeline endpoints', 
  '// -----------------------------------------------------------------------------',
  "router.post('/createVideo', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {",
  "  const userId = req.user?._id ? String(req.user._id) : (req.user?.id ? String(req.user.id) : null);",
  '',
  ...afterCorruption
].join('\n');

console.log('\nOriginal lines:', lines.length);
console.log('Fixed lines:', fixedContent.split('\n').length);
console.log('Lines removed:', lines.length - fixedContent.split('\n').length);

// Write back
fs.writeFileSync(filePath, fixedContent, 'utf8');
console.log('\n✅ File fixed successfully!');
