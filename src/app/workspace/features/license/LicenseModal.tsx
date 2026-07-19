'use client';

/**
 * Bản quyền / License modal — UI theo mẫu kích hoạt (gói + QR + paste key).
 * Mở từ logo header (tab license), không nằm trong Cài đặt.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Copy,
  Maximize2,
  Rocket,
  Shield,
  X,
} from 'lucide-react';
import { API } from '@/contracts';
import { toast } from '@/lib/toastBus';
import { useNovelStore } from '@/store/useNovelStore';
import { buildClientApiHeaders } from '../../modules/apiClient';
import {
  PAID_PLANS,
  SELLER_BANK,
  STATIC_QR_FALLBACK,
  buildTransferContent,
  buildVietQrImageUrl,
  formatVnd,
  type PaidPlanId,
} from '@/lib/commercial/pricingPlans';

const ENTITLEMENT_LS_KEY = 'ainovel.entitlementToken';

type Props = {
  open: boolean;
  onClose: () => void;
};

function readStoredToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return (
      window.localStorage.getItem(ENTITLEMENT_LS_KEY) ||
      window.sessionStorage.getItem(ENTITLEMENT_LS_KEY) ||
      ''
    );
  } catch {
    return '';
  }
}

function writeStoredToken(token: string) {
  try {
    if (token.trim()) {
      window.localStorage.setItem(ENTITLEMENT_LS_KEY, token.trim());
    } else {
      window.localStorage.removeItem(ENTITLEMENT_LS_KEY);
    }
  } catch {
    /* ignore */
  }
}

export default function LicenseModal({ open, onClose }: Props) {
  const setVipStatus = useNovelStore((s) => s.setVipStatus);
  const setCredits = useNovelStore((s) => s.setCredits);
  const isPro = useNovelStore((s) => s.is_pro);
  const isVip = useNovelStore((s) => s.is_vip);
  const isTrial = useNovelStore((s) => s.is_trial);

  const [mounted, setMounted] = useState(false);
  const [planId, setPlanId] = useState<PaidPlanId>('lifetime');
  const [hwid, setHwid] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [copiedHwid, setCopiedHwid] = useState(false);
  const [copiedContent, setCopiedContent] = useState(false);
  const [qrBroken, setQrBroken] = useState(false);
  const [qrFullscreen, setQrFullscreen] = useState(false);
  const [tier, setTier] = useState('free');
  const [trialDaysLabel, setTrialDaysLabel] = useState(3);
  const [cloudNote, setCloudNote] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  const selected = useMemo(
    () => PAID_PLANS.find((p) => p.id === planId) || PAID_PLANS[2],
    [planId],
  );

  const transferContent = useMemo(
    () => buildTransferContent(planId, hwid || '…………'),
    [planId, hwid],
  );

  const qrUrl = useMemo(() => {
    if (!hwid) return STATIC_QR_FALLBACK;
    return buildVietQrImageUrl(planId, hwid);
  }, [planId, hwid]);

  const applyClaims = useCallback(
    (
      claims: {
        is_pro?: boolean;
        is_vip?: boolean;
        is_trial?: boolean;
        plan?: string;
      } | null | undefined,
    ) => {
      if (!claims) {
        setVipStatus(false, false, false);
        setCredits(100);
        return;
      }
      const trial = !!claims.is_trial || claims.plan === 'trial';
      if (trial) {
        setVipStatus(false, true, true);
        setCredits(50_000);
        return;
      }
      // Paid Pro (legacy VIP tokens → Pro badge)
      if (claims.is_pro || claims.is_vip || claims.plan === 'pro' || claims.plan === 'vip') {
        setVipStatus(false, true, false);
        setCredits(999_999_999);
        return;
      }
      setVipStatus(false, false, false);
      setCredits(100);
    },
    [setVipStatus, setCredits],
  );

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(API.commercialStatus, {
        method: 'GET',
        headers: buildClientApiHeaders(),
        cache: 'no-store',
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        tier?: string;
        openMode?: boolean;
        ownerUnlimited?: boolean;
        tokenValid?: boolean;
        trial?: { active?: boolean; days?: number };
        claims?: {
          is_pro?: boolean;
          is_vip?: boolean;
          is_trial?: boolean;
          plan?: string;
        };
        entitlement?: { hwid?: string };
        supabase?: { adminConfigured?: boolean; configured?: boolean };
        model?: { cloud?: boolean };
        cloudRevoked?: boolean;
      };
      const id = (data.entitlement?.hwid || '').toUpperCase();
      if (id) setHwid(id);
      setTier(data.tier || 'free');
      if (typeof data.trial?.days === 'number' && data.trial.days > 0) {
        setTrialDaysLabel(data.trial.days);
      }
      if (data.cloudRevoked) {
        setCloudNote('License cloud đã revoke/hết hạn — về Free.');
        writeStoredToken('');
      } else if (data.supabase?.adminConfigured) {
        setCloudNote('Cloud Supabase: bật (order + revoke online).');
      } else if (data.supabase?.configured) {
        setCloudNote('Supabase URL/anon có — thiếu SERVICE_ROLE (admin).');
      } else {
        setCloudNote('Chế độ local (Zalo + key) — chưa cấu hình Supabase.');
      }
      if (data.ownerUnlimited) {
        setVipStatus(false, true, false);
        setCredits(999_999_999);
      } else if (data.tier === 'pro' && data.tokenValid && data.claims) {
        applyClaims(data.claims);
      } else if (data.tier === 'trial' || data.trial?.active) {
        if (
          data.tokenValid &&
          data.claims &&
          !data.claims.is_trial &&
          data.claims.plan !== 'trial' &&
          (data.claims.is_pro || data.claims.is_vip)
        ) {
          applyClaims(data.claims);
        } else {
          setVipStatus(false, true, true);
          setCredits(50_000);
        }
      } else if (data.tokenValid && data.claims) {
        applyClaims(data.claims);
      } else if (!data.tokenValid) {
        setVipStatus(false, false, false);
        setCredits(100);
      }
      if (!keyDraft) {
        const t = readStoredToken();
        if (t) setKeyDraft(t);
      }
      setQrBroken(false);
    } catch (e) {
      toast.error(
        'Bản quyền',
        e instanceof Error ? e.message : 'Không đọc được HWID / trạng thái',
      );
    } finally {
      setBusy(false);
    }
  }, [applyClaims, keyDraft, setCredits, setVipStatus]);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) {
      setQrFullscreen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (qrFullscreen) {
          setQrFullscreen(false);
          e.stopPropagation();
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, qrFullscreen]);

  const copyText = async (text: string, kind: 'hwid' | 'content') => {
    try {
      await navigator.clipboard.writeText(text);
      if (kind === 'hwid') {
        setCopiedHwid(true);
        setTimeout(() => setCopiedHwid(false), 1500);
        toast.success('Đã copy mã thiết bị', text);
      } else {
        setCopiedContent(true);
        setTimeout(() => setCopiedContent(false), 1500);
        toast.success('Đã copy nội dung CK', text);
      }
    } catch {
      toast.error('Clipboard', 'Không copy được — chọn và Ctrl+C thủ công.');
    }
  };

  /** Rút token/mã từ tin Telegram (tránh dán cả đoạn «ĐÃ CẤP KEY»). */
  const extractLicensePaste = (
    raw: string,
  ): { code?: string; token?: string; error?: string } => {
    // Telegram wraps long tokens with newlines — strip whitespace inside credential
    const s = raw.trim();
    if (!s) return {};
    const compact = s.replace(/\s+/g, '');
    const tokenHit = compact.match(
      /AINOVEL2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    );
    if (tokenHit) return { token: tokenHit[0] };
    const codeHit = s.toUpperCase().match(/\bAINOVEL-[A-Z0-9]+(?:-[A-Z0-9]+){1,4}\b/);
    if (codeHit) return { code: codeHit[0] };
    if (compact.startsWith('AINOVEL2.')) return { token: compact };
    if (s.toUpperCase().startsWith('AINOVEL-')) {
      return { code: s.toUpperCase().split(/\s+/)[0] };
    }
    // Legacy HMAC paste: eyJ….sig (~43 chars) — never valid on Ed25519 app
    const hmacParts = compact.split('.');
    if (
      hmacParts.length === 2 &&
      hmacParts[0].startsWith('eyJ') &&
      hmacParts[1].length >= 40 &&
      hmacParts[1].length <= 50
    ) {
      return {
        error:
          'Key HMAC cũ (bắt đầu eyJ…, không có AINOVEL2.). Admin cần redeploy Telegram bridge + Cấp Key lại — key đúng bắt đầu bằng AINOVEL2.',
      };
    }
    if (compact.startsWith('eyJ')) {
      return {
        error:
          'Key thiếu tiền tố AINOVEL2.<kid>. — copy trọn 1 dòng từ Telegram (không chỉ đoạn eyJ…).',
      };
    }
    return {
      error:
        'Không tìm thấy key. Copy đúng dòng AINOVEL2.… hoặc mã AINOVEL-XXXX, không dán cả tin nhắn.',
    };
  };

  const handleActivate = async () => {
    const raw = keyDraft.trim();
    if (!raw) {
      toast.warn('Bản quyền', 'Dán License Key (AINOVEL2.…) hoặc mã AINOVEL-… từ Telegram/Admin.');
      return;
    }
    setBusy(true);
    try {
      const extracted = extractLicensePaste(raw);
      if (extracted.error) {
        throw new Error(extracted.error);
      }
      if (!extracted.code && !extracted.token) {
        throw new Error(
          'Không tìm thấy key. Copy đúng dòng AINOVEL2.… (token) hoặc AINOVEL-XXXX (mã), không dán cả tin nhắn.',
        );
      }
      const res = await fetch(API.entitlementActivate, {
        method: 'POST',
        headers: buildClientApiHeaders(),
        body: JSON.stringify(
          extracted.code
            ? { code: extracted.code, hwid }
            : { token: extracted.token, hwid },
        ),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        token?: string;
        claims?: {
          is_pro?: boolean;
          is_vip?: boolean;
          is_trial?: boolean;
          plan?: string;
        };
      };
      if (!res.ok || !data.ok) {
        throw new Error(
          data.error || data.message || 'Key không hợp lệ trên máy này.',
        );
      }
      const token = data.token || extracted.token || raw;
      if (!data.claims || (!data.claims.is_pro && !data.claims.is_vip && !data.claims.is_trial)) {
        throw new Error(
          'Server chấp nhận key nhưng không trả quyền Pro. Thử lại hoặc báo admin kiểm tra Supabase / cặp key ký.',
        );
      }
      writeStoredToken(token);
      setKeyDraft(token);
      applyClaims(data.claims);
      toast.success('Kích hoạt thành công', 'Pro đã bật trên máy này');
      await refresh();
    } catch (e) {
      toast.error('Kích hoạt thất bại', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleStartTrial = async () => {
    setBusy(true);
    try {
      // Prefer cloud trial (Supabase) → fallback local entitlement trial
      let res = await fetch(API.cloudLicenseTrial, {
        method: 'POST',
        headers: buildClientApiHeaders(),
        body: JSON.stringify({ hwid }),
      });
      let data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        token?: string;
        cloud?: boolean;
        status?: { active?: boolean };
      };

      if (!res.ok || !data.ok) {
        res = await fetch(API.entitlementTrial, {
          method: 'POST',
          headers: buildClientApiHeaders(),
          body: JSON.stringify({ hwid }),
        });
        data = (await res.json().catch(() => ({}))) as typeof data;
      }

      if (!res.ok || !data.ok) throw new Error(data.error || 'Trial thất bại');

      if (data.token) {
        writeStoredToken(data.token);
        setKeyDraft(data.token);
        setVipStatus(false, true, true);
        setCredits(50_000);
      } else if (data.status?.active) {
        setVipStatus(false, true, true);
        setCredits(50_000);
      }
      toast.success(
        'Trial',
        data.message ||
          (data.cloud ? 'Trial cloud đã bật' : 'Trial local đã bật'),
      );
      await refresh();
    } catch (e) {
      toast.error('Trial', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handlePaidNotify = async () => {
    if (!hwid) {
      toast.warn('Thanh toán', 'Chưa có mã thiết bị — đợi tải HWID rồi thử lại.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(API.entitlementPaymentNotify, {
        method: 'POST',
        headers: buildClientApiHeaders(),
        body: JSON.stringify({ hwid, planId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        zaloUrl?: string;
        zalo?: string;
      };
      if (!res.ok || !data.ok) {
        // Vẫn mở Zalo để user gửi bill khi Telegram chưa cấu hình / lỗi mạng
        const zaloUrl =
          data.zaloUrl || `https://zalo.me/${SELLER_BANK.zalo}`;
        try {
          window.open(zaloUrl, '_blank', 'noopener,noreferrer');
        } catch {
          /* ignore */
        }
        throw new Error(
          data.error ||
            `Không gửi được Telegram. Mở Zalo ${SELLER_BANK.zaloDisplay} gửi bill + HWID.`,
        );
      }
      toast.success(
        'Đã báo Admin',
        data.message ||
          `Telegram OK. Gửi bill qua Zalo ${SELLER_BANK.zaloDisplay} để nhận key.`,
      );
      try {
        window.open(
          data.zaloUrl || `https://zalo.me/${SELLER_BANK.zalo}`,
          '_blank',
          'noopener,noreferrer',
        );
      } catch {
        /* ignore */
      }
    } catch (e) {
      toast.error(
        'Báo thanh toán',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!mounted || !open) return null;

  const statusLine = isTrial
    ? ' · Trial đang dùng (chưa mua Pro)'
    : isPro || isVip
      ? ' · Pro đã kích hoạt'
      : ' · Free — nâng Pro bên dưới';

  const qrSrc = qrBroken ? STATIC_QR_FALLBACK : qrUrl;

  return createPortal(
    <>
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Bản quyền License"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/75 backdrop-blur-md cursor-default"
        aria-label="Đóng"
        onClick={onClose}
      />

      <div className="relative z-[121] w-full max-w-[720px] max-h-[min(92vh,820px)] overflow-y-auto rounded-2xl border border-sky-800/50 bg-gradient-to-b from-[#0a1628] via-[#0b1a30] to-[#07101c] shadow-2xl shadow-sky-950/80">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-sky-900/50 bg-[#0a1628]/95 px-4 py-3 backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-black shadow-md shadow-amber-500/25 ring-1 ring-amber-300/30">
              <Rocket className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold uppercase tracking-wider text-sky-100 flex items-center gap-1.5">
                <Shield className="h-4 w-4 text-amber-400" />
                Bản quyền / License
              </h2>
              <p className="text-[10px] text-sky-400/80 truncate">
                Tier hiện tại:{' '}
                <span className="font-bold text-amber-300 uppercase">{tier}</span>
                {statusLine}
              </p>
              {cloudNote ? (
                <p className="text-[9px] text-zinc-500 truncate" title={cloudNote}>
                  {cloudNote}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-700 bg-zinc-900/80 p-2 text-zinc-400 hover:text-white cursor-pointer"
            title="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Device ID */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg border border-sky-700/60 bg-sky-950/50 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-sky-300">
              Mã thiết bị
            </span>
            <code className="flex-1 min-w-[140px] rounded-lg border border-sky-800/40 bg-black/50 px-3 py-1.5 text-sm font-mono font-bold tracking-wider text-amber-300">
              {hwid || (busy ? '…' : '—')}
            </code>
            <button
              type="button"
              disabled={!hwid}
              onClick={() => void copyText(hwid, 'hwid')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-600/50 bg-sky-900/40 px-3 py-1.5 text-[10px] font-bold uppercase text-sky-200 hover:bg-sky-800/50 cursor-pointer disabled:opacity-40"
            >
              {copiedHwid ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              Copy mã
            </button>
          </div>

          {/* Plans */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {PAID_PLANS.map((p) => {
              const active = planId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setPlanId(p.id);
                    setQrBroken(false);
                  }}
                  className={`relative rounded-xl border px-3 py-3 text-center transition-all cursor-pointer ${
                    p.highlight
                      ? active
                        ? 'border-amber-400 bg-gradient-to-b from-amber-400 to-amber-600 text-black shadow-lg shadow-amber-500/30 scale-[1.02]'
                        : 'border-amber-600/60 bg-amber-950/30 text-amber-200 hover:border-amber-400'
                      : active
                        ? 'border-sky-400 bg-sky-950/80 text-sky-50 ring-1 ring-sky-400/40'
                        : 'border-sky-900/60 bg-[#0c1e38]/80 text-sky-200 hover:border-sky-600'
                  }`}
                >
                  <div className="text-[10px] font-bold uppercase tracking-wide opacity-90">
                    {p.label}
                  </div>
                  <div
                    className={`mt-1 text-lg font-black tabular-nums ${
                      p.highlight && active ? 'text-black' : 'text-inherit'
                    }`}
                  >
                    {p.priceLabel}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Payment + steps */}
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-3">
            <div className="rounded-xl border border-sky-800/50 bg-black/30 p-3 flex flex-col sm:flex-row gap-3 items-center sm:items-start">
              <div className="shrink-0 flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setQrFullscreen(true)}
                  className="group relative rounded-xl bg-white p-2 shadow-inner cursor-zoom-in border border-transparent hover:border-amber-400/80 transition-colors"
                  title="Phóng to QR toàn màn hình"
                  aria-label="Phóng to QR"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrSrc}
                    alt="QR chuyển khoản"
                    className="h-[148px] w-[148px] object-contain pointer-events-none"
                    onError={() => setQrBroken(true)}
                  />
                  <span className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[8px] font-bold uppercase text-white opacity-90 group-hover:opacity-100">
                    <Maximize2 className="h-2.5 w-2.5" />
                    Phóng to
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setQrFullscreen(true)}
                  className="text-[9px] font-bold uppercase tracking-wide text-sky-400 hover:text-amber-300 cursor-pointer"
                >
                  Bấm QR để phóng to
                </button>
              </div>
              <div className="flex-1 min-w-0 space-y-1.5 text-left">
                <p className="text-xs font-bold uppercase tracking-wide text-amber-400">
                  Thanh toán: {selected.label}
                </p>
                <p className="text-[11px] text-sky-100">
                  <span className="text-sky-500">Số tiền:</span>{' '}
                  <span className="font-bold text-amber-300">
                    {formatVnd(selected.priceVnd)}
                  </span>
                </p>
                <p className="text-[11px] text-sky-100 break-all">
                  <span className="text-sky-500">Nội dung:</span>{' '}
                  <span className="font-mono font-bold text-emerald-300">
                    {transferContent}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => void copyText(transferContent, 'content')}
                  className="text-[9px] font-bold uppercase text-sky-400 hover:text-amber-300 cursor-pointer inline-flex items-center gap-1"
                >
                  {copiedContent ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  Copy nội dung CK
                </button>
                <p className="text-[11px] text-sky-100 pt-1">
                  <span className="text-sky-500">Ngân hàng:</span>{' '}
                  {SELLER_BANK.bankName}
                </p>
                <p className="text-[11px] text-sky-100">
                  <span className="text-sky-500">STK:</span>{' '}
                  <span className="font-mono font-bold">
                    {SELLER_BANK.accountNo.replace(/(\d{4})(?=\d)/g, '$1 ')}
                  </span>
                </p>
                <p className="text-[11px] text-sky-100">
                  <span className="text-sky-500">Chủ TK:</span>{' '}
                  {SELLER_BANK.accountName}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-sky-800/50 bg-sky-950/20 p-3 space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-sky-200 flex items-center gap-1.5">
                <span className="text-amber-400">📋</span> Các bước nhận key
              </p>
              <ol className="space-y-2 text-[11px] text-sky-100/90 leading-relaxed list-none">
                <li>
                  <span className="text-amber-400 font-bold">1. Chuyển khoản:</span>{' '}
                  Quét QR hoặc CK đúng{' '}
                  <strong className="text-amber-300">{formatVnd(selected.priceVnd)}</strong>{' '}
                  + nội dung{' '}
                  <code className="text-emerald-300 text-[10px]">{transferContent}</code>
                </li>
                <li>
                  <span className="text-amber-400 font-bold">2. Chụp màn hình:</span>{' '}
                  Bill / xác nhận chuyển khoản thành công.
                </li>
                <li>
                  <span className="text-amber-400 font-bold">3. Gửi Admin:</span> Zalo{' '}
                  <a
                    href={`https://zalo.me/${SELLER_BANK.zalo}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-300 underline font-bold hover:text-amber-300"
                  >
                    {SELLER_BANK.zaloDisplay}
                  </a>
                </li>
                <li>
                  <span className="text-amber-400 font-bold">4. Nhận Key:</span> Gửi kèm{' '}
                  <strong>ảnh bill + mã thiết bị</strong> → nhận key kích hoạt ngay.
                </li>
              </ol>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleStartTrial()}
                className="mt-1 w-full rounded-lg border border-sky-700/50 bg-sky-950/40 py-1.5 text-[10px] font-bold uppercase text-sky-300 hover:bg-sky-900/50 cursor-pointer disabled:opacity-50"
              >
                {`Dùng thử Trial ${trialDaysLabel} ngày (1 máy)`}
              </button>
              <button
                type="button"
                disabled={busy || !hwid}
                onClick={() => void handlePaidNotify()}
                className="w-full rounded-lg border border-emerald-600/50 bg-emerald-600/90 py-2 text-[11px] font-black uppercase tracking-wide text-black shadow-md shadow-emerald-900/30 hover:bg-emerald-500 cursor-pointer disabled:opacity-50"
                title="Báo Admin qua Telegram + mở Zalo gửi bill"
              >
                ✓ Đã thanh toán — báo Admin
              </button>
              <p className="text-[9px] text-zinc-500 leading-relaxed">
                Báo Admin: gói + HWID + nội dung CK lên Telegram (nút{' '}
                <span className="text-emerald-400 font-bold">Cấp Key</span> /{' '}
                <span className="text-rose-400 font-bold">Từ chối</span>
                ). Đồng thời mở Zalo{' '}
                <span className="text-sky-400 font-bold">{SELLER_BANK.zaloDisplay}</span>{' '}
                để gửi ảnh bill.
              </p>
            </div>
          </div>

          {/* Paste key */}
          <div className="space-y-2">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-sky-500">
              Dán License Key bạn nhận được từ Admin vào đây…
            </label>
            <input
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="AINOVEL-XXXX-… hoặc token Ed25519"
              className="w-full rounded-xl border border-sky-800/60 bg-black/50 px-3 py-2.5 text-sm font-mono text-sky-100 outline-none focus:border-amber-500 placeholder:text-zinc-600"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-zinc-700 bg-zinc-900/80 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-zinc-300 hover:text-white cursor-pointer"
              >
                Thoát
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleActivate()}
                className="flex flex-1 min-w-[160px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2.5 text-sm font-black uppercase tracking-wide text-black shadow-lg shadow-orange-500/30 hover:from-orange-400 hover:to-amber-400 cursor-pointer disabled:opacity-50"
              >
                <Rocket className="h-4 w-4" />
                Kích hoạt ngay
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  writeStoredToken('');
                  setKeyDraft('');
                  applyClaims(null);
                  toast.info('Bản quyền', 'Đã xóa key local');
                  void refresh();
                }}
                className="rounded-xl border border-zinc-700 px-3 py-2.5 text-[10px] font-bold uppercase text-zinc-500 hover:text-rose-300 cursor-pointer"
              >
                Xóa key
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* QR fullscreen — toàn app, z trên modal license */}
    {qrFullscreen ? (
      <div
        className="fixed inset-0 z-[140] flex flex-col items-center justify-center bg-black/92 backdrop-blur-md p-4 cursor-zoom-out"
        role="dialog"
        aria-modal="true"
        aria-label="QR phóng to"
        onClick={() => setQrFullscreen(false)}
      >
        <button
          type="button"
          onClick={() => setQrFullscreen(false)}
          className="absolute top-4 right-4 rounded-xl border border-zinc-600 bg-zinc-900/90 p-2.5 text-zinc-200 hover:text-white hover:border-amber-500 cursor-pointer"
          title="Đóng (Esc)"
          aria-label="Đóng QR phóng to"
        >
          <X className="h-5 w-5" />
        </button>
        <p className="mb-3 text-center text-xs font-bold uppercase tracking-wider text-amber-300">
          {selected.label} · {formatVnd(selected.priceVnd)}
        </p>
        <p className="mb-4 max-w-lg text-center text-[11px] font-mono text-emerald-300 break-all">
          {transferContent}
        </p>
        <div
          className="rounded-2xl bg-white p-4 sm:p-6 shadow-2xl cursor-default"
          onClick={(e) => e.stopPropagation()}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrSrc}
            alt="QR chuyển khoản phóng to"
            className="h-[min(70vh,420px)] w-[min(70vh,420px)] max-w-[min(92vw,420px)] object-contain"
            onError={() => setQrBroken(true)}
          />
        </div>
        <p className="mt-4 text-[10px] text-zinc-400">
          Bấm nền tối hoặc Esc để đóng · {SELLER_BANK.bankName} · {SELLER_BANK.accountName}
        </p>
      </div>
    ) : null}
    </>,
    document.body,
  );
}
