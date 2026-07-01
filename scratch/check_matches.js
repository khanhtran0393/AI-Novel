// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

const targetDir = 'd:\\chuyen gia mac the app\\scratch';
const files = fs.readdirSync(targetDir);

for (const file of files) {
  if (file.startsWith('match_') && file.endsWith('.json')) {
    const filePath = path.join(targetDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      console.log(`\n--- ${file} ---`);
      console.log(JSON.stringify(data, null, 2).substring(0, 1000));
    } catch (e) {
      console.error(`Error parsing ${file}:`, e);
    }
  }
}
