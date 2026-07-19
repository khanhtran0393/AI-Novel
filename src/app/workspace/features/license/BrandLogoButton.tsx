'use client';

/**
 * Brand mark gốc (Sparkles). Free / chưa mua license:
 * hiệu ứng phóng to–thu nhỏ đều đặn + badge "up to PRO".
 * Click → License modal.
 *
 * Lưu ý: MODE=open vẫn pulse nếu chưa có token/trial (promo Free),
 * dù API Pro đang mở cho dev.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { API } from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';
import {
  selectIsPro,
  selectIsVip,
  selectIsTrial,
} from '@/store/useNovelStoreSelectors';
import { buildClientApiHeaders } from '../../modules/apiClient';
import LicenseModal from './LicenseModal';

export default function BrandLogoButton() {
  const isPro = useNovelStore(selectIsPro);
  const isVip = useNovelStore(selectIsVip);
  const isTrial = useNovelStore(selectIsTrial);
  const [licenseOpen, setLicenseOpen] = useState(false);
  /** Promo Free = chưa license trả phí / trial (kể cả dev open) */
  const [showFreePromo, setShowFreePromo] = useState(!isPro && !isVip && !isTrial);

  const refreshPromo = useCallback(async () => {
    try {
      const res = await fetch(API.commercialStatus, {
        method: 'GET',
        headers: buildClientApiHeaders(),
        cache: 'no-store',
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        ownerUnlimited?: boolean;
        tokenValid?: boolean;
        trial?: { active?: boolean };
        openMode?: boolean;
      };
      if (!res.ok || !data.ok) {
        setShowFreePromo(!isPro && !isVip && !isTrial);
        return;
      }
      // Owner CISO unlimited → không promo
      if (data.ownerUnlimited) {
        setShowFreePromo(false);
        return;
      }
      // Có token Pro/VIP hoặc trial → không pulse Free
      if (data.tokenValid || data.trial?.active) {
        setShowFreePromo(false);
        return;
      }
      // Chưa mua / chưa trial → Free promo (kể cả open mode)
      setShowFreePromo(true);
    } catch {
      setShowFreePromo(!isPro && !isVip && !isTrial);
    }
  }, [isPro, isVip, isTrial]);

  useEffect(() => {
    void refreshPromo();
  }, [refreshPromo, licenseOpen]);

  useEffect(() => {
    const onFocus = () => void refreshPromo();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshPromo]);

  // Store free → luôn promo; store pro/trial nhưng chưa token → refreshPromo xử lý
  useEffect(() => {
    if (!isPro && !isVip && !isTrial) setShowFreePromo(true);
  }, [isPro, isVip, isTrial]);

  // Product: Free | Trial | Pro only (legacy is_vip → PRO)
  const planBadge = isTrial ? 'TRIAL' : 'PRO';
  const planBadgeClass = isTrial
    ? 'bg-gradient-to-r from-sky-300 to-cyan-400'
    : 'bg-gradient-to-r from-yellow-300 to-amber-400';

  return (
    <>
      <button
        type="button"
        onClick={() => setLicenseOpen(true)}
        className={`group relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-black shadow-lg shadow-amber-500/30 ring-1 ring-amber-300/30 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-amber-200/90 border-0 p-0 overflow-visible ${
          showFreePromo ? 'ainovel-logo-pulse' : ''
        }`}
        title={
          showFreePromo
            ? 'Free — nhấp để nâng cấp Pro (Bản quyền)'
            : isTrial
              ? 'Trial — nhấp để xem Bản quyền / mua Pro'
              : 'Bản quyền / License'
        }
        aria-label="Mở Bản quyền License"
      >
        <Sparkles className="h-5 w-5 sm:h-6 sm:w-6 relative z-[1]" />

        {showFreePromo ? (
          <span className="pointer-events-none absolute -bottom-1 -right-2 z-[2] whitespace-nowrap rounded bg-gradient-to-r from-orange-500 to-amber-400 px-1 py-px text-[7px] font-black uppercase leading-none tracking-tight text-black shadow-md ainovel-pro-badge-pulse">
            up to PRO
          </span>
        ) : (
          <span
            className={`pointer-events-none absolute -bottom-0.5 -right-1 z-[2] rounded px-1 py-px text-[7px] font-black uppercase leading-none text-black shadow ${planBadgeClass}`}
          >
            {planBadge}
          </span>
        )}
      </button>

      <LicenseModal
        open={licenseOpen}
        onClose={() => {
          setLicenseOpen(false);
          void refreshPromo();
        }}
      />
    </>
  );
}
