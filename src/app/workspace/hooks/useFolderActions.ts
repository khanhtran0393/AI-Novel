'use client';

import { useNovelStore } from '@/store/useNovelStore';
import { openFolderAction } from '../modules/folderModule';
import { toast } from '@/lib/toastBus';

export function useFolderActions() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const store = useNovelStore();

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
