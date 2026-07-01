// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

const GOOGLE_CHROME_DIR = 'C:\\Users\\Khanh\\AppData\\Local\\Google\\Chrome\\User Data';

async function dumpAll() {
  console.log('================================================================');
  console.log('🔍 KHỞI CHẠY QUÉT DUMP RAW NOVEL STORE TỪ CHROME...');
  console.log('================================================================\n');

  if (!fs.existsSync(GOOGLE_CHROME_DIR)) {
    console.error('[-] Không tìm thấy Chrome User Data.');
    return;
  }

  const subdirs = fs.readdirSync(GOOGLE_CHROME_DIR);
  const profileDirs = subdirs.filter(dir => dir === 'Default' || dir.startsWith('Profile '));

  for (const profile of profileDirs) {
    const leveldbDir = path.join(GOOGLE_CHROME_DIR, profile, 'Local Storage', 'leveldb');
    if (!fs.existsSync(leveldbDir)) continue;

    console.log(`[*] Đang quét Profile: "${profile}"...`);
    const files = fs.readdirSync(leveldbDir);

    for (const file of files) {
      const filePath = path.join(leveldbDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;

        const content = fs.readFileSync(filePath);
        const idx = content.indexOf('novel_generator_v2_store');
        if (idx !== -1) {
          console.log(`  [+] Tìm thấy "novel_generator_v2_store" trong tệp: ${file}`);
          
          // Lấy chuỗi raw xung quanh
          const contentStr = content.toString('utf8', Math.max(0, idx - 100), Math.min(content.length, idx + 2000));
          console.log('  --- Bắt đầu nội dung raw tìm thấy ---');
          
          // Thử trích xuất phần JSON
          const jsonStart = contentStr.indexOf('{"state":');
          if (jsonStart !== -1) {
            let braceCount = 0;
            let jsonEnd = -1;
            for (let i = jsonStart; i < contentStr.length; i++) {
              if (contentStr[i] === '{') braceCount++;
              else if (contentStr[i] === '}') {
                braceCount--;
                if (braceCount === 0) {
                  jsonEnd = i + 1;
                  break;
                }
              }
            }
            if (jsonEnd !== -1) {
              const rawJson = contentStr.substring(jsonStart, jsonEnd);
              try {
                const parsed = JSON.parse(rawJson);
                console.log(`    - useMock: ${parsed.state?.useMock}`);
                console.log(`    - apiKey (độ dài): ${parsed.state?.apiKey?.length || 0}`);
                console.log(`    - apiKeys (số lượng): ${parsed.state?.apiKeys?.length || 0}`);
                console.log(`    - googleStudioCookie (độ dài): ${parsed.state?.googleStudioCookie?.length || 0}`);
                console.log(`    - googleStudioCookies (số lượng): ${parsed.state?.googleStudioCookies?.length || 0}`);
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              } catch (e) {
                console.log('    [!] Không thể parse JSON. Nội dung raw 150 ký tự đầu:');
                console.log(contentStr.substring(jsonStart, jsonStart + 150));
              }
            } else {
              console.log('    [!] Không định vị được dấu ngoặc kết thúc JSON.');
            }
          } else {
            console.log('    [!] Không tìm thấy chuỗi JSON bắt đầu bằng {"state":');
          }
          console.log('  --- Kết thúc nội dung raw ---\n');
        }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (err) {}
    }
  }
}

dumpAll();
