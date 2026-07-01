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
  console.log(`Found ${files.length} SST files in cache.`);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const content = fs.readFileSync(filePath, 'binary');
    
    let idx = content.indexOf('parseScenes');
    while (idx !== -1) {
      // Search backward for 'use client'
      let startIdx = content.lastIndexOf('use client', idx);
      if (startIdx !== -1 && (idx - startIdx) < 200000) {
        const segment = content.substring(startIdx, startIdx + 160000);
        
        // Count binary characters in first 50000 bytes
        let binaryChars = 0;
        for (let i = 0; i < Math.min(segment.length, 50000); i++) {
          const code = segment.charCodeAt(i);
          if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
            binaryChars++;
          }
        }
        
        console.log(`Scanning File ${file}, index ${idx}, 'use client' at ${startIdx}, binary characters: ${binaryChars}`);
        
        if (binaryChars < 100) {
          console.log(`*** SUCCESS: FOUND PRISTINE SOURCE IN cache file: ${file}! ***`);
          fs.writeFileSync('d:\\chuyen gia mac the app\\src\\app\\workspace\\page.tsx', segment, 'binary');
          console.log('RECOVERED SOURCE FILE SUCCESSFULLY!');
          return true;
        }
      }
      idx = content.indexOf('parseScenes', idx + 1);
    }
  }
  
  console.log('Finished scanning, no plain text source found.');
  return false;
}

extractSource();
