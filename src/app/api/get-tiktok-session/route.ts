import { NextResponse } from 'next/server';
import { addExtra } from 'puppeteer-extra';
import puppeteerCore from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Poll login up to ~5 minutes */
export const maxDuration = 300;

function findChromePath(): string | undefined {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];

  if (process.env.LOCALAPPDATA) {
    paths.push(path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'));
  }

  if (process.env.USERPROFILE) {
    paths.push(
      path.join(process.env.USERPROFILE, 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
    );
  }

  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function extractSessionId(
  cookies: Array<{ name: string; value: string; domain?: string }>,
): string | null {
  // Prefer exact sessionid used by tiktok-tts package: Cookie: sessionid=...
  const primary = cookies.find(
    (c) =>
      c.name === 'sessionid' &&
      c.value &&
      c.value.length > 8 &&
      (!c.domain || c.domain.includes('tiktok')),
  );
  if (primary) return primary.value;

  const fallback = cookies.find((c) => c.name === 'sessionid' && c.value && c.value.length > 8);
  if (fallback) return fallback.value;

  // Some regions expose sessionid_ss alongside sessionid
  const ss = cookies.find(
    (c) =>
      c.name === 'sessionid_ss' &&
      c.value &&
      c.value.length > 8 &&
      (!c.domain || c.domain.includes('tiktok')),
  );
  return ss?.value || null;
}

export async function POST(req: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any;

  try {
    const body = await req.json().catch(() => ({} as { slot?: number | string; fresh?: boolean }));
    // Multi-account: mỗi slot = profile Chrome riêng (giống multi cookie / API keys)
    const rawSlot = body?.slot;
    const slotNum =
      typeof rawSlot === 'number' && Number.isFinite(rawSlot)
        ? Math.max(1, Math.floor(rawSlot))
        : typeof rawSlot === 'string' && /^\d+$/.test(rawSlot.trim())
          ? Math.max(1, parseInt(rawSlot.trim(), 10))
          : 1;
    const profileDir = path.join(
      process.cwd(),
      'scratch',
      `chrome-profile-tiktok-${slotNum}`,
    );

    // fresh=true: xóa profile slot để bắt buộc login tài khoản mới
    if (body?.fresh && fs.existsSync(profileDir)) {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
        console.log(`[TikTok Session] Đã xóa profile slot ${slotNum} (fresh login)`);
      } catch (rmErr) {
        console.warn('[TikTok Session] Không xóa được profile cũ:', rmErr);
      }
    }

    fs.mkdirSync(profileDir, { recursive: true });

    console.log(
      `[TikTok Session] Khởi chạy Chrome (Stealth) slot=${slotNum} profile=${profileDir}`,
    );

    const chromePath = findChromePath();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const launchOptions: any = {
      headless: false,
      defaultViewport: null,
      userDataDir: profileDir,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--window-size=1100,850',
        '--no-first-run',
        '--no-default-browser-check',
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
      ],
    };

    if (chromePath) {
      console.log(`[TikTok Session] Dùng Chrome: ${chromePath}`);
      launchOptions.executablePath = chromePath;
    } else {
      console.log('[TikTok Session] Không tìm thấy Chrome — dùng Chromium mặc định.');
    }

    const puppeteer = addExtra(puppeteerCore);
    puppeteer.use(StealthPlugin());
    browser = await puppeteer.launch(launchOptions);

    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    );
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // TikTok web login — user đăng nhập thủ công trên cửa sổ Chrome
    await page.goto('https://www.tiktok.com/login', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    // CDP once — httpOnly sessionid may not appear in page.cookies()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cdpClient: any = null;
    try {
      cdpClient = await page.createCDPSession();
    } catch {
      cdpClient = null;
    }

    let sessionId: string | null = null;
    const timeoutMs = 300000; // 5 phút
    const intervalMs = 2000;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, intervalMs));

      if (!browser.connected) {
        throw new Error('Trình duyệt đã bị đóng trước khi hoàn tất đăng nhập TikTok.');
      }

      try {
        // 1) page cookies
        let cookies = await page.cookies('https://www.tiktok.com');
        if (!cookies.length) {
          cookies = await page.cookies();
        }
        sessionId = extractSessionId(cookies);
        if (sessionId) {
          console.log('[TikTok Session] Đã phát hiện sessionid — đóng Chrome...');
          break;
        }

        // 2) full cookie jar via CDP (covers httpOnly)
        if (cdpClient) {
          try {
            const { cookies: cdpCookies } = await cdpClient.send('Network.getAllCookies');
            const tiktokCookies = (cdpCookies || []).filter(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (c: any) =>
                String(c.domain || '').includes('tiktok') || String(c.name || '') === 'sessionid',
            );
            sessionId = extractSessionId(tiktokCookies);
            if (sessionId) {
              console.log('[TikTok Session] sessionid lấy qua CDP — đóng Chrome...');
              break;
            }
          } catch {
            /* page may be navigating */
          }
        }
      } catch (pollErr) {
        console.warn(
          '[TikTok Session] Poll error (tiếp tục chờ):',
          pollErr instanceof Error ? pollErr.message : pollErr,
        );
      }
    }

    if (browser) {
      await browser.close().catch(() => {});
      browser = undefined;
    }

    if (!sessionId) {
      return NextResponse.json(
        {
          error:
            'Hết hạn chờ 5 phút — chưa lấy được sessionid. Hãy đăng nhập TikTok trên Chrome rồi thử lại.',
        },
        { status: 408 },
      );
    }

    console.log(`[TikTok Session] ✅ sessionid OK (len=${sessionId.length})`);
    return NextResponse.json({
      sessionId,
      tiktokSessionId: sessionId,
    });
  } catch (err: unknown) {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
    const message =
      err instanceof Error ? err.message : 'Lỗi không xác định khi lấy session TikTok.';
    console.error('[TikTok Session] Lỗi:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
