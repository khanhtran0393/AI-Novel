// eslint-disable-next-line @typescript-eslint/no-require-imports
const puppeteer = require('puppeteer');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

function findChromePath() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  if (process.env.LOCALAPPDATA) paths.push(path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'));
  if (process.env.USERPROFILE) paths.push(path.join(process.env.USERPROFILE, 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'));

  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

async function main() {
  console.log('================================================================');
  console.log('🌐 TRÍCH XUẤT COOKIES TỪ PROFILE SECURE QUA PUPPETEER...');
  console.log('================================================================\n');

  const chromePath = findChromePath();
  const secureProfileDir = path.join(process.cwd(), 'scratch', 'chrome-profile-secure');
  
  if (!fs.existsSync(secureProfileDir)) {
    console.error('[-] Thư mục chrome-profile-secure không tồn tại.');
    return;
  }

  console.log(`[*] Sử dụng profile: "${secureProfileDir}"`);
  console.log(`[*] Chrome Executable: "${chromePath || 'Default'}"`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true, // we don't need UI
      executablePath: chromePath,
      userDataDir: secureProfileDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ]
    });

    const page = await browser.newPage();
    console.log('[*] Đang truy cập https://aistudio.google.com...');
    await page.goto('https://aistudio.google.com', { waitUntil: 'networkidle2', timeout: 30000 });
    
    console.log('[*] Đang lấy cookies...');
    const cookies = await page.cookies();
    console.log(`[+] Đã lấy được ${cookies.length} cookies.`);

    // Filter secure cookies for Google
    const secureSid = cookies.find(c => c.name === '__Secure-1PSID' || c.name === 'SID');
    if (secureSid) {
      console.log(`🎉 TÌM THẤY COOKIE ĐĂNG NHẬP HỢP LỆ: ${secureSid.name}!`);
      
      const cookiesStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      console.log(`- Độ dài cookie chuỗi: ${cookiesStr.length}`);
      console.log(`- Snippet: "${cookiesStr.substring(0, 100)}..."`);

      // Save to saved_novel_store.json
      const storePath = path.join(process.cwd(), 'scratch', 'saved_novel_store.json');
      let storeData = { state: {} };
      if (fs.existsSync(storePath)) {
        try {
          storeData = JSON.parse(fs.readFileSync(storePath, 'utf8'));
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {}
      }
      
      if (!storeData.state) storeData.state = {};
      storeData.state.googleStudioCookie = cookiesStr;
      storeData.state.googleStudioCookies = [cookiesStr];
      storeData.state.useMock = false;

      fs.writeFileSync(storePath, JSON.stringify(storeData, null, 2), 'utf8');
      console.log('💾 Đã lưu Cookie đăng nhập thực tế vào scratch/saved_novel_store.json!');
    } else {
      console.log('[-] Không tìm thấy cookie đăng nhập (__Secure-1PSID hoặc SID) trong profile secure.');
      console.log('Danh sách các cookie tìm thấy:', cookies.map(c => c.name).join(', '));
    }
  } catch (err) {
    console.error('[-] Lỗi:', err.message);
  } finally {
    if (browser) await browser.close();
  }
}

main();
