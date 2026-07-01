// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const path = require('path');

const filePath = 'd:\\chuyen gia mac the app\\scratch\\recovered_source.js';
if (!fs.existsSync(filePath)) {
  console.log('recovered_source.js does not exist!');
  process.exit(1);
}

const content = fs.readFileSync(filePath, 'binary');
console.log(`Scanning recovered_source.js (Size: ${content.length})...`);

const terms = ['parseScenes', 'cleanVoiceScript', 'getWordCount', 'activeSceneIndex', 'ttsSpeed', 'playSample'];

for (const term of terms) {
  let idx = content.indexOf(term);
  if (idx !== -1) {
    console.log(`\n==================================================`);
    console.log(`FOUND TERM '${term}' at index ${idx}`);
    console.log(`==================================================`);
    
    // Print 1000 characters before and 2000 characters after
    const start = Math.max(0, idx - 300);
    const end = Math.min(content.length, idx + 2500);
    console.log(content.substring(start, end));
  }
}
