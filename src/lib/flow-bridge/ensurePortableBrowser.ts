/**
 * One-click portable Chromium for non-technical users.
 * Downloads Chrome for Testing (win64) into tools/browsers/ungoogled-chromium/
 * so resolveBrowser(auto) picks a clean path without manual unzip/README.
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  resolveBrowser,
  listDetectedBrowsers,
  type ResolvedBrowser,
} from './browserResolver';

const execFileAsync = promisify(execFile);

export type EnsureBrowserProgress = {
  phase: 'check' | 'download' | 'extract' | 'verify' | 'done' | 'error';
  message: string;
  percent?: number;
};

export type EnsureBrowserResult = {
  ok: boolean;
  alreadyPresent: boolean;
  browser?: ResolvedBrowser;
  installPath?: string;
  message: string;
  steps: string[];
};

function portableTargetDir(cwd = process.cwd()): string {
  return path.join(cwd, 'tools', 'browsers', 'ungoogled-chromium');
}

function portableExe(cwd = process.cwd()): string {
  return path.join(portableTargetDir(cwd), 'chrome.exe');
}

function findCleanBrowser(): ResolvedBrowser | null {
  try {
    const list = listDetectedBrowsers().filter(
      (b) => b.family === 'chromium' && !b.isStockChrome,
    );
    if (list[0]) return list[0];
    const auto = resolveBrowser({ engine: 'auto' });
    if (auto && !auto.isStockChrome) return auto;
  } catch {
    /* none */
  }
  return null;
}

function httpGetBuffer(
  url: string,
  onProgress?: (received: number, total: number) => void,
  redirects = 0,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (redirects > 8) {
      reject(new Error('Quá nhiều redirect khi tải browser.'));
      return;
    }
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 120_000 }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        void httpGetBuffer(res.headers.location, onProgress, redirects + 1)
          .then(resolve)
          .catch(reject);
        return;
      }
      if (code !== 200) {
        res.resume();
        reject(new Error(`Tải browser HTTP ${code}`));
        return;
      }
      const total = parseInt(String(res.headers['content-length'] || '0'), 10) || 0;
      const chunks: Buffer[] = [];
      let received = 0;
      res.on('data', (c: Buffer) => {
        chunks.push(c);
        received += c.length;
        onProgress?.(received, total);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout tải browser (mạng chậm).'));
    });
  });
}

function httpGetJson<T>(url: string): Promise<T> {
  return httpGetBuffer(url).then((buf) => JSON.parse(buf.toString('utf8')) as T);
}

type CftJson = {
  channels?: {
    Stable?: {
      version?: string;
      downloads?: {
        chrome?: Array<{ platform: string; url: string }>;
      };
    };
  };
};

async function resolveChromeForTestingUrl(): Promise<{ url: string; version: string }> {
  const meta = await httpGetJson<CftJson>(
    'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json',
  );
  const stable = meta.channels?.Stable;
  const list = stable?.downloads?.chrome || [];
  const win =
    list.find((d) => d.platform === 'win64') ||
    list.find((d) => d.platform === 'win32');
  if (!win?.url) {
    throw new Error('Không lấy được link tải Chrome for Testing (win64).');
  }
  return { url: win.url, version: stable?.version || 'unknown' };
}

async function extractZipWindows(zipPath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  // PowerShell Expand-Archive — có sẵn Windows, không cần 7zip
  const ps = [
    `$ErrorActionPreference='Stop';`,
    `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
  ].join(' ');
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', ps],
    { timeout: 300_000, windowsHide: true },
  );
}

/** Find chrome.exe under extracted tree and promote to targetDir/chrome.exe */
function promoteChromeExe(extractRoot: string, targetDir: string): string {
  const stack = [extractRoot];
  let found = '';
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(full);
      else if (name.toLowerCase() === 'chrome.exe') {
        found = full;
        break;
      }
    }
    if (found) break;
  }
  if (!found) {
    throw new Error('Giải nén xong nhưng không thấy chrome.exe.');
  }
  const srcDir = path.dirname(found);
  fs.mkdirSync(targetDir, { recursive: true });
  // Copy entire chrome-win64 folder contents next to chrome.exe
  for (const name of fs.readdirSync(srcDir)) {
    const from = path.join(srcDir, name);
    const to = path.join(targetDir, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) {
      fs.cpSync(from, to, { recursive: true, force: true });
    } else {
      fs.copyFileSync(from, to);
    }
  }
  const exe = path.join(targetDir, 'chrome.exe');
  if (!fs.existsSync(exe)) {
    throw new Error('Copy portable thất bại — thiếu chrome.exe đích.');
  }
  return exe;
}

/**
 * Ensure a non-stock Chromium exists for Flow.
 * - If already have Brave/Ungoogled/Playwright/portable → return immediately
 * - Else download Chrome for Testing → tools/browsers/ungoogled-chromium/
 */
export async function ensurePortableBrowser(opts?: {
  cwd?: string;
  forceRedownload?: boolean;
  onProgress?: (p: EnsureBrowserProgress) => void;
}): Promise<EnsureBrowserResult> {
  const cwd = opts?.cwd || process.cwd();
  const steps: string[] = [];
  const report = (p: EnsureBrowserProgress) => {
    steps.push(p.message);
    opts?.onProgress?.(p);
  };

  report({ phase: 'check', message: 'Đang kiểm tra browser sẵn có…', percent: 5 });

  if (!opts?.forceRedownload) {
    const existing = findCleanBrowser();
    if (existing) {
      report({
        phase: 'done',
        message: `Đã có browser sạch: ${existing.label}`,
        percent: 100,
      });
      return {
        ok: true,
        alreadyPresent: true,
        browser: existing,
        installPath: existing.exe,
        message: `Máy đã có «${existing.label}» — không cần tải thêm. Bấm Đăng nhập Google là được.`,
        steps,
      };
    }
    if (fs.existsSync(portableExe(cwd))) {
      const b = resolveBrowser({
        engine: 'custom',
        browserExe: portableExe(cwd),
      });
      report({ phase: 'done', message: 'Portable chrome.exe đã có sẵn', percent: 100 });
      return {
        ok: true,
        alreadyPresent: true,
        browser: b,
        installPath: portableExe(cwd),
        message: 'Đã có browser portable trong app. Bấm Đăng nhập Google.',
        steps,
      };
    }
  }

  if (process.platform !== 'win32') {
    return {
      ok: false,
      alreadyPresent: false,
      message:
        'Tự cài browser 1-nút hiện hỗ trợ Windows. Trên macOS/Linux hãy cài Chromium hoặc Brave.',
      steps,
    };
  }

  const targetDir = portableTargetDir(cwd);
  const scratch = path.join(cwd, 'scratch', 'browser-download');
  fs.mkdirSync(scratch, { recursive: true });

  try {
    report({
      phase: 'download',
      message: 'Đang lấy link tải browser (Chrome for Testing, ~150MB)…',
      percent: 10,
    });
    const { url, version } = await resolveChromeForTestingUrl();
    report({
      phase: 'download',
      message: `Đang tải Chromium ${version} — lần đầu mất 1–3 phút tuỳ mạng…`,
      percent: 15,
    });

    const zipPath = path.join(scratch, `chrome-${version}-win64.zip`);
    const buf = await httpGetBuffer(url, (received, total) => {
      if (!total) return;
      const pct = 15 + Math.min(55, Math.round((received / total) * 55));
      opts?.onProgress?.({
        phase: 'download',
        message: `Đang tải… ${Math.round(received / 1024 / 1024)}/${Math.round(total / 1024 / 1024)} MB`,
        percent: pct,
      });
    });
    fs.writeFileSync(zipPath, buf);
    steps.push(`Đã tải xong ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

    report({ phase: 'extract', message: 'Đang giải nén vào thư mục app…', percent: 75 });
    const extractDir = path.join(scratch, `extract-${version}`);
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
    await extractZipWindows(zipPath, extractDir);

    report({ phase: 'verify', message: 'Đang cài browser portable…', percent: 88 });
    if (fs.existsSync(targetDir)) {
      try {
        fs.rmSync(targetDir, { recursive: true, force: true });
      } catch {
        /* may be locked — overwrite files instead */
      }
    }
    const exe = promoteChromeExe(extractDir, targetDir);

    // Cleanup zip to save disk (keep extract optional)
    try {
      fs.unlinkSync(zipPath);
    } catch {
      /* ignore */
    }

    const browser = resolveBrowser({ engine: 'custom', browserExe: exe });
    report({
      phase: 'done',
      message: `Xong — browser portable: ${exe}`,
      percent: 100,
    });

    return {
      ok: true,
      alreadyPresent: false,
      browser,
      installPath: exe,
      message:
        'Đã cài browser gen ảnh/video xong. Bấm «Đăng nhập Google» → đăng nhập 1 lần → dùng bình thường.',
      steps,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    report({ phase: 'error', message: msg, percent: 0 });
    return {
      ok: false,
      alreadyPresent: false,
      message: `Không cài được browser tự động: ${msg}. Thử lại khi có mạng, hoặc cài Brave từ brave.com (miễn phí).`,
      steps,
    };
  }
}
