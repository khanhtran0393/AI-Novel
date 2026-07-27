/**
 * Chrome login session lifecycle for Flow — **1 account = 1 isolated browser profile**.
 *
 * FlowAgent model:
 * - user-data-dir = scratch/flow-profiles/<accountId>/user-data  (cookies riêng)
 * - extension copy = scratch/flow-profiles/<accountId>/extension (không share source)
 * - Session state tracked **per accountId** (không ghi đè profile khác)
 */
import fs from 'fs';
import path from 'path';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { resolveAccountProxyServer } from './resolveAccountProxy';

export type ChromeLaunchMode = 'login' | 'background';

export type ProfileSession = {
  accountId: string;
  /** Chrome --user-data-dir (cookies/localStorage) */
  profileDir: string;
  chromePath: string;
  /** Per-account extension folder (load-extension) */
  extDir: string;
  loginPid?: number;
  bgPid?: number;
  loginOpen: boolean;
  closing: boolean;
  lastTokenCloseAt?: number;
};

type GlobalChrome = {
  /** Isolated sessions keyed by accountId */
  byAccount: Record<string, ProfileSession>;
  /** Last account that opened login / captured token */
  lastActiveAccountId?: string;
};

const g = globalThis as unknown as { __ainovelFlowChromeV2?: GlobalChrome };

function root(): GlobalChrome {
  if (!g.__ainovelFlowChromeV2) {
    g.__ainovelFlowChromeV2 = { byAccount: {} };
  }
  return g.__ainovelFlowChromeV2;
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

/**
 * Root for one account — matches FlowAgent guide:
 *   accounts_data/Profile_N  →  accounts_data/<accountId>
 * Legacy: scratch/flow-profiles/<accountId>
 */
export function accountRootDir(accountId: string): string {
  const id = String(accountId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cwd = process.env.AI_NOVEL_ROOT || process.cwd();
  const preferred = path.resolve(cwd, 'accounts_data', id);
  const legacy = path.resolve(cwd, 'scratch', 'flow-profiles', id);
  // Prefer accounts_data; if only legacy has Chrome Default, keep using legacy cookies
  const legacyHasSession =
    fs.existsSync(path.join(legacy, 'Default')) ||
    fs.existsSync(path.join(legacy, 'user-data', 'Default'));
  const preferredHasSession =
    fs.existsSync(path.join(preferred, 'Default')) ||
    fs.existsSync(path.join(preferred, 'user-data', 'Default'));
  if (preferredHasSession || !legacyHasSession) {
    fs.mkdirSync(preferred, { recursive: true });
    return preferred;
  }
  return legacy;
}

/**
 * Chrome --user-data-dir (cookies Google) — 1 account = 1 dir, tách biệt Chrome cá nhân.
 * Guide: accounts_data/Profile_1
 */
export function profileDirForAccount(accountId: string): string {
  const rootDir = accountRootDir(accountId);
  // Guide style: user-data-dir = profile folder itself (has Default/)
  const nested = path.join(rootDir, 'user-data');
  if (fs.existsSync(path.join(rootDir, 'Default'))) {
    return path.resolve(rootDir);
  }
  if (fs.existsSync(path.join(nested, 'Default'))) {
    return path.resolve(nested);
  }
  // New profiles: put Chrome data at profile root (simpler, matches FlowAgent)
  fs.mkdirSync(rootDir, { recursive: true });
  return path.resolve(rootDir);
}

/** Absolute path to source extension (always load from repo — never stale copy). */
export function sourceExtensionDir(fallback?: string): string {
  if (fallback && fs.existsSync(path.join(fallback, 'manifest.json'))) {
    return path.resolve(fallback);
  }
  const cwd = process.env.AI_NOVEL_ROOT || process.cwd();
  const candidates = [
    path.join(cwd, 'extensions', 'ainovel-flow'),
    path.join(cwd, 'extension'),
    path.join(process.cwd(), 'extensions', 'ainovel-flow'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'manifest.json'))) return path.resolve(c);
  }
  return path.resolve(cwd, 'extensions', 'ainovel-flow');
}

/** Ensure profile prefs allow --load-extension (Chrome 137+). */
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
  const browser = (prefs.browser || {}) as Record<string, unknown>;
  browser.has_seen_welcome_page = true;
  prefs.browser = browser;
  fs.writeFileSync(prefsPath, JSON.stringify(prefs), 'utf8');
}

/**
 * 1 account = 1 extension copy under that profile root.
 * Cookies/session stay isolated via --user-data-dir.
 * Bind WS URL to accountId so bridge maps socket → this profile only
 * (never a shared/global "default" session leaking across cards).
 */
export function ensureAccountExtension(
  accountId: string,
  sourceExtDir: string,
): string {
  const id = String(accountId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const src = sourceExtensionDir(sourceExtDir);
  const rootDir = accountRootDir(id);
  fs.mkdirSync(rootDir, { recursive: true });

  const extDest = path.join(rootDir, 'extension');
  const bindPath = path.join(extDest, 'ACCOUNT_BIND.json');
  let needCopy = !fs.existsSync(path.join(extDest, 'manifest.json'));
  if (!needCopy && fs.existsSync(bindPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(bindPath, 'utf8')) as {
        accountId?: string;
      };
      if (String(prev.accountId || '') !== id) needCopy = true;
    } catch {
      needCopy = true;
    }
  } else if (!needCopy && !fs.existsSync(bindPath)) {
    // Old copy without bind → re-inject at least
  }

  // Hot-sync critical SW files when source is newer (NO_FLOW_KEY fix etc.)
  // without full wipe of per-profile extension state.
  if (!needCopy && fs.existsSync(path.join(extDest, 'manifest.json'))) {
    const hotFiles = [
      'background.js',
      'content.js',
      'injected.js',
      'manifest.json',
      'popup.js',
      'side_panel.js',
      'tabGuard.js',
    ];
    for (const f of hotFiles) {
      const from = path.join(/* turbopackIgnore: true */ src, f);
      const to = path.join(/* turbopackIgnore: true */ extDest, f);
      if (!fs.existsSync(from)) continue;
      try {
        const srcStat = fs.statSync(from);
        const destNewer =
          fs.existsSync(to) && fs.statSync(to).mtimeMs >= srcStat.mtimeMs;
        if (!destNewer) {
          fs.copyFileSync(from, to);
          console.log(`[FlowChrome] hot-sync ${f} → account=${id}`);
        }
      } catch (e) {
        console.warn(
          `[FlowChrome] hot-sync ${f} failed account=${id}`,
          e instanceof Error ? e.message : e,
        );
      }
    }
  }

  if (needCopy) {
    try {
      if (fs.existsSync(extDest)) {
        fs.rmSync(extDest, { recursive: true, force: true });
      }
    } catch {
      /* locked — overwrite in place below */
    }
    try {
      fs.cpSync(src, extDest, { recursive: true });
    } catch (e) {
      console.warn(
        `[FlowChrome] extension copy failed account=${id}`,
        e instanceof Error ? e.message : e,
      );
      if (!fs.existsSync(path.join(extDest, 'manifest.json'))) {
        throw e;
      }
    }
  }

  // Always ensure WS URL carries this accountId (idempotent)
  const bgFile = path.join(extDest, 'background.js');
  const bound = `ws://127.0.0.1:9223/?accountId=${id}`;
  if (fs.existsSync(bgFile)) {
    let content = fs.readFileSync(bgFile, 'utf8');
    const before = content;
    content = content.replace(
      /ws:\/\/127\.0\.0\.1:9223(?:\/?\?[^'"`\s]*)?/g,
      bound,
    );
    content = content.replace(
      /(const\s+AGENT_WS_URL\s*=\s*['"])([^'"]+)(['"])/,
      `$1${bound}$3`,
    );
    if (content !== before) {
      try {
        fs.writeFileSync(bgFile, content, 'utf8');
      } catch (e) {
        console.warn(
          `[FlowChrome] inject accountId failed (browser may lock file) account=${id}`,
          e instanceof Error ? e.message : e,
        );
      }
    }
  }

  try {
    fs.writeFileSync(
      bindPath,
      JSON.stringify({ accountId: id, wsUrl: bound }),
      'utf8',
    );
  } catch {
    /* ignore */
  }

  const metaPath = path.join(rootDir, 'ACCOUNT_META.json');
  try {
    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        {
          accountId: id,
          userDataDir: profileDirForAccount(id),
          extensionDir: extDest,
          note: '1 profile = 1 Chrome user-data-dir + extension bound to accountId. Login session is isolated.',
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch {
    /* ignore */
  }
  return extDest;
}

/** Prepare isolated user-data + resolve extension path (guide §1 + §3). */
export function ensureIsolatedAccountProfile(
  accountId: string,
  sourceExtDir: string,
): { profileDir: string; extDir: string; rootDir: string } {
  const id = String(accountId || 'default');
  const rootDir = accountRootDir(id);
  fs.mkdirSync(rootDir, { recursive: true });
  const profileDir = profileDirForAccount(id);
  const extDir = ensureAccountExtension(id, sourceExtDir);
  return { profileDir, extDir, rootDir };
}

/**
 * Hồ sơ TRỐNG cho profile mới: xóa cookies/session Google cũ trong user-data-dir
 * (giữ folder + extension bind). 1 profile mới = 1 trình duyệt trống, không đăng nhập account cũ.
 */
export function prepareBlankLoginProfile(
  accountId: string,
  sourceExtDir: string,
): { profileDir: string; extDir: string; rootDir: string; wiped: string[] } {
  const id = String(accountId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const rootDir = accountRootDir(id);
  fs.mkdirSync(rootDir, { recursive: true });

  // Kill browser of THIS profile only
  const profileDir = profileDirForAccount(id);
  try {
    killChromeForProfile(profileDir);
    if (path.resolve(rootDir) !== path.resolve(profileDir)) {
      killChromeForProfile(rootDir);
    }
    try {
      execSync('ping -n 2 127.0.0.1 >nul', { windowsHide: true });
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }

  const wiped: string[] = [];
  const keep = new Set([
    'extension',
    'ACCOUNT_META.json',
    'ACCOUNT_BIND.json',
    'LAST_LAUNCH.cmd.txt',
  ]);

  const wipeDir = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (keep.has(name)) continue;
      const p = path.join(dir, name);
      try {
        fs.rmSync(p, { recursive: true, force: true });
        wiped.push(name);
      } catch (e) {
        console.warn(
          `[FlowChrome] wipe ${name} failed`,
          e instanceof Error ? e.message : e,
        );
      }
    }
  };

  // user-data may be rootDir itself or rootDir/user-data
  wipeDir(profileDir);
  if (path.resolve(profileDir) !== path.resolve(rootDir)) {
    wipeDir(rootDir);
  }

  // Locks
  for (const base of [profileDir, rootDir]) {
    for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      const lock = path.join(/* turbopackIgnore: true */ base, name);
      try {
        if (fs.existsSync(lock)) fs.unlinkSync(lock);
      } catch {
        /* ignore */
      }
    }
  }

  const extDir = ensureAccountExtension(id, sourceExtDir);
  const finalProfile = profileDirForAccount(id);
  fs.mkdirSync(finalProfile, { recursive: true });
  try {
    ensureProfileDeveloperMode(finalProfile);
  } catch {
    /* ignore */
  }

  console.log(
    `[FlowChrome] Blank login profile account=${id} wiped=[${wiped.join(',')}] dir=${finalProfile}`,
  );
  return { profileDir: finalProfile, extDir, rootDir, wiped };
}

export function getSession(accountId: string): ProfileSession | null {
  return root().byAccount[accountId] || null;
}

/**
 * Hard purge one profile: kill its browser, remove accounts_data + legacy dirs,
 * drop in-memory session. Does NOT touch accounts.json (caller owns that).
 * Safe for user "xóa profile" — no orphan cookies/tokens on disk.
 */
export function purgeAccountProfile(accountId: string): {
  accountId: string;
  killed: number;
  removed: string[];
  errors: string[];
} {
  const id = String(accountId || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const removed: string[] = [];
  const errors: string[] = [];
  let killed = 0;

  if (!id || id === 'default' && !String(accountId || '').trim()) {
    return { accountId: id || '', killed: 0, removed, errors: ['empty accountId'] };
  }

  const cwd = process.env.AI_NOVEL_ROOT || process.cwd();
  const candidates = [
    path.resolve(cwd, 'accounts_data', id),
    path.resolve(cwd, 'scratch', 'flow-profiles', id),
  ];

  // Prefer known session profileDir if tracked
  const sess = root().byAccount[id];
  if (sess?.profileDir) {
    candidates.unshift(path.resolve(sess.profileDir));
    try {
      const parent = path.dirname(sess.profileDir);
      if (/accounts_data|flow-profiles/i.test(parent)) {
        candidates.unshift(path.resolve(parent, id));
      }
    } catch {
      /* ignore */
    }
  }

  const uniqueDirs = [...new Set(candidates.map((c) => path.resolve(c)))];

  for (const dir of uniqueDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      killed += killChromeForProfile(dir);
    } catch (e) {
      errors.push(
        `kill ${dir}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Brief settle so Windows releases file locks
  try {
    execSync('ping -n 2 127.0.0.1 >nul', { windowsHide: true });
  } catch {
    /* ignore */
  }

  for (const dir of uniqueDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      // Retry wipe once if partial lock
      fs.rmSync(dir, { recursive: true, force: true });
      if (!fs.existsSync(dir)) {
        removed.push(dir);
      } else {
        // Second pass: wipe children then root
        for (const name of fs.readdirSync(dir)) {
          try {
            fs.rmSync(path.join(dir, name), { recursive: true, force: true });
          } catch (e) {
            errors.push(
              `wipe ${name}: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        if (!fs.existsSync(dir)) removed.push(dir);
        else errors.push(`still exists after wipe: ${dir}`);
      }
    } catch (e) {
      errors.push(
        `rm ${dir}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  delete root().byAccount[id];
  if (root().lastActiveAccountId === id) {
    root().lastActiveAccountId = undefined;
  }

  console.log(
    `[FlowChrome] purgeAccountProfile account=${id} killed=${killed} removed=${removed.length} errors=${errors.length}`,
  );
  return { accountId: id, killed, removed, errors };
}

/**
 * List profile folders on disk that are NOT in the given account id set (orphans).
 */
export function listOrphanProfileDirs(knownIds: string[]): string[] {
  const known = new Set(
    (knownIds || []).map((x) =>
      String(x || '').replace(/[^a-zA-Z0-9_-]/g, '_'),
    ),
  );
  const cwd = process.env.AI_NOVEL_ROOT || process.cwd();
  const roots = [
    path.resolve(cwd, 'accounts_data'),
    path.resolve(cwd, 'scratch', 'flow-profiles'),
  ];
  const orphans: string[] = [];
  for (const rootDir of roots) {
    if (!fs.existsSync(rootDir)) continue;
    let names: string[] = [];
    try {
      names = fs.readdirSync(rootDir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name === 'README.md' || name.startsWith('.')) continue;
      const full = path.join(rootDir, name);
      try {
        if (!fs.statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
      // Only treat acc_* folders as profile dirs
      if (!/^acc_[a-z0-9_]+$/i.test(name) && name !== 'default') continue;
      if (!known.has(name)) orphans.push(full);
    }
  }
  return orphans;
}

export function listSessions(): ProfileSession[] {
  return Object.values(root().byAccount);
}

/**
 * Count Chrome/Edge processes whose command line includes profileDir (Windows).
 */
export function countChromeForProfile(profileDir: string): number {
  if (!profileDir) return 0;
  if (process.platform !== 'win32') {
    return listSessions().filter(
      (s) =>
        s.profileDir === path.resolve(profileDir) &&
        ((s.loginPid && isAlive(s.loginPid)) || (s.bgPid && isAlive(s.bgPid))),
    ).length
      ? 1
      : 0;
  }
  const needle = path.resolve(profileDir).replace(/'/g, "''");
  const ps = [
    `$n=0;`,
    `Get-CimInstance Win32_Process -EA SilentlyContinue |`,
    `Where-Object { ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe' -or $_.Name -eq 'chromium.exe') -and $_.CommandLine -and ($_.CommandLine -like '*${needle}*') } |`,
    `ForEach-Object { $n++ };`,
    `Write-Output $n`,
  ].join(' ');
  try {
    const out = execSync(
      `powershell -NoProfile -NonInteractive -Command "${ps}"`,
      {
        encoding: 'utf8',
        timeout: 12_000,
        windowsHide: true,
      },
    );
    const n = Number(String(out).trim().split(/\r?\n/).filter(Boolean).pop());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function isProfileBrowserAlive(profileDir?: string | null): boolean {
  if (!profileDir) {
    return listSessions().some(
      (s) =>
        (s.loginPid && isAlive(s.loginPid)) || (s.bgPid && isAlive(s.bgPid)),
    );
  }
  const abs = path.resolve(profileDir);
  const sess = listSessions().find((s) => s.profileDir === abs);
  if (sess) {
    if (sess.loginPid && isAlive(sess.loginPid)) return true;
    if (sess.bgPid && isAlive(sess.bgPid)) return true;
  }
  return countChromeForProfile(abs) > 0;
}

export function getChromeSessionInfo(accountId?: string | null) {
  const gstate = root();
  const id = accountId || gstate.lastActiveAccountId;
  const s = id ? gstate.byAccount[id] : null;
  const profileDir = s?.profileDir || null;
  const loginPidAlive = isAlive(s?.loginPid);
  const bgPidAlive = isAlive(s?.bgPid);
  let profileBrowserAlive = loginPidAlive || bgPidAlive;
  if ((s?.loginOpen || s?.closing) && !profileBrowserAlive && profileDir) {
    profileBrowserAlive = countChromeForProfile(profileDir) > 0;
  }
  return {
    loginOpen: Boolean(s?.loginOpen),
    profileDir,
    accountId: s?.accountId || id || null,
    closing: Boolean(s?.closing),
    loginPid: s?.loginPid || null,
    bgPid: s?.bgPid || null,
    loginPidAlive,
    bgPidAlive,
    profileBrowserAlive,
  };
}

export function registerSessionMeta(meta: {
  profileDir: string;
  chromePath: string;
  extDir: string;
  accountId: string;
}) {
  const gstate = root();
  const id = String(meta.accountId || 'default');
  const prev = gstate.byAccount[id];
  gstate.byAccount[id] = {
    accountId: id,
    profileDir: path.resolve(meta.profileDir),
    chromePath: meta.chromePath,
    extDir: path.resolve(meta.extDir),
    loginPid: prev?.loginPid,
    bgPid: prev?.bgPid,
    loginOpen: prev?.loginOpen ?? false,
    closing: prev?.closing ?? false,
    lastTokenCloseAt: prev?.lastTokenCloseAt,
  };
  gstate.lastActiveAccountId = id;
}

/**
 * Kill chrome/msedge/chromium whose CommandLine contains any of the given path needles.
 * Used for per-profile cleanup and full app-quit (detached browsers otherwise survive).
 */
export function killChromeByPathNeedles(needles: string[]): number {
  const clean = [
    ...new Set(
      (needles || [])
        .map((n) => String(n || '').trim())
        .filter(Boolean)
        .map((n) => path.resolve(n)),
    ),
  ];
  if (clean.length === 0) return 0;

  let killedByPid = 0;
  for (const s of listSessions()) {
    const hit = clean.some(
      (needle) =>
        s.profileDir === needle ||
        s.profileDir.startsWith(needle + path.sep) ||
        needle.startsWith(s.profileDir + path.sep),
    );
    if (!hit) continue;
    for (const pid of [s.loginPid, s.bgPid]) {
      if (pid && isAlive(pid)) {
        try {
          if (process.platform === 'win32') {
            execSync(`taskkill /F /T /PID ${pid}`, { windowsHide: true, stdio: 'ignore' });
          } else {
            process.kill(pid, 'SIGKILL');
          }
          killedByPid++;
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (process.platform !== 'win32') {
    return killedByPid;
  }

  const likeParts = clean
    .map((n) => n.replace(/'/g, "''"))
    .map((n) => `($_.CommandLine -like '*${n}*')`)
    .join(' -or ');
  const ps = [
    `$n=0;`,
    `Get-CimInstance Win32_Process -EA SilentlyContinue |`,
    `Where-Object { ($_.Name -like '*chrome*' -or $_.Name -like '*chromium*' -or $_.Name -like '*edge*') -and $_.CommandLine -and (${likeParts}) } |`,
    `ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -EA Stop; $n++ } catch {} };`,
    `Write-Output $n`,
  ].join(' ');

  try {
    const out = execSync(
      `powershell -NoProfile -NonInteractive -Command "${ps}"`,
      {
        encoding: 'utf8',
        timeout: 3_000,
        windowsHide: true,
      },
    );
    const n = Number(String(out).trim().split(/\r?\n/).filter(Boolean).pop());
    const psKilled = Number.isFinite(n) ? n : 0;
    return killedByPid + psKilled;
  } catch {
    return killedByPid;
  }
}

/** Kill Chrome processes for ONE profile dir only (never other accounts). */
export function killChromeForProfile(profileDir: string): number {
  if (!profileDir) return 0;
  return killChromeByPathNeedles([profileDir]);
}

/**
 * Kill EVERY Flow/TikTok app browser under this install root.
 * Chrome is spawned detached+unref so it survives Electron exit unless we kill it here.
 */
export function killAllFlowBrowsers(opts?: {
  reason?: string;
  roots?: string[];
}): { killed: number; needles: string[] } {
  const cwd = process.env.AI_NOVEL_ROOT || process.cwd();
  const extra = (opts?.roots || []).filter(Boolean);
  const baseRoots = [...new Set([cwd, ...extra].map((r) => path.resolve(r)))];

  const needles: string[] = [];
  for (const r of baseRoots) {
    needles.push(path.join(r, 'accounts_data'));
    needles.push(path.join(r, 'scratch', 'flow-profiles'));
    needles.push(path.join(r, 'browser-profiles'));
  }

  // Tracked sessions (may sit outside default roots)
  for (const s of listSessions()) {
    if (s.profileDir) needles.push(s.profileDir);
    try {
      needles.push(accountRootDir(s.accountId));
      needles.push(profileDirForAccount(s.accountId));
    } catch {
      /* ignore */
    }
  }

  const killed = killChromeByPathNeedles(needles);

  // Clear in-memory session flags so next boot is clean
  const gstate = root();
  for (const s of Object.values(gstate.byAccount)) {
    s.loginOpen = false;
    s.closing = false;
    s.loginPid = undefined;
    s.bgPid = undefined;
  }
  gstate.byAccount = {};
  gstate.lastActiveAccountId = undefined;

  console.log(
    `[FlowChrome] killAllFlowBrowsers reason=${opts?.reason || '?'} killed=${killed} needles=${needles.length}`,
  );
  return { killed, needles: [...new Set(needles.map((n) => path.resolve(n)))] };
}

let shutdownHooksRegistered = false;

/** Idempotent: register process exit hooks so Node/Next quit also kills browsers. */
export function registerFlowBrowserShutdownHooks(): void {
  if (shutdownHooksRegistered) return;
  shutdownHooksRegistered = true;
  const run = (sig: string) => {
    try {
      killAllFlowBrowsers({ reason: `process:${sig}` });
    } catch (e) {
      console.warn(
        '[FlowChrome] shutdown kill failed',
        e instanceof Error ? e.message : e,
      );
    }
  };
  process.once('exit', () => run('exit'));
  process.once('SIGTERM', () => run('SIGTERM'));
  process.once('SIGINT', () => run('SIGINT'));
  // Windows console close / Electron killing Next child
  process.once('SIGHUP' as NodeJS.Signals, () => run('SIGHUP'));
  console.log('[FlowChrome] shutdown hooks registered (kill browsers on process exit)');
}

/**
 * If user closed the login window for any account, clear flags.
 */
export function reconcileLoginBrowserClosed(accountId?: string | null): {
  closed: boolean;
  accountId: string | null;
} {
  const gstate = root();
  const ids = accountId
    ? [accountId]
    : Object.keys(gstate.byAccount).filter((id) => gstate.byAccount[id]?.loginOpen);

  for (const id of ids) {
    const s = gstate.byAccount[id];
    if (!s?.loginOpen) continue;
    const alive = isProfileBrowserAlive(s.profileDir);
    if (alive) continue;

    s.loginOpen = false;
    s.loginPid = undefined;
    try {
      void import('./bridgeServer').then((m) => m.setLoginSessionOpen(false));
    } catch {
      /* ignore */
    }
    console.log(
      `[FlowChrome] Login browser closed (account=${id} dir=${path.basename(path.dirname(s.profileDir))}/${path.basename(s.profileDir)})`,
    );
    return { closed: true, accountId: id };
  }
  return { closed: false, accountId: accountId || gstate.lastActiveAccountId || null };
}

/**
 * Remove only Chromium's restored-tab metadata before a forced Flow relaunch.
 * Cookies, Local Storage, IndexedDB and the Google login session are preserved.
 */
export function clearProfileTabRestoreState(profileDir: string): string[] {
  const root = path.resolve(profileDir);
  const defaultDir = path.join(root, 'Default');
  const candidates = [
    path.join(defaultDir, 'Sessions'),
    path.join(defaultDir, 'Current Session'),
    path.join(defaultDir, 'Current Tabs'),
    path.join(defaultDir, 'Last Session'),
    path.join(defaultDir, 'Last Tabs'),
  ];
  const removed: string[] = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(`${root}${path.sep}`) || !fs.existsSync(resolved)) {
      continue;
    }
    try {
      fs.rmSync(resolved, { recursive: true, force: true });
      removed.push(resolved);
    } catch (error) {
      console.warn(
        `[FlowChrome] Cannot clear restored-tab state ${resolved}`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return removed;
}

/**
 * Clear only Chromium's service-worker registration/script cache before a
 * forced relaunch so an updated unpacked Flow extension cannot keep executing
 * stale background.js bytecode. Google cookies and site storage are untouched.
 */
export function clearProfileServiceWorkerCache(profileDir: string): string[] {
  const root = path.resolve(profileDir);
  const serviceWorkerDir = path.join(root, 'Default', 'Service Worker');
  const candidates = [
    path.join(serviceWorkerDir, 'ScriptCache'),
    path.join(serviceWorkerDir, 'Database'),
  ];
  const removed: string[] = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(`${root}${path.sep}`) || !fs.existsSync(resolved)) {
      continue;
    }
    try {
      fs.rmSync(resolved, { recursive: true, force: true });
      removed.push(resolved);
    } catch (error) {
      console.warn(
        `[FlowChrome] Cannot clear service-worker cache ${resolved}`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return removed;
}

export function launchChrome(opts: {
  chromePath: string;
  /** Source extension dir OR already per-account ext — will isolate if needed */
  extDir: string;
  profileDir: string;
  accountId: string;
  mode: ChromeLaunchMode;
  forceClean?: boolean;
  isStockChrome?: boolean;
  proxy?: string;
}): { launched: boolean; child?: ChildProcess; profileDir: string; killed: number } {
  const accountId = String(opts.accountId || 'default');

  // Resolve user-data path first (before extension re-sync needs free files)
  const userDataEarly = path.resolve(profileDirForAccount(accountId));
  fs.mkdirSync(userDataEarly, { recursive: true });

  // Kill ONLY this account's browser BEFORE rewriting extension (file locks)
  let killed = 0;
  if (opts.forceClean !== false) {
    try {
      killed = killChromeForProfile(userDataEarly);
      const root = accountRootDir(accountId);
      if (path.resolve(root) !== userDataEarly) {
        killed += killChromeForProfile(root);
      }
      // Legacy scratch path
      const legacy = path.resolve(
        process.cwd(),
        'scratch',
        'flow-profiles',
        accountId,
      );
      if (fs.existsSync(legacy)) killed += killChromeForProfile(legacy);
      if (killed > 0) {
        console.log(
          `[FlowChrome] Killed ${killed} process(es) for account=${accountId} only`,
        );
      }
    } catch (e) {
      console.warn('[FlowChrome] kill profile failed (continue)', e);
    }
  }

  // Guide §1: --user-data-dir + --load-extension (absolute paths)
  // After kill: re-copy extension + inject accountId (1 profile = 1 bound socket)
  const isolated = ensureIsolatedAccountProfile(accountId, opts.extDir);
  const userData = path.resolve(isolated.profileDir);
  const extAbs = path.resolve(isolated.extDir);
  if (opts.forceClean !== false) {
    const removedTabState = clearProfileTabRestoreState(userData);
    const removedWorkerCache = clearProfileServiceWorkerCache(userData);
    if (removedTabState.length > 0) {
      console.log(
        `[FlowChrome] Cleared ${removedTabState.length} restored-tab artifact(s) for account=${accountId}`,
      );
    }
    if (removedWorkerCache.length > 0) {
      console.log(
        `[FlowChrome] Cleared ${removedWorkerCache.length} stale service-worker cache artifact(s) for account=${accountId}`,
      );
    }
  }

  if (!fs.existsSync(path.join(extAbs, 'manifest.json'))) {
    throw new Error(`Extension missing manifest.json at ${extAbs}`);
  }
  if (!fs.existsSync(opts.chromePath)) {
    throw new Error(`Browser exe not found: ${opts.chromePath}`);
  }

  fs.mkdirSync(userData, { recursive: true });
  registerSessionMeta({
    profileDir: userData,
    chromePath: opts.chromePath,
    extDir: extAbs,
    accountId,
  });

  try {
    for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      const lock = path.join(/* turbopackIgnore: true */ userData, name);
      if (fs.existsSync(lock)) fs.unlinkSync(lock);
    }
  } catch {
    /* ignore */
  }

  try {
    ensureProfileDeveloperMode(userData);
  } catch (e) {
    console.warn('[FlowChrome] developer_mode prefs patch failed', e);
  }

  // Exact guide flags (+ minimal extras for stability)
  const baseArgs = [
    `--user-data-dir=${userData}`,
    `--load-extension=${extAbs}`,
    `--disable-extensions-except=${extAbs}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-popup-blocking',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--enable-extensions',
  ];

  // Per-profile proxy (UI) → ops.globalProxy fallback. No free-VPN auto.
  const proxyServer = resolveAccountProxyServer(accountId, opts.proxy);
  if (proxyServer) {
    baseArgs.push(`--proxy-server=${proxyServer}`);
    console.log(
      `[FlowChrome] proxy for account=${accountId}: ${proxyServer.replace(/:[^:@/]+@/, ':***@')}`,
    );
  }

  if (opts.isStockChrome) {
    baseArgs.push(
      '--enable-unsafe-extension-debugging',
      '--disable-features=ChromeWhatsNewUI,DisableLoadExtensionCommandLineSwitch',
    );
  }

  const flowUrl = `https://labs.google/fx/tools/flow?ainovel_account=${encodeURIComponent(accountId)}`;

  // Login: single maximized window + Flow URL.
  // Background: start minimized + silent launch off-screen (zero window flash on screen).
  const args =
    opts.mode === 'login'
      ? [...baseArgs, '--start-maximized', flowUrl]
      : [
          ...baseArgs,
          '--window-state=minimized',
          '--start-minimized',
          '--silent-launch',
          '--window-position=-32000,-32000',
          '--window-size=10,10',
          flowUrl,
        ];

  // Persist last launch command for debugging (guide-style CMD)
  try {
    const cmdLine = [opts.chromePath, ...args].map((a) =>
      a.includes(' ') ? `"${a}"` : a,
    ).join(' ');
    fs.writeFileSync(
      path.join(accountRootDir(accountId), 'LAST_LAUNCH.cmd.txt'),
      cmdLine + '\n',
      'utf8',
    );
    console.log(`[FlowChrome] CMD: ${cmdLine}`);
  } catch {
    /* ignore */
  }

  console.log(
    `[FlowChrome] launch account=${accountId} mode=${opts.mode}\n  user-data-dir=${userData}\n  load-extension=${extAbs}\n  exe=${opts.chromePath}`,
  );

  const child = spawn(opts.chromePath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: opts.mode !== 'login',
  });
  child.unref();

  const sess = root().byAccount[accountId];
  if (sess) {
    if (opts.mode === 'login') {
      sess.loginPid = child.pid;
      sess.loginOpen = true;
      sess.bgPid = undefined;
    } else {
      sess.bgPid = child.pid;
      sess.loginOpen = false;
    }
  }
  try {
    void import('./bridgeServer').then((m) =>
      m.setLoginSessionOpen(Boolean(opts.mode === 'login')),
    );
  } catch {
    /* ignore */
  }

  return { launched: true, child, profileDir: userData, killed };
}

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
  const accountId = String(opts.accountId || 'default');
  const isolated = ensureIsolatedAccountProfile(accountId, opts.extDir);
  const profileAbs = path.resolve(isolated.profileDir);
  const extAbs = path.resolve(isolated.extDir);
  const manifestPath = path.join(extAbs, 'manifest.json');
  fs.mkdirSync(profileAbs, { recursive: true });

  registerSessionMeta({
    profileDir: profileAbs,
    chromePath: opts.exe,
    extDir: extAbs,
    accountId,
  });

  const args = [
    '--no-remote',
    '-profile',
    profileAbs,
    `https://labs.google/fx/tools/flow?ainovel_account=${encodeURIComponent(accountId)}`,
  ];

  const child = spawn(opts.exe, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  const sess = root().byAccount[accountId];
  if (sess) {
    sess.loginPid = child.pid;
    sess.loginOpen = true;
  }
  void import('./bridgeServer').then((m) => m.setLoginSessionOpen(true));

  let clipboardOk = false;
  try {
    execSync(
      `powershell -NoProfile -Command "Set-Clipboard -Value '${manifestPath.replace(/'/g, "''")}'"`,
      { windowsHide: true, timeout: 5000 },
    );
    clipboardOk = true;
  } catch {
    /* ignore */
  }

  const manualSteps = [
    `Profile riêng: ${profileAbs}`,
    'Firefox/Mullvad: about:debugging → This Firefox → Load Temporary Add-on',
    clipboardOk
      ? '(manifest.json đã copy clipboard)'
      : `(manifest: ${manifestPath})`,
    'Đăng nhập Google trên tab Flow',
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
 * After verified email+token capture (docs/flow-bridge.md):
 *   1) extension close_login_session (minimize / off-screen)
 *   2) kill login Chrome for this profile only
 *   3) relaunch Chrome background (off-screen) when keepBackground
 *
 * Do NOT only flip loginOpen while leaving a visible login window —
 * that left "LOGIN OFF" + browser still on screen after capture.
 */
export async function closeLoginSessionAfterCapture(opts?: {
  delayMs?: number;
  keepBackground?: boolean;
  accountId?: string;
  /** Force kill even if already marked closed (stuck visible window) */
  force?: boolean;
}): Promise<{
  closed: boolean;
  relaunched: boolean;
  message: string;
  minimized?: boolean;
  killed?: number;
}> {
  const gstate = root();
  const accountId =
    opts?.accountId || gstate.lastActiveAccountId || Object.keys(gstate.byAccount)[0];
  if (!accountId) {
    return {
      closed: false,
      relaunched: false,
      message: 'No tracked login session',
    };
  }
  const s = gstate.byAccount[accountId];
  if (!s) {
    return {
      closed: false,
      relaunched: false,
      message: `No session for account ${accountId}`,
    };
  }
  if (s.closing) {
    return { closed: false, relaunched: false, message: 'Close already in progress' };
  }

  const profileDir = s.profileDir;
  const browserAlive = Boolean(
    profileDir && isProfileBrowserAlive(profileDir),
  );
  const force = Boolean(opts?.force);
  // Already in true background (no login window, bgPid, browser may be off-screen)
  // and not forced → skip. If browser still alive after "closed" with loginPid
  // only (stuck visible), still close.
  if (
    !force &&
    !s.loginOpen &&
    s.bgPid &&
    isAlive(s.bgPid) &&
    !s.loginPid &&
    s.lastTokenCloseAt &&
    Date.now() - s.lastTokenCloseAt < 60_000
  ) {
    return {
      closed: false,
      relaunched: false,
      message: 'Already in background — skip kill/relaunch',
    };
  }
  // Debounce only when we already killed recently AND browser is gone
  if (
    !force &&
    s.lastTokenCloseAt &&
    Date.now() - s.lastTokenCloseAt < 45_000 &&
    !s.loginOpen &&
    !browserAlive
  ) {
    return {
      closed: false,
      relaunched: false,
      message: 'Recently closed (debounce)',
    };
  }
  // Nothing to close
  if (!force && !s.loginOpen && !browserAlive && !s.loginPid) {
    return {
      closed: false,
      relaunched: false,
      message: 'Login already closed',
    };
  }

  const chromePath = s.chromePath;
  const extDir = s.extDir;

  if (!profileDir || !chromePath || !extDir) {
    s.loginOpen = false;
    s.loginPid = undefined;
    try {
      const { setLoginSessionOpen } = await import('./bridgeServer');
      setLoginSessionOpen(false);
    } catch {
      /* ignore */
    }
    return {
      closed: true,
      relaunched: false,
      message: 'Đã đánh dấu đóng login (thiếu meta profile).',
    };
  }

  s.closing = true;
  const delayMs = opts?.delayMs ?? 800;
  const keepBg = opts?.keepBackground !== false;
  let minimized = false;

  // 1) Ask extension to minimize / hide windows (best-effort before kill)
  try {
    const bridge = await import('./bridgeServer');
    const r = await bridge.commandExtension(
      'close_login_session',
      {},
      4_000,
      accountId,
    );
    minimized = Boolean(
      r &&
        typeof r === 'object' &&
        (r as { result?: { ok?: boolean; minimized?: number } }).result?.ok !==
          false,
    );
    console.log(
      `[FlowChrome] close_login_session minimize account=${accountId} ok=${minimized}`,
    );
  } catch (e) {
    console.warn(
      `[FlowChrome] close_login_session (minimize) failed account=${accountId}`,
      e instanceof Error ? e.message : e,
    );
  }

  await new Promise((r) => setTimeout(r, delayMs));

  try {
    // 2) Kill login/visible browser for this profile only (docs: auto-close)
    let killed = killChromeForProfile(profileDir);
    if (killed === 0) {
      for (const pid of [s.loginPid, s.bgPid]) {
        if (pid && isAlive(pid)) {
          try {
            process.kill(pid, 'SIGTERM');
            killed++;
          } catch {
            /* ignore */
          }
        }
      }
    }
    // Retry once if Windows process still holds the profile
    if (isProfileBrowserAlive(profileDir)) {
      await new Promise((r) => setTimeout(r, 600));
      killed += killChromeForProfile(profileDir);
    }

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
      `[FlowChrome] Login closed account=${accountId} killed=${killed} minimized=${minimized} dir=${profileDir}`,
    );

    let relaunched = false;
    let reconnected = false;
    // 3) Relaunch background (off-screen) so gen/captcha keep working
    const stillAlive = isProfileBrowserAlive(profileDir);
    if (
      keepBg &&
      !stillAlive &&
      fs.existsSync(chromePath) &&
      fs.existsSync(extDir)
    ) {
      await new Promise((r) => setTimeout(r, 1200));
      const isStock =
        /google[\\/]chrome/i.test(chromePath) ||
        /\\chrome\\application\\chrome\.exe$/i.test(chromePath);
      launchChrome({
        chromePath,
        extDir,
        profileDir,
        accountId,
        mode: 'background',
        forceClean: false,
        isStockChrome: isStock,
      });
      relaunched = true;
      console.log(`[FlowChrome] Background once for account=${accountId}`);

      try {
        const bridge = await import('./bridgeServer');
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
          const snap = bridge.getBridgeSnapshot();
          if (snap.extensionConnected && snap.flowKeyPresent) {
            reconnected = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch {
        /* ignore */
      }
    } else if (stillAlive) {
      console.warn(
        `[FlowChrome] Browser still alive after kill account=${accountId} — user may need to close manually`,
      );
    }

    return {
      closed: true,
      relaunched,
      minimized,
      killed,
      message: relaunched
        ? reconnected
          ? `Đã đóng login + Chrome nền sẵn sàng (${accountId}).`
          : `Đã đóng login; Chrome nền đang nối (${accountId})…`
        : killed > 0
          ? `Đã đóng cửa sổ đăng nhập (${accountId}).`
          : `Đã đánh dấu đóng login (${accountId}).`,
    };
  } finally {
    s.closing = false;
  }
}
