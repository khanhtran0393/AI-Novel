// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');

const filePath = 'd:\\chuyen gia mac the app\\scratch\\recovered_cleanVoiceScript_from_6961ece0-84d7-4f5d-a2e0-21a4097fb7b6_step_2196.js';
if (!fs.existsSync(filePath)) {
  console.log('File step 2196 does not exist!');
  process.exit(1);
}

const content = fs.readFileSync(filePath, 'utf8');
console.log(`Successfully read step 2196 log! File length: ${content.length} characters.`);

// Write the whole file to a text file for complete inspection
fs.writeFileSync('d:\\chuyen gia mac the app\\scratch\\untruncated_step_2196.txt', content);
console.log('Saved untruncated content to: scratch/untruncated_step_2196.txt');

// Search for key functions inside it
const functions = [
  'cleanVoiceScript',
  'handlePlayTTS',
  'handleStopTTS',
  'handleGenerateTTSAIStudio',
  'handleGenerateImagePrompt'
];

for (const fn of functions) {
  let idx = content.indexOf(fn);
  if (idx !== -1) {
    console.log(`\n==================================================`);
    console.log(`EXTRACTING '${fn}' FROM STEP 2196`);
    console.log(`==================================================`);
    // Print 1500 characters
    console.log(content.substring(idx - 100, idx + 1800));
  }
}
