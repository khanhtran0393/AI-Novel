// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const readline = require('readline');

const brainDir = 'C:\\Users\\Khanh\\.gemini\\antigravity\\brain';

async function searchAll() {
  const folders = fs.readdirSync(brainDir);
  console.log(`Found ${folders.length} folders in brain directory.`);

  const keywords = ['neo-veridia', 'empathic', 'memory hunter', 'khải đăng', 'mạng lưới thấu cảm'];

  for (const folder of folders) {
    const logPath = path.join(brainDir, folder, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(logPath)) continue;

    console.log(`Scanning ${folder}...`);
    const fileStream = fs.createReadStream(logPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let lineNum = 0;
    for await (const line of rl) {
      lineNum++;
      const lowerLine = line.toLowerCase();
      
      let matchedKeyword = null;
      for (const kw of keywords) {
        if (lowerLine.includes(kw)) {
          matchedKeyword = kw;
          break;
        }
      }

      if (matchedKeyword) {
        console.log(`[MATCH] ${folder} L#${lineNum} [KW: ${matchedKeyword}]:`);
        
        try {
          const parsed = JSON.parse(line);
          const findDeep = (obj, depth = 0) => {
            if (!obj || depth > 6) return;
            if (typeof obj === 'string') {
              if (obj.toLowerCase().includes(matchedKeyword) && obj.length > 50) {
                console.log(`    String length ${obj.length}: ${obj.substring(0, 500)}...`);
              }
              return;
            }
            if (typeof obj === 'object') {
              if (obj.lorebook) {
                console.log(`    LOREBOOK FOUND: ${obj.lorebook.substring(0, 500)}...`);
              }
              if (obj.dan_y_tong_the) {
                console.log(`    DAN_Y_TONG_THE FOUND: ${obj.dan_y_tong_the.substring(0, 500)}...`);
              }
              if (obj.tom_tat_cuon_chieu) {
                console.log(`    TOM_TAT FOUND: ${obj.tom_tat_cuon_chieu.substring(0, 500)}...`);
              }
              for (const k in obj) {
                findDeep(obj[k], depth + 1);
              }
            }
          };
          findDeep(parsed);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
          console.log(`    Raw snippet: ${line.substring(0, 500)}...`);
        }
      }
    }
  }
}

searchAll().catch(err => console.error(err));
