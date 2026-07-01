import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

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

const TARGET = process.argv[2] || 'labs'; // 'labs' hoặc 'aistudio'
function getHeadersVeoPath() {
  const localPath = path.join(process.cwd(), 'headers_veo.txt');
  const fallbackPath = 'C:\\Users\\Khanh\\Downloads\\tool sua\\CREATE VIDEO PRO 12052026\\CREATE VIDEO PRO 12052026\\headers_veo.txt';
  const fallbackDir = 'C:\\Users\\Khanh\\Downloads\\tool sua\\CREATE VIDEO PRO 12052026\\CREATE VIDEO PRO 12052026';
  
  if (fs.existsSync(fallbackDir)) {
    return fallbackPath;
  }
  return localPath;
}
const HEADERS_VEO_PATH = getHeadersVeoPath();

(async () => {
  let browser;
  try {
    const chromePath = findChromePath();
    if (!chromePath) {
      console.log(JSON.stringify({ error: "Không tìm thấy Chrome. Hãy cài Google Chrome." }));
      process.exit(1);
    }

    console.log(JSON.stringify({ status: "Đang mở trình duyệt Chrome... Hãy đăng nhập tài khoản Google của bạn." }));

    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      executablePath: chromePath,
      userDataDir: path.join(process.cwd(), 'scratch', 'chrome-profile-login'),
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--window-size=1100,850',
        '--no-first-run',
        '--no-default-browser-check',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars'
      ]
    });

    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36');
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    if (TARGET === 'labs') {
      // Mở Google Labs Flow
      await page.goto('https://labs.google/fx/tools/flow', { waitUntil: 'domcontentloaded', timeout: 30000 });
    } else {
      // Mở Google AI Studio
      await page.goto('https://aistudio.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    console.log(JSON.stringify({ status: `Đã mở trang ${TARGET === 'labs' ? 'Google Labs' : 'AI Studio'}. Hãy đăng nhập nếu cần...` }));

    // Chờ tối đa 5 phút cho người dùng đăng nhập
    const MAX_WAIT = 300; // giây
    for (let i = 0; i < MAX_WAIT; i += 3) {
      await new Promise(r => setTimeout(r, 3000));

      const url = page.url();
      
      if (TARGET === 'labs') {
        // Kiểm tra đã vào được Labs chưa (không phải trang login)
        if (url.includes('labs.google') && !url.includes('accounts.google')) {
          const cookies = await page.cookies();
          const sessionToken = cookies.find(c => c.name === '__Secure-next-auth.session-token');
          
          if (sessionToken) {
            // Tạo chuỗi cookie đầy đủ
            const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
            
            // Lấy session info
            let sessionInfo = '';
            try {
              const sessionResp = await page.evaluate(async () => {
                const r = await fetch('/api/auth/session');
                return await r.text();
              });
              sessionInfo = sessionResp;
            } catch {}

            // Ghi ra file headers_veo.txt theo format cũ
            const headerContent = `======================================================================
 HEADERS TẤT CẢ PROFILES - GOOGLE FLOW
======================================================================


──────────────────────────────────────────────────────────────────────
 PROFILE 1 (Auto-captured ${new Date().toISOString()})
──────────────────────────────────────────────────────────────────────

FULL REQUEST HEADERS:
==================================================
accept
*/*
accept-encoding
gzip, deflate, br, zstd
accept-language
vi
content-type
application/json
cookie
${cookieStr}
referer
https://labs.google/fx/tools/flow
user-agent
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36

SESSION API RESPONSE:
==================================================
${sessionInfo}

`;
            // Ghi file
            fs.writeFileSync(HEADERS_VEO_PATH, headerContent, 'utf8');
            const localPath = path.join(process.cwd(), 'headers_veo.txt');
            if (HEADERS_VEO_PATH !== localPath) {
              fs.writeFileSync(localPath, headerContent, 'utf8');
            }
            
            console.log(JSON.stringify({ 
              success: true, 
              cookie: cookieStr.substring(0, 100) + '...',
              sessionToken: sessionToken.value.substring(0, 50) + '...',
              savedTo: HEADERS_VEO_PATH,
              status: "✅ Đã bắt Cookie thành công và lưu vào headers_veo.txt!"
            }));
            
            await browser.close();
            process.exit(0);
          }
        }
      } else {
        // AI Studio - kiểm tra cookie __Secure-1PSID
        if (url.includes('aistudio.google.com')) {
          const cookies = await page.cookies();
          const secureSid = cookies.find(c => c.name === '__Secure-1PSID');
          if (secureSid) {
            const cookiesStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
            console.log(JSON.stringify({ success: true, cookie: cookiesStr.substring(0, 100) + '...' }));
            await browser.close();
            process.exit(0);
          }
        }
      }
      
      // In trạng thái mỗi 15 giây
      if (i % 15 === 0 && i > 0) {
        console.log(JSON.stringify({ status: `Đang chờ đăng nhập... (${i}s/${MAX_WAIT}s) | URL: ${url.substring(0, 60)}` }));
      }
    }

    console.log(JSON.stringify({ error: `Quá thời gian ${MAX_WAIT}s mà chưa bắt được Cookie. Bạn đã đăng nhập thành công chưa?` }));
    await browser.close();
    process.exit(1);

  } catch (err) {
    if (browser) await browser.close();
    console.log(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
})();
