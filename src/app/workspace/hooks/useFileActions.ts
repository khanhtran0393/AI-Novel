'use client';

import { useNovelStore } from '@/store/useNovelStore';

export function useFileActions(streamText: string) {
  const store = useNovelStore();

  // Tải file kịch bản .txt
  const handleExportTxt = () => {
    const currentChapter = store.danh_sach_chuong.find(c => c.so_chuong === store.chuong_dang_chon);
    let text = '';
    
    if (store.tab_hien_tai === 'dan_y') {
      text = `TÁC PHẨM: ${store.ten_tac_pham}\n\n${store.dan_y_tong_the}\n\n======================\nCHI TIẾT CHƯƠNG ${store.chuong_dang_chon}:\n${currentChapter?.dan_y || ''}`;
    } else {
      text = currentChapter?.noi_dung || streamText || 'Chưa có nội dung.';
    }

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${store.ten_tac_pham}_Chuong_${store.chuong_dang_chon}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Mở thư mục lưu trữ cục bộ bằng explorer.exe
  const handleOpenLocalFolder = async (folderPath: string) => {
    if (!folderPath || folderPath.trim() === '') {
      alert('⚠️ Chưa cấu hình đường dẫn thư mục lưu trữ.');
      return;
    }
    try {
      const res = await fetch('/api/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: folderPath.trim() })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Lỗi khi mở thư mục.');
      }
      console.log(`[Folder Opener] Successfully opened folder: ${folderPath}`);
    } catch (err: unknown) {
      alert(`❌ Không thể mở thư mục: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return {
    handleExportTxt,
    handleOpenLocalFolder
  };
}
