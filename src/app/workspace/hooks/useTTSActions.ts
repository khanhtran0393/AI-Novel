'use client';

import { useState, useEffect } from 'react';
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
  pruneDeadPartialParts,
  saveChapterFailLog,
} from '@/lib/multiTtsPartialCache';
import {
  formatChapterPreflightConfirm,
  formatPreflightConfirm,
  runCastPreflight,
  runChapterCastPreflight,
} from '../modules/castPreflight';
import { persistTextReport } from '@/lib/downloadText';
import {
  cancelChapterQueue,
  getChapterQueueState,
  hydrateChapterQueueFromDisk,
  startChapterQueue,
  subscribeChapterQueue,
  type ChapterQueueSnapshot,
} from '@/lib/ttsChapterQueue';


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
  const [chapterQueue, setChapterQueue] = useState<ChapterQueueSnapshot>(() =>
    getChapterQueueState(),
  );

  useEffect(() => {
    void hydrateChapterQueueFromDisk();
    return subscribeChapterQueue(setChapterQueue);
  }, []);

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
    cancelChapterQueue();
  };

  /**
   * Gen TTS chương qua queue nền (sống sót remount React / đổi tab).
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

    if (getChapterQueueState().running) {
      if (!silent) alert('Đang có job TTS chương chạy nền. Bấm Dừng trước.');
      return { ok: 0, fail: 0, skipped: 0 };
    }

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
          (skipExisting && !onlyFailed ? '\n(Đã có audio sẽ bỏ qua)' : '') +
          '\n\n⏱ Job chạy NỀN — đổi tab/cảnh vẫn tiếp tục gen.',
      );
      if (!proceed) return { ok: 0, fail: 0, skipped: 0 };
    }

    const blockedSet = new Set(chPf.blocked.map((b) => b.job.sceneIndex));
    jobs = jobs.filter((j) => !blockedSet.has(j.sceneIndex));
    const initialErrors = chPf.blocked.map(
      (b) =>
        `${b.job.title}: block — ${
          b.result.issues.find((i) => i.level === 'block')?.message || 'preflight'
        }`,
    );

    const result = await startChapterQueue({
      chapterNumber,
      jobs,
      skipExisting: !onlyFailed && skipExisting,
      initialSkipped: chPf.blocked.length,
      initialErrors,
      hasExistingAudio: (sceneIndex) => {
        const assetKey = `${chapterNumber}_${sceneIndex}`;
        const existing = useNovelStore.getState().generatedAudioPaths?.[assetKey];
        return !!(existing?.path && Number(existing.duration) > 0);
      },
      deductCredit: () => useNovelStore.getState().deductCredits(1),
      generateOne: async (job) => {
        const st = useNovelStore.getState();
        const creds = getTTSApiCredentials(st);
        const { audioPath, duration, multi, segmentCount } = await generateTTSAction({
          apiKey: creds.apiKey,
          apiKeys: creds.apiKeys,
          sceneText: job.text,
          chuong_dang_chon: chapterNumber,
          sceneIndex: job.sceneIndex,
          savePathTTS: st.savePathTTS || '',
          googleDrivePath: st.googleDrivePath || '',
          voice: st.ttsConfig.voice || '',
          ten_tac_pham: st.ten_tac_pham || 'Kịch Bản Vô Danh',
          ttsConfig: st.ttsConfig,
          syncMode: st.ttsConfig.syncMode,
          forceFullMulti: false,
        });
        const assetKey = `${chapterNumber}_${job.sceneIndex}`;
        useNovelStore.getState().addGeneratedAudio(assetKey, audioPath, duration);
        void recordEngineCheckpoint({
          step: 'tts_audio',
          scope: { kind: 'scene', chapter: chapterNumber, scene: job.sceneIndex },
          projectName: st.ten_tac_pham,
          payload: {
            assetKey,
            audioPath,
            duration,
            multi: !!multi,
            segmentCount: segmentCount || 1,
            backgroundQueue: true,
          },
        });
      },
      onComplete: (r) => {
        if (r.failedIndexes.length) {
          saveChapterFailLog(chapterNumber, r.failedIndexes);
        } else if (!r.cancelled) {
          clearChapterFailLog(chapterNumber);
        }
        if (!silent) {
          let msg = `TTS chương ${chapterNumber} (nền):\n• Thành công: ${r.ok}\n• Lỗi: ${r.fail}\n• Bỏ qua: ${r.skipped}`;
          if (r.cancelled) msg += '\n• (Đã dừng sớm)';
          if (r.failedIndexes.length) msg += `\n• Bấm 「Gen lại cảnh lỗi」 để retry`;
          if (r.errors.length) {
            msg += `\n\nChi tiết:\n• ${r.errors.slice(0, 5).join('\n• ')}`;
          }
          alert(msg);
        }
      },
    });

    return result;
  };

  /** Dry-run preflight + export report file */
  const handleChapterCastPreflight = async (
    opts?: { exportFile?: boolean },
  ): Promise<string | null> => {
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

    let pruned = 0;
    for (const j of jobs) {
      try {
        pruned += await pruneDeadPartialParts(chapterNumber, j.sceneIndex);
      } catch {
        /* ignore */
      }
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
    let report = formatChapterPreflightConfirm(chPf).replace(
      '\n\nTiếp tục?',
      '',
    );
    report =
      `# AI Novel — Cast Preflight Report\n` +
      `# Chương ${chapterNumber} · ${new Date().toISOString()}\n` +
      `# Tác phẩm: ${state.ten_tac_pham || '(chưa đặt)'}\n\n` +
      report;
    if (pruned > 0) {
      report += `\n\n🧹 Đã dọn ${pruned} partial path chết (file không còn).`;
    }

    // Always download/persist report when exportFile (default true for dry-run button)
    const shouldExport = opts?.exportFile !== false;
    let saveNote = '';
    if (shouldExport) {
      const fname = `cast-preflight-ch${chapterNumber}-${Date.now()}.txt`;
      const saved = await persistTextReport(fname, report);
      if (saved.via === 'electron' && saved.path) {
        saveNote = `\n\n📁 Đã lưu: ${saved.path}`;
      } else {
        saveNote = `\n\n📥 Đã tải file: ${fname}`;
      }
    }

    alert(report + saveNote);
    return report;
  };

  return {
    isPlayingTTS,
    generatingTTS,
    ttsProgress,
    ttsStatus,
    chapterTtsRunning: chapterQueue.running,
    chapterTtsProgress: chapterQueue.progress,
    chapterTtsStatus: chapterQueue.status,
    chapterQueue,
    handlePlayTTS,
    handleStopTTS,
    handleGenerateTTS,
    handleGenerateChapterTTS,
    handleStopChapterTTS,
    handleChapterCastPreflight,
  };
}
