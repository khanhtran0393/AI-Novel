// Tự động mở AI Studio và tạo API key
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

const APIKEY_PATH = 'C:\\Users\\Khanh\\Downloads\\tool sua\\CREATE VIDEO PRO 12052026\\CREATE VIDEO PRO 12052026\\apikey.txt';

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: path.join(process.cwd(), 'scratch', 'chrome-profile-aistudio'),
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--window-size=1200,900', '--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-infobars']
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  // Thử đăng nhập tự động
  console.log('1. Mở Google Sign In...');
  await page.goto('https://accounts.google.com/signin', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Kiểm tra xem đã đăng nhập chưa
  const currentUrl = page.url();
  console.log(`URL: ${currentUrl}`);
  
  if (currentUrl.includes('accounts.google.com')) {
    // Cần đăng nhập
    console.log('2. Nhập email...');
    try {
      await page.waitForSelector('input[type="email"]', { timeout: 5000 });
      await page.type('input[type="email"]', 'khanhtran0393@gmail.com', { delay: 50 });
      await new Promise(r => setTimeout(r, 500));
      await page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 3000));
      
      console.log('3. Nhập password...');
      await page.waitForSelector('input[type="password"]', { timeout: 10000 });
      await page.type('input[type="password"]', 'LouiS3110.', { delay: 50 });
      await new Promise(r => setTimeout(r, 500));
      await page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 5000));
    } catch (e) {
      console.log(`Lỗi đăng nhập: ${e.message}`);
    }
  }

  // Vào AI Studio API Key page
  console.log('4. Mở AI Studio API Key page...');
  await page.goto('https://aistudio.google.com/apikey', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));
  
  console.log(`URL: ${page.url()}`);
  await page.screenshot({ path: 'scratch/aistudio_page.png' });

  // Tìm nút "Create API key"
  console.log('5. Tìm nút Create API key...');
  const domInfo = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null);
    return {
      buttons: buttons.map(b => ({
        text: (b.textContent || '').trim().substring(0, 80),
        ariaLabel: b.getAttribute('aria-label'),
      })),
      bodySnippet: document.body?.innerText?.substring(0, 500)
    };
  });
  console.log(JSON.stringify(domInfo, null, 2));

  // Tìm và bấm "Create API key"
  try {
    const btns = await page.$$('button');
    for (const btn of btns) {
      const text = await page.evaluate(el => (el.textContent || '').trim(), btn);
      const visible = await page.evaluate(el => el.offsetParent !== null, btn);
      if (visible && (text.includes('Create API key') || text.includes('Tạo khóa API') || text.includes('Create API Key'))) {
        console.log(`✅ Bấm: "${text}"`);
        await btn.click();
        await new Promise(r => setTimeout(r, 5000));
        break;
      }
    }
  } catch {}

  await page.screenshot({ path: 'scratch/aistudio_after_click.png' });
  
  // Chờ API key xuất hiện
  console.log('6. Tìm API key...');
  await new Promise(r => setTimeout(r, 5000));
  
  // Tìm API key trong trang (thường ở input hoặc code block)
  const keyInfo = await page.evaluate(() => {
    // Tìm trong input fields
    const inputs = Array.from(document.querySelectorAll('input'));
    for (const input of inputs) {
      if (input.value && input.value.startsWith('AIzaSy')) {
        return { key: input.value, source: 'input' };
      }
    }
    
    // Tìm trong text content
    const text = document.body?.innerText || '';
    const match = text.match(/AIzaSy[\w-]{30,}/);
    if (match) return { key: match[0], source: 'text' };
    
    // Tìm trong clipboard-related elements
    const codeBlocks = document.querySelectorAll('code, pre, [class*="key"], [class*="api"]');
    for (const el of codeBlocks) {
      const t = el.textContent || '';
      const m = t.match(/AIzaSy[\w-]{30,}/);
      if (m) return { key: m[0], source: 'code' };
    }
    
    return { key: null, source: 'not found', bodySnippet: text.substring(0, 500) };
  });

  console.log(`Key info: ${JSON.stringify(keyInfo)}`);

  if (keyInfo.key) {
    console.log(`\n🎉 API KEY MỚI: ${keyInfo.key}`);
    
    // Thêm vào apikey.txt
    const existing = fs.existsSync(APIKEY_PATH) ? fs.readFileSync(APIKEY_PATH, 'utf8') : '';
    if (!existing.includes(keyInfo.key)) {
      fs.appendFileSync(APIKEY_PATH, `\n${keyInfo.key}`);
      console.log(`✅ Đã thêm key mới vào apikey.txt`);
    } else {
      console.log(`Key đã tồn tại trong apikey.txt`);
    }
  } else {
    console.log('\n⚠️ Không tìm thấy API key tự động.');
    console.log('Hãy tạo key thủ công trên cửa sổ Chrome đang mở.');
    // Chờ user tạo key thủ công
    console.log('Chờ 60s cho user thao tác...');
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const check = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        const match = text.match(/AIzaSy[\w-]{30,}/);
        return match ? match[0] : null;
      });
      if (check) {
        console.log(`\n🎉 API KEY: ${check}`);
        const existing = fs.existsSync(APIKEY_PATH) ? fs.readFileSync(APIKEY_PATH, 'utf8') : '';
        if (!existing.includes(check)) {
          fs.appendFileSync(APIKEY_PATH, `\n${check}`);
          console.log(`✅ Đã thêm key mới vào apikey.txt`);
        }
        break;
      }
    }
  }

  await browser.close();
  console.log('Done!');
})();
