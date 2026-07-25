/**
 * Lấy TikTok sessionid bằng Chrome/Edge THẬT (spawn + CDP connect).
 * Không dùng puppeteer.launch() mặc định — tránh --no-sandbox / automation
 * khiến TikTok chặn đăng nhập.
 */
import { NextResponse } from 'next/server';
import puppeteerCore from 'puppeteer-core';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import http from 'http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SESSION_COOKIE_NAMES = [
  'sessionid',
  'sessionid_ss',
  'sid_tt',
  'sid_guard',
  'tt_session_id',
] as const;

function findChromePath(): string | undefined {
  const paths = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean) as string[];

  if (process.env.LOCALAPPDATA) {
    paths.push(
      path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env.LOCALAPPDATA, 'Microsoft\\Edge\\Application\\msedge.exe'),
    );
  }
  if (process.env.USERPROFILE) {
    paths.push(
      path.join(
        process.env.USERPROFILE,
        'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
      ),
    );
  }
  paths.push(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  );

  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return undefined;
}

function extractSessionId(
  cookies: Array<{ name?: string; value?: string; domain?: string }>,
): string | null {
  const list = cookies || [];
  const tiktokish = (c: { domain?: string }) =>
    !c.domain ||
    String(c.domain).includes('tiktok') ||
    String(c.domain).includes('bytedance');

  for (const name of SESSION_COOKIE_NAMES) {
    const hit = list.find(
      (c) =>
        c.name === name &&
        c.value &&
        String(c.value).length > 8 &&
        tiktokish(c),
    );
    if (hit?.value) return String(hit.value).trim();
  }
  for (const name of SESSION_COOKIE_NAMES) {
    const hit = list.find(
      (c) => c.name === name && c.value && String(c.value).length > 8,
    );
    if (hit?.value) return String(hit.value).trim();
  }
  return null;
}

function freePortInRange(start: number, end: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = start;
    const tryOne = () => {
      if (port > end) {
        reject(new Error('Không còn cổng debug trống (9222–9322).'));
        return;
      }
      const srv = net.createServer();
      srv.unref();
      srv.on('error', () => {
        port += 1;
        tryOne();
      });
      srv.listen(port, '127.0.0.1', () => {
        const p = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(p));
      });
    };
    tryOne();
  });
}

function waitForCdp(port: number, timeoutMs = 45000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (Date.now() - start > timeoutMs) {
        reject(
          new Error(
            `Chrome không mở CDP :${port} trong ${timeoutMs / 1000}s. ` +
              'Đóng mọi cửa sổ Chrome profile TikTok rồi thử lại.',
          ),
        );
        return;
      }
      const req = http.get(
        `http://127.0.0.1:${port}/json/version`,
        { timeout: 2000 },
        (res) => {
          res.resume();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
            resolve();
          } else {
            setTimeout(tick, 400);
          }
        },
      );
      req.on('error', () => setTimeout(tick, 400));
      req.on('timeout', () => {
        req.destroy();
        setTimeout(tick, 400);
      });
    };
    tick();
  });
}

function killChromeChild(child: ChildProcess | null) {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    /* ignore */
  }
}

/**
 * Spawn system Chrome/Edge (no Puppeteer default args → no --no-sandbox banner).
 * Connect with puppeteer-core over CDP.
 */
async function launchRealBrowser(input: {
  chromePath: string;
  profileDir: string;
  startUrl: string;
}): Promise<{ browser: Awaited<ReturnType<typeof puppeteerCore.connect>>; child: ChildProcess; port: number }> {
  fs.mkdirSync(input.profileDir, { recursive: true });
  const port = await freePortInRange(9222, 9322);

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${input.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--window-size=1200,900',
    '--new-window',
    input.startUrl,
  ];

  console.log(
    `[TikTok Session] Spawn real browser: ${input.chromePath} port=${port}`,
  );

  const child = spawn(input.chromePath, args, {
    detached: false,
    stdio: 'ignore',
    windowsHide: false,
  });

  child.on('error', (e) => {
    console.error('[TikTok Session] Chrome spawn error:', e.message);
  });

  try {
    await waitForCdp(port, 45000);
  } catch (e) {
    killChromeChild(child);
    throw e;
  }

  const browser = await puppeteerCore.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: null,
  });

  return { browser, child, port };
}

export async function POST(req: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any = null;
  let chromeChild: ChildProcess | null = null;

  try {
    const body = await req
      .json()
      .catch(() => ({} as { slot?: number | string; fresh?: boolean }));

    const rawSlot = body?.slot;
    const slotNum =
      typeof rawSlot === 'number' && Number.isFinite(rawSlot)
        ? Math.max(1, Math.floor(rawSlot))
        : typeof rawSlot === 'string' && /^\d+$/.test(rawSlot.trim())
          ? Math.max(1, parseInt(rawSlot.trim(), 10))
          : 1;

    const dataRoot =
      process.env.AINOVEL_DATA_ROOT ||
      process.env.AI_NOVEL_ROOT ||
      path.join(os.homedir(), 'AppData', 'Roaming', 'AI Novel');
    const profileDir = path.join(
      dataRoot,
      'browser-profiles',
      `chrome-profile-tiktok-${slotNum}`,
    );

    // Default fresh when body.fresh === true OR env forces
    if (body?.fresh && fs.existsSync(profileDir)) {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
        console.log(`[TikTok Session] Xóa profile slot ${slotNum} (fresh)`);
      } catch (rmErr) {
        console.warn('[TikTok Session] Không xóa profile:', rmErr);
      }
    }

    const chromePath = findChromePath();
    if (!chromePath) {
      return NextResponse.json(
        {
          error:
            'Không tìm thấy Google Chrome hoặc Microsoft Edge.\n' +
            'Cài Chrome từ https://www.google.com/chrome/ rồi thử lại.\n' +
            'Hoặc dán thủ công cookie sessionid (F12 → Application → Cookies).',
        },
        { status: 503 },
      );
    }

    const launched = await launchRealBrowser({
      chromePath,
      profileDir,
      startUrl: 'https://www.tiktok.com/login',
    });
    browser = launched.browser;
    chromeChild = launched.child;

    // Prefer existing tab on login page
    let page = (await browser.pages())[0];
    if (!page) page = await browser.newPage();

    try {
      const u = page.url();
      if (!u || u === 'about:blank' || !u.includes('tiktok.com')) {
        await page.goto('https://www.tiktok.com/login', {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });
      }
    } catch {
      await page.goto('https://www.tiktok.com/login', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      }).catch(() => undefined);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cdpClient: any = null;
    try {
      cdpClient = await page.createCDPSession();
      await cdpClient.send('Network.enable').catch(() => undefined);
    } catch {
      cdpClient = null;
    }

    let sessionId: string | null = null;
    const timeoutMs = 300_000;
    const intervalMs = 2000;
    const start = Date.now();
    let nudgedHome = false;

    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, intervalMs));

      try {
        // Browser closed by user?
        if (!browser.isConnected?.() && !browser.connected) {
          throw new Error(
            'Trình duyệt đã đóng trước khi lấy được session. Giữ cửa sổ mở đến khi app tự đóng.',
          );
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('đã đóng')) throw e;
      }

      try {
        const pages = await browser.pages();
        const active =
          pages.find((p: { url: () => string }) => {
            try {
              return p.url().includes('tiktok.com');
            } catch {
              return false;
            }
          }) ||
          pages[0] ||
          page;
        page = active;

        let url = '';
        try {
          url = page.url();
        } catch {
          url = '';
        }

        if (
          !nudgedHome &&
          url &&
          url.includes('tiktok.com') &&
          !url.includes('/login')
        ) {
          nudgedHome = true;
          try {
            await page.goto('https://www.tiktok.com/foryou', {
              waitUntil: 'domcontentloaded',
              timeout: 30000,
            });
          } catch {
            /* continue poll */
          }
        }

        // 1) page cookies
        let cookies: Array<{ name: string; value: string; domain?: string }> =
          [];
        try {
          cookies = await page.cookies(
            'https://www.tiktok.com',
            'https://tiktok.com',
          );
        } catch {
          try {
            cookies = await page.cookies();
          } catch {
            cookies = [];
          }
        }
        sessionId = extractSessionId(cookies);
        if (sessionId) break;

        // 2) CDP all cookies
        if (!cdpClient) {
          try {
            cdpClient = await page.createCDPSession();
            await cdpClient.send('Network.enable').catch(() => undefined);
          } catch {
            cdpClient = null;
          }
        }
        if (cdpClient) {
          try {
            const { cookies: cdpCookies } = await cdpClient.send(
              'Network.getAllCookies',
            );
            sessionId = extractSessionId(cdpCookies || []);
            if (sessionId) break;
          } catch {
            cdpClient = null;
          }
        }

        // 3) document.cookie fallback (non-httpOnly only)
        try {
          const docCookie = await page.evaluate(() => document.cookie || '');
          if (docCookie.includes('sessionid=')) {
            const m = docCookie.match(/(?:^|;\s*)sessionid=([^;]+)/);
            if (m?.[1] && m[1].length > 8) {
              sessionId = decodeURIComponent(m[1]);
              break;
            }
          }
        } catch {
          /* navigating */
        }
      } catch (pollErr) {
        console.warn(
          '[TikTok Session] poll:',
          pollErr instanceof Error ? pollErr.message : pollErr,
        );
      }
    }

    // Disconnect CDP first, then kill browser process
    try {
      if (browser?.disconnect) browser.disconnect();
      else if (browser?.close) await browser.close().catch(() => {});
    } catch {
      /* ignore */
    }
    browser = null;
    killChromeChild(chromeChild);
    chromeChild = null;

    if (!sessionId) {
      return NextResponse.json(
        {
          error:
            'Hết 5 phút — chưa thấy cookie session (sessionid / sid_tt).\n\n' +
            'Làm lần lượt:\n' +
            '1) Đăng nhập xong trên cửa sổ Chrome app mở — đợi feed For You\n' +
            '2) Không đóng cửa sổ sớm; đợi app tự đóng\n' +
            '3) Tắt VPN; thử QR login (ổn hơn Google)\n' +
            '4) Fallback tay: Chrome thường → tiktok.com → F12 → Application → Cookies → copy sessionid dán vào app',
        },
        { status: 408 },
      );
    }

    console.log(`[TikTok Session] ✅ OK len=${sessionId.length}`);
    return NextResponse.json({
      sessionId,
      tiktokSessionId: sessionId,
      method: 'real-chrome-cdp',
    });
  } catch (err: unknown) {
    try {
      if (browser?.disconnect) browser.disconnect();
      else if (browser?.close) await browser.close().catch(() => {});
    } catch {
      /* ignore */
    }
    killChromeChild(chromeChild);

    const message =
      err instanceof Error ? err.message : 'Lỗi không xác định khi lấy session TikTok.';
    console.error('[TikTok Session]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Health / diagnostic without opening browser long */
export async function GET() {
  const chromePath = findChromePath();
  return NextResponse.json({
    ok: true,
    service: 'get-tiktok-session',
    chromePath: chromePath || null,
    chromeFound: Boolean(chromePath),
    method: 'real-chrome-cdp (no puppeteer --no-sandbox)',
    hint: 'POST body: { slot?: number, fresh?: boolean } — mở Chrome login TikTok, poll cookie ≤5 phút.',
  });
}
