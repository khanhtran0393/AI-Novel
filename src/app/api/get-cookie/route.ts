import { NextResponse } from 'next/server';
import { addExtra } from 'puppeteer-extra';
import puppeteerCore from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

function findChromePath(): string | undefined {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  
  if (process.env.LOCALAPPDATA) {
    paths.push(path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'));
  }
  
  if (process.env.USERPROFILE) {
    paths.push(path.join(process.env.USERPROFILE, 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'));
  }

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return undefined;
}

export async function POST(req: Request) {
  let browser;
  try {
    const body = await req.json().catch(() => ({}));
    const email = body.email || '';
    const password = body.password || '';

    console.log('[Puppeteer Cookie Service] Đang khởi chạy trình duyệt Chrome/Chromium (Stealth Mode)...');
    
    const chromePath = findChromePath();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const launchOptions: any = {
      headless: false,
      defaultViewport: null,
      userDataDir: path.join(process.cwd(), 'scratch', 'chrome-profile-secure'),
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--window-size=1100,850',
        '--no-first-run',
        '--no-default-browser-check',
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars'
      ]
    };

    if (chromePath) {
      console.log(`[Puppeteer Cookie Service] Sử dụng Chrome thật tại: ${chromePath}`);
      launchOptions.executablePath = chromePath;
    } else {
      console.log('[Puppeteer Cookie Service] Không tìm thấy Chrome thật, sử dụng Chromium mặc định.');
    }

    // Khởi chạy trình duyệt có stealth plugin
    const puppeteer = addExtra(puppeteerCore);
    puppeteer.use(StealthPlugin());
    browser = await puppeteer.launch(launchOptions);

    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();

    // Cài đặt cờ ẩn danh nâng cao chống bot Google
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36');
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // Điều hướng trực tiếp đến Google Labs - Google sẽ tự redirect sang trang Login nếu chưa đăng nhập
    await page.goto('https://labs.google/fx/tools/flow', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Tự động điền thông tin đăng nhập nếu có
    if (email && password) {
      console.log(`[Cookie Service] Tự động đăng nhập với email: ${email}`);
      await new Promise(r => setTimeout(r, 3000)); // Chờ redirect tới trang login
      
      try {
        // Chờ ô email xuất hiện
        await page.waitForSelector('input[type="email"]', { timeout: 15000 });
        await page.type('input[type="email"]', email, { delay: 50 });
        
        // Bấm Next
        const nextBtns = await page.$$('#identifierNext, button[type="button"]');
        for (const btn of nextBtns) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const text = await page.evaluate((el: any) => el.textContent || el.innerText, btn);
          if (text && (text.includes('Next') || text.includes('Tiếp'))) {
            await btn.click();
            break;
          }
        }
        if (nextBtns.length === 0) {
          await page.click('#identifierNext');
        }
        
        console.log('[Cookie Service] Đã nhập email, chờ ô mật khẩu...');
        await new Promise(r => setTimeout(r, 3000));
        
        // Chờ ô password xuất hiện
        await page.waitForSelector('input[type="password"]', { timeout: 15000 });
        await page.type('input[type="password"]', password, { delay: 50 });
        
        // Bấm Next cho password
        const passBtns = await page.$$('#passwordNext, button[type="button"]');
        for (const btn of passBtns) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const text = await page.evaluate((el: any) => el.textContent || el.innerText, btn);
          if (text && (text.includes('Next') || text.includes('Tiếp'))) {
            await btn.click();
            break;
          }
        }
        if (passBtns.length === 0) {
          await page.click('#passwordNext');
        }
        
        console.log('[Cookie Service] Đã nhập mật khẩu, đang chờ đăng nhập hoàn tất...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (loginErr: any) {
        console.warn(`[Cookie Service] Lỗi auto-login: ${loginErr.message}. Bạn hãy đăng nhập thủ công trên Chrome.`);
      }
    }

    let cookiesStr = '';
    let isSuccess = false;

    // Thiết lập vòng lặp thăm dò (polling) trạng thái đăng nhập
    const timeout = 300000; // Hạn chờ tối đa 5 phút (300,000ms)
    const interval = 2000;  // Thăm dò mỗi 2 giây
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, interval));
      
      // Kiểm tra nếu trình duyệt bị người dùng đóng thủ công
      if (!browser.connected) {
        throw new Error('Trình duyệt đã bị đóng trước khi hoàn tất đăng nhập.');
      }

      const currentUrl = page.url();
      const currentCookies = await page.cookies();
      
      // Nhận diện trạng thái đăng nhập dựa trên sự xuất hiện của Cookie session token của Google Labs
      const hasSessionToken = currentCookies.some(c => c.name === '__Secure-next-auth.session-token');
      const isLabsPage = currentUrl.includes('labs.google');

      if (hasSessionToken && isLabsPage) {
        console.log('[Puppeteer Cookie Service] Đăng nhập thành công Google Labs! Đang trích xuất cookie...');
        // Lấy tất cả cookies cần thiết
        cookiesStr = currentCookies.map(c => `${c.name}=${c.value}`).join('; ');
        isSuccess = true;
        break;
      }

      // Tự động bấm nút "Create with Google Flow" hoặc "Sign in" nếu thấy trên trang
      try {
        const buttons = await page.$$('a, button');
        for (const btn of buttons) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const text = await page.evaluate((el: any) => (el.textContent || el.innerText || '').trim(), btn);
          if (text.includes('Create with Google Flow') || text.includes('Sign in') || text.includes('Đăng nhập') || text.includes('Get started')) {
            console.log(`[Cookie Service] Tự động bấm nút: "${text}"`);
            await btn.click();
            await new Promise(r => setTimeout(r, 2000));
            break;
          }
        }
      } catch {}

      // Nếu đang ở trang login Google, tự động điền nếu có credentials
      if (email && password && currentUrl.includes('accounts.google.com')) {
        try {
          const emailInput = await page.$('input[type="email"]');
          if (emailInput) {
            await page.type('input[type="email"]', email, { delay: 50 });
            await new Promise(r => setTimeout(r, 500));
            await page.click('#identifierNext').catch(() => {});
            console.log('[Cookie Service] Đã tự động nhập email trên trang login');
            await new Promise(r => setTimeout(r, 3000));
          }
          const passInput = await page.$('input[type="password"]:not([aria-hidden="true"])');
          if (passInput) {
            await page.type('input[type="password"]', password, { delay: 50 });
            await new Promise(r => setTimeout(r, 500));
            await page.click('#passwordNext').catch(() => {});
            console.log('[Cookie Service] Đã tự động nhập mật khẩu');
            await new Promise(r => setTimeout(r, 3000));
          }
        } catch {}
      }
    }

    // Đóng trình duyệt an toàn sau khi trích xuất hoặc hết hạn
    if (browser) {
      await browser.close();
    }

    if (!isSuccess) {
      return NextResponse.json(
        { error: 'Đăng nhập hết hạn chờ (5 phút). Vui lòng thử lại.' },
        { status: 408 }
      );
    }

    // Tự động lưu cookie vào headers_veo.txt để generate-video sử dụng
    try {
      const localPath = path.join(process.cwd(), 'headers_veo.txt');
      const headerContent = `======================================================================
 HEADERS TẤT CẢ PROFILES - GOOGLE FLOW
======================================================================


──────────────────────────────────────────────────────────────────────
 PROFILE 1 (Auto-captured ${new Date().toISOString()})
──────────────────────────────────────────────────────────────────────

FULL REQUEST HEADERS:
==================================================
accept
*/*
accept-encoding
gzip, deflate, br, zstd
accept-language
vi
content-type
application/json
cookie
${cookiesStr}
referer
https://labs.google/fx/tools/flow
user-agent
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36

`;
      // Ghi ra file local
      fs.writeFileSync(localPath, headerContent, 'utf8');
      console.log(`[Cookie Service] ✅ Đã tự động lưu cookie mới vào local: ${localPath}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (saveErr: any) {
      console.warn(`[Cookie Service] Không thể lưu headers_veo.txt: ${saveErr.message}`);
    }

    return NextResponse.json({ cookie: cookiesStr });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (browser) {
      try {
        await browser.close();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {}
    }
    console.error('Lỗi khi lấy Cookie:', err);
    return NextResponse.json(
      { error: err.message || 'Lỗi không xác định.', stack: err.stack },
      { status: 500 }
    );
  }
}

