// Script gen video v2: nhập prompt ở ô dưới cùng, bấm nút arrow_forward
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

const HEADERS_PATH = 'C:\\Users\\Khanh\\Downloads\\tool sua\\CREATE VIDEO PRO 12052026\\CREATE VIDEO PRO 12052026\\headers_veo.txt';
const PROMPT = 'A cute orange cat walking slowly in a beautiful japanese garden, cinematic 4K';

(async () => {
  const hdrs = fs.readFileSync(HEADERS_PATH, 'utf8');
  const tokenMatch = hdrs.match(/__Secure-next-auth\.session-token=([^;]+)/);
  const sessionToken = tokenMatch ? tokenMatch[1].trim() : '';

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: path.join(process.cwd(), 'scratch', 'chrome-profile-gen2'),
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
  const apiCalls = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/trpc/') && !url.includes('submitBatchLog')) {
      apiCalls.push({ method: req.method(), url, postData: req.postData()?.substring(0, 800) });
      console.log(`[API] ${req.method()} ${url.substring(0, 100)}`);
      if (req.postData()) console.log(`  → ${req.postData().substring(0, 300)}`);
    }
    req.continue();
  });

  // Vào project
  await page.goto('https://labs.google/fx/vi/tools/flow/project/a49860c6-fabc-4d08-b618-34c8066_backfill', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));

  // Đóng popup
  try {
    const btns = await page.$$('button');
    for (const btn of btns) {
      const text = await page.evaluate(el => (el.textContent || '').trim(), btn);
      if (text.includes('Tiếp theo')) { await btn.click(); console.log('✅ Đóng popup'); break; }
    }
  } catch {}
  await new Promise(r => setTimeout(r, 3000));

  // Nhập prompt: click vào ô contenteditable ở cuối trang
  console.log('📝 Nhập prompt...');
  try {
    // Dùng evaluate để tìm đúng ô prompt
    await page.evaluate((prompt) => {
      const editables = document.querySelectorAll('div[contenteditable="true"]');
      for (const el of editables) {
        if (el.offsetParent !== null) {
          el.focus();
          el.textContent = '';
          // Dùng insertText để trigger React events
          document.execCommand('insertText', false, prompt);
          console.log('Đã nhập prompt qua execCommand');
          break;
        }
      }
    }, PROMPT);
    
    await new Promise(r => setTimeout(r, 1000));
    console.log('✅ Đã nhập prompt');
  } catch (e) {
    console.log(`❌ Lỗi nhập: ${e.message}`);
  }

  await page.screenshot({ path: 'scratch/flow_v2_before.png', fullPage: false });

  // Bấm nút submit (arrow_forward → Tạo)
  console.log('🚀 Bấm nút submit...');
  try {
    const btns = await page.$$('button');
    for (const btn of btns) {
      const text = await page.evaluate(el => (el.textContent || '').trim(), btn);
      const visible = await page.evaluate(el => el.offsetParent !== null, btn);
      if (visible && text.includes('arrow_forward') && text.includes('Tạo')) {
        console.log(`✅ Bấm: "${text}"`);
        await btn.click();
        break;
      }
    }
  } catch (e) {
    console.log(`❌ Lỗi bấm: ${e.message}`);
  }

  // Chờ lâu hơn để bắt response
  console.log('\n⏳ Chờ API generate (60s)...');
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    console.log(`  ... ${(i+1)*5}s`);
    
    // Kiểm tra nếu có video xuất hiện trên trang
    const videoCount = await page.evaluate(() => document.querySelectorAll('video').length);
    if (videoCount > 0) {
      console.log(`🎬 Phát hiện ${videoCount} video element!`);
    }
  }

  await page.screenshot({ path: 'scratch/flow_v2_after.png', fullPage: false });

  // Dò DOM sau khi gen
  const domAfter = await page.evaluate(() => {
    return {
      videos: Array.from(document.querySelectorAll('video')).map(v => ({ src: v.src, poster: v.poster })),
      bodySnippet: document.body?.innerText?.substring(0, 500),
      imgs: Array.from(document.querySelectorAll('img')).filter(i => i.offsetParent !== null).slice(0, 10).map(i => ({ src: i.src?.substring(0, 150), alt: i.alt }))
    };
  });
  console.log('\n=== DOM After ===');
  console.log(JSON.stringify(domAfter, null, 2));

  console.log('\n=== ALL API CALLS (non-log) ===');
  for (const c of apiCalls) {
    console.log(`${c.method} ${c.url.substring(0, 120)}`);
    if (c.postData) console.log(`  ${c.postData.substring(0, 200)}`);
  }

  await browser.close();
  console.log('\nDone!');
})();
