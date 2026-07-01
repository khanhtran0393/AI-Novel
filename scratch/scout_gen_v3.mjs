// V3: Click vào ô prompt → gõ keyboard thật → bấm Enter/submit
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

const HEADERS_PATH = 'C:\\Users\\Khanh\\Downloads\\tool sua\\CREATE VIDEO PRO 12052026\\CREATE VIDEO PRO 12052026\\headers_veo.txt';
const PROMPT = 'A cute orange cat walking slowly in a beautiful garden';

(async () => {
  const hdrs = fs.readFileSync(HEADERS_PATH, 'utf8');
  const tokenMatch = hdrs.match(/__Secure-next-auth\.session-token=([^;]+)/);
  const sessionToken = tokenMatch ? tokenMatch[1].trim() : '';

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: path.join(process.cwd(), 'scratch', 'chrome-profile-gen3'),
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

  // Intercept
  const genCalls = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/trpc/') && !url.includes('submitBatchLog') && !url.includes('getMediaUrl') && !url.includes('fetchUser')) {
      genCalls.push({ method: req.method(), url: url.substring(0, 150), postData: req.postData()?.substring(0, 500) });
      console.log(`[API] ${req.method()} ${url.substring(0, 120)}`);
      if (req.postData()) console.log(`  → ${req.postData().substring(0, 300)}`);
    }
    req.continue();
  });

  // Vào project
  await page.goto('https://labs.google/fx/vi/tools/flow/project/a49860c6-fabc-4d08-b618-34c8066_backfill', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  // Đóng popup
  try {
    const btns = await page.$$('button');
    for (const btn of btns) {
      const text = await page.evaluate(el => (el.textContent || '').trim(), btn);
      if (text.includes('Tiếp theo')) { await btn.click(); console.log('✅ Đóng popup'); break; }
    }
  } catch {}
  await new Promise(r => setTimeout(r, 3000));

  // Click vào ô prompt contenteditable
  console.log('📝 Click vào ô prompt...');
  const editable = await page.$('div[contenteditable="true"]');
  if (!editable) {
    console.log('❌ Không tìm thấy contenteditable!');
    await browser.close();
    return;
  }
  
  await editable.click();
  await new Promise(r => setTimeout(r, 500));
  
  // Xóa placeholder text
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await new Promise(r => setTimeout(r, 300));
  
  // Gõ từng ký tự bằng keyboard thật
  console.log('⌨️ Gõ prompt bằng keyboard...');
  await page.keyboard.type(PROMPT, { delay: 30 });
  await new Promise(r => setTimeout(r, 1000));
  
  // Kiểm tra nội dung đã nhập
  const typedText = await page.evaluate(() => {
    const el = document.querySelector('div[contenteditable="true"]');
    return el ? el.textContent : '';
  });
  console.log(`📝 Nội dung đã gõ: "${typedText}"`);
  
  await page.screenshot({ path: 'scratch/flow_v3_typed.png', fullPage: false });
  console.log('📸 Screenshot: flow_v3_typed.png');

  // Bấm nút submit bằng keyboard Enter
  console.log('🚀 Bấm Enter để submit...');
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 3000));
  
  // Nếu Enter không hoạt động, thử click nút arrow_forward
  const afterEnterCalls = genCalls.length;
  if (genCalls.length <= 8) {
    console.log('Enter không trigger API. Thử click nút →...');
    try {
      const btns = await page.$$('button');
      for (const btn of btns) {
        const text = await page.evaluate(el => (el.textContent || '').trim(), btn);
        const visible = await page.evaluate(el => el.offsetParent !== null, btn);
        if (visible && text.includes('arrow_forward')) {
          console.log(`✅ Click: "${text}"`);
          await btn.click();
          break;
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 3000));
  }

  await page.screenshot({ path: 'scratch/flow_v3_submitted.png', fullPage: false });
  
  // Chờ cho các API calls
  console.log('\n⏳ Chờ API response (90s)...');
  for (let i = 0; i < 18; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const newCalls = genCalls.slice(afterEnterCalls);
    if (newCalls.length > 0) {
      console.log(`  ${(i+1)*5}s - ${newCalls.length} new API calls!`);
    } else {
      console.log(`  ${(i+1)*5}s - waiting...`);
    }
  }

  await page.screenshot({ path: 'scratch/flow_v3_final.png', fullPage: false });

  console.log('\n=== ALL API CALLS ===');
  for (const c of genCalls) {
    console.log(`${c.method} ${c.url}`);
    if (c.postData) console.log(`  ${c.postData.substring(0, 300)}`);
  }

  await browser.close();
  console.log('\nDone!');
})();
