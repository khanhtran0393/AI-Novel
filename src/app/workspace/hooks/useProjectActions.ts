'use client';

import { useNovelStore } from '@/store/useNovelStore';
import {
  allowIntentionalStoreReset,
  commitIntentionalProjectResetFromLocal,
} from '@/store/persistStorage';
import { exportTxtAction, resetProjectAction } from '../modules/projectModule';
import { resetEngineAction } from '../modules/engineModule';
import { toast } from '@/lib/toastBus';

export function useProjectActions(streamText: string) {
  const store = useNovelStore();

  const handleExportTxt = () => {
    const currentChapter = store.danh_sach_chuong.find(c => c.so_chuong === store.chuong_dang_chon);
    exportTxtAction({
      ten_tac_pham: store.ten_tac_pham,
      chuong_dang_chon: store.chuong_dang_chon,
      dan_y_tong_the: store.dan_y_tong_the,
      tab_hien_tai: store.tab_hien_tai,
      noi_dung_chuong: currentChapter?.noi_dung || '',
      dan_y_chuong: currentChapter?.dan_y || '',
      streamText
    });
  };

  const handleResetProject = async () => {
    if (confirm('⚠️ Bạn có chắc chắn muốn làm mới dự án? Toàn bộ thiết lập, kịch bản đã sinh cùng với tất cả file âm thanh/hình ảnh cũ liên quan sẽ bị XÓA SẠCH!')) {
      try {
        await resetProjectAction(store.googleDrivePath || '');
        await resetEngineAction();
      } catch (err: unknown) {
        console.warn(err instanceof Error ? err.message : String(err));
      }
      // RESET_POINT: blank canvas + keep settings.
      // 1) open wipe-guard window  2) reset memory  3) force all durables (local/IPC/HTTP)
      // so pickRichest cannot resurrect old title/lore/chapters from disk.
      allowIntentionalStoreReset(60_000);
      store.resetStore();
      // Zustand persist setItem is sync; re-flush every durable layer + retry after tick
      commitIntentionalProjectResetFromLocal();
      queueMicrotask(() => commitIntentionalProjectResetFromLocal());
      setTimeout(() => commitIntentionalProjectResetFromLocal(), 200);
      setTimeout(() => commitIntentionalProjectResetFromLocal(), 1000);

      const live = useNovelStore.getState();
      if (
        live.ten_tac_pham ||
        live.lorebook ||
        (live.danh_sach_chuong && live.danh_sach_chuong.length > 0)
      ) {
        // Hard re-apply blank if something raced and refilled story fields
        live.resetStore();
        commitIntentionalProjectResetFromLocal();
      }

      toast.info('Notice', 'Đã làm mới dự án (trống tên / lore / chương). Cài đặt & API key giữ nguyên.');
    }
  };

  return {
    handleExportTxt,
    handleResetProject
  };
}
