// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const readline = require('readline');

const BRAIN_DIR = 'C:\\Users\\Khanh\\.gemini\\antigravity\\brain';

async function scanLogs() {
  console.log('================================================================');
  console.log('🔍 QUÉT TOÀN BỘ TRANSCRIPT LOGS TRONG BRAIN ĐỂ TÌM COOKIE...');
  console.log('================================================================\n');

  if (!fs.existsSync(BRAIN_DIR)) {
    console.error('[-] Thư mục brain không tồn tại:', BRAIN_DIR);
    return;
  }

  const dirs = fs.readdirSync(BRAIN_DIR);
  const convDirs = dirs.filter(d => {
    const full = path.join(BRAIN_DIR, d);
    return fs.statSync(full).isDirectory() && d !== '.tempmediaStorage';
  });

  console.log(`[*] Tìm thấy ${convDirs.length} thư mục cuộc trò chuyện:`);
  console.log(convDirs.map(d => ` - ${d}`).join('\n'));

  for (const conv of convDirs) {
    const logFile = path.join(BRAIN_DIR, conv, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(logFile)) {
      continue;
    }

    console.log(`\n[*] Đang quét log file: ${logFile}...`);
    const fileStream = fs.createReadStream(logFile);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let lineIndex = 0;
    for await (const line of rl) {
      lineIndex++;
      if (line.includes('googleStudioCookie') || line.includes('googleStudioCookies')) {
        console.log(`  [+] Tìm thấy 'googleStudioCookie' ở dòng ${lineIndex}!`);
        // Let's analyze what's on this line
        try {
          const parsed = JSON.parse(line);
          // Try to extract from tool_calls or content
          findCookiesInObject(parsed, `${conv} (Line ${lineIndex})`);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
          // If not valid JSON line, do a simple regex or substring match
          console.log(`  [!] Dòng không phải JSON hợp lệ. Thử tìm chuỗi...`);
          const match = line.match(/(?:googleStudioCookie(?:s)?["']?\s*:\s*\[?["']([^"']+)["'])/i);
          if (match && match[1]) {
            console.log(`    -> Tìm thấy chuỗi cookie (độ dài ${match[1].length}): ${match[1].substring(0, 50)}...`);
          }
        }
      }
    }
  }
}

function findCookiesInObject(obj, loc) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const str = JSON.stringify(obj);
  
  // Search for googleStudioCookies array or googleStudioCookie string in JSON
  const matches = [];
  
  // Simple recursive search in object
  function recurse(o) {
    if (!o) return;
    if (typeof o === 'string') {
      if (o.includes('__Secure-1PSID=') || o.includes('__Secure-3PSID=') || o.includes('SID=') || (o.length > 50 && o.includes(';'))) {
        matches.push(o);
      }
    } else if (Array.isArray(o)) {
      for (const item of o) recurse(item);
    } else if (typeof o === 'object') {
      for (const key of Object.keys(o)) {
        if (key === 'googleStudioCookie' && typeof o[key] === 'string' && o[key].length > 10) {
          matches.push(o[key]);
        } else if (key === 'googleStudioCookies' && Array.isArray(o[key])) {
          for (const c of o[key]) {
            if (typeof c === 'string' && c.length > 10) {
              matches.push(c);
            }
          }
        } else {
          recurse(o[key]);
        }
      }
    }
  }

  recurse(obj);

  if (matches.length > 0) {
    console.log(`  🎉 ĐÃ TRÍCH XUẤT THÀNH CÔNG ${matches.length} COOKIES TỪ ${loc}!`);
    for (let i = 0; i < matches.length; i++) {
      const cookie = matches[i];
      console.log(`    - Cookie #${i + 1} (độ dài ${cookie.length}): "${cookie.substring(0, 60)}..."`);
      
      // Save it to a global map to write to saved_novel_store.json
      if (!global.foundCookies) global.foundCookies = [];
      if (!global.foundCookies.includes(cookie)) {
        global.foundCookies.push(cookie);
      }
    }
  }
}

global.foundCookies = [];

scanLogs().then(() => {
  console.log('\n================================================================');
  console.log(`📊 KẾT QUẢ QUÉT LOGS: TÌM THẤY ${global.foundCookies.length} COOKIES DUY NHẤT`);
  console.log('================================================================');
  if (global.foundCookies.length > 0) {
    const storePath = path.join(process.cwd(), 'scratch', 'saved_novel_store.json');
    let storeData = { state: {} };
    if (fs.existsSync(storePath)) {
      try {
        storeData = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {}
    }
    
    if (!storeData.state) storeData.state = {};
    storeData.state.googleStudioCookie = global.foundCookies[0];
    storeData.state.googleStudioCookies = global.foundCookies;
    storeData.state.useMock = false;
    
    fs.writeFileSync(storePath, JSON.stringify(storeData, null, 2), 'utf8');
    console.log(`💾 Đã cập nhật và lưu cache Store có Cookie tại: scratch/saved_novel_store.json`);
  }
});
