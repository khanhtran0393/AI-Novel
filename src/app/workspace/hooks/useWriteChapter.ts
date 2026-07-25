'use client';

import { useRef } from 'react';
import { useNovelStore, type Chuong } from '@/store/useNovelStore';
import {
  writeChapterAction,
  reviseChapterAction,
  enforceWordGateBudget,
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
import { appConfirm } from '@/lib/confirmDialog';
import { validateSpeechFingerprints } from '@/lib/youtubeSafe';
import {
  FREE_LIMITS,
  TRIAL_LIMITS,
  freeChapterCapMessage,
  freeWordCapMessage,
  trialChapterCapMessage,
  trialWordCapMessage,
  resolveWriteWordPlan,
} from '@/lib/commercial/freeLimitsPolicy';
import { minScenesForScriptMode, normalizeScriptMode } from '@/lib/scriptMode';

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

  const publishLiveText = (
    fullText: string,
    opts?: { skipWordCount?: boolean },
  ) => {
    const normalized = (fullText || '').normalize('NFC');
    // Word count splits entire chapter — skip on typewriter mid-ticks (GUI freeze).
    if (opts?.skipWordCount) {
      setStreamUi({ liveScriptText: normalized });
      return;
    }
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
   * Typewriter for the new chunk.
   * Throttled UI (~8–10fps + large steps) — avoids parseScenes/re-render thrash
   * that freezes Electron when streaming long chapters.
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
      const compose = (chunk: string) =>
        base ? `${base}\n\n${chunk}` : chunk;
      publishLiveText(base);
      // Adaptive step: longer chapters advance faster so total animation stays ~3–6s
      const len = content.length || 1;
      const step = Math.max(48, Math.min(220, Math.ceil(len / 80)));
      const delay = 90; // ~11fps UI — enough smoothness, leaves main thread free
      let index = 0;
      let tick = 0;

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
          tick += 1;
          // Paint stream every tick; word-count every 3rd to cut split() cost
          setStreamUi({ streamText: next });
          if (tick % 3 === 0 || index >= content.length) {
            publishLiveText(compose(next));
          } else {
            publishLiveText(compose(next), { skipWordCount: true });
          }
          return;
        }
        stopTyping();
        streamTextRef.current = content;
        setStreamUi({ streamText: content });
        publishLiveText(compose(content));
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

    // Word plan BEFORE gen: goal = so_tu user set · min/max = 0.92 / +20% · clamp gói
    const wordPlan = resolveWriteWordPlan(startState.setup?.so_tu_chuong, {
      is_pro: startState.is_pro,
      is_trial: startState.is_trial,
      is_vip: startState.is_vip,
    });
    // Sync Setup if store still holds over-tier value (e.g. 4250 on Free)
    if (Number(startState.setup?.so_tu_chuong) !== wordPlan.goal) {
      startState.setSetup({ so_tu_chuong: wordPlan.goal });
    }

    // Free: ≤2 ch · 3/day. Trial: ≤10 ch · 5/day.
    // Word block only when FULL chapter already complete (floor+scenes) and at soft max+
    // — never block mid-script solely for soft max.
    if (wordPlan.tier === 'free') {
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
      if (!overwrite) {
        const existing = currentChapter.noi_dung || '';
        const g = evaluateWordGate(
          existing,
          wordPlan.goal,
          minScenesForScriptMode(normalizeScriptMode(startState.scriptMode)),
        );
        if (!g.needsContinue && g.wordCount >= wordPlan.max) {
          const msg = freeWordCapMessage();
          setPromptError(msg);
          pushToast('error', 'Gói Free — giới hạn từ', msg, 12_000);
          return;
        }
      }
    } else if (wordPlan.tier === 'trial') {
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
      if (!overwrite) {
        const existing = currentChapter.noi_dung || '';
        const g = evaluateWordGate(
          existing,
          wordPlan.goal,
          minScenesForScriptMode(normalizeScriptMode(startState.scriptMode)),
        );
        if (!g.needsContinue && g.wordCount >= wordPlan.max) {
          const msg = trialWordCapMessage();
          setPromptError(msg);
          pushToast('error', 'Gói Trial — giới hạn từ', msg, 12_000);
          return;
        }
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
        const prepMsg =
          mode === 'polish'
            ? `✨ Đang trau chuốt chương ${chapterNumber} theo nhận xét biên tập — chuẩn bị viết lại...`
            : `📝 Đang viết lại chương ${chapterNumber} theo nhận xét biên tập — chuẩn bị rewrite...`;
        setPromptError(prepMsg);
        pushToast(
          'info',
          mode === 'polish' ? 'Chuẩn bị trau chuốt' : 'Chuẩn bị viết lại',
          `Chương ${chapterNumber}: AI đang ${mode === 'polish' ? 'trau chuốt' : 'viết lại'} kịch bản theo nhận xét (media giữ nguyên).`,
          7_000,
        );
        const revised = await reviseChapterAction({
          ten_tac_pham: startState.ten_tac_pham,
          chuong_hien_tai: currentChapter,
          noi_dung_kich_ban: workingContent,
          lorebook: startState.lorebook,
          userRules: startState.userRules,
          review,
          mode,
          ngon_ngu: resolveNgonNgu(startState.setup.ngon_ngu),
          so_tu_chuong: wordPlan.goal,
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
        // Re-resolve plan each loop from live store (user may change setup mid-write)
        const minScenes = minScenesForScriptMode(
          normalizeScriptMode(startState.scriptMode),
        );

        do {
          if (controller.signal.aborted || genId !== writeGenRef.current) {
            throw new DOMException('Aborted', 'AbortError');
          }

          const live = useNovelStore.getState();
          const plan = resolveWriteWordPlan(live.setup?.so_tu_chuong, {
            is_pro: live.is_pro,
            is_trial: live.is_trial,
            is_vip: live.is_vip,
          });
          // Pre-call: stop if done OR already over hard max (anti 200%+)
          if (workingContent.trim()) {
            const preGate = evaluateWordGate(
              workingContent,
              plan.goal,
              minScenes,
            );
            if (preGate.overSoftMax) {
              setPromptError(
                `⛔ Cổng từ vượt trần: ${preGate.wordCount}/${plan.goal} từ (max ${preGate.wordMax} = +20%). Dừng gen — không bù thêm.`,
              );
              pushToast(
                'warn',
                'Cổng từ vượt quy định',
                `${preGate.wordCount}/${plan.goal} từ (${Math.round((preGate.wordCount / plan.goal) * 100)}%). Mục tiêu Setup ${plan.goal}, trần ${preGate.wordMax}.`,
                12_000,
              );
              break;
            }
            if (!preGate.needsContinue) {
              break;
            }
          }

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
            // Cổng từ = đúng so_tu user = độ dài TOÀN BỘ chương
            so_tu_chuong: plan.goal,
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
          // Server may return full condensed chapter (after overshoot) — replace, don't append
          if (result.fullChapterReplace) {
            workingContent = normalizeSceneTags(result.noi_dung);
            if (result.condensedFrom) {
              setPromptError(
                `✂ Đã rút gọn cổng từ: ${result.condensedFrom} → ${result.wordCount ?? getWordCount(workingContent)} / ${plan.goal} từ (trần ${plan.max}).`,
              );
              pushToast(
                'info',
                'Cổng từ — rút gọn',
                `Từ ${result.condensedFrom} xuống ~${result.wordCount ?? '?'} (mục tiêu ${plan.goal}, trần ${plan.max}).`,
                10_000,
              );
            }
          } else {
            workingContent = workingContent
              ? normalizeSceneTags(`${workingContent}\n\n${result.noi_dung}`)
              : normalizeSceneTags(result.noi_dung);
          }

          // fullChapterReplace: animate full condensed body from empty base
          await animateText(
            latestChunk,
            genId,
            result.fullChapterReplace ? '' : baseBeforeChunk,
          );
          liveBaseRef.current = workingContent;
          publishLiveText(workingContent);

          intervention = undefined;

          const gate = evaluateWordGate(
            workingContent,
            plan.goal,
            minScenes,
          );
          if (gate.overSoftMax) {
            // Client safety net: force condense, don't leave 200%+ on disk
            setPromptError(
              `✂ Đang rút gọn cổng từ ${gate.wordCount}/${plan.goal} (trần ${gate.wordMax})…`,
            );
            try {
              const enforced = await enforceWordGateBudget({
                content: workingContent,
                wordGoal: plan.goal,
                minScenes,
                ten_tac_pham: live.ten_tac_pham,
                chuong_hien_tai: currentChapter,
                lorebook: live.lorebook,
                userRules: live.userRules || {
                  forbidden_words: '',
                  fatigue_words: '',
                },
                ngon_ngu: resolveNgonNgu(live.setup.ngon_ngu),
                nhan_vat: live.nhan_vat,
                nhan_vat_prompts: live.nhan_vat_prompts,
                signal: controller.signal,
              });
              workingContent = enforced.content;
              liveBaseRef.current = workingContent;
              publishLiveText(workingContent);
              if (enforced.stillOver) {
                pushToast(
                  'error',
                  'Cổng từ vẫn vượt',
                  `Sau rút gọn còn ${enforced.wordCount}/${plan.goal} (trần ${plan.max}). Hãy bấm viết lại hoặc hạ so_tu Setup.`,
                  14_000,
                );
                setPromptError(
                  `⛔ Cổng từ ${enforced.wordCount}/${plan.goal} vẫn > trần ${plan.max} sau rút gọn.`,
                );
              } else if (enforced.condensed) {
                pushToast(
                  'success',
                  'Cổng từ đã khớp',
                  `${enforced.wordCount}/${plan.goal} từ (trần ${plan.max}).`,
                  8_000,
                );
                setPromptError(
                  `✓ Cổng từ sau rút gọn: ${enforced.wordCount}/${plan.goal} (sàn ${Math.round(plan.goal * 0.92)} · trần ${plan.max}).`,
                );
              }
            } catch (condenseErr) {
              pushToast(
                'warn',
                'Cổng từ vượt — rút gọn lỗi',
                condenseErr instanceof Error
                  ? condenseErr.message
                  : String(condenseErr),
                12_000,
              );
            }
            break;
          }
          if (options.skipAutoContinue || !gate.needsContinue) {
            break;
          }
          if (autoContinues >= MAX_AUTO_CONTINUES) {
            setPromptError(
              `⚠️ Cổng Từ chưa đạt sau ${MAX_AUTO_CONTINUES + 1} lượt: ${gate.wordCount}/${gate.wordMin}–${plan.goal} từ (trần ${gate.wordMax}), ${gate.sceneCount}/${minScenes} cảnh.`,
            );
            break;
          }
          autoContinues += 1;
          forceGate = true;
          setPromptError(
            `↻ Bù Cổng Từ (lượt ${autoContinues}/${MAX_AUTO_CONTINUES}): ${gate.wordCount}/${plan.goal} từ (sàn ${gate.wordMin} · trần ${gate.wordMax}), ${gate.sceneCount}/${minScenes} cảnh…`,
          );
        } while (true);
      }

      if (genId !== writeGenRef.current) return;

      // Final hard enforce before save — never leave 200%+ chapter on disk
      {
        const live = useNovelStore.getState();
        const plan = resolveWriteWordPlan(live.setup?.so_tu_chuong, {
          is_pro: live.is_pro,
          is_trial: live.is_trial,
          is_vip: live.is_vip,
        });
        const minScenes = minScenesForScriptMode(
          normalizeScriptMode(live.scriptMode),
        );
        const finalGate = evaluateWordGate(
          workingContent,
          plan.goal,
          minScenes,
        );
        if (finalGate.overSoftMax) {
          setPromptError(
            `✂ Rút gọn cổng từ trước khi lưu: ${finalGate.wordCount}/${plan.goal} (trần ${finalGate.wordMax})…`,
          );
          try {
            const enforced = await enforceWordGateBudget({
              content: workingContent,
              wordGoal: plan.goal,
              minScenes,
              ten_tac_pham: live.ten_tac_pham,
              chuong_hien_tai: currentChapter,
              lorebook: live.lorebook,
              userRules: live.userRules || {
                forbidden_words: '',
                fatigue_words: '',
              },
              ngon_ngu: resolveNgonNgu(live.setup.ngon_ngu),
              nhan_vat: live.nhan_vat,
              nhan_vat_prompts: live.nhan_vat_prompts,
              signal: controller.signal,
            });
            workingContent = enforced.content;
            liveBaseRef.current = workingContent;
            publishLiveText(workingContent);
            pushToast(
              enforced.stillOver ? 'error' : 'success',
              enforced.stillOver ? 'Cổng từ vẫn vượt' : 'Cổng từ đã khớp',
              `${enforced.wordCount}/${plan.goal} từ (trần ${plan.max}).`,
              10_000,
            );
          } catch (e) {
            pushToast(
              'error',
              'Rút gọn cổng từ thất bại',
              e instanceof Error ? e.message : String(e),
              12_000,
            );
          }
        }
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
    const state = useNovelStore.getState();
    const ch = chapterNumber ?? state.chuong_dang_chon;
    const review = state.editorReviews[ch];
    const isPolish = review?.verdict === 'polish';
    const summary = (review?.summary || '').trim();
    const summaryLine = summary
      ? `Nhận xét: ${summary.length > 180 ? `${summary.slice(0, 180)}…` : summary}`
      : 'Có nhận xét biên tập';

    const ok = await appConfirm({
      title: isPolish ? 'Trau chuốt theo nhận xét' : 'Sửa theo nhận xét',
      message: isPolish
        ? 'AI sắp trau chuốt / viết lại kịch bản chương theo nhận xét biên tập. Nội dung hiện tại sẽ được thay thế.'
        : 'AI sắp viết lại kịch bản chương theo nhận xét biên tập. Nội dung hiện tại sẽ được thay thế.',
      details: [
        `Chương ${ch}`,
        summaryLine,
        isPolish ? 'Chế độ: polish (trau chuốt)' : 'Chế độ: rewrite (viết lại)',
        'Media (audio · ảnh · video) giữ nguyên — không xóa',
      ],
      confirmLabel: isPolish ? 'Bắt đầu trau chuốt' : 'Bắt đầu viết lại',
      cancelLabel: 'Hủy',
      tone: isPolish ? 'warn' : 'danger',
    });
    if (!ok) return;

    // Toast ngay sau xác nhận (trước khi stream) — user biết đang chuẩn bị viết lại
    pushToast(
      'warn',
      isPolish ? 'Chuẩn bị trau chuốt' : 'Chuẩn bị viết lại',
      `Chương ${ch}: AI sắp ${isPolish ? 'trau chuốt' : 'viết lại'} kịch bản theo nhận xét. Media giữ nguyên.`,
      6_000,
    );

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
