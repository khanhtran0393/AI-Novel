'use client';

import { useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { writeChapterAction } from '../modules/writeModule';
import { getFriendlyErrorMessage } from '../modules/setupModule';

export function useWriteChapter(setPromptError: (err: string) => void) {
  const store = useNovelStore();
  const [streamText, setStreamText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // Nút viết nội dung chi tiết chương truyện (Viết tiếp hoặc Viết lại từ đầu)
  const handleWriteChapter = async (overwrite: boolean = false) => {
    const currentChapter = store.danh_sach_chuong.find(c => c.so_chuong === store.chuong_dang_chon);
    if (!currentChapter) return;

    store.setDangTai(true);
    setIsStreaming(true);
    setStreamText('');

    const baseContent = overwrite ? '' : (currentChapter.noi_dung || '');

    try {
      const content = await writeChapterAction({
        useMock: store.useMock,
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        ten_tac_pham: store.ten_tac_pham,
        dan_y_tong_the: store.dan_y_tong_the,
        lorebook: store.lorebook,
        tom_tat_cuon_chieu: store.tom_tat_cuon_chieu,
        tri_nho_ngan_han: store.tri_nho_ngan_han,
        nhan_vat: store.nhan_vat,
        chuong_hien_tai: currentChapter,
        so_chuong: store.setup.so_chuong,
        so_tu_chuong: store.setup.so_tu_chuong || 4250,
        noi_dung_hien_tai: baseContent
      });

      // Giả lập Typing Effect cực kỳ mượt mà sử dụng NFC chuẩn
      const delay = store.useMock ? 25 : 15;
      const step = store.useMock ? 6 : 10;
      let index = 0;
      const interval = setInterval(() => {
        if (index < content.length) {
          setStreamText(prev => prev + content.substring(index, index + step));
          index += step;
        } else {
          clearInterval(interval);
          const finalResult = overwrite ? content : (baseContent ? (baseContent + '\n\n' + content) : content);
          store.updateChuong(store.chuong_dang_chon, {
            noi_dung: finalResult,
            trang_thai: 'ready'
          });
          setIsStreaming(false);
          store.setDangTai(false);
          store.setTabHienTai('noi_dung');
        }
      }, delay);

    } catch (err: unknown) {
      setPromptError(getFriendlyErrorMessage(err));
      store.setDangTai(false);
      setIsStreaming(false);
    }
  };

  return {
    isStreaming,
    streamText,
    setStreamText,
    setIsStreaming,
    handleWriteChapter
  };
}
