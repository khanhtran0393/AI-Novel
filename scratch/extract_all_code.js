// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

const targetDir = 'd:\\chuyen gia mac the app\\scratch';
const files = fs.readdirSync(targetDir);

console.log('Searching all files for clean code blocks...');

const keywords = ['function parseScenes', 'function cleanVoiceScript', 'function getWordCount', 'const handleExpandScene', 'const handlePlayTTS'];

for (const file of files) {
  const filePath = path.join(targetDir, file);
  if (!fs.statSync(filePath).isFile()) continue;

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    for (const keyword of keywords) {
      let idx = content.indexOf(keyword);
      if (idx !== -1) {
        console.log(`\n==================================================`);
        console.log(`FOUND '${keyword}' in ${file} at index ${idx}`);
        console.log(`==================================================`);
        console.log(content.substring(idx, Math.min(content.length, idx + 2000)));
      }
    }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    // Ignore binary errors
  }
}
