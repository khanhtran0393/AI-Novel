'use client';

import { useRef } from 'react';
import { useNovelStore, type Chuong } from '@/store/useNovelStore';
import {
  writeChapterAction,
  reviseChapterAction,
} from '../modules/writeModule';
import {
  resolveNgonNgu,
  commitChapterMemory,
} from './writeChapterHelpers';
import { finishChapterWrite } from './writeChapterFinish';
import { getFriendlyErrorMessage } from '../modules/setupModule';
import {
  evaluateWordGate,
  getWordCount,
  MAX_AUTO_CONTINUES,
  normalizeSceneTags,
} from '@/lib/storyWriting';
import { setStreamUi, getStreamUi } from '../modules/streamUiStore';

export type WriteChapterOptions = {
  /** Apply editor review via REVISE_CHAPTER instead of fresh write */
  reviseFromReview?: boolean;
  /** Optional author steering instruction for continue/write */
  intervention?: string;
  /** Skip auto word-gate continue loops */
  skipAutoContinue?: boolean;
  /** Skip auto revise after bad editor verdict */
  skipAutoRevise?: boolean;
};

/**
 * Write-chapter actions. Stream UI is external (streamUiStore) so typewriter
 * ticks only re-render leaves that call useStreamUi — not the workspace shell.
 */
export function useWriteChapter(setPromptError: (err: string) => void) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamTextRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const writeGenRef = useRef(0);
  /** Content already written before the current typing chunk */
  const liveBaseRef = useRef('');

  const stopTyping = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const publishLiveText = (fullText: string) => {
    const normalized = (fullText || '').normalize('NFC');
    setStreamUi({
      liveScriptText: normalized,
      liveWordCount: getWordCount(normalized),
    });
  };

  const setIsStreaming = (v: boolean) => {
    setStreamUi({ isStreaming: v });
  };

  const setStreamText = (v: string) => {
    streamTextRef.current = v;
    setStreamUi({ streamText: v });
  };

  /**
   * Typewriter for the new chunk; Word-Gate counts base + typed so far in real time.
   * ~30fps (33ms / step 28) — smooth enough without flooding React.
   */
  const animateText = (
    content: string,
    genId: number,
    baseContent: string = liveBaseRef.current,
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      stopTyping();
      setStreamText('');
      streamTextRef.current = '';
      liveBaseRef.current = baseContent || '';
      const base = liveBaseRef.current;
      publishLiveText(base);
      const delay = 33;
      const step = 28;
      let index = 0;

      intervalRef.current = setInterval(() => {
        if (genId !== writeGenRef.current) {
          stopTyping();
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        if (index < content.length) {
          index = Math.min(index + step, content.length);
          const next = content.substring(0, index);
          streamTextRef.current = next;
          setStreamUi({ streamText: next });
          publishLiveText(base ? `${base}\n\n${next}` : next);
          return;
        }
        stopTyping();
        streamTextRef.current = content;
        setStreamUi({ streamText: content });
        publishLiveText(base ? `${base}\n\n${content}` : content);
        resolve();
      }, delay);
    });
  };

  const handleWriteChapter = async (
    overwrite: boolean = false,
    chapterNumber: number = useNovelStore.getState().chuong_dang_chon,
    options: WriteChapterOptions = {},
  ): Promise<void> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const genId = ++writeGenRef.current;
    stopTyping();

    const startState = useNovelStore.getState();
    const currentChapter = startState.danh_sach_chuong.find(
      (c) => c.so_chuong === chapterNumber,
    );
    if (!currentChapter) return;

    startState.setDangTai(true);
    startState.setMemoryPipelineStatus({
      status: 'idle',
      chapter: chapterNumber,
      message: '',
    });
    setIsStreaming(true);
    setStreamText('');
    streamTextRef.current = '';
    setPromptError('');

    if (overwrite) {
      startState.clearChapterMedia(chapterNumber);
    }

    try {
      let workingContent = overwrite ? '' : currentChapter.noi_dung || '';
      let latestChunk = '';
      liveBaseRef.current = workingContent;
      publishLiveText(workingContent);

      if (options.reviseFromReview) {
        const review = startState.editorReviews[chapterNumber];
        if (!review || !workingContent.trim()) {
          throw new Error('Không có bản thảo hoặc nhận xét biên tập để sửa.');
        }
        const mode = review.verdict === 'polish' ? 'polish' : 'rewrite';
        const revised = await reviseChapterAction({
          ten_tac_pham: startState.ten_tac_pham,
          chuong_hien_tai: currentChapter,
          noi_dung_kich_ban: workingContent,
          lorebook: startState.lorebook,
          userRules: startState.userRules,
          review,
          mode,
          ngon_ngu: resolveNgonNgu(startState.setup.ngon_ngu),
          so_tu_chuong: startState.setup.so_tu_chuong || 4250,
          nhan_vat: startState.nhan_vat,
          nhan_vat_prompts: startState.nhan_vat_prompts,
          signal: controller.signal,
        });
        if (genId !== writeGenRef.current) return;
        latestChunk = revised.noi_dung;
        workingContent = normalizeSceneTags(revised.noi_dung);
        await animateText(latestChunk, genId, '');
        liveBaseRef.current = workingContent;
        publishLiveText(workingContent);
      } else {
        let autoContinues = 0;
        let forceGate = false;
        let intervention = options.intervention;

        do {
          if (controller.signal.aborted || genId !== writeGenRef.current) {
            throw new DOMException('Aborted', 'AbortError');
          }

          const live = useNovelStore.getState();
          const result = await writeChapterAction({
            apiKey: live.apiKey,
            apiKeys: live.apiKeys || [],
            ten_tac_pham: live.ten_tac_pham,
            dan_y_tong_the: live.dan_y_tong_the,
            lorebook: live.lorebook,
            tom_tat_cuon_chieu: live.tom_tat_cuon_chieu,
            tri_nho_ngan_han: live.tri_nho_ngan_han,
            nhan_vat: live.nhan_vat,
            nhan_vat_prompts: live.nhan_vat_prompts,
            chuong_hien_tai: currentChapter,
            so_chuong: live.setup.so_chuong,
            so_tu_chuong: live.setup.so_tu_chuong || 4250,
            ngon_ngu: resolveNgonNgu(live.setup.ngon_ngu),
            noi_dung_hien_tai: workingContent,
            userRules: live.userRules,
            da_dien_ra_entities: live.da_dien_ra_entities,
            world_state: live.world_state,
            current_beat_type: live.current_beat_type,
            intervention_directive: intervention,
            force_word_gate_continue: forceGate,
            signal: controller.signal,
          });

          if (genId !== writeGenRef.current) return;

          latestChunk = result.noi_dung;
          const baseBeforeChunk = workingContent;
          workingContent = workingContent
            ? normalizeSceneTags(`${workingContent}\n\n${result.noi_dung}`)
            : normalizeSceneTags(result.noi_dung);

          await animateText(latestChunk, genId, baseBeforeChunk);
          liveBaseRef.current = workingContent;
          publishLiveText(workingContent);

          intervention = undefined;

          const gate = evaluateWordGate(
            workingContent,
            live.setup.so_tu_chuong || 4250,
          );
          if (options.skipAutoContinue || !gate.needsContinue) {
            break;
          }
          if (autoContinues >= MAX_AUTO_CONTINUES) {
            setPromptError(
              `⚠️ Cổng Từ chưa đạt sau ${MAX_AUTO_CONTINUES + 1} lượt: ${gate.wordCount}/${gate.wordMin} từ, ${gate.sceneCount} cảnh (cần ≥3). Hãy bấm "Sinh phần tiếp theo".`,
            );
            break;
          }
          autoContinues += 1;
          forceGate = true;
          setPromptError(
            `↻ Tự động bù Cổng Từ (lượt ${autoContinues}/${MAX_AUTO_CONTINUES}): ${gate.wordCount}/${gate.wordMin} từ, ${gate.sceneCount} cảnh...`,
          );
        } while (true);
      }

      if (genId !== writeGenRef.current) return;

      await finishChapter({
        chapterNumber,
        content: workingContent,
        currentChapter,
        overwrite,
        genId,
        signal: controller.signal,
        skipAutoRevise: options.skipAutoRevise || options.reviseFromReview,
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      setPromptError(getFriendlyErrorMessage(err));
      useNovelStore.getState().setDangTai(false);
      setIsStreaming(false);
      throw err;
    }
  };

  const finishChapter = async (params: {
    chapterNumber: number;
    content: string;
    currentChapter: Chuong;
    overwrite: boolean;
    genId: number;
    signal: AbortSignal;
    skipAutoRevise?: boolean;
  }): Promise<void> => {
    publishLiveText(params.content);
    liveBaseRef.current = params.content;
    await finishChapterWrite(params, {
      isCurrentGen: (genId) => genId === writeGenRef.current,
      animateText: async (content, genId) => {
        await animateText(content, genId, '');
        liveBaseRef.current = content;
        publishLiveText(content);
      },
      setPromptError,
      setIsStreaming,
    });
  };

  const handleIntervene = (interventionText: string) => {
    stopTyping();
    abortRef.current?.abort();

    const state = useNovelStore.getState();
    const currentChapter = state.danh_sach_chuong.find(
      (c) => c.so_chuong === state.chuong_dang_chon,
    );
    if (!currentChapter) return;

    const baseContent = currentChapter.noi_dung || '';
    const newStream = streamTextRef.current;
    const interventionBlock = `\n\n[Lệnh Can Thiệp: ${interventionText}]\n\n`;
    const finalContent = baseContent
      ? baseContent + '\n\n' + newStream + interventionBlock
      : newStream + interventionBlock;

    state.updateChuong(state.chuong_dang_chon, {
      noi_dung: finalContent.normalize('NFC'),
      trang_thai: 'ready',
    });

    void handleWriteChapter(false, state.chuong_dang_chon, {
      intervention: interventionText,
      skipAutoRevise: false,
    }).catch(() => undefined);
  };

  const handleReviseFromReview = async (chapterNumber?: number) => {
    const ch = chapterNumber ?? useNovelStore.getState().chuong_dang_chon;
    await handleWriteChapter(false, ch, {
      reviseFromReview: true,
      skipAutoRevise: true,
    });
  };

  const retryMemoryCommit = async (chapterNumber?: number) => {
    const { toast } = await import('@/lib/toastBus');
    const state = useNovelStore.getState();
    const chNum = chapterNumber ?? state.chuong_dang_chon;
    const chapter = state.danh_sach_chuong.find((c) => c.so_chuong === chNum);
    if (!chapter?.noi_dung?.trim()) {
      toast.warn(
        'Memory',
        `Chương ${chNum} chưa có kịch bản — không commit được. Hãy viết chương trước.`,
      );
      state.setMemoryPipelineStatus({
        status: 'failed',
        chapter: chNum,
        message: 'Chưa có nội dung chương để commit.',
      });
      return;
    }
    const result = await commitChapterMemory(
      chapter,
      chapter.noi_dung,
      state.danh_sach_chuong,
    );
    if (result.ok) {
      toast.success('Memory', 'Commit bộ nhớ vĩ mô thành công.');
    } else {
      toast.error('Memory', result.error || 'Commit thất bại.');
    }
  };

  return {
    /** Snapshots for non-React callers — UI leaves should use useStreamUi() */
    get isStreaming() {
      return getStreamUi().isStreaming;
    },
    get streamText() {
      return getStreamUi().streamText;
    },
    get liveScriptText() {
      return getStreamUi().liveScriptText;
    },
    get liveWordCount() {
      return getStreamUi().liveWordCount;
    },
    setStreamText,
    setIsStreaming,
    handleWriteChapter,
    handleIntervene,
    handleReviseFromReview,
    retryMemoryCommit,
  };
}
