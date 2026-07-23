import { useNovelStore, type Chuong } from '@/store/useNovelStore';
import { reviseChapterAction } from '../modules/writeModule';
import { sendNotification } from '../modules/notifyModule';
import { recordEngineCheckpoint, recordEngineSnapshot } from '../modules/engineModule';
import { evaluateWordGate, normalizeSceneTags } from '@/lib/storyWriting';
import {
  mergeYoutubeSafe,
  buildThumbnailPrompt,
  scoreNarrativePsychScript,
  YOUTUBE_META_PASS_SCORE,
  YOUTUBE_MOBILE_TITLE_MAX,
  YOUTUBE_TITLE_HARD_MAX,
  buildFiveTitleFormulas,
  enforceMobileTitle,
} from '@/lib/youtubeSafe';
import {
  fetchYoutubeMetaWithQA,
  formatMetaScoreLine,
} from '../modules/youtubeMetaModule';
import {
  resolveNgonNgu,
  evaluateChapter,
  commitChapterMemory,
} from './writeChapterHelpers';
import {
  evaluateChapterQuality,
  setChapterQuality,
} from '@/lib/pipeline';
import { pushToast } from '@/lib/toastBus';


export type FinishChapterParams = {
  chapterNumber: number;
  content: string;
  currentChapter: Chuong;
  overwrite: boolean;
  genId: number;
  signal: AbortSignal;
  skipAutoRevise?: boolean;
};

export type FinishChapterDeps = {
  isCurrentGen: (genId: number) => boolean;
  animateText: (content: string, genId: number) => Promise<void>;
  setPromptError: (err: string) => void;
  setIsStreaming: (v: boolean) => void;
};

/**
 * Owner: post-write pipeline only (memory, editor revise, youtube hook meta).
 * Does not call WRITE_CHAPTER API — that stays in useWriteChapter.handleWriteChapter.
 */
export async function finishChapterWrite(
  params: FinishChapterParams,
  deps: FinishChapterDeps,
): Promise<void> {
  const { isCurrentGen, animateText, setPromptError, setIsStreaming } = deps;

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

    try {
      const { markOnboardingStep } = await import('@/lib/onboarding');
      markOnboardingStep('write');
    } catch {
      /* ignore */
    }

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

    // P0 — Quality Gate (pre-memory snapshot; re-run after editor)
    {
      const live = useNovelStore.getState();
      const preQ = evaluateChapterQuality({
        chapter: params.chapterNumber,
        content: updatedChapter.noi_dung,
        characterNames: live.nhan_vat || [],
        wordGoal: live.setup?.so_tu_chuong || 4250,
        userRules: live.userRules,
      });
      setChapterQuality(preQ);
      if (!preQ.mediaReady) {
        pushToast(
          'warn',
          `Quality Gate ch${params.chapterNumber}`,
          `${preQ.hardErrors} lỗi · ${preQ.warnings} cảnh báo — media bị chặn đến khi đạt gate.`,
          12_000,
        );
      }
    }

    // Memory must not share write abort signal — content already saved
    await commitChapterMemory(updatedChapter, updatedChapter.noi_dung, updatedChapters);

    // Superseded write: parent finally releases dang_tai if still owner.
    // Do NOT leave global lock stuck (blocks "Sinh chương" while char gen still works).
    if (!isCurrentGen(params.genId)) return;

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

    // P0 — re-gate with editor verdict (mediaReady requires accept-level)
    {
      const live = useNovelStore.getState();
      const chBody =
        live.danh_sach_chuong.find((c) => c.so_chuong === params.chapterNumber)?.noi_dung ||
        updatedChapter.noi_dung;
      const postQ = evaluateChapterQuality({
        chapter: params.chapterNumber,
        content: chBody,
        characterNames: live.nhan_vat || [],
        wordGoal: live.setup?.so_tu_chuong || 4250,
        userRules: live.userRules,
        editorVerdict: review?.verdict || live.editorReviews?.[params.chapterNumber]?.verdict,
      });
      setChapterQuality(postQ);
      if (postQ.mediaReady) {
        pushToast(
          'success',
          `Quality Gate ch${params.chapterNumber}`,
          `Media-ready · ${postQ.wordCount} từ · ${postQ.sceneCount} cảnh`,
          6_000,
        );
      }
    }

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
    } catch (psychErr) {
      throw new Error(`Narrative psych failed: ${psychErr instanceof Error ? psychErr.message : String(psychErr)}`);
    }

    // Auto one-shot revise if editor demands rewrite OR polish (YouTube-safe: don't ship raw AI)
    const needsAutoRevise =
      review?.verdict === 'rewrite' || review?.verdict === 'polish';
    if (
      !params.skipAutoRevise &&
      needsAutoRevise &&
      isCurrentGen(params.genId) &&
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
          ngon_ngu: resolveNgonNgu(useNovelStore.getState().setup.ngon_ngu),
          so_tu_chuong: useNovelStore.getState().setup.so_tu_chuong || 4250,
          nhan_vat: useNovelStore.getState().nhan_vat,
          nhan_vat_prompts: useNovelStore.getState().nhan_vat_prompts,
          signal: params.signal,
        });
        if (!isCurrentGen(params.genId)) return;
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
          isCurrentGen(params.genId) &&
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
                ngon_ngu: resolveNgonNgu(live.setup.ngon_ngu),
                so_tu_chuong: live.setup.so_tu_chuong || 4250,
                nhan_vat: live.nhan_vat,
                nhan_vat_prompts: live.nhan_vat_prompts,
                signal: params.signal,
              });
              if (!isCurrentGen(params.genId)) return;
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
            throw new Error(`Audio readability failed: ${arErr instanceof Error ? arErr.message : String(arErr)}`);
          }
        }
      } catch (e) {
        throw new Error(`Auto revise failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (!isCurrentGen(params.genId)) return;

    // Hook + YouTube meta — score ≥8.5 + rewrite (same as Studio Meta button)
    const finalCh = useNovelStore.getState().danh_sach_chuong.find(
      (c) => c.so_chuong === params.chapterNumber,
    );
    if (finalCh?.noi_dung) {
      const live = useNovelStore.getState();
      const visualDna = (live.visualDnaPrompt || live.mediaStylePreset || '').trim();
      if (!visualDna) {
        throw new Error('Thieu Visual DNA / Media Style de tao thumbnailPrompt.');
      }
      const chProfile = live.channels?.[live.activeChannelId || ''];
      setPromptError('📺 Meta YouTube: đang tự chấm + rewrite psych SEO...');
      const meta = await fetchYoutubeMetaWithQA({
        script: finalCh.noi_dung,
        novelTitle: live.ten_tac_pham,
        chapter: params.chapterNumber,
        maxRounds: 5,
        outerRetries: 2,
        usedTitles: chProfile?.usedHooks || [],
        usedThumbLines: chProfile?.usedThumbnailNotes || [],
        visualDna,
        characterHint:
          (live.nhan_vat || []).slice(0, 2).join(' and ') || undefined,
        signal: params.signal,
        chu_de: live.setup?.chu_de,
        phong_cach: live.setup?.phong_cach,
        styleEngineId: live.activeStyleEngineId,
      });
      let seoTitle = (meta.seoTitle || '').normalize('NFC').trim();
      if (seoTitle.length > YOUTUBE_MOBILE_TITLE_MAX) {
        const clipped = enforceMobileTitle(seoTitle, YOUTUBE_MOBILE_TITLE_MAX);
        if (clipped.length >= 28) seoTitle = clipped;
      }
      seoTitle = seoTitle.slice(0, YOUTUBE_TITLE_HARD_MAX);
      const titleVariants = buildFiveTitleFormulas({
        hook: meta.hook || seoTitle,
        novelTitle: live.ten_tac_pham,
        seed: params.chapterNumber * 97 + meta.rounds,
      });
      const { buildEndScreenPromptHint } = await import('@/lib/matrixEngine');
      live.setChapterHook(params.chapterNumber, {
        hook: meta.hook,
        thumbnailLine: meta.thumbnailLine.slice(0, 30),
        seoTitle,
        seoTitleVariants: titleVariants,
        seoDescription: meta.seoDescription,
        seoTags: meta.seoTags,
        thumbnailPrompt:
          meta.thumbnailPrompt ||
          buildThumbnailPrompt({
            hook: meta.hook,
            thumbnailLine: meta.thumbnailLine,
            visualDna,
            characterHint:
              (live.nhan_vat || []).slice(0, 2).join(' and ') || undefined,
          }),
        endScreenPrompt: buildEndScreenPromptHint({
          genreLabel: [live.setup?.chu_de, live.setup?.phong_cach]
            .filter(Boolean)
            .join(' / '),
          visualDna,
          nextHook: (meta.hook || seoTitle || '').slice(0, 80),
        }),
      });
      try {
        live.rememberChannelMotif?.('hook', seoTitle.slice(0, 120));
        live.rememberChannelMotif?.('thumb', meta.thumbnailLine.slice(0, 80));
      } catch (motifErr) {
        throw new Error(
          `Khong luu duoc channel motif: ${motifErr instanceof Error ? motifErr.message : String(motifErr)}`,
        );
      }
      const scoreLine = formatMetaScoreLine(meta.scores);
      if (!meta.passed) {
        pushToast(
          'warn',
          `Meta ch${params.chapterNumber} — điểm thấp`,
          `${scoreLine} · rewrite ${meta.rounds} vòng chưa ≥${YOUTUBE_META_PASS_SCORE}. Mở YouTube Studio → Meta để rewrite tiếp.`,
          12_000,
        );
        setPromptError(
          `⚠️ Meta SEO dưới chuẩn: ${scoreLine}. Bấm Meta trong YouTube Studio để rewrite.`,
        );
      } else {
        pushToast(
          'success',
          `Meta ch${params.chapterNumber}`,
          `Pass · ${scoreLine}`,
          6_000,
        );
        setPromptError('');
      }
      // New AI draft → require human pass again
      useNovelStore.getState().setHumanEditFlag(params.chapterNumber, {
        edited: false,
        note: 'reset after AI write',
      });
    }

    // Loading release is owned by useWriteChapter finally (avoids double-clear races).
    // Still clear here if we remain current — defensive for callers that skip finally.
    if (isCurrentGen(params.genId)) {
      setIsStreaming(false);
      useNovelStore.getState().setDangTai(false);
    }
    useNovelStore.getState().setTabHienTai('noi_dung');

    sendNotification(
      'Hệ Thống AI Novel',
      `Chương ${params.currentChapter.so_chuong} đã được sinh xong!`,
    );
}
