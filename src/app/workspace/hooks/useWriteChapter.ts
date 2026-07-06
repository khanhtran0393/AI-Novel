'use client';

import { useState, useRef } from 'react';
import { useNovelStore, type Chuong } from '@/store/useNovelStore';
import { writeChapterAction, evaluateChapterAction, commitMemoryAction } from '../modules/writeModule';
import { getFriendlyErrorMessage } from '../modules/setupModule';
import { sendNotification } from '../modules/notifyModule';
import { recordEngineCheckpoint, recordEngineSnapshot } from '../modules/engineModule';

export function useWriteChapter(setPromptError: (err: string) => void) {
  const [streamText, setStreamText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamTextRef = useRef('');

  const handleWriteChapter = async (
    overwrite: boolean = false,
    chapterNumber: number = useNovelStore.getState().chuong_dang_chon,
  ): Promise<void> => {
    const startState = useNovelStore.getState();
    const currentChapter = startState.danh_sach_chuong.find(c => c.so_chuong === chapterNumber);
    if (!currentChapter) return;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    startState.setDangTai(true);
    setIsStreaming(true);
    setStreamText('');
    streamTextRef.current = '';

    const baseContent = overwrite ? '' : (currentChapter.noi_dung || '');

    try {
      const content = await writeChapterAction({
        useMock: false,
        apiKey: startState.apiKey,
        apiKeys: startState.apiKeys || [],
        ten_tac_pham: startState.ten_tac_pham,
        dan_y_tong_the: startState.dan_y_tong_the,
        lorebook: startState.lorebook,
        tom_tat_cuon_chieu: startState.tom_tat_cuon_chieu,
        tri_nho_ngan_han: startState.tri_nho_ngan_han,
        nhan_vat: startState.nhan_vat,
        chuong_hien_tai: currentChapter,
        so_chuong: startState.setup.so_chuong,
        so_tu_chuong: startState.setup.so_tu_chuong || 4250,
        ngon_ngu: startState.setup.ngon_ngu || 'Tiếng Việt',
        noi_dung_hien_tai: baseContent,
        userRules: startState.userRules
      });

      const delay = 15;
      const step = 10;
      let index = 0;

      await new Promise<void>((resolve, reject) => {
        intervalRef.current = setInterval(() => {
          if (index < content.length) {
            const chunk = content.substring(index, index + step);
            setStreamText(prev => {
              const next = prev + chunk;
              streamTextRef.current = next;
              return next;
            });
            index += step;
            return;
          }

          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }

          void finishChapter({
            baseContent,
            chapterNumber,
            content,
            currentChapter,
            overwrite,
          }).then(resolve).catch(reject);
        }, delay);
      });
    } catch (err: unknown) {
      setPromptError(getFriendlyErrorMessage(err));
      useNovelStore.getState().setDangTai(false);
      setIsStreaming(false);
      throw err;
    }
  };

  const finishChapter = async (params: {
    baseContent: string;
    chapterNumber: number;
    content: string;
    currentChapter: Chuong;
    overwrite: boolean;
  }): Promise<void> => {
    const finalResult = params.overwrite
      ? params.content
      : (params.baseContent ? `${params.baseContent}\n\n${params.content}` : params.content);

    const liveState = useNovelStore.getState();
    const updatedChapter: Chuong = {
      ...params.currentChapter,
      noi_dung: finalResult.normalize('NFC'),
      trang_thai: 'ready',
    };
    const updatedChapters = liveState.danh_sach_chuong.map((chapter) =>
      chapter.so_chuong === params.chapterNumber ? updatedChapter : chapter,
    );

    liveState.updateChuong(params.chapterNumber, {
      noi_dung: updatedChapter.noi_dung,
      trang_thai: 'ready',
    });

    await recordEngineCheckpoint({
      step: params.overwrite ? 'chapter_rewrite' : 'chapter_write',
      scope: { kind: 'chapter', chapter: params.chapterNumber },
      projectName: liveState.ten_tac_pham,
      payload: {
        chapter: updatedChapter,
        overwrite: params.overwrite,
        targetWords: liveState.setup.so_tu_chuong || 4250,
      },
    });

    await commitChapterMemory(updatedChapter, updatedChapter.noi_dung, updatedChapters);

    const afterMemoryState = useNovelStore.getState();
    await recordEngineSnapshot({
      ten_tac_pham: afterMemoryState.ten_tac_pham,
      chuong_dang_chon: afterMemoryState.chuong_dang_chon,
      setup: afterMemoryState.setup,
      danh_sach_chuong: afterMemoryState.danh_sach_chuong,
      editorReviews: afterMemoryState.editorReviews,
      generatedAudioPaths: afterMemoryState.generatedAudioPaths,
      generatedImages: afterMemoryState.generatedImages,
      generatedVideos: afterMemoryState.generatedVideos,
    });

    await evaluateChapter(updatedChapter.noi_dung, params.chapterNumber);

    setIsStreaming(false);
    liveState.setDangTai(false);
    liveState.setTabHienTai('noi_dung');

    sendNotification(
      'Hệ Thống AI Novel',
      `Chương ${params.currentChapter.so_chuong} đã được sinh xong!`,
    );
  };

  const commitChapterMemory = async (
    updatedChapter: Chuong,
    noi_dung_kich_ban: string,
    updatedChapters: Chuong[],
  ): Promise<void> => {
    const state = useNovelStore.getState();
    try {
      const memory = await commitMemoryAction({
        apiKey: state.apiKey,
        apiKeys: state.apiKeys || [],
        ten_tac_pham: state.ten_tac_pham,
        chuong_hien_tai: updatedChapter,
        noi_dung_kich_ban,
        tom_tat_cuon_chieu: state.tom_tat_cuon_chieu,
        tri_nho_ngan_han: state.tri_nho_ngan_han,
        lorebook: state.lorebook,
        useMock: false,
      });

      if (memory.tom_tat_cuon_chieu) {
        state.updateTomTatCuonChieu(memory.tom_tat_cuon_chieu.normalize('NFC'));
      }
      if (memory.tri_nho_ngan_han_moi) {
        state.updateTriNhoNganHan([...state.tri_nho_ngan_han, memory.tri_nho_ngan_han_moi.normalize('NFC')].slice(-3));
      }
      if (memory.lorebook_cap_nhat && memory.lorebook_cap_nhat.trim()) {
        state.updateLorebook(memory.lorebook_cap_nhat.normalize('NFC'));
      }

      await recordEngineCheckpoint({
        step: 'memory_commit',
        scope: { kind: 'chapter', chapter: updatedChapter.so_chuong },
        projectName: state.ten_tac_pham,
        payload: {
          chapter: updatedChapter.so_chuong,
          tom_tat_cuon_chieu: memory.tom_tat_cuon_chieu,
          tri_nho_ngan_han_moi: memory.tri_nho_ngan_han_moi,
          hasLorebookUpdate: Boolean(memory.lorebook_cap_nhat && memory.lorebook_cap_nhat !== state.lorebook),
          chapterCount: updatedChapters.length,
        },
      });
    } catch (error) {
      console.warn('[Engine] memory commit skipped:', error);
    }
  };

  const handleIntervene = (interventionText: string) => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const state = useNovelStore.getState();
    const currentChapter = state.danh_sach_chuong.find(c => c.so_chuong === state.chuong_dang_chon);
    if (!currentChapter) return;

    const baseContent = currentChapter.noi_dung || '';
    const newStream = streamTextRef.current;
    const interventionBlock = `\n\n[Lệnh Can Thiệp: ${interventionText}]\n\n`;
    const finalContent = baseContent ? (baseContent + '\n\n' + newStream + interventionBlock) : (newStream + interventionBlock);

    state.updateChuong(state.chuong_dang_chon, {
      noi_dung: finalContent.normalize('NFC'),
      trang_thai: 'ready'
    });

    void handleWriteChapter(false, state.chuong_dang_chon).catch(() => undefined);
  };

  const evaluateChapter = async (noi_dung_kich_ban: string, chapterNumber: number) => {
    try {
      const state = useNovelStore.getState();
      const currentChapter = state.danh_sach_chuong.find(c => c.so_chuong === chapterNumber);
      if (!currentChapter) return undefined;

      const review = await evaluateChapterAction({
        apiKey: state.apiKey,
        apiKeys: state.apiKeys || [],
        chuong_hien_tai: currentChapter,
        noi_dung_kich_ban,
        userRules: state.userRules,
        useMock: false
      });

      state.updateEditorReview(chapterNumber, review);
      await recordEngineCheckpoint({
        step: 'chapter_review',
        scope: { kind: 'chapter', chapter: chapterNumber },
        projectName: state.ten_tac_pham,
        payload: {
          chapter: chapterNumber,
          review,
        },
      });

      const afterReviewState = useNovelStore.getState();
      await recordEngineSnapshot({
        ten_tac_pham: afterReviewState.ten_tac_pham,
        chuong_dang_chon: afterReviewState.chuong_dang_chon,
        setup: afterReviewState.setup,
        danh_sach_chuong: afterReviewState.danh_sach_chuong,
        editorReviews: afterReviewState.editorReviews,
        generatedAudioPaths: afterReviewState.generatedAudioPaths,
        generatedImages: afterReviewState.generatedImages,
        generatedVideos: afterReviewState.generatedVideos,
      });
      return review;
    } catch (err: unknown) {
      console.error('Lỗi khi chấm điểm:', err);
      return undefined;
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
