'use client';

import { useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { autoImportCookieAction, addCookieAction, removeCookieAction } from '../modules/cookieModule';

export function useCookieActions() {
  const store = useNovelStore();
  const [isImportingCookie, setIsImportingCookie] = useState(false);

  const handleAutoImportCookie = async () => {
    setIsImportingCookie(true);
    try {
      alert("🤖 Hệ thống đang khởi động trình duyệt bảo mật Chrome để bạn đăng nhập Google.\nHãy tiến hành đăng nhập Google trong cửa sổ Chrome vừa hiện ra. Khi thành công và giao diện Google AI Studio mở ra, Cookie sẽ tự động được trích xuất về ứng dụng của bạn!");
      const cookie = await autoImportCookieAction();
      store.addGoogleCookie(cookie);
      if (!store.googleStudioCookie) {
        store.setGoogleStudioCookie(cookie);
      }
      alert("🎉 Đã tự động lấy và lưu Cookie Google AI Studio thành công!");
    } catch (err: unknown) {
      alert(`❌ Lỗi lấy Cookie tự động: ${err instanceof Error ? err.message : String(err)}`);
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
    handleRemoveCookie
  };
}
