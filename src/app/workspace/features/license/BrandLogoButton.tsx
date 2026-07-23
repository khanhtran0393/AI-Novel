'use client';

/**
 * Brand logo = public/brand/logo.png (user-approved mark).
 * Free: pulse + badge "up to PRO". Trial/Pro: badge TRIAL|PRO.
 * Click → License modal.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { API } from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';
import {
  selectIsPro,
  selectIsVip,
  selectIsTrial,
} from '@/store/useNovelStoreSelectors';
import { buildClientApiHeaders } from '../../modules/apiClient';
import LicenseModal from './LicenseModal';

/** Cache-bust after transparent-alpha brand regen (avoid stale black-bg PNG). */
const LOGO_SRC = '/brand/logo.png?v=alpha3';

export default function BrandLogoButton() {
  const isPro = useNovelStore(selectIsPro);
  const isVip = useNovelStore(selectIsVip);
  const isTrial = useNovelStore(selectIsTrial);
  const [licenseOpen, setLicenseOpen] = useState(false);
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
      };
      if (!res.ok || !data.ok) {
        setShowFreePromo(!isPro && !isVip && !isTrial);
        return;
      }
      if (data.ownerUnlimited) {
        setShowFreePromo(false);
        return;
      }
      if (data.tokenValid || data.trial?.active) {
        setShowFreePromo(false);
        return;
      }
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

  useEffect(() => {
    if (!isPro && !isVip && !isTrial) setShowFreePromo(true);
  }, [isPro, isVip, isTrial]);

  const planBadge = isTrial ? 'TRIAL' : 'PRO';
  const planBadgeClass = isTrial
    ? 'bg-gradient-to-r from-sky-300 to-cyan-400'
    : 'bg-gradient-to-r from-yellow-300 to-amber-400';

  // Badge neo CHÂN GÓC PHẢI: left=100% → mép trái badge = mép phải logo,
  // chữ tràn sang phải (không right:0 — right:0 khiến chữ dài mọc sang TRÁI đè logo).
  const badgeAnchorStyle: React.CSSProperties = {
    position: 'absolute',
    top: '100%',
    left: '100%',
    right: 'auto',
    bottom: 'auto',
    marginTop: 2,
    marginLeft: -6, // chút đè vào chân góc phải
    zIndex: 2,
    whiteSpace: 'nowrap',
    maxWidth: 'none',
    pointerEvents: 'none',
    lineHeight: 1,
    fontSize: 7,
    fontWeight: 900,
    textTransform: 'uppercase',
    color: '#000',
    borderRadius: 3,
    padding: '1px 4px',
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setLicenseOpen(true)}
        className={`group relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-950 p-0 shadow-lg shadow-amber-500/30 ring-1 ring-amber-300/40 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-amber-200/90 border-0 overflow-visible ${
          showFreePromo ? 'ainovel-logo-pulse' : ''
        }`}
        title={
          showFreePromo
            ? 'Free — nhấp logo để mở Bản quyền / nâng cấp Pro'
            : isTrial
              ? 'Trial — nhấp để xem Bản quyền / mua Pro'
              : 'Bản quyền / License'
        }
        aria-label="Mở Bản quyền License"
      >
        {/* Dark circular plate under alpha PNG so logo never reads as empty black hole */}
        <span className="relative z-[1] block h-11 w-11 overflow-hidden rounded-full bg-gradient-to-br from-amber-950/90 via-zinc-950 to-black ring-1 ring-amber-500/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGO_SRC}
            alt="AI Novel"
            width={44}
            height={44}
            className="h-full w-full object-contain bg-transparent"
            draggable={false}
          />
        </span>

        {showFreePromo ? (
          <span
            className="ainovel-pro-badge-pulse bg-gradient-to-r from-yellow-300 to-amber-400 shadow-md shadow-amber-500/40 ring-1 ring-amber-200/50"
            style={badgeAnchorStyle}
            aria-hidden
          >
            up to PRO
          </span>
        ) : (
          <span className={planBadgeClass} style={badgeAnchorStyle}>
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
