'use client';

/**
 * Portal dropdown menu — escapes header overflow-x/y clip (Electron + browser).
 * Anchors to a trigger element via getBoundingClientRect + fixed position.
 */
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export type FloatingMenuProps = {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /** Prefer left edge of anchor (default) or right-align */
  align?: 'left' | 'right';
  /** Gap under anchor in px */
  offsetY?: number;
  zIndex?: number;
  /** Max width CSS */
  width?: string;
};

type Pos = { top: number; left: number; minWidth: number };

export default function FloatingMenu({
  open,
  anchorRef,
  onClose,
  children,
  className = '',
  align = 'left',
  offsetY = 8,
  zIndex = 200,
  width,
}: FloatingMenuProps) {
  const [pos, setPos] = useState<Pos | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const minWidth = Math.max(r.width, 160);
      let left = align === 'right' ? r.right : r.left;
      // Keep inside viewport
      const menuW = width
        ? Math.min(parseInt(width, 10) || 280, window.innerWidth - 16)
        : Math.min(320, window.innerWidth - 16);
      if (align === 'right') {
        left = Math.max(8, r.right - menuW);
      } else {
        left = Math.min(Math.max(8, left), window.innerWidth - menuW - 8);
      }
      const top = Math.min(r.bottom + offsetY, window.innerHeight - 24);
      setPos({ top, left, minWidth });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, anchorRef, align, offsetY, width]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      const menu = document.getElementById('ainovel-floating-menu');
      if (menu?.contains(t)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    // capture phase so we win over other handlers
    document.addEventListener('mousedown', onDoc, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDoc, true);
    };
  }, [open, onClose, anchorRef]);

  if (!mounted || !open || !pos) return null;

  return createPortal(
    <>
      {/* Backdrop: captures clicks outside without blocking layout */}
      <div
        className="fixed inset-0"
        style={{ zIndex: zIndex - 1 }}
        aria-hidden
        onMouseDown={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        id="ainovel-floating-menu"
        role="menu"
        className={className}
        style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          zIndex,
          minWidth: pos.minWidth,
          width: width || undefined,
          maxWidth: 'min(92vw, 360px)',
          maxHeight: 'min(70vh, 520px)',
          overflowY: 'auto',
          pointerEvents: 'auto',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
