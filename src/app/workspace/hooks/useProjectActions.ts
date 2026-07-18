'use client';

import { useNovelStore } from '@/store/useNovelStore';
import {
  allowIntentionalStoreReset,
  commitIntentionalProjectResetFromLocal,
} from '@/store/persistStorage';
import { exportTxtAction, resetProjectAction } from '../modules/projectModule';
import { resetEngineAction } from '../modules/engineModule';
import { toast } from '@/lib/toastBus';
import { appConfirm } from '@/lib/confirmDialog';
import { getStreamUi } from '../modules/streamUiStore';
import { clearPipelineStore } from '@/lib/pipeline';

/** Project actions — getState only (no full-store subscription). */
export function useProjectActions(streamText?: string) {
  const handleExportTxt = () => {
    const store = useNovelStore.getState();
    const currentChapter = store.danh_sach_chuong.find(
      (c) => c.so_chuong === store.chuong_dang_chon,
    );
    exportTxtAction({
      ten_tac_pham: store.ten_tac_pham,
      chuong_dang_chon: store.chuong_dang_chon,
      dan_y_tong_the: store.dan_y_tong_the,
      tab_hien_tai: store.tab_hien_tai,
      noi_dung_chuong: currentChapter?.noi_dung || '',
      dan_y_chuong: currentChapter?.dan_y || '',
      streamText:
        streamText !== undefined ? streamText : getStreamUi().streamText,
    });
  };

  const handleResetProject = async () => {
    const ok = await appConfirm({
      title: 'Làm mới dự án',
      message:
        'Toàn bộ canvas dự án sẽ bị xóa sạch. Cài đặt & API key được giữ nguyên.',
      details: [
        'Tên tác phẩm, lorebook, dàn ý, chương / kịch bản',
        'File âm thanh, hình ảnh, video, prompt liên quan',
        'Hồ sơ nhân vật trên canvas hiện tại',
      ],
      confirmLabel: 'Xóa sạch & làm mới',
      cancelLabel: 'Giữ nguyên',
      tone: 'danger',
    });
    if (!ok) return;
    const store = useNovelStore.getState();
    try {
      await resetProjectAction(store.googleDrivePath || '');
      await resetEngineAction();
    } catch (err: unknown) {
      console.warn(err instanceof Error ? err.message : String(err));
    }
    allowIntentionalStoreReset(60_000);
    store.resetStore();
    // P0 — wipe Quality Gate / foreshadow / longform meta with canvas
    clearPipelineStore();
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
      live.resetStore();
      clearPipelineStore();
      commitIntentionalProjectResetFromLocal();
    }

    toast.info(
      'Notice',
      'Đã làm mới dự án (trống tên / lore / chương). Cài đặt & API key giữ nguyên.',
    );
  };

  return {
    handleExportTxt,
    handleResetProject,
  };
}
