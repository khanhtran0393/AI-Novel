'use client';

import { useNovelStore } from '@/store/useNovelStore';
import { openFolderAction } from '../modules/folderModule';

export function useFolderActions() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const store = useNovelStore();

  const handleOpenFolder = async (folderPath: string) => {
    if (!folderPath) {
      alert('⚠️ Chưa cấu hình thư mục lưu trữ.');
      return;
    }
    try {
      await openFolderAction(folderPath);
    } catch (err: unknown) {
      const error = err as { isFallback?: boolean; fallbackUrl?: string };
      if (error.isFallback && error.fallbackUrl) {
        if (confirm(`❌ Thư mục cục bộ không tồn tại: ${folderPath}\n\nBạn có muốn mở Google Drive trực tuyến trên Web để truy cập các tệp của mình không?`)) {
          window.open(error.fallbackUrl, '_blank');
        }
      } else {
        alert(`❌ Không thể mở thư mục: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  return {
    handleOpenFolder
  };
}
