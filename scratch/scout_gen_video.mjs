// Script test gen video thực tế: nhập prompt -> bấm Tạo -> intercept API -> tải video
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
    userDataDir: path.join(process.cwd(), 'scratch', 'chrome-profile-gen'),
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

  // Intercept ALL API requests - đặc biệt bắt video generation calls
  const apiCalls = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/') || url.includes('trpc')) {
      const entry = { method: req.method(), url: url, postData: req.postData()?.substring(0, 500) };
      apiCalls.push(entry);
      if (url.includes('generate') || url.includes('create') || url.includes('video')) {
        console.log(`\n🎬 [VIDEO API] ${req.method()} ${url}`);
        if (req.postData()) console.log(`   Body: ${req.postData().substring(0, 500)}`);
      }
    }
    req.continue();
  });

  // Vào project
  await page.goto('https://labs.google/fx/vi/tools/flow/project/a49860c6-fabc-4d08-b618-34c8066_backfill', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));

  // Đóng popup Terms nếu có
  try {
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => (el.textContent || '').trim(), btn);
      if (text.includes('Tiếp theo') || text.includes('Next')) {
        await btn.click();
        console.log(`✅ Đóng popup: "${text}"`);
        break;
      }
    }
  } catch {}
  await new Promise(r => setTimeout(r, 3000));

  // Nhập prompt vào contenteditable div
  console.log(`📝 Nhập prompt: "${PROMPT}"`);
  try {
    // Tìm contenteditable div
    const editableDiv = await page.$('div[contenteditable="true"]');
    if (editableDiv) {
      await editableDiv.click();
      await new Promise(r => setTimeout(r, 500));
      // Clear existing content
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      // Type prompt
      await page.keyboard.type(PROMPT, { delay: 20 });
      console.log('✅ Đã nhập prompt');
    } else {
      console.log('❌ Không tìm thấy ô nhập prompt');
    }
  } catch (e) {
    console.log(`❌ Lỗi nhập prompt: ${e.message}`);
  }

  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'scratch/flow_before_gen.png', fullPage: false });
  console.log('📸 Screenshot trước khi gen: flow_before_gen.png');

  // Bấm nút "Tạo" (nút cuối cùng chứa text "Tạo")
  console.log('🚀 Bấm nút Tạo...');
  try {
    const buttons = await page.$$('button');
    let clicked = false;
    for (const btn of buttons) {
      const text = await page.evaluate(el => (el.textContent || '').trim(), btn);
      const visible = await page.evaluate(el => el.offsetParent !== null, btn);
      // Bấm nút "Tạo" trong vùng editor (có icon add_2 hoặc arrow_forward)
      if (visible && (text === 'add_2Tạo' || text === 'arrow_forwardTạo' || text === 'Tạo')) {
        console.log(`✅ Bấm: "${text}"`);
        await btn.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      // Fallback: tìm nút có chứa "Tạo" và visible
      for (const btn of buttons) {
        const text = await page.evaluate(el => (el.textContent || '').trim(), btn);
        const visible = await page.evaluate(el => el.offsetParent !== null, btn);
        if (visible && text.includes('Tạo') && !text.includes('Xoá') && !text.includes('Chỉnh sửa')) {
          console.log(`✅ Fallback bấm: "${text}"`);
          await btn.click();
          clicked = true;
          break;
        }
      }
    }
    if (!clicked) console.log('❌ Không tìm thấy nút Tạo');
  } catch (e) {
    console.log(`❌ Lỗi bấm Tạo: ${e.message}`);
  }

  // Chờ API call gen video (tối đa 30s)
  console.log('\n⏳ Chờ API response sinh video (30s)...');
  await new Promise(r => setTimeout(r, 15000));
  
  await page.screenshot({ path: 'scratch/flow_after_gen.png', fullPage: false });
  console.log('📸 Screenshot sau khi gen: flow_after_gen.png');

  // Wait thêm để bắt response
  await new Promise(r => setTimeout(r, 15000));

  console.log('\n=== ALL VIDEO-RELATED API CALLS ===');
  const videoCalls = apiCalls.filter(c => c.url.includes('video') || c.url.includes('generate') || c.url.includes('create') || c.url.includes('media'));
  console.log(JSON.stringify(videoCalls, null, 2));

  console.log(`\nTotal API calls: ${apiCalls.length}`);
  console.log('Video/Generate calls:', videoCalls.length);

  await browser.close();
  console.log('\nDone!');
})();
