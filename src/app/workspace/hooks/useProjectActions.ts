'use client';

import { useNovelStore } from '@/store/useNovelStore';
import { exportTxtAction, resetProjectAction } from '../modules/projectModule';

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
      } catch (err: unknown) {
        console.warn(err instanceof Error ? err.message : String(err));
      }
      store.resetStore();
      alert('🎉 Đã làm mới dự án và dọn dẹp sạch sẽ tài nguyên cũ thành công!');
    }
  };

  return {
    handleExportTxt,
    handleResetProject
  };
}
