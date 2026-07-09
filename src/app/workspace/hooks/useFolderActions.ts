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
      alert(`❌ Không thể mở thư mục: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return {
    handleOpenFolder
  };
}
