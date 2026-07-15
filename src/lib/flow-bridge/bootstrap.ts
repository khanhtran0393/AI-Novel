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
import { ensureBridgeStarted, getBridgeSnapshot } from './bridgeServer';
import {
  getChromeSessionInfo,
  launchChrome,
  launchFirefoxFamily,
  profileDirForAccount,
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
}): Promise<BootstrapResult> {
  const steps: string[] = [];
  const extPath = extensionDir();

  await ensureBridgeStarted();
  steps.push(`Bridge HTTP :${FLOW_HTTP_PORT} + WS :${FLOW_WS_PORT} đã bật`);
  steps.push(
    'Chiến thuật FlowAgent: ưu tiên Chromium sạch (Ungoogled/Brave) — không CDP',
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

  let browser;
  try {
    browser = resolveBrowser({
      engine: opts?.engine || 'auto',
      browserExe: opts?.browserExe,
    });
  } catch (e) {
    const snap = getBridgeSnapshot();
    const hint = portableChromiumInstallHint();
    steps.push(String(e instanceof Error ? e.message : e));
    steps.push(hint);
    return {
      ok: false,
      bridgeRunning: snap.running,
      extensionConnected: false,
      flowKeyPresent: false,
      chromeLaunched: false,
      extensionPath: extPath,
      loginRequired: true,
      message: e instanceof Error ? e.message : String(e),
      steps,
      snapshot: snap,
      installHint: hint,
    };
  }

  steps.push(`Browser: ${browser.label} → ${browser.exe}`);
  if (browser.warning) steps.push(`⚠ ${browser.warning}`);
  if (browser.isStockChrome) {
    steps.push(
      '⚠ Đang dùng Google Chrome — load-extension thường FAIL. Cài portable Ungoogled vào tools/browsers/ungoogled-chromium/',
    );
  }

  let accountId = opts?.accountId || '';
  if (!accountId) {
    const { id, created } = ensureDefaultAccount(
      browser.family === 'firefox' ? 'mullvad' : 'chromium',
    );
    accountId = id;
    steps.push(
      created ? `Đã tạo profile mặc định (${id})` : `Dùng profile có sẵn (${id})`,
    );
  }
  updateAccount(accountId, {
    status: 'connecting',
    engine: browser.family === 'firefox' ? 'mullvad' : 'chromium',
    browserExe: browser.exe,
  });

  const profileDir = profileDirForAccount(accountId);
  let snap = getBridgeSnapshot();

  if (snap.extensionConnected && snap.flowKeyPresent && !opts?.forceChrome) {
    updateAccount(accountId, {
      status: 'active',
      flowKeyPresent: true,
      projectId: snap.projectId || '',
    });
    steps.push('Token + extension sẵn sàng — không mở đăng nhập');
    return {
      ok: true,
      bridgeRunning: true,
      extensionConnected: true,
      flowKeyPresent: true,
      projectId: snap.projectId,
      accountId,
      chromeLaunched: false,
      chromePath: browser.exe,
      extensionPath: extPath,
      profileDir,
      loginRequired: false,
      browserLabel: browser.label,
      isStockChrome: browser.isStockChrome,
      engine: browser.engine,
      message: 'Flow sẵn sàng. Không cần đăng nhập lại.',
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
    extDir: extPath,
    profileDir,
    accountId,
    mode: 'login',
    forceClean: true,
    isStockChrome: browser.isStockChrome,
  });
  if (launch.killed > 0) {
    steps.push(`Đã reset profile browser (kill ${launch.killed}) để nạp extension`);
  }
  steps.push(
    browser.isStockChrome
      ? 'Đã mở Chrome — nếu extension không nối, chuyển sang Ungoogled/Brave'
      : `Đã mở ${browser.label} + --load-extension (Chromium sạch)`,
  );
  steps.push('Đăng nhập Google trên tab Flow nếu cần; token xong → tự đóng cửa sổ');

  const extOk = await waitFor(
    () => getBridgeSnapshot().extensionConnected,
    opts?.waitExtensionMs ?? 25_000,
  );
  if (extOk) {
    steps.push('Extension đã nối bridge — harvest token…');
    try {
      const { commandExtension } = await import('./bridgeServer');
      await commandExtension('force_token_harvest', {}, 30_000);
    } catch {
      /* race ok */
    }
  } else {
    steps.push('⚠ Extension chưa nối sau lần mở đầu — thử lại 1 lần…');
    launchChrome({
      chromePath: browser.exe,
      extDir: extPath,
      profileDir,
      accountId,
      mode: 'login',
      forceClean: true,
      isStockChrome: browser.isStockChrome,
    });
    await waitFor(() => getBridgeSnapshot().extensionConnected, 20_000);
    if (getBridgeSnapshot().extensionConnected) {
      steps.push('Extension đã nối sau lần 2');
      try {
        const { commandExtension } = await import('./bridgeServer');
        await commandExtension('force_token_harvest', {}, 30_000);
      } catch {
        /* ignore */
      }
    } else if (browser.isStockChrome) {
      steps.push(portableChromiumInstallHint());
    } else {
      steps.push(
        'Vẫn chưa thấy extension. Kiểm tra chrome.exe portable / tắt antivirus chặn extension.',
      );
    }
  }

  const waitMs = opts?.waitLoginMs ?? 60_000;
  steps.push(`Chờ token tối đa ${Math.round(waitMs / 1000)}s…`);
  const gotToken = await waitFor(
    () => Boolean(getBridgeSnapshot().flowKeyPresent),
    waitMs,
  );
  await waitFor(
    () => !getChromeSessionInfo().loginOpen || gotToken,
    8000,
    400,
  );

  snap = getBridgeSnapshot();
  if (gotToken || snap.flowKeyPresent) {
    steps.push('Đã nhận Bearer token — đóng phiên đăng nhập');
    updateAccount(accountId, {
      status: 'active',
      flowKeyPresent: true,
      projectId: snap.projectId || '',
    });
    await waitFor(() => getBridgeSnapshot().extensionConnected, 15_000);
    snap = getBridgeSnapshot();
  } else {
    steps.push(
      snap.extensionConnected
        ? 'Extension đã nối — đăng nhập Google / reload tab Flow để phát sinh token'
        : browser.isStockChrome
          ? 'Chrome chặn extension. Cài Ungoogled portable → tools/browsers/ungoogled-chromium/'
          : 'Chưa token — đăng nhập Google trên cửa sổ browser app vừa mở',
    );
    updateAccount(accountId, { status: 'connecting' });
  }

  const ready = Boolean(snap.flowKeyPresent) || launch.launched;
  return {
    ok: ready,
    bridgeRunning: snap.running || launch.launched,
    extensionConnected: snap.extensionConnected,
    flowKeyPresent: snap.flowKeyPresent,
    projectId: snap.projectId,
    accountId,
    chromeLaunched: launch.launched,
    chromePath: browser.exe,
    extensionPath: extPath,
    profileDir,
    loginRequired: !snap.flowKeyPresent,
    browserLabel: browser.label,
    isStockChrome: browser.isStockChrome,
    engine: browser.engine,
    message: snap.flowKeyPresent
      ? 'Đăng nhập xong — Flow sẵn sàng gen.'
      : snap.extensionConnected
        ? 'Extension đã nối — hoàn tất login Google nếu token chưa xanh.'
        : browser.isStockChrome
          ? 'Chrome không nạp extension. Dùng Ungoogled Chromium portable (xem tools/browsers/README.md).'
          : 'Đã mở browser sạch. Đăng nhập Google; khi có token cửa sổ tự đóng.',
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
