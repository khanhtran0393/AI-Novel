// Script dò DOM Google Flow - xem các element thực tế
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

const HEADERS_PATH = 'C:\\Users\\Khanh\\Downloads\\tool sua\\CREATE VIDEO PRO 12052026\\CREATE VIDEO PRO 12052026\\headers_veo.txt';

(async () => {
  // Đọc session token
  const hdrs = fs.readFileSync(HEADERS_PATH, 'utf8');
  const tokenMatch = hdrs.match(/__Secure-next-auth\.session-token=([^;]+)/);
  const sessionToken = tokenMatch ? tokenMatch[1].trim() : '';
  
  if (!sessionToken) {
    console.log('Không tìm thấy session token!');
    process.exit(1);
  }
  console.log(`Session token: ${sessionToken.substring(0, 30)}...`);

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    executablePath: chromePath,
    userDataDir: path.join(process.cwd(), 'scratch', 'chrome-profile-scout'),
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--window-size=1200,900', '--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-infobars']
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  // Set cookie
  await page.setCookie({
    name: '__Secure-next-auth.session-token',
    value: sessionToken,
    domain: '.labs.google',
    path: '/',
    secure: true,
    httpOnly: true
  });

  // Vào trang Flow
  await page.goto('https://labs.google/fx/tools/flow', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log(`URL: ${page.url()}`);
  
  // Chờ trang tải
  await new Promise(r => setTimeout(r, 5000));
  console.log(`URL after wait: ${page.url()}`);

  // Dò tất cả element quan trọng
  const domInfo = await page.evaluate(() => {
    const result = {};
    
    // Tìm tất cả textarea
    const textareas = document.querySelectorAll('textarea');
    result.textareas = Array.from(textareas).map((el, i) => ({
      index: i,
      placeholder: el.placeholder,
      name: el.name,
      id: el.id,
      className: el.className.substring(0, 100),
      ariaLabel: el.getAttribute('aria-label'),
    }));
    
    // Tìm tất cả input
    const inputs = document.querySelectorAll('input');
    result.inputs = Array.from(inputs).map((el, i) => ({
      index: i,
      type: el.type,
      placeholder: el.placeholder,
      name: el.name,
      id: el.id,
      ariaLabel: el.getAttribute('aria-label'),
    }));
    
    // Tìm tất cả button
    const buttons = document.querySelectorAll('button');
    result.buttons = Array.from(buttons).map((el, i) => ({
      index: i,
      text: (el.textContent || '').trim().substring(0, 80),
      ariaLabel: el.getAttribute('aria-label'),
      id: el.id,
      className: el.className.substring(0, 80),
      disabled: el.disabled,
    }));
    
    // Tìm links quan trọng
    const links = document.querySelectorAll('a');
    result.links = Array.from(links).slice(0, 20).map((el, i) => ({
      index: i,
      text: (el.textContent || '').trim().substring(0, 60),
      href: el.href,
    }));

    // Nội dung chính
    result.title = document.title;
    result.bodyText = document.body?.innerText?.substring(0, 500);
    
    return result;
  });

  console.log('\n=== DOM INFO ===');
  console.log(JSON.stringify(domInfo, null, 2));

  // Chờ thêm để có thể tương tác
  await new Promise(r => setTimeout(r, 3000));
  
  // Screenshot
  await page.screenshot({ path: 'scratch/flow_screenshot.png', fullPage: false });
  console.log('\nScreenshot saved: scratch/flow_screenshot.png');

  await browser.close();
  console.log('\nDone!');
})();
