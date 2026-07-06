'use client';

import { useNovelStore } from '@/store/useNovelStore';
import { parseScenes } from '../utils/stringUtils';
import { sceneChangeAction, copySceneAction, expandSceneAction } from '../modules/sceneModule';

export function useSceneActions(streamText: string) {
  const store = useNovelStore();

  // Cập nhật kịch bản tổng thể khi người dùng thay đổi nội dung ở một Scene cụ thể
  const handleSceneChange = (idx: number, newContent: string) => {
    const currentChapter = store.danh_sach_chuong.find(c => c.so_chuong === store.chuong_dang_chon);
    if (!currentChapter) return;

    const fullText = sceneChangeAction({
      idx,
      newContent,
      noiDungHienTai: currentChapter.noi_dung,
      streamText
    });

    store.updateChuong(store.chuong_dang_chon, { noi_dung: fullText });
  };

  // Sao chép nội dung cảnh vào Clipboard
  const handleCopyScene = async (text: string) => {
    try {
      await copySceneAction(text);
      alert('📋 Đã sao chép nội dung phân cảnh thành công!');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      alert('❌ Lỗi không thể sao chép văn bản.');
    }
  };

  // Mở rộng nội dung phân cảnh bằng AI (Expart)
  const handleExpandScene = async (idx: number) => {
    const currentChapter = store.danh_sach_chuong.find(c => c.so_chuong === store.chuong_dang_chon);
    if (!currentChapter) return;

    const scenes = parseScenes(currentChapter.noi_dung || streamText);
    const sceneToExpand = scenes[idx];
    if (!sceneToExpand || !sceneToExpand.content.trim()) return;

    store.setDangTai(true);
    try {
      const expandedContent = await expandSceneAction({
        idx,
        useMock: false,
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        ten_tac_pham: store.ten_tac_pham,
        currentChapter,
        lorebook: store.lorebook,
        scenes,
        sceneToExpand
      });

      handleSceneChange(idx, expandedContent);
    } catch (err: unknown) {
      alert(`❌ Lỗi Mở rộng: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      store.setDangTai(false);
    }
  };

  return {
    handleSceneChange,
    handleCopyScene,
    handleExpandScene
  };
}
