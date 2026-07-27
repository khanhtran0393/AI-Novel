'use client';

import {
  openFolderAction,
  openChannelFolderAction,
  type ChannelResourceType,
} from '../modules/folderModule';
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

  const handleOpenChannelFolder = async (
    channelName?: string,
    resourceType: ChannelResourceType = 'all',
  ) => {
    try {
      const result = await openChannelFolderAction({
        channelName,
        resourceType,
      });
      if (result?.opened) {
        const typeLabel =
          resourceType === 'all'
            ? 'Kênh'
            : resourceType === 'images'
              ? 'Ảnh'
              : resourceType === 'video'
                ? 'Video'
                : resourceType === 'audio'
                  ? 'Giọng đọc'
                  : resourceType === 'scripts'
                    ? 'Kịch bản'
                    : resourceType === 'thumbnails'
                      ? 'Thumbnails'
                      : 'Ship Pack';
        toast.success(`Đã mở thư mục ${typeLabel}`, result.opened);
      }
    } catch (err: unknown) {
      toast.error(
        'Mở thư mục kênh',
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  return {
    handleOpenFolder,
    handleOpenChannelFolder,
  };
}
