// Script intercept API: vào project, bắt network request tới API backend của Google Flow
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
    userDataDir: path.join(process.cwd(), 'scratch', 'chrome-profile-intercept'),
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--window-size=1200,900', '--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-infobars']
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36');

  await page.setCookie({
    name: '__Secure-next-auth.session-token',
    value: sessionToken,
    domain: '.labs.google',
    path: '/',
    secure: true,
    httpOnly: true
  });

  // Intercept ALL API requests
  const apiCalls = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    // Log tất cả API calls (không phải static assets)
    if (url.includes('/api/') || url.includes('generativelanguage') || url.includes('generate') || url.includes('aiplatform')) {
      apiCalls.push({
        method: req.method(),
        url: url,
        headers: req.headers(),
        postData: req.postData()?.substring(0, 500)
      });
      console.log(`[API] ${req.method()} ${url.substring(0, 120)}`);
    }
    req.continue();
  });

  // Vào project đầu tiên 
  const projectUrl = 'https://labs.google/fx/vi/tools/flow/project/a49860c6-fabc-4d08-b618-34c8066_backfill';
  console.log(`Vào project: ${projectUrl}`);
  await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 8000));

  console.log(`\nURL: ${page.url()}`);
  
  // Dò DOM trong project editor
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
    
    result.buttons = Array.from(document.querySelectorAll('button')).filter(el => el.offsetParent !== null).map((el, i) => ({
      index: i, text: (el.textContent || '').trim().substring(0, 80),
      ariaLabel: el.getAttribute('aria-label'),
      disabled: el.disabled,
    }));

    result.title = document.title;
    result.url = window.location.href;
    result.bodyText = document.body?.innerText?.substring(0, 1000);
    
    return result;
  });

  console.log('\n=== DOM IN PROJECT EDITOR ===');
  console.log(JSON.stringify(domInfo, null, 2));
  
  console.log('\n=== INTERCEPTED API CALLS ===');
  console.log(JSON.stringify(apiCalls, null, 2));

  await page.screenshot({ path: 'scratch/flow_editor.png', fullPage: false });
  console.log('\nScreenshot: scratch/flow_editor.png');

  await browser.close();
})();
