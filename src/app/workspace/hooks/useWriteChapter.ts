'use client';

import { useState, useRef } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { writeChapterAction, evaluateChapterAction } from '../modules/writeModule';
import { getFriendlyErrorMessage } from '../modules/setupModule';
import { sendNotification } from '../modules/notifyModule';

export function useWriteChapter(setPromptError: (err: string) => void) {
  const store = useNovelStore();
  const [streamText, setStreamText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamTextRef = useRef('');

  // Nút viết nội dung chi tiết chương truyện (Viết tiếp hoặc Viết lại từ đầu)
  const handleWriteChapter = async (overwrite: boolean = false) => {
    const currentChapter = store.danh_sach_chuong.find(c => c.so_chuong === store.chuong_dang_chon);
    if (!currentChapter) return;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    store.setDangTai(true);
    setIsStreaming(true);
    setStreamText('');
    streamTextRef.current = '';

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
        ngon_ngu: store.setup.ngon_ngu || 'Tiếng Việt',
        noi_dung_hien_tai: baseContent,
        userRules: store.userRules
      });

      // Giả lập Typing Effect cực kỳ mượt mà sử dụng NFC chuẩn
      const delay = store.useMock ? 25 : 15;
      const step = store.useMock ? 6 : 10;
      let index = 0;
      intervalRef.current = setInterval(() => {
        if (index < content.length) {
          const chunk = content.substring(index, index + step);
          setStreamText(prev => {
            const next = prev + chunk;
            streamTextRef.current = next;
            return next;
          });
          index += step;
        } else {
          if (intervalRef.current) clearInterval(intervalRef.current);
          const finalResult = overwrite ? content : (baseContent ? (baseContent + '\n\n' + content) : content);
          store.updateChuong(store.chuong_dang_chon, {
            noi_dung: finalResult,
            trang_thai: 'ready'
          });
          setIsStreaming(false);
          store.setDangTai(false);
          store.setTabHienTai('noi_dung');
          
          // Trí tuệ Biên Tập Viên chấm điểm
          evaluateChapter(finalResult);

          // Phát cảnh báo khi viết xong
          sendNotification(
            'Hệ Thống AI Novel', 
            `Chương ${currentChapter.so_chuong} đã được sinh xong!`
          );
        }
      }, delay);

    } catch (err: unknown) {
      setPromptError(getFriendlyErrorMessage(err));
      store.setDangTai(false);
      setIsStreaming(false);
    }
  };

  const handleIntervene = (interventionText: string) => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const currentChapter = store.danh_sach_chuong.find(c => c.so_chuong === store.chuong_dang_chon);
    if (!currentChapter) return;

    const baseContent = currentChapter.noi_dung || '';
    const newStream = streamTextRef.current;
    const interventionBlock = `\n\n[Lệnh Can Thiệp: ${interventionText}]\n\n`;
    
    // Gộp phần đã gõ và lệnh can thiệp thành nội dung hiện tại
    const finalContent = baseContent ? (baseContent + '\n\n' + newStream + interventionBlock) : (newStream + interventionBlock);

    store.updateChuong(store.chuong_dang_chon, {
      noi_dung: finalContent,
      trang_thai: 'ready'
    });
    
    // Tự động gọi lại viết tiếp để đẩy lệnh can thiệp lên LLM
    handleWriteChapter(false);
  };

  const evaluateChapter = async (noi_dung_kich_ban: string) => {
    try {
      const currentChapter = store.danh_sach_chuong.find(c => c.so_chuong === store.chuong_dang_chon);
      if (!currentChapter) return;

      const review = await evaluateChapterAction({
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        chuong_hien_tai: currentChapter,
        noi_dung_kich_ban,
        userRules: store.userRules,
        useMock: store.useMock
      });

      store.updateEditorReview(store.chuong_dang_chon, review);
    } catch (err: unknown) {
      console.error('Lỗi khi chấm điểm:', err);
    }
  };

  return {
    isStreaming,
    streamText,
    setStreamText,
    setIsStreaming,
    handleWriteChapter,
    handleIntervene
  };
}
