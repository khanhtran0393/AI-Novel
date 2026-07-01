// Script tìm cách gen video: đóng popup -> vào project -> dò prompt input
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
    userDataDir: path.join(process.cwd(), 'scratch', 'chrome-profile-scout3'),
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

  // Intercept API
  const apiCalls = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/') || url.includes('generate') || url.includes('trpc')) {
      apiCalls.push({ method: req.method(), url: url.substring(0, 150), postData: req.postData()?.substring(0, 300) });
      console.log(`[API] ${req.method()} ${url.substring(0, 120)}`);
    }
    req.continue();
  });

  // Vào project đầu tiên
  await page.goto('https://labs.google/fx/vi/tools/flow/project/a49860c6-fabc-4d08-b618-34c8066_backfill', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Bấm "Tiếp theo" để đóng popup
  console.log('Đóng popup...');
  try {
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => (el.textContent || '').trim(), btn);
      if (text.includes('Tiếp theo') || text.includes('Next')) {
        await btn.click();
        console.log(`Đã bấm: "${text}"`);
        break;
      }
    }
  } catch {}
  
  await new Promise(r => setTimeout(r, 5000));
  console.log(`URL: ${page.url()}`);

  // Screenshot
  await page.screenshot({ path: 'scratch/flow_after_popup.png', fullPage: false });

  // Dò DOM
  const domInfo = await page.evaluate(() => {
    const result = {};
    
    result.textareas = Array.from(document.querySelectorAll('textarea')).map((el, i) => ({
      index: i, placeholder: el.placeholder, name: el.name, id: el.id,
      ariaLabel: el.getAttribute('aria-label'),
      visible: el.offsetParent !== null,
      value: el.value?.substring(0, 100)
    }));
    
    result.inputs = Array.from(document.querySelectorAll('input')).map((el, i) => ({
      index: i, type: el.type, placeholder: el.placeholder, name: el.name, id: el.id,
      ariaLabel: el.getAttribute('aria-label'),
      visible: el.offsetParent !== null
    }));
    
    // Chỉ visible buttons
    result.buttons = Array.from(document.querySelectorAll('button')).filter(el => el.offsetParent !== null).map((el, i) => ({
      index: i, text: (el.textContent || '').trim().substring(0, 80),
      ariaLabel: el.getAttribute('aria-label'),
      disabled: el.disabled,
    })).slice(0, 30);

    // Tìm tất cả div có contenteditable
    result.editables = Array.from(document.querySelectorAll('[contenteditable]')).map((el, i) => ({
      index: i,
      tag: el.tagName,
      contenteditable: el.getAttribute('contenteditable'),
      text: el.textContent?.substring(0, 100),
      ariaLabel: el.getAttribute('aria-label'),
      placeholder: el.getAttribute('data-placeholder') || el.getAttribute('placeholder'),
      visible: el.offsetParent !== null
    }));

    result.title = document.title;
    result.bodyText = document.body?.innerText?.substring(0, 1500);
    
    return result;
  });

  console.log('\n=== DOM AFTER POPUP ===');
  console.log(JSON.stringify(domInfo, null, 2));
  
  console.log('\n=== API CALLS ===');
  for (const c of apiCalls) {
    console.log(`${c.method} ${c.url}`);
    if (c.postData) console.log(`  Data: ${c.postData.substring(0, 200)}`);
  }

  await browser.close();
  console.log('\nDone!');
})();
