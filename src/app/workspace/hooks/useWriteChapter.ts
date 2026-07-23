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
import { pushToast } from '@/lib/toastBus';
import { validateSpeechFingerprints } from '@/lib/youtubeSafe';
import {
  FREE_LIMITS,
  TRIAL_LIMITS,
  clampFreeWordGoal,
  clampTrialWordGoal,
  freeChapterCapMessage,
  freeWordCapMessage,
  trialChapterCapMessage,
  trialWordCapMessage,
} from '@/lib/commercial/freeLimitsPolicy';
import { storeIsFreeTier } from './useFreeLimits';

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
    if (!currentChapter) {
      pushToast(
        'warn',
        'Viết chương',
        'Chưa có / chưa chọn chương. Mở Setup sinh dàn ý hoặc chọn chương ở sidebar.',
      );
      return;
    }

    // Free: ≤2 ch · ≤600 từ · 3/day. Trial: ≤10 ch · ≤3000 từ · 5/day.
    if (storeIsFreeTier(startState)) {
      if (chapterNumber > FREE_LIMITS.maxChapters) {
        const msg = freeChapterCapMessage();
        setPromptError(msg);
        pushToast('error', 'Gói Free — giới hạn chương', msg, 12_000);
        return;
      }
      if (startState.danh_sach_chuong.length > FREE_LIMITS.maxChapters) {
        const msg = freeChapterCapMessage();
        setPromptError(msg);
        pushToast('error', 'Gói Free — giới hạn chương', msg, 12_000);
        return;
      }
      const goal = Number(startState.setup.so_tu_chuong) || FREE_LIMITS.maxWordsPerChapter;
      if (goal > FREE_LIMITS.maxWordsPerChapter) {
        startState.setSetup({
          so_tu_chuong: clampFreeWordGoal(goal),
        });
      }
      const existingWords = getWordCount(
        overwrite ? '' : currentChapter.noi_dung || '',
      );
      if (existingWords >= FREE_LIMITS.maxWordsPerChapter) {
        const msg = freeWordCapMessage();
        setPromptError(msg);
        pushToast('error', 'Gói Free — giới hạn từ', msg, 12_000);
        return;
      }
    } else if (startState.is_trial) {
      if (chapterNumber > TRIAL_LIMITS.maxChapters) {
        const msg = trialChapterCapMessage();
        setPromptError(msg);
        pushToast('error', 'Gói Trial — giới hạn chương', msg, 12_000);
        return;
      }
      if (startState.danh_sach_chuong.length > TRIAL_LIMITS.maxChapters) {
        const msg = trialChapterCapMessage();
        setPromptError(msg);
        pushToast('error', 'Gói Trial — giới hạn chương', msg, 12_000);
        return;
      }
      const goal =
        Number(startState.setup.so_tu_chuong) || TRIAL_LIMITS.maxWordsPerChapter;
      if (goal > TRIAL_LIMITS.maxWordsPerChapter) {
        startState.setSetup({ so_tu_chuong: clampTrialWordGoal(goal) });
      }
      const existingWords = getWordCount(
        overwrite ? '' : currentChapter.noi_dung || '',
      );
      if (existingWords >= TRIAL_LIMITS.maxWordsPerChapter) {
        const msg = trialWordCapMessage();
        setPromptError(msg);
        pushToast('error', 'Gói Trial — giới hạn từ', msg, 12_000);
        return;
      }
    }

    // Soft-gate Setup genre — trước khi gọi API (tránh 400/hard-fail muộn)
    {
      const chu_de = String(startState.setup?.chu_de || '').trim();
      const phong_cach = String(startState.setup?.phong_cach || '').trim();
      if (!chu_de || !phong_cach) {
        const msg =
          'Chưa chọn Setup Chủ đề + Phong cách. Mở nút Setup (sidebar) chọn cả hai trước khi viết chương.';
        setPromptError(msg);
        pushToast('error', 'Thiếu Setup', msg, 14_000);
        return;
      }
    }

    // Preflight hồ sơ thoại — popup ngay, không gọi API / không unhandledRejection
    const fpErr = validateSpeechFingerprints(
      startState.nhan_vat,
      startState.nhan_vat_prompts,
    );
    if (fpErr) {
      setPromptError(fpErr);
      pushToast('error', 'Sinh kịch bản — thiếu hồ sơ nhân vật', fpErr, 14_000);
      return;
    }

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
          so_tu_chuong: storeIsFreeTier(startState)
            ? clampFreeWordGoal(startState.setup.so_tu_chuong)
            : startState.setup.so_tu_chuong || 4250,
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
            so_tu_chuong: storeIsFreeTier(live)
              ? clampFreeWordGoal(live.setup.so_tu_chuong)
              : live.setup.so_tu_chuong || 4250,
            ngon_ngu: resolveNgonNgu(live.setup.ngon_ngu),
            noi_dung_hien_tai: workingContent,
            userRules: live.userRules,
            da_dien_ra_entities: live.da_dien_ra_entities,
            world_state: live.world_state,
            current_beat_type: live.current_beat_type,
            intervention_directive: intervention,
            // Free: không force word-gate continue vượt 600 từ
            force_word_gate_continue: storeIsFreeTier(live)
              ? false
              : forceGate,
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

          // Free: dừng auto-continue khi đã đạt cap từ
          if (storeIsFreeTier(live)) {
            const freeWords = getWordCount(workingContent);
            if (freeWords >= FREE_LIMITS.maxWordsPerChapter) {
              break;
            }
          }

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
      const friendly = getFriendlyErrorMessage(err);
      setPromptError(friendly);
      useNovelStore.getState().setDangTai(false);
      setIsStreaming(false);
      // Popup cho user (callers often .catch(() => undefined) → không rethrow)
      const raw = err instanceof Error ? err.message : String(err);
      const isProfile =
        /Giọng thoại|giong_thoai|Thói quen|thoi_quen|hồ sơ nhân vật|fingerprint/i.test(
          raw,
        );
      pushToast(
        'error',
        isProfile ? 'Sinh kịch bản — thiếu hồ sơ nhân vật' : 'Sinh kịch bản thất bại',
        raw || friendly,
        isProfile ? 14_000 : 9_000,
      );
      // Không rethrow: tránh unhandledRejection khi Sidebar/Setup .catch(() => undefined)
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
