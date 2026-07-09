'use client';

import { useState, useEffect, useRef } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { playTTSAction, generateTTSAction } from '../modules/ttsModule';
import { recordEngineCheckpoint, recordEngineSnapshot } from '../modules/engineModule';
import {
  evaluateYoutubeTtsGate,
  mergeYoutubeSafe,
  YOUTUBE_HOOK_SCENE_INDEX,
} from '@/lib/youtubeSafe';
import { parseScenes } from '../utils/stringUtils';
import {
  clearChapterFailLog,
  loadChapterFailLog,
  saveChapterFailLog,
} from '@/lib/multiTtsPartialCache';
import {
  formatChapterPreflightConfirm,
  formatPreflightConfirm,
  runCastPreflight,
  runChapterCastPreflight,
} from '../modules/castPreflight';


interface SceneAutomationOptions {
  chapterNumber?: number;
  silent?: boolean;
  /** Skip YouTube editor gate (automation / force) */
  bypassYoutubeGate?: boolean;
  /** Skip credit deduct (chapter batch already counted) */
  skipCredit?: boolean;
  /** Force full multi regen (ignore segment resume cache) */
  forceFullMulti?: boolean;
  /** Skip cast preflight confirm */
  skipPreflight?: boolean;
}

export interface ChapterTTSOptions {
  includeHook?: boolean;
  /** Skip scenes that already have audioPath */
  skipExisting?: boolean;
  /** Only re-run scenes recorded as failed in last chapter batch */
  onlyFailed?: boolean;
  silent?: boolean;
}

type NovelStoreSnapshot = ReturnType<typeof useNovelStore.getState>;

function getTTSApiCredentials(state: NovelStoreSnapshot) {
  if (state.ttsConfig.platform === 'openai_tts') {
    const apiKeys = state.openaiApiKeys?.length
      ? state.openaiApiKeys
      : (state.openaiApiKey ? [state.openaiApiKey] : []);
    return { apiKeys, apiKey: state.openaiApiKey || '' };
  }

  const apiKeys = state.apiKeys?.length ? state.apiKeys : (state.apiKey ? [state.apiKey] : []);
  return { apiKeys, apiKey: state.apiKey || '' };
}

export function useTTSActions() {
  const [audioPreview, setAudioPreview] = useState<HTMLAudioElement | null>(null);
  const [isPlayingTTS, setIsPlayingTTS] = useState<{ [sceneIndex: number]: boolean }>({});
  const [generatingTTS, setGeneratingTTS] = useState<{ [sceneIndex: number]: boolean }>({});
  const [ttsProgress, setTtsProgress] = useState<{ [sceneIndex: number]: number }>({});
  const [ttsStatus, setTtsStatus] = useState<{ [sceneIndex: number]: string }>({});
  const [chapterTtsRunning, setChapterTtsRunning] = useState(false);
  const [chapterTtsProgress, setChapterTtsProgress] = useState(0);
  const [chapterTtsStatus, setChapterTtsStatus] = useState('');
  const chapterAbortRef = useRef(false);

  useEffect(() => {
    return () => {
      if (audioPreview) {
        audioPreview.pause();
      }
    };
  }, [audioPreview]);

  const handlePlayTTS = async (text: string, sceneIndex: number, voice: string) => {
    handleStopTTS();
    const state = useNovelStore.getState();
    const finalVoice = voice || state.ttsConfig.voice;
    const ttsApiCredentials = getTTSApiCredentials(state);

    try {
      await playTTSAction({
        text,
        voice: finalVoice,
        ttsConfig: state.ttsConfig,
        apiKeys: ttsApiCredentials.apiKeys,
        apiKey: ttsApiCredentials.apiKey,
        ten_tac_pham: state.ten_tac_pham || 'Kịch Bản Vô Danh',
        onStart: () => {
          setIsPlayingTTS(prev => ({ ...prev, [sceneIndex]: true }));
        },
        onSuccess: (audio) => {
          setAudioPreview(audio);
        },
        onEnded: () => {
          setIsPlayingTTS(prev => ({ ...prev, [sceneIndex]: false }));
        },
        onError: (msg) => {
          alert(`Lỗi nghe thử: ${msg}`);
        }
      });
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStopTTS = () => {
    if (audioPreview) {
      audioPreview.pause();
      setAudioPreview(null);
    }
    setIsPlayingTTS({});
  };

  const handleGenerateTTS = async (
    sceneText: string,
    sceneIndex: number,
    voice: string,
    targetDuration?: number,
    options: SceneAutomationOptions = {},
  ): Promise<number | undefined> => {
    const state = useNovelStore.getState();
    const chapterNumber = options.chapterNumber || state.chuong_dang_chon;
    const finalVoice = voice || state.ttsConfig.voice;
    const ttsApiCredentials = getTTSApiCredentials(state);
    const cost = 1;

    const yt = mergeYoutubeSafe(state.youtubeSafe);
    const chapter = state.danh_sach_chuong.find((c) => c.so_chuong === chapterNumber);
    const gate = evaluateYoutubeTtsGate({
      enforceEditorGate: yt.enforceEditorGate !== false,
      requireHumanEdit: yt.requireHumanEdit === true,
      humanEdited: !!state.humanEditFlags?.[chapterNumber]?.edited,
      chapterNumber,
      hasScript: !!(sceneText?.trim() || chapter?.noi_dung?.trim()),
      editorReview: state.editorReviews[chapterNumber],
      ttsPlatform: state.ttsConfig.platform,
      ttsPitch: state.ttsConfig.pitch,
      ttsSpeed: state.ttsConfig.speed,
      bypass: options.bypassYoutubeGate === true,
    });

    if (gate.hardBlock) {
      const msg = `🚫 YouTube-safe gate:\n• ${gate.reasons.join('\n• ')}`;
      if (!options.silent) alert(msg);
      throw new Error(gate.reasons.join(' | '));
    }

    if (gate.warnings.length > 0 && !options.silent) {
      const proceed = confirm(
        `⚠️ Cảnh báo YouTube-safe:\n• ${gate.warnings.join('\n• ')}\n\nVẫn tiếp tục sinh TTS?`,
      );
      if (!proceed) return;
    }

    // Cast preflight (warn / block before spending credits)
    if (!options.skipPreflight && !options.silent) {
      const pf = runCastPreflight({
        sceneText,
        chapter: chapterNumber,
        sceneIndex,
        cast: state.voiceCast,
        characterNames: state.nhan_vat || [],
        nhanVatPrompts: state.nhan_vat_prompts || {},
        defaultVoice: finalVoice || state.ttsConfig.voice || '',
        platform: state.ttsConfig.platform,
        language: state.ttsConfig.language || 'vi',
        globalSpeed: state.ttsConfig.speed ?? 1,
        globalPitch: state.ttsConfig.pitch ?? 0,
      });
      if (!pf.ok) {
        alert(
          `🚫 Không thể gen TTS:\n• ${pf.issues
            .filter((i) => i.level === 'block')
            .map((i) => i.message)
            .join('\n• ')}`,
        );
        return;
      }
      // Confirm only on warnings or resume cache (not every multi gen)
      const needsConfirm =
        pf.issues.some((i) => i.level === 'warn') || pf.partialCached > 0;
      if (needsConfirm) {
        const proceed = confirm(formatPreflightConfirm(pf));
        if (!proceed) return;
      }
    }

    if (!options.skipCredit) {
      if (!state.deductCredits(cost)) {
        if (!options.silent) {
          alert(`Bạn đã hết Tín dụng. Sinh giọng đọc này cần ${cost} tín dụng.`);
        }
        return;
      }
    }

    setGeneratingTTS(prev => ({ ...prev, [sceneIndex]: true }));
    setTtsProgress(prev => ({ ...prev, [sceneIndex]: 0 }));
    setTtsStatus(prev => ({ ...prev, [sceneIndex]: 'Đang chuẩn bị…' }));

    const assetKey = `${chapterNumber}_${sceneIndex}`;
    state.addGeneratedAudio(assetKey, '', 0);

    try {
      const { audioPath, duration, selfRepair, multi, segmentCount } = await generateTTSAction({
        apiKey: ttsApiCredentials.apiKey,
        apiKeys: ttsApiCredentials.apiKeys,
        sceneText,
        chuong_dang_chon: chapterNumber,
        sceneIndex,
        savePathTTS: state.savePathTTS || '',
        googleDrivePath: state.googleDrivePath || '',
        voice: finalVoice,
        ten_tac_pham: state.ten_tac_pham || 'Kịch Bản Vô Danh',
        ttsConfig: state.ttsConfig,
        targetDuration,
        syncMode: state.ttsConfig.syncMode,
        forceFullMulti: options.forceFullMulti === true,
        onProgress: (ev) => {
          setTtsProgress((prev) => ({
            ...prev,
            [sceneIndex]: Math.min(100, Math.max(0, ev.percent)),
          }));
          if (ev.label) {
            setTtsStatus((prev) => ({ ...prev, [sceneIndex]: ev.label || '' }));
          }
        },
      });

      setTtsProgress(prev => ({ ...prev, [sceneIndex]: 100 }));
      setTtsStatus(prev => ({
        ...prev,
        [sceneIndex]: multi
          ? `Xong đa giọng · ${segmentCount || '?'} đoạn`
          : 'Hoàn tất',
      }));
      const latestState = useNovelStore.getState();
      latestState.addGeneratedAudio(assetKey, audioPath, duration);

      void recordEngineCheckpoint({
        step: 'tts_audio',
        scope: { kind: 'scene', chapter: chapterNumber, scene: sceneIndex },
        projectName: latestState.ten_tac_pham,
        payload: {
          assetKey,
          audioPath,
          duration,
          voice: finalVoice,
          platform: latestState.ttsConfig.platform,
          multi: !!multi,
          segmentCount: segmentCount || 1,
        },
      });

      void recordEngineSnapshot({
        ten_tac_pham: latestState.ten_tac_pham,
        chuong_dang_chon: latestState.chuong_dang_chon,
        setup: latestState.setup,
        danh_sach_chuong: latestState.danh_sach_chuong,
        editorReviews: latestState.editorReviews,
        generatedAudioPaths: {
          ...latestState.generatedAudioPaths,
          [assetKey]: { path: audioPath, duration },
        },
        generatedImages: latestState.generatedImages,
        generatedVideos: latestState.generatedVideos,
      });

      if (!options.silent) {
        const multiHint = multi ? ` · đa giọng ${segmentCount} đoạn` : '';
        alert(
          `Đã sinh âm thanh TTS (${finalVoice})${multiHint} thành công. Thời lượng: ${duration}s`,
        );
      }
      if (!options.silent && selfRepair?.message) {
        alert(`Self-healing TTS: ${selfRepair.message}`);
      }
      return duration;
    } catch (err: unknown) {
      setTtsProgress(prev => ({ ...prev, [sceneIndex]: 0 }));
      setTtsStatus(prev => ({ ...prev, [sceneIndex]: '' }));
      if (!options.silent) {
        alert(`Lỗi sinh TTS: ${err instanceof Error ? err.message : String(err)}`);
      }
      throw err;
    } finally {
      setGeneratingTTS(prev => ({ ...prev, [sceneIndex]: false }));
      setTimeout(() => {
        setTtsProgress(prev => ({ ...prev, [sceneIndex]: 0 }));
        setTtsStatus(prev => ({ ...prev, [sceneIndex]: '' }));
      }, 1800);
    }
  };

  const handleStopChapterTTS = () => {
    chapterAbortRef.current = true;
    setChapterTtsStatus('Đang dừng…');
  };

  /**
   * Gen TTS tuần tự cho mọi cảnh (và tùy chọn Hook) của chương hiện tại.
   * Cast multi + retry per-seg đã nằm trong generateTTSAction.
   */
  const handleGenerateChapterTTS = async (
    chapterOpts: ChapterTTSOptions = {},
  ): Promise<{ ok: number; fail: number; skipped: number }> => {
    const {
      includeHook = true,
      skipExisting = true,
      onlyFailed = false,
      silent = false,
    } = chapterOpts;

    const state = useNovelStore.getState();
    const chapterNumber = state.chuong_dang_chon;
    const chapter = state.danh_sach_chuong.find((c) => c.so_chuong === chapterNumber);
    if (!chapter?.noi_dung?.trim() && !state.chapterHooks?.[chapterNumber]?.hook?.trim()) {
      if (!silent) alert('Chương chưa có nội dung / hook để gen TTS.');
      return { ok: 0, fail: 0, skipped: 0 };
    }

    const scenes = parseScenes(chapter?.noi_dung || '');
    type Job = { sceneIndex: number; text: string; title: string };
    let jobs: Job[] = [];

    if (includeHook) {
      const hook = state.chapterHooks?.[chapterNumber]?.hook?.trim() || '';
      if (hook) {
        jobs.push({
          sceneIndex: YOUTUBE_HOOK_SCENE_INDEX,
          text: hook,
          title: 'Hook',
        });
      }
    }
    scenes.forEach((s, idx) => {
      if (s.content?.trim()) {
        jobs.push({
          sceneIndex: idx,
          text: s.content,
          title: s.title || `Cảnh ${idx + 1}`,
        });
      }
    });

    if (onlyFailed) {
      const failed = new Set(loadChapterFailLog(chapterNumber));
      if (!failed.size) {
        if (!silent) {
          alert('Không có log cảnh lỗi gần đây. Hãy gen cả chương trước.');
        }
        return { ok: 0, fail: 0, skipped: 0 };
      }
      jobs = jobs.filter((j) => failed.has(j.sceneIndex));
    }

    if (!jobs.length) {
      if (!silent) alert('Không có cảnh nào để gen TTS.');
      return { ok: 0, fail: 0, skipped: 0 };
    }

    // YouTube gate once for chapter
    const yt = mergeYoutubeSafe(state.youtubeSafe);
    const gate = evaluateYoutubeTtsGate({
      enforceEditorGate: yt.enforceEditorGate !== false,
      requireHumanEdit: yt.requireHumanEdit === true,
      humanEdited: !!state.humanEditFlags?.[chapterNumber]?.edited,
      chapterNumber,
      hasScript: true,
      editorReview: state.editorReviews[chapterNumber],
      ttsPlatform: state.ttsConfig.platform,
      ttsPitch: state.ttsConfig.pitch,
      ttsSpeed: state.ttsConfig.speed,
      bypass: false,
    });
    if (gate.hardBlock) {
      if (!silent) alert(`🚫 YouTube-safe gate:\n• ${gate.reasons.join('\n• ')}`);
      throw new Error(gate.reasons.join(' | '));
    }
    if (gate.warnings.length && !silent) {
      const proceed = confirm(
        `⚠️ Cảnh báo YouTube-safe:\n• ${gate.warnings.join('\n• ')}\n\nVẫn gen TTS (${jobs.length} mục)?`,
      );
      if (!proceed) return { ok: 0, fail: 0, skipped: 0 };
    }

    // Chapter cast preflight (aggregate)
    const chPf = runChapterCastPreflight({
      jobs,
      chapter: chapterNumber,
      cast: state.voiceCast,
      characterNames: state.nhan_vat || [],
      nhanVatPrompts: state.nhan_vat_prompts || {},
      defaultVoice: state.ttsConfig.voice || '',
      platform: state.ttsConfig.platform,
      language: state.ttsConfig.language || 'vi',
      globalSpeed: state.ttsConfig.speed ?? 1,
      globalPitch: state.ttsConfig.pitch ?? 0,
    });

    if (!chPf.runnable.length) {
      if (!silent) {
        alert(
          `🚫 Không có cảnh nào chạy được.\n` +
            formatChapterPreflightConfirm(chPf, { onlyFailed }),
        );
      }
      return { ok: 0, fail: chPf.blocked.length, skipped: 0 };
    }

    if (!silent) {
      const proceed = confirm(
        formatChapterPreflightConfirm(chPf, { onlyFailed }) +
          (skipExisting && !onlyFailed
            ? '\n(Đã có audio sẽ bỏ qua)'
            : ''),
      );
      if (!proceed) return { ok: 0, fail: 0, skipped: 0 };
    }

    // Only process runnable jobs; blocked counted as skipped-block
    const blockedSet = new Set(chPf.blocked.map((b) => b.job.sceneIndex));
    jobs = jobs.filter((j) => !blockedSet.has(j.sceneIndex));

    chapterAbortRef.current = false;
    setChapterTtsRunning(true);
    setChapterTtsProgress(0);
    setChapterTtsStatus(
      `Preflight OK · ${jobs.length} cảnh · multi ${chPf.multiScenes}`,
    );

    let ok = 0;
    let fail = 0;
    let skipped = chPf.blocked.length; // blocked scenes
    const errors: string[] = chPf.blocked.map(
      (b) =>
        `${b.job.title}: block — ${
          b.result.issues.find((i) => i.level === 'block')?.message || 'preflight'
        }`,
    );
    const failedIndexes: number[] = [];

    try {
      for (let j = 0; j < jobs.length; j++) {
        if (chapterAbortRef.current) {
          setChapterTtsStatus('Đã dừng bởi người dùng');
          break;
        }
        const job = jobs[j];
        const assetKey = `${chapterNumber}_${job.sceneIndex}`;
        const livePaths = useNovelStore.getState().generatedAudioPaths;
        const existing = livePaths?.[assetKey];
        if (
          !onlyFailed &&
          skipExisting &&
          existing?.path &&
          Number(existing.duration) > 0
        ) {
          skipped += 1;
          setChapterTtsProgress(Math.round(((j + 1) / jobs.length) * 100));
          setChapterTtsStatus(`Bỏ qua ${job.title} (đã có audio)`);
          continue;
        }

        const st = useNovelStore.getState();
        if (!st.deductCredits(1)) {
          errors.push(`${job.title}: hết tín dụng`);
          fail += 1;
          failedIndexes.push(job.sceneIndex);
          break;
        }

        setChapterTtsStatus(`Đang gen ${j + 1}/${jobs.length}: ${job.title}`);
        setChapterTtsProgress(Math.round((j / jobs.length) * 100));

        try {
          await handleGenerateTTS(job.text, job.sceneIndex, '', undefined, {
            chapterNumber,
            silent: true,
            bypassYoutubeGate: true,
            skipCredit: true,
            skipPreflight: true,
          });
          ok += 1;
        } catch (e) {
          fail += 1;
          failedIndexes.push(job.sceneIndex);
          errors.push(
            `${job.title}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }

        setChapterTtsProgress(Math.round(((j + 1) / jobs.length) * 100));
      }

      if (failedIndexes.length) {
        saveChapterFailLog(chapterNumber, failedIndexes);
      } else if (!chapterAbortRef.current) {
        clearChapterFailLog(chapterNumber);
      }

      setChapterTtsStatus(
        `Xong · OK ${ok} · lỗi ${fail} · bỏ qua ${skipped}` +
          (chapterAbortRef.current ? ' · (dừng sớm)' : '') +
          (failedIndexes.length ? ` · lưu ${failedIndexes.length} cảnh lỗi` : ''),
      );

      if (!silent) {
        let msg = `TTS chương ${chapterNumber}:\n• Thành công: ${ok}\n• Lỗi: ${fail}\n• Bỏ qua: ${skipped}`;
        if (failedIndexes.length) {
          msg += `\n• Có thể bấm 「Gen lại cảnh lỗi」`;
        }
        if (errors.length) {
          msg += `\n\nChi tiết:\n• ${errors.slice(0, 5).join('\n• ')}`;
          if (errors.length > 5) msg += `\n… (+${errors.length - 5})`;
        }
        alert(msg);
      }

      return { ok, fail, skipped };
    } finally {
      setChapterTtsRunning(false);
      setTimeout(() => {
        setChapterTtsProgress(0);
        setChapterTtsStatus('');
      }, 4000);
    }
  };

  /** Dry-run: chapter cast preflight report without generating */
  const handleChapterCastPreflight = (): string | null => {
    const state = useNovelStore.getState();
    const chapterNumber = state.chuong_dang_chon;
    const chapter = state.danh_sach_chuong.find((c) => c.so_chuong === chapterNumber);
    const scenes = parseScenes(chapter?.noi_dung || '');
    const jobs: { sceneIndex: number; text: string; title: string }[] = [];
    const hook = state.chapterHooks?.[chapterNumber]?.hook?.trim() || '';
    if (hook) {
      jobs.push({
        sceneIndex: YOUTUBE_HOOK_SCENE_INDEX,
        text: hook,
        title: 'Hook',
      });
    }
    scenes.forEach((s, idx) => {
      if (s.content?.trim()) {
        jobs.push({
          sceneIndex: idx,
          text: s.content,
          title: s.title || `Cảnh ${idx + 1}`,
        });
      }
    });
    if (!jobs.length) {
      alert('Chương chưa có nội dung để kiểm tra.');
      return null;
    }
    const chPf = runChapterCastPreflight({
      jobs,
      chapter: chapterNumber,
      cast: state.voiceCast,
      characterNames: state.nhan_vat || [],
      nhanVatPrompts: state.nhan_vat_prompts || {},
      defaultVoice: state.ttsConfig.voice || '',
      platform: state.ttsConfig.platform,
      language: state.ttsConfig.language || 'vi',
      globalSpeed: state.ttsConfig.speed ?? 1,
      globalPitch: state.ttsConfig.pitch ?? 0,
    });
    const report = formatChapterPreflightConfirm(chPf).replace(
      '\n\nTiếp tục?',
      '',
    );
    alert(report);
    return report;
  };

  return {
    isPlayingTTS,
    generatingTTS,
    ttsProgress,
    ttsStatus,
    chapterTtsRunning,
    chapterTtsProgress,
    chapterTtsStatus,
    handlePlayTTS,
    handleStopTTS,
    handleGenerateTTS,
    handleGenerateChapterTTS,
    handleStopChapterTTS,
    handleChapterCastPreflight,
  };
}
