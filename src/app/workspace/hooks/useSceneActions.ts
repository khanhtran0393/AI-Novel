'use client';

import { useNovelStore } from '@/store/useNovelStore';
import { parseScenes } from '../utils/stringUtils';
import {
  sceneChangeAction,
  copySceneAction,
  expandSceneAction,
  rewriteSceneAction,
} from '../modules/sceneModule';
import {
  extractHookFromScript,
  injectHumanJokeAsides,
  isHookSceneIndex,
} from '@/lib/youtubeSafe';
import { toast } from '@/lib/toastBus';

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
      toast.info('Notice', '📋 Đã sao chép nội dung phân cảnh thành công!');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      toast.info('Notice', '❌ Lỗi không thể sao chép văn bản.');
    }
  };

  // Mở rộng nội dung phân cảnh bằng AI (Expart) — gồm cả Hook ~30s
  const handleExpandScene = async (idx: number) => {
    const currentChapter = store.danh_sach_chuong.find(c => c.so_chuong === store.chuong_dang_chon);
    if (!currentChapter) return;

    const ch = store.chuong_dang_chon;
    const isHook = isHookSceneIndex(idx);
    const scenes = parseScenes(currentChapter.noi_dung || streamText);

    if (isHook) {
      let hookContent = (store.chapterHooks?.[ch]?.hook || '').trim();
      if (!hookContent) {
        const extracted = extractHookFromScript(currentChapter.noi_dung || streamText || '');
        hookContent = (extracted.hook || '').trim();
      }
      if (!hookContent) {
        toast.info('Notice', '⚠️ Chưa có nội dung Hook — viết kịch bản chương hoặc dán cold-open vào ô MỞ ĐẦU trước.');
        return;
      }

      store.setDangTai(true);
      try {
        let expanded = await expandSceneAction({
          idx,
          apiKey: store.apiKey,
          apiKeys: store.apiKeys || [],
          ten_tac_pham: store.ten_tac_pham,
          currentChapter,
          lorebook: store.lorebook,
          scenes,
          sceneToExpand: {
            title: 'MỞ ĐẦU / HOOK (~30s)',
            content: hookContent,
          },
          isHook: true,
        });
        if (store.youtubeSafe?.humanizeScript !== false) {
          expanded = injectHumanJokeAsides(expanded, { minCount: 1, enabled: true });
        }
        store.setChapterHook(ch, { hook: expanded });
        store.setHumanEditFlag(ch, {
          edited: true,
          note: 'author human pass after hook expand',
        });
      } catch (err: unknown) {
        toast.info('Notice', `❌ Lỗi Mở rộng Hook: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        store.setDangTai(false);
      }
      return;
    }

    const sceneToExpand = scenes[idx];
    if (!sceneToExpand || !sceneToExpand.content.trim()) return;

    store.setDangTai(true);
    try {
      const expandedContent = await expandSceneAction({
        idx,
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        ten_tac_pham: store.ten_tac_pham,
        currentChapter,
        lorebook: store.lorebook,
        scenes,
        sceneToExpand,
      });

      handleSceneChange(idx, expandedContent);
    } catch (err: unknown) {
      toast.info('Notice', `❌ Lỗi Mở rộng: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      store.setDangTai(false);
    }
  };

  // Viết lại nhẹ nội dung cảnh — giữ cốt lõi, điều hòa nối tiếp 2 cảnh kề
  // Hook (MỞ ĐẦU): viết lại cold-open ~30s + humanize / câu đùa người
  const handleRewriteScene = async (idx: number) => {
    const currentChapter = store.danh_sach_chuong.find(c => c.so_chuong === store.chuong_dang_chon);
    if (!currentChapter) return;

    const ch = store.chuong_dang_chon;
    const isHook = isHookSceneIndex(idx);

    if (isHook) {
      let hookContent = (store.chapterHooks?.[ch]?.hook || '').trim();
      if (!hookContent) {
        const extracted = extractHookFromScript(currentChapter.noi_dung || streamText || '');
        hookContent = (extracted.hook || '').trim();
      }
      if (!hookContent) {
        toast.info('Notice', '⚠️ Chưa có nội dung Hook — viết kịch bản chương hoặc dán cold-open vào ô MỞ ĐẦU trước.');
        return;
      }

      const scenes = parseScenes(currentChapter.noi_dung || streamText);
      store.setDangTai(true);
      try {
        let rewritten = await rewriteSceneAction({
          idx,
          apiKey: store.apiKey,
          apiKeys: store.apiKeys || [],
          ten_tac_pham: store.ten_tac_pham,
          currentChapter,
          lorebook: store.lorebook,
          scenes,
          sceneToRewrite: {
            title: 'MỞ ĐẦU / HOOK (~30s)',
            content: hookContent,
          },
          isHook: true,
          humanize: store.youtubeSafe?.humanizeScript !== false,
        });
        if (store.youtubeSafe?.humanizeScript !== false) {
          rewritten = injectHumanJokeAsides(rewritten, { minCount: 1, enabled: true });
        }
        store.setChapterHook(ch, { hook: rewritten });
        // Sau viết lại Hook: đánh dấu Human Pass để workflow TTS/YouTube gate rõ ràng
        store.setHumanEditFlag(ch, {
          edited: true,
          note: 'author human pass after hook rewrite',
        });
      } catch (err: unknown) {
        toast.info('Notice', `❌ Lỗi Viết lại Hook: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        store.setDangTai(false);
      }
      return;
    }

    const scenes = parseScenes(currentChapter.noi_dung || streamText);
    const sceneToRewrite = scenes[idx];
    if (!sceneToRewrite || !sceneToRewrite.content.trim()) return;

    store.setDangTai(true);
    try {
      const rewrittenContent = await rewriteSceneAction({
        idx,
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        ten_tac_pham: store.ten_tac_pham,
        currentChapter,
        lorebook: store.lorebook,
        scenes,
        sceneToRewrite,
      });

      handleSceneChange(idx, rewrittenContent);
    } catch (err: unknown) {
      toast.info('Notice', `❌ Lỗi Viết lại: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      store.setDangTai(false);
    }
  };

  return {
    handleSceneChange,
    handleCopyScene,
    handleExpandScene,
    handleRewriteScene
  };
}
