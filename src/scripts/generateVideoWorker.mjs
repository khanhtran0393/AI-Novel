/* eslint-disable @typescript-eslint/no-unused-vars */
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

const args = process.argv.slice(2);
const sessionToken = args[0] || '';
const promptText = args[1] || '';
if (!promptText) {
  console.error(JSON.stringify({ error: 'Missing promptText for production video generation.' }));
  process.exit(1);
}
const duration = args[2] || '5';
const outputPath = args[3] || path.join(process.cwd(), 'public', 'video', 'output.mp4');

(async () => {
  let browser;
  try {
    const chromePath = findChromePath();
    if (!chromePath) {
      console.error(JSON.stringify({ error: "Không tìm thấy trình duyệt Chrome." }));
      process.exit(1);
    }

    browser = await puppeteer.launch({
      headless: false, // Để false để user thấy luồng chạy thực tế
      defaultViewport: null,
      executablePath: chromePath,
      userDataDir: path.join(process.cwd(), 'scratch', 'chrome-profile-veo'),
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--window-size=1200,900',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars'
      ]
    });

    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    // 1. Set Cookie để bypass login
    if (sessionToken) {
      await page.setCookie({
        name: '__Secure-next-auth.session-token',
        value: sessionToken,
        domain: '.labs.google',
        path: '/',
        secure: true,
        httpOnly: true
      });
    }

    // 2. Vào trang Google Flow / Veo
    await page.goto('https://labs.google/fx/tools/flow', { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log(JSON.stringify({ status: "Đã vào trang Google Labs", url: page.url() }));

    // 3. Đợi trang load và điền prompt (cần cập nhật selector thực tế của Google Labs)
    // Các selector dưới đây là phỏng đoán dựa trên cấu trúc thông thường của Google Labs
    try {
      await page.waitForSelector('textarea', { timeout: 10000 });
      await page.type('textarea', promptText);
      console.log(JSON.stringify({ status: "Đã điền Prompt" }));
      
      // Tìm nút Generate
      const buttons = await page.$$('button');
      for (const btn of buttons) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text && text.toLowerCase().includes('generate')) {
          await btn.click();
          break;
        }
      }
      console.log(JSON.stringify({ status: "Đã click Generate, đang đợi sinh video..." }));

      throw new Error('Google Flow worker does not have a verified output download path. Refusing to report success without a real MP4 file.');

    } catch (err) {
      console.error(JSON.stringify({ error: `Lỗi khi tự động hóa giao diện: ${err.message}` }));
    }

    await browser.close();
    process.exit(0);

  } catch (err) {
    if (browser) await browser.close();
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
})();
