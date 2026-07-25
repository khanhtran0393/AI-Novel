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
    id?: string;
    extensionConnected?: boolean;
    flowKeyPresent?: boolean;
    sessionVerified?: boolean;
    email?: string;
    status?: string;
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

function activeAccount(st: FlowSessionSnapshot) {
  const accounts = Array.isArray(st.accounts) ? st.accounts : [];
  return accounts.find((a) => a.id === st.activeAccountId) || accounts[0];
}

function hasLoggedInProfile(st: FlowSessionSnapshot): boolean {
  const active = activeAccount(st);
  return Boolean(
    active?.flowKeyPresent &&
      active.sessionVerified &&
      active.email &&
      String(active.email).includes('@'),
  );
}

/** Token/key paint without real Google email — must re-login. */
function hasStaleTokenNoEmail(st: FlowSessionSnapshot): boolean {
  const active = activeAccount(st);
  if (!active) return false;
  const hasKey = Boolean(active.flowKeyPresent || st.flowKeyPresent);
  const hasEmail = Boolean(active.email && String(active.email).includes('@'));
  return hasKey && !hasEmail;
}

function isSessionReady(st: FlowSessionSnapshot): boolean {
  // Extension + token + real Google login (email). Token stale ≠ ready.
  const active = activeAccount(st);
  return Boolean(active?.extensionConnected && hasLoggedInProfile(st));
}

const LOGIN_GUIDE =
  'Extension đã nối nhưng CHƯA đăng nhập Google trong trình duyệt CỦA APP.\n' +
  '① Mở Media Config (Ảnh/Video)\n' +
  '② Card profile → bấm «Đăng nhập»\n' +
  '③ Đăng nhập Google TRONG cửa sổ app mở ra (không dùng Chrome cá nhân)\n' +
  '④ Đợi email hiện trên card + badge sẵn sàng → gen lại';

/**
 * Preflight Flow trước gen ảnh/video.
 * - Lần đầu / extension offline → POST bootstrap + mở browser
 * - Chờ login đủ lâu để user kịp OAuth
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

  const staleKey = hasStaleTokenNoEmail(st);
  const needBrowser = opts.forceBrowser || !isSessionReady(st) || staleKey;

  if (notify) {
    if (!st.extensionConnected) {
      toast.info(
        label,
        'Extension chưa nối — đang mở browser Chromium + load extension…',
      );
    } else if (staleKey || !hasLoggedInProfile(st)) {
      toast.info(
        label,
        'Chưa đăng nhập Google trên browser app — đang mở cửa sổ đăng nhập (chờ ~2 phút)…',
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

  // Login OAuth needs far more than 25s — Media Config uses 180s
  const waitLoginMs = needBrowser ? 120_000 : 40_000;

  const bootRes = await fetch(API.flowBootstrap, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      forceChrome: needBrowser,
      accountId: st.activeAccountId || undefined,
      engine: 'auto',
      waitExtensionMs: 40_000,
      waitLoginMs,
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

  if (isSessionReady(after)) {
    if (notify) {
      const email = activeAccount(after)?.email || '';
      toast.success(
        label,
        email
          ? `Flow sẵn sàng (${email}) — bắt đầu gen…`
          : 'Flow đã sẵn sàng — bắt đầu gen…',
      );
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

  // Token/key without Google email — must login in app browser
  if (
    hasStaleTokenNoEmail(after) ||
    (flowKeyPresent && !hasLoggedInProfile(after))
  ) {
    const msg = LOGIN_GUIDE;
    if (notify) toast.warn(label, msg.replace(/\n/g, ' · '));
    throw new Error(`[Flow] ${msg.replace(/\n/g, ' ')}`);
  }

  // Extension up, no token — browser must show Google login
  if (extensionConnected && !flowKeyPresent) {
    const msg =
      data.message && !/Extension đã nối/.test(data.message)
        ? data.message
        : LOGIN_GUIDE;
    if (notify) {
      toast.warn(label, msg.replace(/\n/g, ' · '));
    }
    throw new Error(`[Flow] ${msg.replace(/\n/g, ' ')}`);
  }

  if (!extensionConnected) {
    const msg =
      data.message ||
      data.error ||
      'Không kết nối được extension. Media Config → Engine Auto → Đăng nhập (Chromium portable của app).';
    if (notify) {
      toast.error(label, msg);
    }
    throw new Error(`[Flow] ${msg}`);
  }

  const failMsg =
    data.message ||
    data.error ||
    LOGIN_GUIDE;
  if (notify) toast.error(label, failMsg.replace(/\n/g, ' · '));
  throw new Error(`[Flow] ${failMsg.replace(/\n/g, ' ')}`);
}
