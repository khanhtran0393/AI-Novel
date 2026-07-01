// Mở Chrome và bắt MỌI network request khi user tương tác
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
    userDataDir: path.join(process.cwd(), 'scratch', 'chrome-profile-monitor'),
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
    domain: '.labs.google', path: '/', secure: true, httpOnly: true
  });

  // Bật CDP Network domain để bắt MỌI request (kể cả XHR/fetch)
  const client = await page.createCDPSession();
  await client.send('Network.enable');
  
  const allRequests = [];
  client.on('Network.requestWillBeSent', (params) => {
    const url = params.request.url;
    if (url.includes('/api/trpc/') || url.includes('/api/') && !url.includes('.js') && !url.includes('.css')) {
      const entry = {
        time: new Date().toISOString(),
        method: params.request.method,
        url: url,
        postData: params.request.postData?.substring(0, 500)
      };
      allRequests.push(entry);
      console.log(`\n🔵 [${entry.method}] ${url}`);
      if (params.request.postData) {
        console.log(`   Body: ${params.request.postData.substring(0, 300)}`);
      }
    }
  });

  // Cũng bắt response
  client.on('Network.responseReceived', (params) => {
    const url = params.response.url;
    if (url.includes('/api/trpc/') && !url.includes('submitBatchLog') && !url.includes('getMediaUrl')) {
      console.log(`🟢 Response: ${params.response.status} ${url.substring(0, 100)}`);
    }
  });

  console.log('📌 Mở Google Flow project...');
  await page.goto('https://labs.google/fx/vi/tools/flow/project/a49860c6-fabc-4d08-b618-34c8066_backfill', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));

  // Đóng popup
  try {
    const btns = await page.$$('button');
    for (const btn of btns) {
      const text = await page.evaluate(el => (el.textContent || '').trim(), btn);
      if (text.includes('Tiếp theo')) { await btn.click(); break; }
    }
  } catch {}
  await new Promise(r => setTimeout(r, 2000));

  console.log('\n\n=========================================');
  console.log('📌 HÃY THAO TÁC THỦ CÔNG TRÊN CHROME:');
  console.log('   1. Nhập prompt vào ô "Bạn muốn tạo gì?"');
  console.log('   2. Bấm nút → (mũi tên) để tạo');
  console.log('   Mình sẽ bắt mọi API request!');
  console.log('   Chờ 120 giây...');
  console.log('=========================================\n');

  // Chờ 120 giây cho user thao tác
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 5000));
    if (i % 6 === 5) console.log(`\n⏰ ${(i+1)*5}s / 120s... (${allRequests.length} API calls bắt được)`);
  }

  console.log('\n\n=== TẤT CẢ API CALLS ===');
  for (const r of allRequests) {
    console.log(`${r.method} ${r.url}`);
    if (r.postData) console.log(`  Body: ${r.postData}`);
  }

  // Lưu ra file
  fs.writeFileSync('scratch/api_calls_log.json', JSON.stringify(allRequests, null, 2));
  console.log('\nĐã lưu log: scratch/api_calls_log.json');

  await browser.close();
  console.log('Done!');
})();
