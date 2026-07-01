// Script dò Flow: tạo project mới -> tìm ô nhập prompt
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

const HEADERS_PATH = 'C:\\Users\\Khanh\\Downloads\\tool sua\\CREATE VIDEO PRO 12052026\\CREATE VIDEO PRO 12052026\\headers_veo.txt';

(async () => {
  const hdrs = fs.readFileSync(HEADERS_PATH, 'utf8');
  const tokenMatch = hdrs.match(/__Secure-next-auth\.session-token=([^;]+)/);
  const sessionToken = tokenMatch ? tokenMatch[1].trim() : '';

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: path.join(process.cwd(), 'scratch', 'chrome-profile-scout2'),
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--window-size=1200,900', '--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-infobars']
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  await page.setCookie({
    name: '__Secure-next-auth.session-token',
    value: sessionToken,
    domain: '.labs.google',
    path: '/',
    secure: true,
    httpOnly: true
  });

  await page.goto('https://labs.google/fx/tools/flow', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  // Đóng popup nếu có (bấm "Tiếp theo" hoặc "Đóng")
  try {
    const closeButtons = await page.$$('button');
    for (const btn of closeButtons) {
      const text = await page.evaluate(el => (el.textContent || '').trim(), btn);
      if (text.includes('Đóng') || text.includes('close')) {
        await btn.click();
        console.log('Đã đóng popup');
        await new Promise(r => setTimeout(r, 1000));
        break;
      }
    }
  } catch {}

  // Bấm "Dự án mới"
  console.log('Tìm nút "Dự án mới"...');
  try {
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => (el.textContent || '').trim(), btn);
      if (text.includes('Dự án mới') || text.includes('New project')) {
        console.log(`Bấm: "${text}"`);
        await btn.click();
        break;
      }
    }
  } catch (e) {
    console.log('Lỗi bấm nút:', e.message);
  }

  await new Promise(r => setTimeout(r, 5000));
  console.log(`URL sau khi bấm: ${page.url()}`);

  // Dò DOM trang project mới
  const domInfo = await page.evaluate(() => {
    const result = {};
    
    result.textareas = Array.from(document.querySelectorAll('textarea')).map((el, i) => ({
      index: i, placeholder: el.placeholder, name: el.name, id: el.id,
      className: el.className.substring(0, 100),
      ariaLabel: el.getAttribute('aria-label'),
      visible: el.offsetParent !== null
    }));
    
    result.inputs = Array.from(document.querySelectorAll('input')).map((el, i) => ({
      index: i, type: el.type, placeholder: el.placeholder, name: el.name, id: el.id,
      ariaLabel: el.getAttribute('aria-label'),
      visible: el.offsetParent !== null
    }));
    
    result.buttons = Array.from(document.querySelectorAll('button')).map((el, i) => ({
      index: i, text: (el.textContent || '').trim().substring(0, 80),
      ariaLabel: el.getAttribute('aria-label'),
      disabled: el.disabled,
      visible: el.offsetParent !== null
    }));

    // Tìm video elements
    result.videos = Array.from(document.querySelectorAll('video')).map((el, i) => ({
      index: i, src: el.src, poster: el.poster, id: el.id
    }));

    result.title = document.title;
    result.url = window.location.href;
    result.bodyText = document.body?.innerText?.substring(0, 800);
    
    return result;
  });

  console.log('\n=== DOM INSIDE PROJECT ===');
  console.log(JSON.stringify(domInfo, null, 2));

  await page.screenshot({ path: 'scratch/flow_project.png', fullPage: false });
  console.log('\nScreenshot: scratch/flow_project.png');

  await browser.close();
  console.log('Done!');
})();
