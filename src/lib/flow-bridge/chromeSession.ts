/**
 * Chrome login session lifecycle for Flow:
 * 1) Open visible Chrome → user logs in Google
 * 2) On token/cookie capture → close login window
 * 3) Relaunch same profile off-screen so extension stays for captcha/API
 */
import fs from 'fs';
import path from 'path';
import { spawn, execSync, type ChildProcess } from 'child_process';

export type ChromeLaunchMode = 'login' | 'background';

/** Ensure profile has extensions.ui.developer_mode so load-extension works on Chrome 137+. */
function ensureProfileDeveloperMode(profileDir: string): void {
  const def = path.join(profileDir, 'Default');
  fs.mkdirSync(def, { recursive: true });
  const prefsPath = path.join(def, 'Preferences');
  let prefs: Record<string, unknown> = {};
  if (fs.existsSync(prefsPath)) {
    try {
      prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      prefs = {};
    }
  }
  const extensions = (prefs.extensions || {}) as Record<string, unknown>;
  const ui = (extensions.ui || {}) as Record<string, unknown>;
  ui.developer_mode = true;
  extensions.ui = ui;
  prefs.extensions = extensions;
  // Allow file:// and local debug
  const browser = (prefs.browser || {}) as Record<string, unknown>;
  browser.has_seen_welcome_page = true;
  prefs.browser = browser;
  fs.writeFileSync(prefsPath, JSON.stringify(prefs), 'utf8');
}

const g = globalThis as unknown as {
  __ainovelFlowChrome?: {
    loginPid?: number;
    bgPid?: number;
    profileDir?: string;
    chromePath?: string;
    extDir?: string;
    accountId?: string;
    loginOpen?: boolean;
    closing?: boolean;
    lastTokenCloseAt?: number;
  };
};

function state() {
  if (!g.__ainovelFlowChrome) g.__ainovelFlowChrome = {};
  return g.__ainovelFlowChrome;
}

export function getChromeSessionInfo() {
  const s = state();
  return {
    loginOpen: Boolean(s.loginOpen),
    profileDir: s.profileDir || null,
    accountId: s.accountId || null,
    closing: Boolean(s.closing),
  };
}

export function registerSessionMeta(meta: {
  profileDir: string;
  chromePath: string;
  extDir: string;
  accountId: string;
}) {
  const s = state();
  s.profileDir = meta.profileDir;
  s.chromePath = meta.chromePath;
  s.extDir = meta.extDir;
  s.accountId = meta.accountId;
}

function isAlive(pid?: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Kill all Chrome/Edge processes whose command line contains profileDir (Windows). */
export function killChromeForProfile(profileDir: string): number {
  if (!profileDir || process.platform !== 'win32') {
    // Fallback: kill tracked pids
    const s = state();
    let n = 0;
    for (const pid of [s.loginPid, s.bgPid]) {
      if (pid && isAlive(pid)) {
        try {
          process.kill(pid, 'SIGTERM');
          n++;
        } catch {
          /* ignore */
        }
      }
    }
    return n;
  }

  // Escape for PowerShell single-quoted string
  const needle = path.resolve(profileDir).replace(/'/g, "''");
  // One-liner — multi-line got mangled when flattened previously
  const ps = [
    `$n=0;`,
    `Get-CimInstance Win32_Process -EA SilentlyContinue |`,
    `Where-Object { ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and $_.CommandLine -and ($_.CommandLine -like '*${needle}*') } |`,
    `ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -EA Stop; $n++ } catch {} };`,
    `Write-Output $n`,
  ].join(' ');

  try {
    const out = execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`, {
      encoding: 'utf8',
      timeout: 20000,
      windowsHide: true,
    });
    const n = Number(String(out).trim().split(/\r?\n/).filter(Boolean).pop());
    return Number.isFinite(n) ? n : 0;
  } catch {
    // Fallback: taskkill tracked pids only
    const s = state();
    let n = 0;
    for (const pid of [s.loginPid, s.bgPid]) {
      if (pid && isAlive(pid)) {
        try {
          execSync(`taskkill /PID ${pid} /T /F`, { windowsHide: true });
          n++;
        } catch {
          /* ignore */
        }
      }
    }
    return n;
  }
}

export function launchChrome(opts: {
  chromePath: string;
  extDir: string;
  profileDir: string;
  accountId: string;
  mode: ChromeLaunchMode;
  /** Kill existing Chrome using this profile first (default true) — required so --load-extension applies */
  forceClean?: boolean;
  /**
   * Stock Google Chrome blocks --load-extension (120+).
   * Clean Chromium (Ungoogled/Brave/portable) does not need unsafe debug flags.
   * FlowAgent strategy: prefer clean Chromium — no CDP.
   */
  isStockChrome?: boolean;
}): { launched: boolean; child?: ChildProcess; profileDir: string; killed: number } {
  const extAbs = path.resolve(opts.extDir);
  const profileAbs = path.resolve(opts.profileDir);
  fs.mkdirSync(profileAbs, { recursive: true });
  registerSessionMeta({
    profileDir: profileAbs,
    chromePath: opts.chromePath,
    extDir: extAbs,
    accountId: opts.accountId,
  });

  // CRITICAL: if browser already holds this profile, new spawn joins it and
  // IGNORES --load-extension. Kill only processes for this profile dir.
  let killed = 0;
  if (opts.forceClean !== false) {
    try {
      killed = killChromeForProfile(profileAbs);
      if (killed > 0) {
        console.log(
          `[FlowChrome] Killed ${killed} process(es) on profile before relaunch`,
        );
        try {
          execSync('ping -n 3 127.0.0.1 >nul', { windowsHide: true });
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      console.warn('[FlowChrome] kill profile failed (continue)', e);
    }
  }

  // Remove SingletonLock if stale (Chrome crashed mid-session)
  try {
    for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      const lock = path.join(profileAbs, name);
      if (fs.existsSync(lock)) fs.unlinkSync(lock);
    }
  } catch {
    /* ignore */
  }

  try {
    ensureProfileDeveloperMode(profileAbs);
  } catch (e) {
    console.warn('[FlowChrome] developer_mode prefs patch failed', e);
  }

  // Clean Chromium forks: simple load-extension (FlowAgent approach).
  // Stock Chrome: last-resort unsafe flags (often still fail on Chrome 120+).
  const baseArgs = opts.isStockChrome
    ? [
        `--user-data-dir=${profileAbs}`,
        '--enable-unsafe-extension-debugging',
        `--disable-extensions-except=${extAbs}`,
        `--load-extension=${extAbs}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-popup-blocking',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        '--disable-features=ChromeWhatsNewUI,DisableLoadExtensionCommandLineSwitch',
        '--enable-extensions',
      ]
    : [
        `--user-data-dir=${profileAbs}`,
        `--disable-extensions-except=${extAbs}`,
        `--load-extension=${extAbs}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-popup-blocking',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        '--enable-extensions',
      ];

  const args =
    opts.mode === 'login'
      ? [
          ...baseArgs,
          '--new-window',
          '--start-maximized',
          'https://labs.google/fx/tools/flow',
        ]
      : [
          ...baseArgs,
          // Off-screen "daemon" — extension stays alive for captcha/API
          '--window-position=-32000,-32000',
          '--window-size=900,700',
          'https://labs.google/fx/tools/flow',
        ];

  console.log(
    `[FlowChrome] launch ${opts.isStockChrome ? 'STOCK_CHROME' : 'CLEAN_CHROMIUM'} ${opts.chromePath}`,
  );

  const child = spawn(opts.chromePath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: opts.mode === 'background',
  });
  child.unref();

  const s = state();
  if (opts.mode === 'login') {
    s.loginPid = child.pid;
    s.loginOpen = true;
  } else {
    s.bgPid = child.pid;
    s.loginOpen = false;
  }
  try {
    void import('./bridgeServer').then((m) =>
      m.setLoginSessionOpen(Boolean(s.loginOpen)),
    );
  } catch {
    /* ignore */
  }

  return { launched: true, child, profileDir: profileAbs, killed };
}

/**
 * Mullvad/Firefox path (FlowAgent): --no-remote, multi-profile.
 * Cannot CLI load-extension → copy manifest path to clipboard + return manual steps.
 */
export function launchFirefoxFamily(opts: {
  exe: string;
  profileDir: string;
  extDir: string;
  accountId: string;
}): {
  launched: boolean;
  profileDir: string;
  manifestPath: string;
  clipboardOk: boolean;
  manualSteps: string[];
} {
  const profileAbs = path.resolve(opts.profileDir);
  const extAbs = path.resolve(opts.extDir);
  const manifestPath = path.join(extAbs, 'manifest.json');
  fs.mkdirSync(profileAbs, { recursive: true });

  registerSessionMeta({
    profileDir: profileAbs,
    chromePath: opts.exe,
    extDir: extAbs,
    accountId: opts.accountId,
  });

  // --no-remote: allow independent profile (FlowAgent)
  const args = [
    '--no-remote',
    '-profile',
    profileAbs,
    'https://labs.google/fx/tools/flow',
  ];

  const child = spawn(opts.exe, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  const s = state();
  s.loginPid = child.pid;
  s.loginOpen = true;
  void import('./bridgeServer').then((m) => m.setLoginSessionOpen(true));

  let clipboardOk = false;
  try {
    // PowerShell set clipboard to manifest path for "Load Temporary Add-on"
    execSync(
      `powershell -NoProfile -Command "Set-Clipboard -Value '${manifestPath.replace(/'/g, "''")}'"`,
      { windowsHide: true, timeout: 5000 },
    );
    clipboardOk = true;
  } catch {
    clipboardOk = false;
  }

  const manualSteps = [
    'Mullvad/Firefox không tự nạp extension qua CLI (FlowAgent strategy).',
    '1) Trong browser: about:debugging → This Firefox (hoặc This Mullvad Browser)',
    '2) Load Temporary Add-on…',
    `3) Chọn file: ${manifestPath}`,
    clipboardOk
      ? '(Đường dẫn manifest.json đã copy vào Clipboard — Ctrl+V trong hộp chọn file)'
      : '(Copy tay đường dẫn manifest.json ở trên)',
    '4) Đăng nhập Google trên tab Flow — extension nối bridge :9223',
  ];

  return {
    launched: true,
    profileDir: profileAbs,
    manifestPath,
    clipboardOk,
    manualSteps,
  };
}

/**
 * After token/cookie captured: close login Chrome, relaunch background profile.
 * Debounced so multiple token events don't thrash.
 */
export async function closeLoginSessionAfterCapture(opts?: {
  delayMs?: number;
  keepBackground?: boolean;
}): Promise<{ closed: boolean; relaunched: boolean; message: string }> {
  const s = state();
  if (s.closing) {
    return { closed: false, relaunched: false, message: 'Close already in progress' };
  }
  // Debounce 20s
  if (s.lastTokenCloseAt && Date.now() - s.lastTokenCloseAt < 20_000) {
    return { closed: false, relaunched: false, message: 'Recently closed' };
  }

  const profileDir = s.profileDir;
  const chromePath = s.chromePath;
  const extDir = s.extDir;
  const accountId = s.accountId || 'default';

  if (!profileDir || !chromePath || !extDir) {
    return {
      closed: false,
      relaunched: false,
      message: 'No tracked login session (open Connect Flow first)',
    };
  }

  s.closing = true;
  const delayMs = opts?.delayMs ?? 1500;
  const keepBg = opts?.keepBackground !== false;

  await new Promise((r) => setTimeout(r, delayMs));

  try {
    const killed = killChromeForProfile(profileDir);
    s.loginOpen = false;
    s.loginPid = undefined;
    s.bgPid = undefined;
    s.lastTokenCloseAt = Date.now();
    try {
      const { setLoginSessionOpen } = await import('./bridgeServer');
      setLoginSessionOpen(false);
    } catch {
      /* ignore */
    }
    console.log(
      `[FlowChrome] Login session closed (killed ${killed} process(es)) profile=${path.basename(profileDir)}`,
    );

    let relaunched = false;
    let reconnected = false;
    if (keepBg && fs.existsSync(chromePath) && fs.existsSync(extDir)) {
      // Brief pause so profile lock is released
      await new Promise((r) => setTimeout(r, 1500));
      const isStock =
        /google[\\/]chrome/i.test(chromePath) ||
        /\\chrome\\application\\chrome\.exe$/i.test(chromePath);
      launchChrome({
        chromePath,
        extDir,
        profileDir,
        accountId,
        mode: 'background',
        forceClean: true,
        isStockChrome: isStock,
      });
      relaunched = true;
      console.log('[FlowChrome] Background daemon relaunched (extension for gen)');

      // Wait for extension to re-WS (captcha/API need it)
      try {
        const bridge = await import('./bridgeServer');
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          const snap = bridge.getBridgeSnapshot();
          if (snap.extensionConnected && snap.flowKeyPresent) {
            reconnected = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        console.log(
          `[FlowChrome] Extension reconnect: ${reconnected ? 'OK' : 'pending'}`,
        );
      } catch {
        /* ignore */
      }
    }

    return {
      closed: true,
      relaunched,
      message: relaunched
        ? reconnected
          ? 'Đã đóng login; Chrome nền + extension sẵn sàng gen.'
          : 'Đã đóng login; Chrome nền đã mở (extension đang kết nối…).'
        : 'Đã đóng cửa sổ đăng nhập.',
    };
  } finally {
    s.closing = false;
  }
}

export function profileDirForAccount(accountId: string): string {
  return path.join(
    process.cwd(),
    'scratch',
    'flow-profiles',
    accountId || 'default',
  );
}
