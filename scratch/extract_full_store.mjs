import fs from 'fs';
import path from 'path';

const GOOGLE_CHROME_DIR = 'C:\\Users\\Khanh\\AppData\\Local\\Google\\Chrome\\User Data';

async function extractFullStore() {
  console.log('================================================================');
  console.log('🔍 KHỞI CHẠY QUÉT VÀ TRÍCH XUẤT STORE THỰC TẾ TỪ CHROME...');
  console.log('================================================================\n');

  if (!fs.existsSync(GOOGLE_CHROME_DIR)) {
    console.error('[-] Không tìm thấy thư mục Chrome User Data ở đường dẫn:', GOOGLE_CHROME_DIR);
  }

  const pathsToScan = [
    { name: 'Personal Chrome', dir: GOOGLE_CHROME_DIR },
    { name: 'Secure Profile', dir: path.join(process.cwd(), 'scratch', 'chrome-profile-secure') }
  ];

  let found = false;

  for (const target of pathsToScan) {
    if (!fs.existsSync(target.dir)) {
      console.log(`[-] Đường dẫn không tồn tại: ${target.name} (${target.dir})`);
      continue;
    }

    console.log(`\n[*] Bắt đầu quét: ${target.name} tại "${target.dir}"...`);
    
    // Check if leveldb folder is directly in the folder or inside Default
    let leveldbDirs = [];
    const directLeveldb = path.join(target.dir, 'Local Storage', 'leveldb');
    if (fs.existsSync(directLeveldb)) {
      leveldbDirs.push({ name: 'Root', path: directLeveldb });
    }

    // Default or profiles inside the folder
    if (fs.existsSync(target.dir)) {
      const subdirs = fs.readdirSync(target.dir);
      const profiles = subdirs.filter(dir => dir === 'Default' || dir.startsWith('Profile ') || dir === 'Local Storage');
      
      for (const profile of profiles) {
        let p = path.join(target.dir, profile);
        if (profile === 'Local Storage') {
          p = target.dir; // handled above
        } else {
          const ldb = path.join(p, 'Local Storage', 'leveldb');
          if (fs.existsSync(ldb)) {
            leveldbDirs.push({ name: profile, path: ldb });
          }
        }
      }
    }

    for (const ldbDir of leveldbDirs) {
      console.log(`  [*] Quét LevelDB: ${ldbDir.name}...`);
      const files = fs.readdirSync(ldbDir.path);

      for (const file of files) {
        const filePath = path.join(ldbDir.path, file);
        try {
          const stat = fs.statSync(filePath);
          if (!stat.isFile()) continue;

          const content = fs.readFileSync(filePath);
          const idx = content.indexOf('novel_generator_v2_store');
          if (idx !== -1) {
            console.log(`  [+] Tìm thấy "novel_generator_v2_store" trong tệp: ${file}`);
            
            // Trích xuất chuỗi UTF-8 từ vị trí tìm thấy
            const contentStr = content.toString('utf8', Math.max(0, idx - 100), Math.min(content.length, idx + 80000));
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
                  const cookie = parsed.state?.googleStudioCookie || '';
                  const cookies = parsed.state?.googleStudioCookies || [];
                  const drivePath = parsed.state?.googleDrivePath || '';
                  
                  console.log(`    ✅ Đã trích xuất thành công JSON từ Profile "${ldbDir.name}"!`);
                  console.log(`      - useMock: ${parsed.state?.useMock}`);
                  console.log(`      - apiKey chính (độ dài): ${parsed.state?.apiKey?.length || 0}`);
                  console.log(`      - apiKeys xoay vòng: ${parsed.state?.apiKeys?.length || 0}`);
                  console.log(`      - googleStudioCookie (độ dài): ${cookie.length}`);
                  console.log(`      - googleStudioCookies: ${cookies.length}`);
                  console.log(`      - Thư mục lưu PC: "${drivePath}"`);
                  
                  // Lưu toàn bộ store trích xuất được vào scratch/saved_novel_store.json
                  fs.writeFileSync(
                    path.join(process.cwd(), 'scratch', 'saved_novel_store.json'), 
                    JSON.stringify(parsed, null, 2)
                  );
                  console.log(`    💾 Đã ghi nhận và lưu cache Store tại: scratch/saved_novel_store.json`);
                  found = true;
                } catch (e) {
                  console.log('    [!] Lỗi khi parse JSON:', e.message);
                }
              }
            }
          }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (err) {}
      }
    }
  }

  if (!found) {
    console.log('\n[-] Không trích xuất được store thực tế nào có chứa cookie. Tiến hành quét độc lập...');
  }
}

extractFullStore();
