'use client';
import { API } from '@/contracts';

import { useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { autoImportCookieAction, addCookieAction, removeCookieAction } from '../modules/cookieModule';
import { toast } from '@/lib/toastBus';

/** Lấy sessionid TikTok qua Chrome (dùng trong Cấu Hình Giọng Đọc Toàn Cục) */
export async function autoImportTikTokSessionAction(slot?: number): Promise<string> {
  try {
    const res = await fetch(API.getTiktokSession, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slot: typeof slot === 'number' ? slot : undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        (err as { error?: string }).error ||
          'Trích xuất SessionID TikTok thất bại hoặc hết hạn chờ.',
      );
    }
    const data = (await res.json()) as {
      sessionId?: string;
      tiktokSessionId?: string;
    };
    const sessionId = (data.sessionId || data.tiktokSessionId || '').trim();
    if (!sessionId) {
      throw new Error('Dữ liệu sessionid trả về trống.');
    }
    return sessionId;
  } catch (err: unknown) {
    throw new Error(
      `Lỗi lấy Session TikTok: ${err instanceof Error ? err.message : String(err)}\n💡 Cần cài Google Chrome. Đăng nhập xong trong cửa sổ Chrome (không đóng sớm).`,
    );
  }
}

export function useCookieActions() {
  const store = useNovelStore();
  const [isImportingCookie, setIsImportingCookie] = useState(false);

  const handleAutoImportCookie = async () => {
    setIsImportingCookie(true);
    try {
      toast.info(
        'Lấy Cookie',
        'Chrome bảo mật đang mở — đăng nhập Google AI Studio; cookie sẽ tự lưu.',
      );
      const cookie = await autoImportCookieAction();
      store.addGoogleCookie(cookie);
      if (!store.googleStudioCookie) {
        store.setGoogleStudioCookie(cookie);
      }
      toast.success('Cookie Studio', 'Đã lưu Cookie Google AI Studio.');
    } catch (err: unknown) {
      toast.error(
        'Cookie Studio',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setIsImportingCookie(false);
    }
  };

  const handleAddCookie = (newCookie: string) => {
    const current = store.googleStudioCookies || [];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const updated = addCookieAction(current, newCookie);
    store.addGoogleCookie(newCookie.trim()); // store method
    if (!store.googleStudioCookie) {
      store.setGoogleStudioCookie(newCookie.trim());
    }
  };

  const handleRemoveCookie = (index: number) => {
    store.removeGoogleCookie(index); // store method
  };

  return {
    isImportingCookie,
    handleAutoImportCookie,
    handleAddCookie,
    handleRemoveCookie,
  };
}
