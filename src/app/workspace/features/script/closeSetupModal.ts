/**
 * Close Setup / Youtube Setup → workspace (giai_doan = 2).
 * Hard-set store + patch localStorage so late rehydrate cannot revive Setup.
 */
import type { CSSProperties } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { STORE_KEY } from '@/store/persistStorage';

function patchLocalStorageGiaiDoan2(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) {
      // Minimal persist so next boot is not forced into Setup
      window.localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ state: { giai_doan: 2 }, version: 3 }),
      );
      return;
    }
    const parsed = JSON.parse(raw) as {
      state?: Record<string, unknown>;
      version?: number;
    };
    if (parsed && typeof parsed === 'object') {
      if (parsed.state && typeof parsed.state === 'object') {
        parsed.state = { ...parsed.state, giai_doan: 2 };
      } else {
        (parsed as { giai_doan?: number }).giai_doan = 2;
      }
      window.localStorage.setItem(STORE_KEY, JSON.stringify(parsed));
    }
  } catch (e) {
    console.warn('[closeSetupModal] localStorage patch failed', e);
  }
}

export function closeSetupModal(onClose?: () => void): void {
  // 1) In-memory — immediate unmount
  try {
    useNovelStore.setState({ giai_doan: 2 });
  } catch {
    /* ignore */
  }
  try {
    useNovelStore.getState().setGiaiDoan?.(2);
  } catch {
    /* ignore */
  }

  // 2) Disk/session — prevent rehydrate yank-back to phase 1
  patchLocalStorageGiaiDoan2();

  try {
    onClose?.();
  } catch {
    /* ignore */
  }

  // 3) Re-assert after callback
  try {
    if (useNovelStore.getState().giai_doan !== 2) {
      useNovelStore.setState({ giai_doan: 2 });
    }
  } catch {
    /* ignore */
  }

  try {
    const w = window as Window & {
      ainovelPersist?: {
        flush?: () => Promise<unknown>;
        setStore?: (raw: string) => Promise<unknown> | unknown;
      };
    };
    // Async durable only — setStoreSync freezes Electron chrome
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw && w.ainovelPersist?.setStore) {
        void w.ainovelPersist.setStore(raw);
      }
    } catch {
      /* ignore */
    }
    void w.ainovelPersist?.flush?.();
  } catch {
    /* ignore */
  }

  console.info(
    '[closeSetupModal] done giai_doan=',
    useNovelStore.getState().giai_doan,
  );
}

/** Electron frameless: ensure clicks hit buttons (not drag region). */
export const setupModalNoDragStyle = {
  WebkitAppRegion: 'no-drag',
  pointerEvents: 'auto',
} as CSSProperties;
