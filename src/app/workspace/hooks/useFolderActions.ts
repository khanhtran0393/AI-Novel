'use client';

import { openFolderAction } from '../modules/folderModule';
import { toast } from '@/lib/toastBus';

/** Folder actions — no store subscription. */
export function useFolderActions() {
  const handleOpenFolder = async (folderPath: string) => {
    const target = (folderPath || 'project').trim() || 'project';
    try {
      const result = await openFolderAction(target);
      if (result?.opened) {
        toast.success('Đã mở thư mục', result.opened);
      }
    } catch (err: unknown) {
      toast.error(
        'Mở thư mục',
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  return {
    handleOpenFolder,
  };
}
