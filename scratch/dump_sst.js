// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

function extractSource() {
  const dir = 'd:\\chuyen gia mac the app\\.next\\dev\\cache\\turbopack\\ee6e79b1';
  
  if (!fs.existsSync(dir)) {
    console.log(`ERROR: Directory ${dir} does not exist!`);
    return false;
  }
  
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sst'));
  let matchCount = 0;
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const content = fs.readFileSync(filePath, 'binary');
    
    let idx = content.indexOf('parseScenes');
    while (idx !== -1) {
      // Search backward for 'use client'
      let startIdx = content.lastIndexOf('use client', idx);
      if (startIdx !== -1 && (idx - startIdx) < 200000) {
        const segment = content.substring(startIdx, startIdx + 160000);
        fs.writeFileSync(`d:\\chuyen gia mac the app\\scratch\\dump_${matchCount}.txt`, segment, 'binary');
        console.log(`Dumped match ${matchCount} from file ${file}`);
        matchCount++;
        
        // Stop after a few to avoid too many files
        if (matchCount > 10) return;
      }
      idx = content.indexOf('parseScenes', idx + 1);
    }
  }
}

extractSource();
