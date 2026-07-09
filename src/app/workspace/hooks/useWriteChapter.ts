'use client';

import { useState, useRef } from 'react';
import { useNovelStore, type Chuong } from '@/store/useNovelStore';
import {
  writeChapterAction,
  evaluateChapterAction,
  commitMemoryAction,
  reviseChapterAction,
} from '../modules/writeModule';
import { getFriendlyErrorMessage } from '../modules/setupModule';
import { sendNotification } from '../modules/notifyModule';
import { recordEngineCheckpoint, recordEngineSnapshot } from '../modules/engineModule';
import {
  evaluateWordGate,
  MAX_AUTO_CONTINUES,
  normalizeSceneTags,
} from '@/lib/storyWriting';
import {
  extractHookFromScript,
  mergeYoutubeSafe,
  buildSeoDescription,
  buildThumbnailPrompt,
  buildSeoTitleFromHook,
  scoreNarrativePsychScript,
} from '@/lib/youtubeSafe';

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

export function useWriteChapter(setPromptError: (err: string) => void) {
  const [streamText, setStreamText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamTextRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const writeGenRef = useRef(0);

  const stopTyping = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const animateText = (content: string, genId: number): Promise<void> => {
    return new Promise((resolve, reject) => {
      stopTyping();
      setStreamText('');
      streamTextRef.current = '';
      const delay = 12;
      const step = 14;
      let index = 0;

      intervalRef.current = setInterval(() => {
        if (genId !== writeGenRef.current) {
          stopTyping();
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        if (index < content.length) {
          const chunk = content.substring(index, index + step);
          setStreamText((prev) => {
            const next = prev + chunk;
            streamTextRef.current = next;
            return next;
          });
          index += step;
          return;
        }
        stopTyping();
        resolve();
      }, delay);
    });
  };

  const handleWriteChapter = async (
    overwrite: boolean = false,
    chapterNumber: number = useNovelStore.getState().chuong_dang_chon,
    options: WriteChapterOptions = {},
  ): Promise<void> => {
    // Cancel any in-flight write
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const genId = ++writeGenRef.current;
    stopTyping();

    const startState = useNovelStore.getState();
    const currentChapter = startState.danh_sach_chuong.find((c) => c.so_chuong === chapterNumber);
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
      // Clear audio/prompts/images/videos + editor review gắn chương
      startState.clearChapterMedia(chapterNumber);
    }

    try {
      let workingContent = overwrite ? '' : currentChapter.noi_dung || '';
      let latestChunk = '';

      // --- Path A: revise from editor review ---
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
          ngon_ngu: startState.setup.ngon_ngu || 'Tiếng Việt',
          so_tu_chuong: startState.setup.so_tu_chuong || 4250,
          nhan_vat: startState.nhan_vat,
          nhan_vat_prompts: startState.nhan_vat_prompts,
          signal: controller.signal,
        });
        if (genId !== writeGenRef.current) return;
        latestChunk = revised.noi_dung;
        workingContent = normalizeSceneTags(revised.noi_dung);
        await animateText(latestChunk, genId);
      } else {
        // --- Path B: write / continue with Word-Gate auto-continue ---
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
            ngon_ngu: live.setup.ngon_ngu || 'Tiếng Việt',
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
          workingContent = workingContent
            ? normalizeSceneTags(`${workingContent}\n\n${result.noi_dung}`)
            : normalizeSceneTags(result.noi_dung);

          // Show only the new chunk in the typing animation (full chapter is saved after)
          await animateText(latestChunk, genId);

          // Consume one-shot intervention after first pass
          intervention = undefined;

          const gate = evaluateWordGate(workingContent, live.setup.so_tu_chuong || 4250);
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
            `⏳ Tự động bù Cổng Từ (lượt ${autoContinues}/${MAX_AUTO_CONTINUES}): ${gate.wordCount}/${gate.wordMin} từ, ${gate.sceneCount} cảnh...`,
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
        // Silent abort when superseded
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
    const finalResult = normalizeSceneTags(params.content);

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
        gate: evaluateWordGate(updatedChapter.noi_dung, liveState.setup.so_tu_chuong || 4250),
      },
    });

    await commitChapterMemory(updatedChapter, updatedChapter.noi_dung, updatedChapters, params.signal);

    if (params.genId !== writeGenRef.current) return;

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

    const review = await evaluateChapter(updatedChapter.noi_dung, params.chapterNumber, params.signal);

    // Tín hiệu phụ: narrative psych (pattern interrupt / open loop) — log + console
    try {
      const psych = scoreNarrativePsychScript(updatedChapter.noi_dung);
      console.info(
        `[NarrativePsych] ch${params.chapterNumber} score=${psych.score} open=${psych.openScore} end=${psych.endScore} density=${psych.threatDensity}% flags=${psych.flags.join(',') || 'ok'}`,
      );
      if (psych.flags.includes('seo_slogan_in_prose')) {
        setPromptError('⚠️ Kịch bản dính slogan SEO — Editor/rewrite sẽ ưu tiên gỡ.');
      } else if (psych.flags.includes('poetic_open') || psych.flags.includes('weak_open_pattern_interrupt')) {
        console.warn('[NarrativePsych] Mở chương yếu (pattern interrupt) — Editor hook sẽ trừ điểm.');
      }
    } catch {
      /* non-fatal */
    }

    // Auto one-shot revise if editor demands rewrite OR polish (YouTube-safe: don't ship raw AI)
    const needsAutoRevise =
      review?.verdict === 'rewrite' || review?.verdict === 'polish';
    if (
      !params.skipAutoRevise &&
      needsAutoRevise &&
      params.genId === writeGenRef.current &&
      !params.signal.aborted
    ) {
      const mode = review.verdict === 'polish' ? 'polish' : 'rewrite';
      setPromptError(
        mode === 'polish'
          ? '✨ Biên tập yêu cầu trau chuốt — đang tự động polish (YouTube-safe)...'
          : '📝 Biên tập yêu cầu viết lại — đang tự động sửa theo nhận xét...',
      );
      try {
        const revised = await reviseChapterAction({
          ten_tac_pham: useNovelStore.getState().ten_tac_pham,
          chuong_hien_tai: updatedChapter,
          noi_dung_kich_ban: updatedChapter.noi_dung,
          lorebook: useNovelStore.getState().lorebook,
          userRules: useNovelStore.getState().userRules,
          review,
          mode,
          ngon_ngu: useNovelStore.getState().setup.ngon_ngu || 'Tiếng Việt',
          so_tu_chuong: useNovelStore.getState().setup.so_tu_chuong || 4250,
          nhan_vat: useNovelStore.getState().nhan_vat,
          nhan_vat_prompts: useNovelStore.getState().nhan_vat_prompts,
          signal: params.signal,
        });
        if (params.genId !== writeGenRef.current) return;
        await animateText(revised.noi_dung, params.genId);
        const revisedChapter: Chuong = {
          ...updatedChapter,
          noi_dung: normalizeSceneTags(revised.noi_dung).normalize('NFC'),
          trang_thai: 'ready',
        };
        useNovelStore.getState().updateChuong(params.chapterNumber, {
          noi_dung: revisedChapter.noi_dung,
          trang_thai: 'ready',
        });
        await commitChapterMemory(
          revisedChapter,
          revisedChapter.noi_dung,
          useNovelStore.getState().danh_sach_chuong.map((c) =>
            c.so_chuong === params.chapterNumber ? revisedChapter : c,
          ),
          params.signal,
        );
        await evaluateChapter(revisedChapter.noi_dung, params.chapterNumber, params.signal);
        setPromptError('');

        // Dual-pass: audio readability for TTS mouth-feel (YouTube narration)
        const yt = mergeYoutubeSafe(useNovelStore.getState().youtubeSafe);
        if (
          yt.autoAudioReadability &&
          params.genId === writeGenRef.current &&
          !params.signal.aborted
        ) {
          setPromptError('🎙️ Đang tối ưu nhịp đọc audio (Audio-Readability)...');
          try {
            const live = useNovelStore.getState();
            const ch = live.danh_sach_chuong.find((c) => c.so_chuong === params.chapterNumber);
            if (ch?.noi_dung) {
              const audioRev = await reviseChapterAction({
                ten_tac_pham: live.ten_tac_pham,
                chuong_hien_tai: ch,
                noi_dung_kich_ban: ch.noi_dung,
                lorebook: live.lorebook,
                userRules: live.userRules,
                review: live.editorReviews[params.chapterNumber] || {
                  verdict: 'polish',
                  summary: 'Audio readability',
                  dimensions: [],
                },
                mode: 'audio_readability',
                ngon_ngu: live.setup.ngon_ngu || 'Tiếng Việt',
                so_tu_chuong: live.setup.so_tu_chuong || 4250,
                nhan_vat: live.nhan_vat,
                nhan_vat_prompts: live.nhan_vat_prompts,
                signal: params.signal,
              });
              if (params.genId !== writeGenRef.current) return;
              const audioChapter: Chuong = {
                ...ch,
                noi_dung: normalizeSceneTags(audioRev.noi_dung).normalize('NFC'),
                trang_thai: 'ready',
              };
              useNovelStore.getState().updateChuong(params.chapterNumber, {
                noi_dung: audioChapter.noi_dung,
                trang_thai: 'ready',
              });
              await animateText(audioRev.noi_dung, params.genId);
            }
          } catch (arErr) {
            console.warn('[Editor] audio-readability skipped:', arErr);
          }
        }
      } catch (e) {
        console.warn('[Editor] auto-revise skipped:', e);
      }
    }

    if (params.genId !== writeGenRef.current) return;

    // Hook engine 0–8s + thumbnail line
    try {
      const finalCh = useNovelStore.getState().danh_sach_chuong.find(
        (c) => c.so_chuong === params.chapterNumber,
      );
      if (finalCh?.noi_dung) {
        const live = useNovelStore.getState();
        const hook = extractHookFromScript(finalCh.noi_dung, { targetSec: 30, wpm: 140 });
        live.setChapterHook(params.chapterNumber, {
          ...hook,
          seoTitle: buildSeoTitleFromHook(hook.hook, hook.thumbnailLine, live.ten_tac_pham),
          seoDescription: buildSeoDescription({
            hook: hook.hook,
            thumbnailLine: hook.thumbnailLine,
            tags: hook.seoTags,
            novelTitle: live.ten_tac_pham,
            chapter: params.chapterNumber,
          }),
          thumbnailPrompt: buildThumbnailPrompt({
            hook: hook.hook,
            thumbnailLine: hook.thumbnailLine,
            visualDna: live.visualDnaPrompt || live.mediaStylePreset,
            characterHint: (live.nhan_vat || []).slice(0, 2).join(' and ') || undefined,
          }),
        });
      }
      // New AI draft → require human pass again
      useNovelStore.getState().setHumanEditFlag(params.chapterNumber, {
        edited: false,
        note: 'reset after AI write',
      });
    } catch (hookErr) {
      console.warn('[Hook] extract failed:', hookErr);
    }

    setIsStreaming(false);
    useNovelStore.getState().setDangTai(false);
    useNovelStore.getState().setTabHienTai('noi_dung');

    sendNotification(
      'Hệ Thống AI Novel',
      `Chương ${params.currentChapter.so_chuong} đã được sinh xong!`,
    );
  };

  const commitChapterMemory = async (
    updatedChapter: Chuong,
    noi_dung_kich_ban: string,
    updatedChapters: Chuong[],
    signal?: AbortSignal,
  ): Promise<void> => {
    const state = useNovelStore.getState();
    state.setMemoryPipelineStatus({
      status: 'pending',
      chapter: updatedChapter.so_chuong,
      message: 'Đang commit bộ nhớ vĩ mô...',
    });
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
        world_state: state.world_state,
        da_dien_ra_entities: state.da_dien_ra_entities,
        signal,
      });

      if (memory.tom_tat_cuon_chieu) {
        state.updateTomTatCuonChieu(memory.tom_tat_cuon_chieu.normalize('NFC'));
      }
      if (memory.tri_nho_ngan_han_moi) {
        state.updateTriNhoNganHan(
          [...state.tri_nho_ngan_han, memory.tri_nho_ngan_han_moi.normalize('NFC')].slice(-3),
        );
      }
      if (memory.lorebook_cap_nhat && memory.lorebook_cap_nhat.trim()) {
        state.updateLorebook(memory.lorebook_cap_nhat.normalize('NFC'));
      }
      if (memory.world_state_cap_nhat) {
        state.updateWorldState(memory.world_state_cap_nhat);
      }
      if (memory.spent_entities_cap_nhat) {
        state.updateSpentEntities(memory.spent_entities_cap_nhat);
      }

      // Xoay vòng nhịp truyện (Beat Type rotation)
      const beats = [
        'Beat A (Discovery)',
        'Beat B (Confrontation)',
        'Beat C (Survival Crisis)',
        'Beat D (Insight)',
      ];
      const currentBeatIdx = beats.indexOf(state.current_beat_type);
      const nextBeat = beats[currentBeatIdx === -1 ? 0 : (currentBeatIdx + 1) % beats.length];
      state.setNextBeatType(nextBeat);

      state.setMemoryPipelineStatus({
        status: 'ok',
        chapter: updatedChapter.so_chuong,
        message: 'Bộ nhớ vĩ mô đã cập nhật.',
      });

      await recordEngineCheckpoint({
        step: 'memory_commit',
        scope: { kind: 'chapter', chapter: updatedChapter.so_chuong },
        projectName: state.ten_tac_pham,
        payload: {
          chapter: updatedChapter.so_chuong,
          tom_tat_cuon_chieu: memory.tom_tat_cuon_chieu,
          tri_nho_ngan_han_moi: memory.tri_nho_ngan_han_moi,
          hasLorebookUpdate: Boolean(
            memory.lorebook_cap_nhat && memory.lorebook_cap_nhat !== state.lorebook,
          ),
          chapterCount: updatedChapters.length,
          nextBeat,
        },
      });
    } catch (error) {
      console.warn('[Engine] memory commit failed:', error);
      useNovelStore.getState().setMemoryPipelineStatus({
        status: 'failed',
        chapter: updatedChapter.so_chuong,
        message:
          error instanceof Error
            ? error.message
            : 'Commit bộ nhớ thất bại — chương sau có thể mất mạch. Hãy thử lại.',
      });
    }
  };

  /**
   * Queues an intervention for the NEXT write pass.
   * (True mid-token streaming is not available; we cancel animation and re-write with directive.)
   */
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
    await handleWriteChapter(false, ch, { reviseFromReview: true, skipAutoRevise: true });
  };

  const evaluateChapter = async (
    noi_dung_kich_ban: string,
    chapterNumber: number,
    signal?: AbortSignal,
  ) => {
    try {
      const state = useNovelStore.getState();
      const currentChapter = state.danh_sach_chuong.find((c) => c.so_chuong === chapterNumber);
      if (!currentChapter) return undefined;

      const review = await evaluateChapterAction({
        apiKey: state.apiKey,
        apiKeys: state.apiKeys || [],
        chuong_hien_tai: currentChapter,
        noi_dung_kich_ban,
        userRules: state.userRules,
        signal,
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

  const retryMemoryCommit = async (chapterNumber?: number) => {
    const state = useNovelStore.getState();
    const chNum = chapterNumber ?? state.chuong_dang_chon;
    const chapter = state.danh_sach_chuong.find((c) => c.so_chuong === chNum);
    if (!chapter?.noi_dung) return;
    await commitChapterMemory(chapter, chapter.noi_dung, state.danh_sach_chuong);
  };

  return {
    isStreaming,
    streamText,
    setStreamText,
    setIsStreaming,
    handleWriteChapter,
    handleIntervene,
    handleReviseFromReview,
    retryMemoryCommit,
  };
}
