// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

function extractSource() {
  const dir = 'd:\\chuyen gia mac the app\\.next\\dev\\cache\\turbopack\\ee6e79b1';
  const files = ['00002264.sst', '00002270.sst', '00002282.sst', '00002314.sst', '00002327.sst', '00002336.sst'];
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) continue;
    
    const content = fs.readFileSync(filePath, 'binary');
    console.log(`Scanning file: ${file}, size: ${content.length}`);
    
    let idx = content.indexOf('parseScenes');
    while (idx !== -1) {
      // Search backward for 'use client'
      let startIdx = content.lastIndexOf('use client', idx);
      if (startIdx !== -1 && (idx - startIdx) < 200000) {
        // Check if this segment contains very few binary characters
        const segment = content.substring(startIdx, startIdx + 160000);
        let binaryChars = 0;
        for (let i = 0; i < Math.min(segment.length, 50000); i++) {
          const code = segment.charCodeAt(i);
          if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
            binaryChars++;
          }
        }
        console.log(`  -> File ${file}, index ${idx}, use client at ${startIdx}, binary chars: ${binaryChars}`);
        
        if (binaryChars < 100) {
          console.log('  *** FOUND PLAIN TEXT SOURCE IN SST! ***');
          fs.writeFileSync('d:\\chuyen gia mac the app\\src\\app\\workspace\\page.tsx', segment, 'binary');
          console.log('  RECOVERED SOURCE FILE SUCCESSFULLY!');
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
