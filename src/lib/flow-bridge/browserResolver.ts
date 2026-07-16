/**
 * FlowAgent strategy: do NOT fight stock Google Chrome (load-extension blocked).
 * Prefer clean Chromium forks (Ungoogled / Neo / Brave / portable).
 * Mullvad/Firefox = separate path (--no-remote + manual temporary add-on).
 *
 * No CDP / remote-debugging — labs.google can fingerprint that as bot.
 */
import fs from 'fs';
import path from 'path';

export type FlowBrowserEngine =
  | 'auto'
  | 'ungoogled'
  | 'chromium'
  | 'brave'
  | 'chrome'
  | 'mullvad'
  | 'custom';

export type ResolvedBrowser = {
  engine: FlowBrowserEngine;
  exe: string;
  family: 'chromium' | 'firefox';
  /** True if stock Google Chrome (extension load often blocked on new Chrome) */
  isStockChrome: boolean;
  label: string;
  warning?: string;
};

function existsExe(p: string | null | undefined): p is string {
  return Boolean(p && fs.existsSync(p));
}

function projectRoots(): string[] {
  const roots = [
    process.cwd(),
    process.env.AI_NOVEL_ROOT || '',
    path.join(process.cwd(), 'tools'),
    path.join(process.cwd(), 'browsers'),
  ].filter(Boolean);
  return [...new Set(roots.map((r) => path.resolve(r)))];
}

/** Portable Ungoogled / Chromium expected under project */
function portableChromiumCandidates(): string[] {
  const names = [
    path.join('tools', 'browsers', 'ungoogled-chromium', 'chrome.exe'),
    path.join('tools', 'browsers', 'chromium', 'chrome.exe'),
    path.join('browsers', 'ungoogled-chromium', 'chrome.exe'),
    path.join('browsers', 'chromium', 'chrome.exe'),
    path.join('ungoogled-chromium', 'chrome.exe'),
    path.join('chromium', 'chrome.exe'),
  ];
  const out: string[] = [];
  for (const root of projectRoots()) {
    for (const n of names) {
      out.push(path.join(root, n));
    }
  }
  return out;
}

/** Discover Playwright / GPM / other clean Chromium installs (no Google branding). */
function discoverExtraChromium(): { path: string; engine: FlowBrowserEngine; label: string }[] {
  const local = process.env.LOCALAPPDATA || '';
  const out: { path: string; engine: FlowBrowserEngine; label: string }[] = [];

  // ms-playwright chromium-*/chrome-win64/chrome.exe (newest first)
  const pwRoot = path.join(local, 'ms-playwright');
  if (fs.existsSync(pwRoot)) {
    try {
      const dirs = fs
        .readdirSync(pwRoot)
        .filter((d) => d.startsWith('chromium-'))
        .sort()
        .reverse();
      for (const d of dirs) {
        const exe = path.join(pwRoot, d, 'chrome-win64', 'chrome.exe');
        if (fs.existsSync(exe)) {
          out.push({
            path: exe,
            engine: 'chromium',
            label: `Playwright Chromium (${d})`,
          });
          break; // newest only for list cleanliness; resolve still uses first clean
        }
      }
      // include up to 2 more for catalog
      let n = 0;
      for (const d of dirs.slice(1)) {
        const exe = path.join(pwRoot, d, 'chrome-win64', 'chrome.exe');
        if (fs.existsSync(exe) && n < 2) {
          out.push({
            path: exe,
            engine: 'chromium',
            label: `Playwright Chromium (${d})`,
          });
          n++;
        }
      }
    } catch {
      /* ignore */
    }
  }

  // GPMLogin chromium cores
  const gpmRoot = path.join(local, 'Programs', 'GPMLogin', 'gpm_browser');
  if (fs.existsSync(gpmRoot)) {
    try {
      const dirs = fs
        .readdirSync(gpmRoot)
        .filter((d) => d.includes('chromium'))
        .sort()
        .reverse();
      for (const d of dirs.slice(0, 3)) {
        const exe = path.join(gpmRoot, d, 'chrome.exe');
        if (fs.existsSync(exe)) {
          out.push({
            path: exe,
            engine: 'chromium',
            label: `GPM Chromium (${d})`,
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  return out;
}

function systemUngoogledBrave(): { path: string; engine: FlowBrowserEngine; label: string }[] {
  const local = process.env.LOCALAPPDATA || '';
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return [
    {
      path: path.join(local, 'Chromium', 'Application', 'chrome.exe'),
      engine: 'chromium',
      label: 'Chromium (user)',
    },
    {
      path: path.join(pf, 'Chromium', 'Application', 'chrome.exe'),
      engine: 'chromium',
      label: 'Chromium',
    },
    {
      path: path.join(pf, 'ungoogled-chromium', 'chrome.exe'),
      engine: 'ungoogled',
      label: 'Ungoogled Chromium',
    },
    {
      path: path.join(pf, 'Ungoogled Chromium', 'chrome.exe'),
      engine: 'ungoogled',
      label: 'Ungoogled Chromium',
    },
    {
      path: path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      engine: 'brave',
      label: 'Brave',
    },
    {
      path: path.join(pf86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      engine: 'brave',
      label: 'Brave',
    },
    {
      path: path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      engine: 'brave',
      label: 'Brave',
    },
    // Neo Browser / other forks (common)
    {
      path: path.join(pf, 'Neo Browser', 'Application', 'chrome.exe'),
      engine: 'ungoogled',
      label: 'Neo Browser',
    },
    ...discoverExtraChromium(),
  ];
}

function stockChrome(): string[] {
  return [
    process.env.CHROME_PATH || '',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
}

function mullvadFirefox(): { path: string; label: string }[] {
  const local = process.env.LOCALAPPDATA || '';
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  return [
    {
      path: path.join(pf, 'Mullvad Browser', 'Browser', 'mullvadbrowser.exe'),
      label: 'Mullvad Browser',
    },
    {
      path: path.join(local, 'Mullvad Browser', 'Browser', 'mullvadbrowser.exe'),
      label: 'Mullvad Browser',
    },
    {
      path: path.join(pf, 'Mozilla Firefox', 'firefox.exe'),
      label: 'Firefox',
    },
    {
      path: path.join(pf, 'Firefox Developer Edition', 'firefox.exe'),
      label: 'Firefox Developer',
    },
  ];
}

export function listDetectedBrowsers(): ResolvedBrowser[] {
  const out: ResolvedBrowser[] = [];
  const seen = new Set<string>();

  const add = (r: ResolvedBrowser) => {
    const key = r.exe.toLowerCase();
    if (seen.has(key) || !existsExe(r.exe)) return;
    seen.add(key);
    out.push(r);
  };

  for (const p of portableChromiumCandidates()) {
    add({
      engine: 'ungoogled',
      exe: p,
      family: 'chromium',
      isStockChrome: false,
      label: 'Portable Ungoogled/Chromium (khuyến nghị)',
    });
  }
  for (const c of systemUngoogledBrave()) {
    add({
      engine: c.engine,
      exe: c.path,
      family: 'chromium',
      isStockChrome: false,
      label: c.label,
    });
  }
  for (const p of stockChrome()) {
    add({
      engine: 'chrome',
      exe: p,
      family: 'chromium',
      isStockChrome: true,
      label: 'Google Chrome (thường bị chặn --load-extension)',
      warning:
        'Chrome mới chặn --load-extension. Nên dùng Ungoogled Chromium / Brave / portable.',
    });
  }
  for (const m of mullvadFirefox()) {
    add({
      engine: 'mullvad',
      exe: m.path,
      family: 'firefox',
      isStockChrome: false,
      label: m.label + ' (load extension tay)',
      warning:
        'Firefox/Mullvad không CLI load-extension — app copy path, user Load Temporary Add-on.',
    });
  }
  return out;
}

/**
 * Resolve browser for Flow launch.
 * Default `auto` = first non-stock Chromium, else Chrome with warning.
 */
export function resolveBrowser(opts?: {
  engine?: FlowBrowserEngine | string;
  browserExe?: string;
}): ResolvedBrowser {
  const engine = (opts?.engine || 'auto') as FlowBrowserEngine;
  const custom = opts?.browserExe?.trim();

  if (custom && existsExe(custom)) {
    const lower = custom.toLowerCase();
    const isFf =
      lower.includes('firefox') ||
      lower.includes('mullvad') ||
      lower.endsWith('firefox.exe') ||
      lower.endsWith('mullvadbrowser.exe');
    const isStock =
      lower.includes('google\\chrome') || lower.includes('google/chrome');
    return {
      engine: isFf ? 'mullvad' : isStock ? 'chrome' : 'custom',
      exe: custom,
      family: isFf ? 'firefox' : 'chromium',
      isStockChrome: isStock,
      label: isFf ? 'Custom Firefox' : 'Custom Chromium',
      warning: isStock
        ? 'Đường dẫn là Google Chrome — có thể không nạp được extension.'
        : undefined,
    };
  }

  if (engine === 'mullvad') {
    for (const m of mullvadFirefox()) {
      if (existsExe(m.path)) {
        return {
          engine: 'mullvad',
          exe: m.path,
          family: 'firefox',
          isStockChrome: false,
          label: m.label,
          warning:
            'Mullvad/Firefox: load Temporary Add-on thủ công (path đã copy clipboard).',
        };
      }
    }
    throw new Error(
      'Không tìm thấy Mullvad/Firefox. Cài Mullvad Browser hoặc chọn engine khác.',
    );
  }

  if (engine === 'chrome') {
    for (const p of stockChrome()) {
      if (existsExe(p)) {
        return {
          engine: 'chrome',
          exe: p,
          family: 'chromium',
          isStockChrome: true,
          label: 'Google Chrome',
          warning:
            'Chrome mới thường chặn --load-extension. Ưu tiên Ungoogled/Brave/portable.',
        };
      }
    }
  }

  if (engine === 'brave' || engine === 'ungoogled' || engine === 'chromium') {
    const list = listDetectedBrowsers().filter(
      (b) =>
        b.family === 'chromium' &&
        !b.isStockChrome &&
        (engine === 'brave' ? b.engine === 'brave' : true),
    );
    if (list[0]) return list[0];
  }

  // auto: CHỈ Chromium sạch — cấm fallback Google Chrome (B10: hard-fail để user sửa)
  const clean = listDetectedBrowsers().find(
    (b) => b.family === 'chromium' && !b.isStockChrome,
  );
  if (clean) return clean;

  const chrome = listDetectedBrowsers().find((b) => b.isStockChrome);
  if (chrome && engine === 'chrome') {
    // Chỉ khi user chọn tường minh engine=chrome
    return {
      ...chrome,
      warning:
        (chrome.warning || '') +
        ' Bạn đã chọn Google Chrome tường minh — load-extension có thể FAIL.',
    };
  }

  if (chrome) {
    throw new Error(
      'Chỉ phát hiện Google Chrome. App không fallback Chrome khi engine=auto (thường chặn extension Flow). ' +
        'Sửa: Ảnh/Video → «Cài browser gen ảnh» (1 nút) hoặc cài Brave, rồi Đăng nhập Google. ' +
        'Hoặc chọn engine «Google Chrome» tường minh nếu cố dùng Chrome.',
    );
  }

  throw new Error(
    'Không tìm thấy trình duyệt sạch. Bấm «Cài browser gen ảnh» trong app hoặc cài Brave / portable vào tools/browsers/ungoogled-chromium/.',
  );
}

export function portableChromiumInstallHint(): string {
  return [
    'Không fallback Chrome ngầm (IRON B10). Làm lần lượt:',
    '1) Trong app: Ảnh/Video → Google Flow → «Cài browser gen ảnh» (tự tải, 1 nút)',
    '2) Rồi «Đăng nhập Google»',
    'Hoặc cài Brave / bỏ portable vào tools/browsers/ungoogled-chromium/chrome.exe',
    'Chỉ chọn engine «Google Chrome» tường minh nếu cố dùng Chrome (dễ fail extension).',
  ].join('\n');
}
