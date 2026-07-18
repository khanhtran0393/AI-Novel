/**
 * Client preflight before Flow image/video gen.
 * Always: check status → toast → auto bootstrap browser if offline → clear wait/login message.
 * Never silent-fail on first gen.
 */
'use client';

import { API } from '@/contracts';
import { toast } from '@/lib/toastBus';

export type FlowSessionSnapshot = {
  running?: boolean;
  extensionConnected?: boolean;
  flowKeyPresent?: boolean;
  loginSessionOpen?: boolean;
  activeAccountId?: string | null;
  error?: string;
  accounts?: Array<{
    flowKeyPresent?: boolean;
    sessionVerified?: boolean;
    email?: string;
  }>;
};

export type FlowPreflightResult = {
  ok: boolean;
  flowKeyPresent: boolean;
  extensionConnected: boolean;
  loginRequired: boolean;
  chromeLaunched?: boolean;
  message: string;
  steps?: string[];
};

export type EnsureFlowOpts = {
  /** Show toast steps (default true) */
  notify?: boolean;
  /** Label for toasts */
  kind?: 'image' | 'video' | 'flow';
  /** Force open browser even if status looks green-but-stale */
  forceBrowser?: boolean;
};

function kindLabel(kind: EnsureFlowOpts['kind']): string {
  if (kind === 'video') return 'Gen video';
  if (kind === 'image') return 'Gen ảnh';
  return 'Flow';
}

async function fetchFlowStatus(): Promise<FlowSessionSnapshot> {
  const res = await fetch(API.flowStatus, { cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as FlowSessionSnapshot;
  if (!res.ok) {
    throw new Error(
      data.error ||
        `Không đọc được trạng thái Flow (HTTP ${res.status}). Kiểm tra app/server đang chạy.`,
    );
  }
  return data;
}

function hasLoggedInProfile(st: FlowSessionSnapshot): boolean {
  const accounts = Array.isArray(st.accounts) ? st.accounts : [];
  if (
    accounts.some(
      (a) =>
        a.flowKeyPresent &&
        a.sessionVerified &&
        a.email &&
        String(a.email).includes('@'),
    )
  ) {
    return true;
  }
  // Snapshot without accounts[] — only trust both flags if caller already verified
  return false;
}

function isSessionReady(st: FlowSessionSnapshot): boolean {
  // Extension + token + real Google login (email). Token stale ≠ ready.
  return Boolean(
    st.extensionConnected && st.flowKeyPresent && hasLoggedInProfile(st),
  );
}

/**
 * Preflight Flow trước gen ảnh/video.
 * - Lần đầu / extension offline → POST bootstrap + mở browser
 * - Toast từng bước + lỗi login rõ ràng
 */
export async function ensureFlowSessionReady(
  opts: EnsureFlowOpts = {},
): Promise<FlowPreflightResult> {
  const notify = opts.notify !== false;
  const label = kindLabel(opts.kind || 'flow');

  if (notify) {
    toast.info(label, 'Đang kiểm tra trạng thái Flow (bridge + extension)…');
  }

  let st: FlowSessionSnapshot;
  try {
    st = await fetchFlowStatus();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (notify) toast.error(label, msg);
    throw new Error(msg);
  }

  if (isSessionReady(st) && !opts.forceBrowser) {
    // Đã sẵn sàng — im lặng (không spam toast mỗi lần gen)
    return {
      ok: true,
      flowKeyPresent: true,
      extensionConnected: true,
      loginRequired: false,
      message: 'Flow session ready',
    };
  }

  const needBrowser =
    opts.forceBrowser ||
    !st.extensionConnected ||
    !st.flowKeyPresent;

  if (notify) {
    if (!st.extensionConnected) {
      toast.info(
        label,
        'Extension chưa nối — đang mở browser Chromium + load extension…',
      );
    } else if (!st.flowKeyPresent) {
      toast.info(
        label,
        'Chưa có Bearer token — đang mở/làm mới tab Flow để harvest…',
      );
    } else {
      toast.info(label, 'Đang bootstrap lại phiên Flow…');
    }
  }

  const bootRes = await fetch(API.flowBootstrap, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      forceChrome: needBrowser,
      engine: 'auto',
      waitExtensionMs: 40_000,
      waitLoginMs: 25_000,
    }),
  });

  const data = (await bootRes.json().catch(() => ({}))) as FlowPreflightResult & {
    ok?: boolean;
    error?: string;
    snapshot?: FlowSessionSnapshot;
  };

  // Re-read live status (bootstrap body may lag daemon)
  let after: FlowSessionSnapshot = data.snapshot || {};
  try {
    after = await fetchFlowStatus();
  } catch {
    /* keep bootstrap snapshot */
  }

  const flowKeyPresent = Boolean(
    after.flowKeyPresent ?? data.flowKeyPresent ?? data.snapshot?.flowKeyPresent,
  );
  const extensionConnected = Boolean(
    after.extensionConnected ??
      data.extensionConnected ??
      data.snapshot?.extensionConnected,
  );
  const loginRequired =
    Boolean(data.loginRequired) || (extensionConnected && !flowKeyPresent);

  if (isSessionReady(after) || (flowKeyPresent && extensionConnected)) {
    if (notify) {
      toast.success(label, 'Flow đã sẵn sàng — bắt đầu gen…');
    }
    return {
      ok: true,
      flowKeyPresent: true,
      extensionConnected: true,
      loginRequired: false,
      chromeLaunched: data.chromeLaunched,
      message: data.message || 'OK',
      steps: data.steps,
    };
  }

  // Token without Google email (stale paint) — force re-login
  if (flowKeyPresent && !hasLoggedInProfile(after) && !hasLoggedInProfile(data.snapshot || {})) {
    const msg =
      'Profile có token nhưng chưa đăng nhập Google (thiếu email). Mở Ảnh/Video → bấm Đăng nhập trên card trình duyệt, đăng nhập Google, đợi badge «sẵn sàng» + email hiện ra.';
    if (notify) toast.warn(label, msg);
    throw new Error(`[Flow] ${msg}`);
  }

  // Partial: browser opened but user must login
  if (extensionConnected && !flowKeyPresent) {
    const msg =
      data.message ||
      'Browser/extension đã mở nhưng chưa có token. Đăng nhập Google trên cửa sổ Flow của app, đợi token xanh, rồi gen lại.';
    if (notify) {
      toast.warn(label, msg);
    }
    throw new Error(`[Flow] ${msg}`);
  }

  if (!extensionConnected) {
    const msg =
      data.message ||
      data.error ||
      'Không kết nối được extension. Kiểm tra Chromium portable + Ảnh/Video → Engine Auto → Đăng nhập.';
    if (notify) {
      toast.error(label, msg);
    }
    throw new Error(`[Flow] ${msg}`);
  }

  const failMsg =
    data.message ||
    data.error ||
    'Flow chưa sẵn sàng. Ảnh/Video → Engine Auto → Đăng nhập Google trên browser profile app.';
  if (notify) toast.error(label, failMsg);
  throw new Error(`[Flow] ${failMsg}`);
}
