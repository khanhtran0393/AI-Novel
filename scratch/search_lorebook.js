// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const readline = require('readline');

const logFilePath = 'C:\\Users\\Khanh\\.gemini\\antigravity\\brain\\6961ece0-84d7-4f5d-a2e0-21a4097fb7b6\\.system_generated\\logs\\transcript.jsonl';

async function search() {
  const fileStream = fs.createReadStream(logFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineCount = 0;
  let matches = [];

  for await (const line of rl) {
    lineCount++;
    if (line.toLowerCase().includes('khải đăng')) {
      matches.push({ lineNum: lineCount, length: line.length });
    }
  }

  console.log(`Searched ${lineCount} lines.`);
  console.log(`Matches found: ${matches.length}`);
  
  if (matches.length > 0) {
    // Let's print the last 3 matches line numbers and try to parse them
    for (const match of matches.slice(-3)) {
      console.log(`--- Match at line ${match.lineNum} ---`);
      let currentLine = 0;
      const fileStream2 = fs.createReadStream(logFilePath);
      const rl2 = readline.createInterface({
        input: fileStream2,
        crlfDelay: Infinity
      });
      
      for await (const line of rl2) {
        currentLine++;
        if (currentLine === match.lineNum) {
          try {
            const parsed = JSON.parse(line);
            console.log("Type:", parsed.type);
            
            const findFields = (obj, depth = 0) => {
              if (!obj || depth > 8) return;
              if (typeof obj === 'string') {
                if (obj.includes('Khải Đăng') && obj.length > 100) {
                  console.log(`[String ${obj.length} chars]:`, obj.substring(0, 1000) + '\n...\n');
                }
                return;
              }
              if (typeof obj === 'object') {
                if (obj.lorebook) {
                  console.log("LOREBOOK FIELD:", obj.lorebook);
                }
                if (obj.dan_y_tong_the) {
                  console.log("DAN_Y_TONG_THE FIELD:", obj.dan_y_tong_the);
                }
                if (obj.tom_tat_cuon_chieu) {
                  console.log("TOM_TAT_CUON_CHIEU FIELD:", obj.tom_tat_cuon_chieu);
                }
                for (const k in obj) {
                  findFields(obj[k], depth + 1);
                }
              }
            };
            findFields(parsed);
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (e) {
            console.log("Non-JSON match snippet:", line.substring(0, 500));
          }
          break;
        }
      }
    }
  }
}

search().catch(err => console.error(err));
