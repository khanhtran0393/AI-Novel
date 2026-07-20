'use client';

import { useState } from 'react';
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
import { getStreamUi } from '../modules/streamUiStore';

/**
 * Scene actions — mỗi nút (Expart / Viết lại) busy RIÊNG theo sceneIndex.
 * CẤM set dang_tai global. Không subscribe full store (getState only).
 */
export function useSceneActions(_streamText?: string) {
  /** Keys: `${chapter}_${sceneIndex}` or `hook_${chapter}` */
  const [expanding, setExpanding] = useState<Record<string, boolean>>({});
  const [rewriting, setRewriting] = useState<Record<string, boolean>>({});

  const sceneBusyKey = (ch: number, idx: number) =>
    isHookSceneIndex(idx) ? `hook_${ch}` : `s_${ch}_${idx}`;

  const streamText = () =>
    _streamText !== undefined ? _streamText : getStreamUi().streamText;

  const handleSceneChange = (idx: number, newContent: string) => {
    const store = useNovelStore.getState();
    const currentChapter = store.danh_sach_chuong.find(
      (c) => c.so_chuong === store.chuong_dang_chon,
    );
    if (!currentChapter) return;

    const fullText = sceneChangeAction({
      idx,
      newContent,
      noiDungHienTai: currentChapter.noi_dung,
      streamText: streamText(),
    });

    store.updateChuong(store.chuong_dang_chon, { noi_dung: fullText });
  };

  const handleCopyScene = async (text: string) => {
    try {
      await copySceneAction(text);
      toast.info('Notice', '📋 Đã sao chép nội dung phân cảnh thành công!');
    } catch {
      toast.info('Notice', '❌ Lỗi không thể sao chép văn bản.');
    }
  };

  const handleExpandScene = async (idx: number) => {
    const store = useNovelStore.getState();
    const currentChapter = store.danh_sach_chuong.find(
      (c) => c.so_chuong === store.chuong_dang_chon,
    );
    if (!currentChapter) {
      toast.warn('Expart', 'Chưa chọn chương — chọn chương ở sidebar trước.');
      return;
    }

    const ch = store.chuong_dang_chon;
    const isHook = isHookSceneIndex(idx);
    const st = streamText();
    const scenes = parseScenes(currentChapter.noi_dung || st);
    const busyKey = sceneBusyKey(ch, idx);
    if (expanding[busyKey]) {
      toast.info('Expart', 'Cảnh này đang mở rộng — chờ xong.');
      return;
    }

    if (isHook) {
      let hookContent = (store.chapterHooks?.[ch]?.hook || '').trim();
      if (!hookContent) {
        const extracted = extractHookFromScript(
          currentChapter.noi_dung || st || '',
        );
        hookContent = (extracted.hook || '').trim();
      }
      if (!hookContent) {
        toast.info(
          'Notice',
          '⚠️ Chưa có nội dung Hook — viết kịch bản chương hoặc dán cold-open vào ô MỞ ĐẦU trước.',
        );
        return;
      }

      setExpanding((p) => ({ ...p, [busyKey]: true }));
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
          expanded = injectHumanJokeAsides(expanded, {
            minCount: 1,
            enabled: true,
          });
        }
        store.setChapterHook(ch, { hook: expanded });
        store.setHumanEditFlag(ch, {
          edited: true,
          note: 'author human pass after hook expand',
        });
      } catch (err: unknown) {
        toast.info(
          'Notice',
          `❌ Lỗi Mở rộng Hook: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setExpanding((p) => ({ ...p, [busyKey]: false }));
      }
      return;
    }

    const sceneToExpand = scenes[idx];
    if (!sceneToExpand || !sceneToExpand.content.trim()) return;

    setExpanding((p) => ({ ...p, [busyKey]: true }));
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
      toast.info(
        'Notice',
        `❌ Lỗi Mở rộng: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setExpanding((p) => ({ ...p, [busyKey]: false }));
    }
  };

  const handleRewriteScene = async (idx: number) => {
    const store = useNovelStore.getState();
    const currentChapter = store.danh_sach_chuong.find(
      (c) => c.so_chuong === store.chuong_dang_chon,
    );
    if (!currentChapter) {
      toast.warn('Viết lại', 'Chưa chọn chương — chọn chương ở sidebar trước.');
      return;
    }

    const ch = store.chuong_dang_chon;
    const isHook = isHookSceneIndex(idx);
    const busyKey = sceneBusyKey(ch, idx);
    if (rewriting[busyKey]) {
      toast.info('Viết lại', 'Cảnh này đang viết lại — chờ xong.');
      return;
    }
    const st = streamText();

    if (isHook) {
      let hookContent = (store.chapterHooks?.[ch]?.hook || '').trim();
      if (!hookContent) {
        const extracted = extractHookFromScript(
          currentChapter.noi_dung || st || '',
        );
        hookContent = (extracted.hook || '').trim();
      }
      if (!hookContent) {
        toast.info(
          'Notice',
          '⚠️ Chưa có nội dung Hook — viết kịch bản chương hoặc dán cold-open vào ô MỞ ĐẦU trước.',
        );
        return;
      }

      const scenes = parseScenes(currentChapter.noi_dung || st);
      setRewriting((p) => ({ ...p, [busyKey]: true }));
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
          rewritten = injectHumanJokeAsides(rewritten, {
            minCount: 1,
            enabled: true,
          });
        }
        store.setChapterHook(ch, { hook: rewritten });
        store.setHumanEditFlag(ch, {
          edited: true,
          note: 'author human pass after hook rewrite',
        });
      } catch (err: unknown) {
        toast.info(
          'Notice',
          `❌ Lỗi Viết lại Hook: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setRewriting((p) => ({ ...p, [busyKey]: false }));
      }
      return;
    }

    const scenes = parseScenes(currentChapter.noi_dung || st);
    const sceneToRewrite = scenes[idx];
    if (!sceneToRewrite || !sceneToRewrite.content.trim()) return;

    setRewriting((p) => ({ ...p, [busyKey]: true }));
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
      toast.info(
        'Notice',
        `❌ Lỗi Viết lại: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setRewriting((p) => ({ ...p, [busyKey]: false }));
    }
  };

  const isExpanding = (idx: number) => {
    const ch = useNovelStore.getState().chuong_dang_chon;
    return Boolean(expanding[sceneBusyKey(ch, idx)]);
  };
  const isRewriting = (idx: number) => {
    const ch = useNovelStore.getState().chuong_dang_chon;
    return Boolean(rewriting[sceneBusyKey(ch, idx)]);
  };

  return {
    handleSceneChange,
    handleCopyScene,
    handleExpandScene,
    handleRewriteScene,
    isExpanding,
    isRewriting,
  };
}
