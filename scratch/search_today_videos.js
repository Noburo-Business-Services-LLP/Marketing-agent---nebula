const fs = require('fs');
const path = require('path');

console.log('Searching for any video URLs generated today (July 27, 2026)...');

function searchDir(dir) {
  try {
    const list = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of list) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (!item.name.includes('node_modules') && !item.name.includes('.git')) {
          searchDir(full);
        }
      } else {
        try {
          const stat = fs.statSync(full);
          if (stat.mtime > new Date('2026-07-27T00:00:00Z')) {
            const content = fs.readFileSync(full, 'utf8');
            const falMatches = content.match(/fal\.media\/[^\s"'\\]+/gi) || [];
            const mp4Matches = content.match(/https?:[^\s"'\\]+\.mp4/gi) || [];
            if (falMatches.length || mp4Matches.length) {
              console.log('\nFOUND MATCHES IN:', full);
              if (falMatches.length) console.log('  Fal URLs:', falMatches);
              if (mp4Matches.length) console.log('  MP4 URLs:', mp4Matches);
            }
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
}

searchDir('./storage');
searchDir('/tmp');
searchDir('/app');
