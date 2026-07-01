// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

const scratchDir = 'd:\\chuyen gia mac the app\\scratch';
const files = fs.readdirSync(scratchDir);

const terms = ['parseScenes', 'cleanVoiceScript', 'handleExpandScene', 'activeSceneIndex', 'getWordCount'];

for (const file of files) {
  if (file.startsWith('recovered_') || file === 'recovered_source.js' || file === 'extracted_chunk.js' || file.startsWith('dump_')) {
    const filePath = path.join(scratchDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      console.log(`\n==================================================`);
      console.log(`Scanning File: ${file}, Size: ${content.length}`);
      console.log(`==================================================`);
      
      for (const term of terms) {
        let idx = content.indexOf(term);
        if (idx !== -1) {
          console.log(`\n  >> Found term '${term}' at index ${idx}`);
          // Print surrounding 1200 characters
          console.log(content.substring(Math.max(0, idx - 100), Math.min(content.length, idx + 1500)));
        }
      }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      // Ignore
    }
  }
}
