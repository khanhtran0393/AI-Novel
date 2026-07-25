/**
 * One-shot auto-configure Google Flow for AI Novel.
 * FlowAgent strategy: clean Chromium (Ungoogled/Brave/portable), NOT stock Chrome + CDP.
 */
import fs from 'fs';
import path from 'path';
import {
  createAccount,
  loadAccounts,
  updateAccount,
} from './accountStore';
import {
  listDetectedBrowsers,
  portableChromiumInstallHint,
  resolveBrowser,
  type FlowBrowserEngine,
} from './browserResolver';
import { ensurePortableBrowser } from './ensurePortableBrowser';
import {
  ensureBridgeStarted,
  getAccountFlowKey,
  getBridgeSnapshot,
} from './bridgeServer';
import {
  getChromeSessionInfo,
  ensureIsolatedAccountProfile,
  prepareBlankLoginProfile,
  launchChrome,
  launchFirefoxFamily,
  profileDirForAccount,
  accountRootDir,
} from './chromeSession';
import { FLOW_HTTP_PORT, FLOW_WS_PORT } from './config';

export type BootstrapResult = {
  ok: boolean;
  bridgeRunning: boolean;
  extensionConnected: boolean;
  flowKeyPresent: boolean;
  projectId?: string | null;
  accountId?: string;
  chromeLaunched: boolean;
  chromePath?: string | null;
  extensionPath: string;
  profileDir?: string;
  loginRequired?: boolean;
  browserLabel?: string;
  isStockChrome?: boolean;
  engine?: string;
  manualSteps?: string[];
  message: string;
  steps: string[];
  snapshot: ReturnType<typeof getBridgeSnapshot>;
  installHint?: string;
};

export type FlowLoginReadinessInput = {
  email?: string | null;
  sessionVerified?: boolean;
  flowKeyPresent?: boolean;
  freshTokenPresent?: boolean;
};

/**
 * Login readiness used by bootstrap. Kept pure so token-only regressions can be
 * tested without launching Chromium or the Flow bridge.
 */
export function isFlowLoginReady(input: FlowLoginReadinessInput): boolean {
  const email = String(input.email || '').trim();
  return Boolean(
    email.includes('@') &&
      input.sessionVerified &&
      (input.flowKeyPresent || input.freshTokenPresent),
  );
}

function extensionDir(): string {
  const candidates = [
    path.join(process.cwd(), 'extensions', 'ainovel-flow'),
    path.join(process.env.AI_NOVEL_ROOT || '', 'extensions', 'ainovel-flow'),
  ];
  for (const d of candidates) {
    if (d && fs.existsSync(path.join(d, 'manifest.json'))) return d;
  }
  return path.join(process.cwd(), 'extensions', 'ainovel-flow');
}

function ensureDefaultAccount(engine?: string): { id: string; created: boolean } {
  const list = loadAccounts();
  if (list.length) return { id: list[0].id, created: false };
  const eng =
    engine === 'mullvad'
      ? 'mullvad'
      : ('chromium' as const);
  const acc = createAccount({
    name: 'Tài khoản chính',
    email: '',
    engine: eng,
  });
  return { id: acc.id, created: true };
}

async function waitFor(
  pred: () => boolean,
  timeoutMs: number,
  stepMs = 800,
): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return pred();
}

export async function bootstrapFlow(opts?: {
  forceChrome?: boolean;
  browserExe?: string;
  accountId?: string;
  engine?: FlowBrowserEngine | string;
  waitExtensionMs?: number;
  waitLoginMs?: number;
  /**
   * Profile mới / thêm trình duyệt: wipe cookies + mở phiên TRỐNG.
   * Không tái dùng token/account Google của profile khác.
   */
  freshSession?: boolean;
}): Promise<BootstrapResult> {
  const steps: string[] = [];
  const extPath = extensionDir();

  // Guide §4 Bước 1: BẬT WebSocket TRƯỚC khi mở browser
  await ensureBridgeStarted();
  steps.push(
    `[1/3] Bridge WS ws://127.0.0.1:${FLOW_WS_PORT} + HTTP :${FLOW_HTTP_PORT} ON`,
  );
  // Verify port actually listening
  try {
    const probe = await fetch(`http://127.0.0.1:${FLOW_HTTP_PORT}/api/status`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!probe.ok) throw new Error(`status HTTP ${probe.status}`);
    steps.push('[1/3] Probe /api/status OK');
  } catch (e) {
    steps.push(
      `[1/3] FAIL probe bridge: ${e instanceof Error ? e.message : e}`,
    );
  }
  steps.push(
    'RPA: browser thật + --user-data-dir + --load-extension (không headless/CDP)',
  );

  if (!fs.existsSync(path.join(extPath, 'manifest.json'))) {
    const snap = getBridgeSnapshot();
    return {
      ok: false,
      bridgeRunning: snap.running,
      extensionConnected: false,
      flowKeyPresent: false,
      chromeLaunched: false,
      extensionPath: extPath,
      loginRequired: true,
      message: `Thiếu extension tại ${extPath}`,
      steps,
      snapshot: snap,
    };
  }
  steps.push(`Extension path: ${extPath}`);

  const engineWanted = String(opts?.engine || 'auto') as FlowBrowserEngine;
  let browser;
  try {
    browser = resolveBrowser({
      engine: engineWanted,
      browserExe: opts?.browserExe,
    });
  } catch (e) {
    // Rào cản vật lý: tools/browsers trống + không Brave → tự tải Chromium portable
    // (không fallback Google Chrome — IRON B10)
    steps.push(String(e instanceof Error ? e.message : e));
    steps.push(
      '[auto-install] Chưa có Chromium sạch — đang tải Chrome for Testing → tools/browsers/ungoogled-chromium/ (~150MB, 1–3 phút)…',
    );
    const installed = await ensurePortableBrowser({
      forceRedownload: false,
      onProgress: (p) => {
        if (p.message) steps.push(`[auto-install] ${p.message}`);
      },
    });
    if (!installed.ok) {
      const snap = getBridgeSnapshot();
      const hint = portableChromiumInstallHint();
      steps.push(installed.message);
      steps.push(...(installed.steps || []).slice(-8));
      return {
        ok: false,
        bridgeRunning: snap.running,
        extensionConnected: false,
        flowKeyPresent: false,
        chromeLaunched: false,
        extensionPath: extPath,
        loginRequired: true,
        message: installed.message,
        steps,
        snapshot: snap,
        installHint: hint,
      };
    }
    steps.push(
      installed.alreadyPresent
        ? `[auto-install] Đã có browser: ${installed.browser?.label || installed.installPath}`
        : `[auto-install] Đã cài portable: ${installed.installPath}`,
    );
    try {
      browser = resolveBrowser({
        engine: installed.installPath ? 'custom' : 'auto',
        browserExe: installed.installPath || opts?.browserExe,
      });
    } catch (e2) {
      const snap = getBridgeSnapshot();
      return {
        ok: false,
        bridgeRunning: snap.running,
        extensionConnected: false,
        flowKeyPresent: false,
        chromeLaunched: false,
        extensionPath: extPath,
        loginRequired: true,
        message: e2 instanceof Error ? e2.message : String(e2),
        steps,
        snapshot: snap,
        installHint: portableChromiumInstallHint(),
      };
    }
  }

  // Chặn stock Chrome khi engine=auto (kể cả resolve nhầm)
  if (browser.isStockChrome && engineWanted !== 'chrome') {
    steps.push(
      'Phát hiện Google Chrome gốc — từ chối launch (chặn --load-extension). Đang cài Chromium portable…',
    );
    const installed = await ensurePortableBrowser({
      forceRedownload: false,
      onProgress: (p) => {
        if (p.message) steps.push(`[auto-install] ${p.message}`);
      },
    });
    if (!installed.ok || !installed.installPath) {
      const snap = getBridgeSnapshot();
      return {
        ok: false,
        bridgeRunning: snap.running,
        extensionConnected: false,
        flowKeyPresent: false,
        chromeLaunched: false,
        extensionPath: extPath,
        loginRequired: true,
        message:
          installed.message ||
          'Không cài được browser sạch. Bấm «Cài browser gen ảnh» hoặc cài Brave.',
        steps,
        snapshot: snap,
        installHint: portableChromiumInstallHint(),
        isStockChrome: true,
      };
    }
    browser = resolveBrowser({
      engine: 'custom',
      browserExe: installed.installPath,
    });
    steps.push(`Browser sau auto-install: ${browser.label} → ${browser.exe}`);
  }

  steps.push(`Browser: ${browser.label} → ${browser.exe}`);
  if (browser.warning) steps.push(`⚠ ${browser.warning}`);
  if (browser.isStockChrome) {
    steps.push(
      '⚠ Đang dùng Google Chrome (engine=chrome tường minh) — load-extension có thể FAIL.',
    );
  }

  let accountId = opts?.accountId ? String(opts.accountId).trim() : '';
  if (!accountId) {
    const { id, created } = ensureDefaultAccount(
      browser.family === 'firefox' ? 'mullvad' : 'chromium',
    );
    accountId = id;
    steps.push(
      created
        ? `Đã tạo profile mặc định (${id}) — phiên login riêng`
        : `Dùng profile (${id}) — mỗi profile = 1 user-data-dir riêng`,
    );
  } else {
    const exists = loadAccounts().some((a) => a.id === accountId);
    if (!exists) {
      steps.push(
        `accountId=${accountId} chưa có trong store — vẫn mở Chrome profile folder riêng`,
      );
    } else {
      steps.push(
        `Login gắn profile ${accountId} (không dùng profile khác / Chrome cá nhân)`,
      );
    }
  }
  const freshSession = Boolean(opts?.freshSession);
  // Profile mới: luôn sạch session + không inherit email/token cũ
  if (freshSession) {
    updateAccount(accountId, {
      status: 'connecting',
      engine: browser.family === 'firefox' ? 'mullvad' : 'chromium',
      browserExe: browser.exe,
      flowKeyPresent: false,
      sessionVerified: false,
      email: '',
      displayName: '',
      projectId: '',
      credits: null,
      lastError: null,
    });
  } else {
    updateAccount(accountId, {
      status: 'connecting',
      engine: browser.family === 'firefox' ? 'mullvad' : 'chromium',
      browserExe: browser.exe,
    });
  }

  // Bind bridge → THIS profile; fresh = ignore token orphan/global
  try {
    const { setActiveAccountId, beginFreshProfileLogin } = await import(
      './bridgeServer'
    );
    if (freshSession || opts?.forceChrome) {
      beginFreshProfileLogin(accountId);
      steps.push(
        freshSession
          ? `[login] Phiên TRỐNG cho profile ${accountId} — đăng nhập Google MỚI (không account cũ)`
          : `[login] Mở lại browser profile ${accountId}`,
      );
    } else {
      setActiveAccountId(accountId);
    }
  } catch {
    /* ignore */
  }

  // Guide §3: blank wipe khi thêm profile mới; còn lại reuse user-data
  const isolated = freshSession
    ? prepareBlankLoginProfile(accountId, extPath)
    : ensureIsolatedAccountProfile(accountId, extPath);
  const profileDir = isolated.profileDir;
  steps.push(`[2/3] --user-data-dir=${profileDir}`);
  steps.push(`[2/3] --load-extension=${isolated.extDir}`);
  steps.push(`[2/3] account root: ${accountRootDir(accountId)}`);
  if (freshSession && 'wiped' in isolated) {
    steps.push(
      `[2/3] Hồ sơ trống — đã xóa session cũ: ${(isolated as { wiped: string[] }).wiped.join(', ') || '(đã sạch)'}`,
    );
  }
  steps.push(
    `[2/3] Isolation: cookies/session chỉ trong profile ${accountId} (1 profile = 1 trình duyệt)`,
  );

  const loginStartedAt = Date.now();
  let snap = getBridgeSnapshot();
  const accNow = loadAccounts().find((a) => a.id === accountId);
  const accountExtensionConnected = Boolean(
    snap.accounts?.find((account) => account.id === accountId)?.extensionConnected,
  );
  const accountFlowKeyPresent = Boolean(getAccountFlowKey(accountId));
  // Chỉ skip login nếu CHÍNH profile này đã verify email (không tin token global)
  // freshSession / forceChrome: LUÔN mở browser
  if (
    !opts?.forceChrome &&
    !freshSession &&
    accNow &&
    accountExtensionConnected &&
    isFlowLoginReady({
      email: accNow?.email,
      sessionVerified: accNow?.sessionVerified,
      flowKeyPresent: accountFlowKeyPresent,
    })
  ) {
    steps.push(`Session đã verify: ${accNow.email}`);
    return {
      ok: true,
      bridgeRunning: true,
      extensionConnected: true,
      flowKeyPresent: true,
      projectId: accNow.projectId || snap.projectId,
      accountId,
      chromeLaunched: false,
      chromePath: browser.exe,
      extensionPath: extPath,
      profileDir,
      loginRequired: false,
      browserLabel: browser.label,
      isStockChrome: browser.isStockChrome,
      engine: browser.engine,
      message: `OK · ${accNow.email} · ${accNow.credits ?? '—'} cr`,
      steps,
      snapshot: snap,
    };
  }

  // ─── Firefox / Mullvad ───
  if (browser.family === 'firefox') {
    const ff = launchFirefoxFamily({
      exe: browser.exe,
      profileDir,
      extDir: extPath,
      accountId,
    });
    steps.push(...ff.manualSteps);
    snap = getBridgeSnapshot();
    return {
      ok: true,
      bridgeRunning: snap.running,
      extensionConnected: snap.extensionConnected,
      flowKeyPresent: snap.flowKeyPresent,
      projectId: snap.projectId,
      accountId,
      chromeLaunched: ff.launched,
      chromePath: browser.exe,
      extensionPath: extPath,
      profileDir: ff.profileDir,
      loginRequired: !snap.flowKeyPresent,
      browserLabel: browser.label,
      isStockChrome: false,
      engine: browser.engine,
      manualSteps: ff.manualSteps,
      message: ff.manualSteps.join(' '),
      steps,
      snapshot: snap,
    };
  }

  // ─── Chromium family (clean preferred) ───
  const launch = launchChrome({
    chromePath: browser.exe,
    extDir: isolated.extDir,
    profileDir,
    accountId,
    mode: 'login',
    forceClean: true,
    isStockChrome: browser.isStockChrome,
  });
  if (launch.killed > 0) {
    steps.push(
      `Kill ${launch.killed} process chỉ của profile này (không đụng profile khác)`,
    );
  }
  steps.push(
    `[2/3] Browser launched: ${browser.label} · account=${accountId}`,
  );
  steps.push(`[3/3] Chờ extension → ws://127.0.0.1:${FLOW_WS_PORT}`);

  const { isProfileBrowserAlive, reconcileLoginBrowserClosed } =
    await import('./chromeSession');

  /** User closed the window → never open browser again in this bootstrap. */
  const markUserClosed = (why: string) => {
    reconcileLoginBrowserClosed(accountId);
    updateAccount(accountId, {
      status: 'idle',
      flowKeyPresent: false,
      sessionVerified: false,
      lastError: why,
    });
    steps.push(why);
  };

  // Wait extension while browser still open — if user closes window, stop (no 2nd launch)
  let browserClosedByUser = false;
  const waitExtMs = opts?.waitExtensionMs ?? 25_000;
  const extDeadline = Date.now() + waitExtMs;
  let extOk = false;
  while (Date.now() < extDeadline) {
    if (!isProfileBrowserAlive(profileDir) && !isProfileBrowserAlive(launch.profileDir)) {
      browserClosedByUser = true;
      markUserClosed('Browser đã đóng — không mở lại (user hủy đăng nhập)');
      break;
    }
    if (getBridgeSnapshot().extensionConnected) {
      extOk = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 600));
  }

  if (browserClosedByUser) {
    snap = getBridgeSnapshot();
    return {
      ok: false,
      bridgeRunning: snap.running,
      extensionConnected: snap.extensionConnected,
      flowKeyPresent: false,
      projectId: snap.projectId,
      accountId,
      chromeLaunched: true,
      chromePath: browser.exe,
      extensionPath: extPath,
      profileDir: launch.profileDir,
      loginRequired: true,
      browserLabel: browser.label,
      isStockChrome: browser.isStockChrome,
      engine: browser.engine,
      message: 'Đã hủy — browser đóng, không mở thêm cửa sổ',
      steps,
      snapshot: snap,
    };
  }

  if (extOk) {
    steps.push('Extension đã nối bridge — harvest session/token…');
    // Only harvest if browser still alive (don't trigger open-tab paths after close)
    if (isProfileBrowserAlive(launch.profileDir)) {
      try {
        const { commandExtension, syncAccountIdentity } = await import(
          './bridgeServer'
        );
        // allowOpenTab:false — CLI already opened Flow; do not open a 2nd tab mid-login
        await commandExtension(
          'force_token_harvest',
          { allowOpenTab: false, reloadIfMissing: false },
          30_000,
          accountId,
        ).catch(() => undefined);
        // Prefer session poll (email) over waiting only for webRequest Bearer
        const idr = await syncAccountIdentity(accountId);
        if (idr.ok && idr.identity?.email) {
          steps.push(`Session: ${idr.identity.email}`);
        }
      } catch {
        /* race ok */
      }
    }
  } else if (
    isProfileBrowserAlive(launch.profileDir) ||
    isProfileBrowserAlive(profileDir)
  ) {
    // Browser still open but extension slow — KEEP the same window.
    // CẤM forceClean relaunch here: kills login window + spawns a 2nd → user sees
    // "tự mở → mở cái nữa → cái kia tắt" (especially stock Chrome blocking --load-extension).
    if (browser.isStockChrome) {
      steps.push(
        'Extension chưa nối — Google Chrome thường chặn --load-extension. Giữ cửa sổ login hiện tại (không mở browser thứ 2). Ưu tiên Brave / Chromium portable.',
      );
      steps.push(portableChromiumInstallHint());
    } else {
      steps.push(
        'Extension chưa nối — giữ cửa sổ login đang mở, chờ thêm (không kill/relaunch cửa sổ thứ 2)…',
      );
    }
    const retryEnd = Date.now() + 20_000;
    let recoveredOnce = false;
    while (Date.now() < retryEnd) {
      const alive =
        isProfileBrowserAlive(profileDir) ||
        isProfileBrowserAlive(launch.profileDir);
      if (!alive) {
        // Crash only: one recovery launch. User intentional close → mark cancel (no loop).
        if (!recoveredOnce) {
          recoveredOnce = true;
          steps.push(
            'Browser crash giữa chừng — mở lại 1 lần duy nhất (cùng profile)…',
          );
          launchChrome({
            chromePath: browser.exe,
            extDir: isolated.extDir,
            profileDir,
            accountId,
            mode: 'login',
            forceClean: true,
            isStockChrome: browser.isStockChrome,
          });
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        browserClosedByUser = true;
        markUserClosed('Browser đã đóng khi chờ extension — dừng, không mở thêm');
        break;
      }
      if (getBridgeSnapshot().extensionConnected) {
        steps.push('Extension đã nối sau khi chờ thêm (cùng cửa sổ)');
        try {
          const { commandExtension } = await import('./bridgeServer');
          await commandExtension(
            'force_token_harvest',
            { allowOpenTab: false, reloadIfMissing: false },
            30_000,
            accountId,
          );
        } catch {
          /* ignore */
        }
        break;
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    if (
      !browserClosedByUser &&
      !getBridgeSnapshot().extensionConnected
    ) {
      if (browser.isStockChrome) {
        steps.push(
          'Chrome vẫn chưa nạp extension Flow — đừng fallback Chrome. Dùng Brave / «Cài browser gen ảnh».',
        );
        steps.push(portableChromiumInstallHint());
      } else {
        steps.push(
          'Extension vẫn chưa nối — đăng nhập Google trên cửa sổ đang mở nếu còn; app không mở browser mới.',
        );
      }
    }
  } else {
    browserClosedByUser = true;
    markUserClosed('Browser đã đóng trước khi extension nối — không mở lại');
  }

  if (browserClosedByUser) {
    snap = getBridgeSnapshot();
    return {
      ok: false,
      bridgeRunning: snap.running,
      extensionConnected: false,
      flowKeyPresent: false,
      projectId: null,
      accountId,
      chromeLaunched: true,
      chromePath: browser.exe,
      extensionPath: extPath,
      profileDir: launch.profileDir,
      loginRequired: true,
      browserLabel: browser.label,
      isStockChrome: browser.isStockChrome,
      engine: browser.engine,
      message: 'Đã hủy đăng nhập (browser đóng)',
      steps,
      snapshot: snap,
    };
  }

  const waitMs = opts?.waitLoginMs ?? 60_000;
  steps.push(
    freshSession
      ? `Chờ đăng nhập Google MỚI trên hồ sơ trống (tối đa ${Math.round(waitMs / 1000)}s)…`
      : `Chờ token tối đa ${Math.round(waitMs / 1000)}s…`,
  );

  // Poll: chỉ nhận token/email của ĐÚNG profile này, sau khi mở browser
  const endWait = Date.now() + waitMs;
  let gotToken = false;
  let lastSyncAt = 0;
  while (Date.now() < endWait) {
    const accLive = loadAccounts().find((a) => a.id === accountId);
    const snapLive = getBridgeSnapshot();
    let freshOk = false;
    try {
      const { isFreshTokenForAccount } = await import('./bridgeServer');
      freshOk = isFreshTokenForAccount(accountId);
    } catch {
      freshOk = false;
    }

    // Chỉ nhận session của ĐÚNG profile này (token bind / email sau khi mở browser)
    if (freshOk && !gotToken) {
      gotToken = true;
      steps.push(
        'Token mới gắn đúng profile — tiếp tục chờ email Google',
      );
    }
    if (
      accLive &&
      isFlowLoginReady({
        email: accLive.email,
        sessionVerified: accLive.sessionVerified,
        flowKeyPresent: accLive.flowKeyPresent,
        freshTokenPresent: freshOk,
      }) &&
      Number(accLive.updatedAt || 0) >= loginStartedAt - 2000
    ) {
      gotToken = true;
      steps.push(`Session mới: ${accLive.email}`);
      break;
    }
    if (
      !freshSession &&
      accLive &&
      isFlowLoginReady({
        email: accLive.email,
        sessionVerified: accLive.sessionVerified,
        flowKeyPresent: accLive.flowKeyPresent,
        freshTokenPresent: freshOk,
      })
    ) {
      gotToken = true;
      steps.push(`Session: ${accLive.email}`);
      break;
    }
    // CẤM: tin flowKeyPresent global của profile khác
    if (
      !isProfileBrowserAlive(profileDir) &&
      !isProfileBrowserAlive(launch.profileDir)
    ) {
      browserClosedByUser = true;
      markUserClosed('Browser đã đóng — dừng chờ, không mở lại');
      break;
    }
    // Poll every 5s: prefer tab session, avoid spam-opening tabs
    if (Date.now() - lastSyncAt > 5000) {
      lastSyncAt = Date.now();
      try {
        const { syncAccountIdentity, commandExtension, isFreshTokenForAccount } =
          await import('./bridgeServer');
        // Chỉ harvest/sync khi extension CỦA profile này đã nối
        const extHere = Boolean(
          snapLive.accounts?.find((a) => a.id === accountId)?.extensionConnected,
        );
        if (extHere || snapLive.extensionConnected) {
          const idr = await syncAccountIdentity(accountId);
          if (idr.identity?.email) {
            const again = loadAccounts().find((a) => a.id === accountId);
            if (
              again &&
              isFlowLoginReady({
                email: again.email,
                sessionVerified: again.sessionVerified,
                flowKeyPresent: again.flowKeyPresent,
                freshTokenPresent: isFreshTokenForAccount(accountId),
              })
            ) {
              gotToken = true;
              steps.push(`Nhận session: ${idr.identity.email}`);
              break;
            }
          }
          if (!isFreshTokenForAccount(accountId)) {
            // Poll-only harvest — never open/reload a new Flow tab while user logs in
            await commandExtension(
              'force_token_harvest',
              { allowOpenTab: false, reloadIfMissing: false },
              12_000,
              accountId,
            ).catch(() => undefined);
          }
        }
      } catch {
        /* ignore */
      }
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  snap = getBridgeSnapshot();
  const accFinal = loadAccounts().find((a) => a.id === accountId);
  let freshOkFinal = false;
  try {
    const { isFreshTokenForAccount } = await import('./bridgeServer');
    freshOkFinal = isFreshTokenForAccount(accountId);
  } catch {
    /* ignore */
  }
  const verified = Boolean(
    accFinal &&
      isFlowLoginReady({
        email: accFinal.email,
        sessionVerified: accFinal.sessionVerified,
        flowKeyPresent: accFinal.flowKeyPresent,
        freshTokenPresent: freshOkFinal,
      }),
  );

  // Persist a newly captured Bearer as partial state, but never call it a
  // verified Google login until the same profile also has an email session.
  if (gotToken && accFinal && !accFinal.flowKeyPresent) {
    const hasEmail = Boolean(
      accFinal.email && String(accFinal.email).includes('@'),
    );
    updateAccount(accountId, {
      status: hasEmail ? 'active' : 'connecting',
      flowKeyPresent: true,
      sessionVerified: hasEmail && Boolean(accFinal.sessionVerified),
      lastError: hasEmail
        ? null
        : 'Có token nhưng chưa đăng nhập Google (thiếu email) — hoàn tất login trên cửa sổ đang mở',
    });
  }

  if (verified) {
    steps.push('Đã nhận token/session');
    // Close login UI; background only after verified (not if user aborted)
    try {
      if (getChromeSessionInfo(accountId).loginOpen) {
        const { closeLoginSessionAfterCapture } = await import('./chromeSession');
        const r = await closeLoginSessionAfterCapture({
          delayMs: 800,
          accountId,
          keepBackground: true,
        });
        steps.push(r.message);
      }
    } catch (e) {
      steps.push(
        `Đóng login: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    // FULL inherit: cookies/cache stay in user-data-dir; app binds
    // email + credits + projects + Bearer for this profile only
    try {
      const { inheritAccountSession } = await import('./bridgeServer');
      const inh = await inheritAccountSession(accountId);
      steps.push('── Thừa hưởng session browser → profile app ──');
      if (inh.steps?.length) steps.push(...inh.steps);
      if (inh.ok) {
        steps.push(
          `✓ Inherit OK: ${inh.account?.email || 'token'} · projects=${inh.account?.projects?.length || 0} · cr=${inh.account?.credits ?? 'n/a'}`,
        );
      } else if (inh.error) {
        steps.push(`Inherit partial: ${inh.error}`);
      }
    } catch (e) {
      steps.push(
        `Inherit: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    await waitFor(() => getBridgeSnapshot().extensionConnected, 15_000);
    snap = getBridgeSnapshot();
  } else if (gotToken) {
    steps.push(
      'Đã có token nhưng chưa có email Google — giữ cửa sổ login mở',
    );
    updateAccount(accountId, {
      status: 'connecting',
      flowKeyPresent: true,
      sessionVerified: false,
      lastError:
        'Có token nhưng chưa đăng nhập Google (thiếu email) — hoàn tất login trên cửa sổ đang mở',
    });
  } else if (browserClosedByUser) {
    steps.push('Người dùng đã đóng trình duyệt');
  } else {
    steps.push(
      snap.extensionConnected
        ? 'Chưa xác minh email session — đăng nhập Google trên browser app'
        : browser.isStockChrome
          ? 'Chrome chặn extension. Cài Ungoogled portable'
          : 'Chưa token — đăng nhập Google trên cửa sổ browser app',
    );
    updateAccount(accountId, {
      status: 'idle',
      flowKeyPresent: false,
      sessionVerified: false,
      lastError: 'Timeout đăng nhập / chưa có email session',
    });
  }

  snap = getBridgeSnapshot();
  const accReady = loadAccounts().find((a) => a.id === accountId);
  const ready = Boolean(
    snap.extensionConnected &&
      snap.flowKeyPresent &&
      snap.activeAccountId === accountId &&
      accReady &&
      isFlowLoginReady({
        email: accReady.email,
        sessionVerified: accReady.sessionVerified,
        flowKeyPresent: accReady.flowKeyPresent,
        freshTokenPresent: snap.flowKeyPresent,
      }),
  );
  return {
    ok: ready,
    bridgeRunning: snap.running || launch.launched,
    extensionConnected: snap.extensionConnected,
    flowKeyPresent: ready,
    projectId: accReady?.projectId || snap.projectId,
    accountId,
    chromeLaunched: launch.launched,
    chromePath: browser.exe,
    extensionPath: extPath,
    profileDir,
    loginRequired: !ready,
    browserLabel: browser.label,
    isStockChrome: browser.isStockChrome,
    engine: browser.engine,
    message: ready
      ? `OK · ${accReady?.email} · ${accReady?.credits ?? '—'} cr`
      : browserClosedByUser
        ? 'Browser đã đóng — chưa hoàn tất đăng nhập'
        : snap.extensionConnected
          ? 'Extension đã nối — CHƯA có email Google. Đăng nhập TRONG cửa sổ browser app (Media Config → Đăng nhập). Không dùng Chrome cá nhân.'
          : browser.isStockChrome
            ? 'Chrome không nạp extension. Cài Ungoogled vào tools/browsers/ungoogled-chromium/'
            : 'Đã mở browser. Đăng nhập Google trên cửa sổ này.',
    steps,
    snapshot: snap,
    installHint: browser.isStockChrome || !snap.extensionConnected
      ? portableChromiumInstallHint()
      : undefined,
  };
}

export function getBrowserCatalog() {
  return {
    detected: listDetectedBrowsers(),
    installHint: portableChromiumInstallHint(),
  };
}
