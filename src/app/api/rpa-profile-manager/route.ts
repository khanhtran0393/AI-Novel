import { NextResponse } from 'next/server';
import { addExtra } from 'puppeteer-extra';
import puppeteerCore from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { requireToolboxAccess } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';

function findChromePath(): string | undefined {
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

export async function GET(req: Request) {
  const denied = await requireToolboxAccess(req);
  if (denied) return denied;
  const scratchDir = './scratch';
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }

  // Luôn trả về 5 slots cố định cho giống phần mềm gốc
  const profiles = Array.from({ length: 5 }).map((_, i) => {
    const profileId = 'chrome-profile-' + (i + 1);
    const profilePath = path.join(scratchDir, profileId);
    const exists = fs.existsSync(profilePath);
    return {
      id: profileId,
      stt: i + 1,
      status: 'OFF',
      username: exists ? 'Sẵn sàng' : 'Chưa xác định...',
      proxy: 'Direct (No Proxy)'
    };
  });

  return NextResponse.json({ profiles });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const denied = await requireToolboxAccess(req, body);
    if (denied) return denied;
    const { action, profileId } = body;

    if (!profileId || !profileId.startsWith('chrome-profile-')) {
      return NextResponse.json({ error: 'Profile ID không hợp lệ.' }, { status: 400 });
    }

    const profilePath = './scratch/' + profileId;

    if (action === 'delete') {
      if (fs.existsSync(profilePath)) {
        fs.rmSync(profilePath, { recursive: true, force: true });
      }
      return NextResponse.json({ success: true, message: 'Đã xóa lịch sử tài khoản ' + profileId });
    }

    if (action === 'login') {
      console.log('[Profile Manager] Mở cửa sổ đăng nhập cho ' + profileId + '...');
      const chromePath = findChromePath();
      const puppeteer = addExtra(puppeteerCore);
      puppeteer.use(StealthPlugin());

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const launchOptions: any = {
        headless: false, // BẮT BUỘC MỞ HIỆN HÌNH ĐỂ USER ĐĂNG NHẬP
        defaultViewport: null,
        userDataDir: profilePath,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
          '--window-size=1200,900',
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled',
        ]
      };
      if (chromePath) launchOptions.executablePath = chromePath;

      const browser = await puppeteer.launch(launchOptions);
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36');
      
      await page.goto('https://aistudio.google.com/app/prompts/new_chat', { waitUntil: 'domcontentloaded' });
      
      // Giữ cửa sổ mở trong 2 phút để user đăng nhập, sau đó tự đóng để giải phóng RAM
      await new Promise(r => setTimeout(r, 120000));
      await browser.close().catch(() => {});

      return NextResponse.json({ success: true, message: 'Đã đóng cửa sổ đăng nhập ' + profileId + ' sau 2 phút.' });
    }

    return NextResponse.json({ error: 'Action không hợp lệ.' }, { status: 400 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
