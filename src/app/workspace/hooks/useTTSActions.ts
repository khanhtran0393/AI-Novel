'use client';

import { useState, useEffect } from 'react';
import { sceneAssetKey } from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';
import { playTTSAction, generateTTSAction } from '../modules/ttsModule';
import { recordEngineCheckpoint, recordEngineSnapshot } from '../modules/engineModule';
import {
  evaluateYoutubeTtsGate,
  mergeYoutubeSafe,
} from '@/lib/youtubeSafe';
import {
  formatPreflightConfirm,
  runCastPreflight,
} from '../modules/castPreflight';
import { toast } from '@/lib/toastBus';
import { appConfirm, splitConfirmBody } from '@/lib/confirmDialog';
import {
  resyncPromptTimestamps,
  timestampsNeedResync,
} from '@/lib/timestampSync';
import { cancelChapterQueue } from '@/lib/ttsChapterQueue';
import {
  getTTSApiCredentials,
  resolveDefaultTtsVoice,
  type SceneAutomationOptions,
  type ChapterTTSOptions,
} from './ttsActionHelpers';
import {
  generateChapterTts,
  runChapterCastPreflightReport,
} from './chapterTtsActions';
import { assertTtsMediaPreflight } from '@/lib/pipeline';
import { scheduleSilentChapterTimeline } from '../modules/integrationsModule';

export type { ChapterTTSOptions, SceneAutomationOptions } from './ttsActionHelpers';

export function useTTSActions() {
  const [audioPreview, setAudioPreview] = useState<HTMLAudioElement | null>(null);
  const [isPlayingTTS, setIsPlayingTTS] = useState<{ [sceneIndex: number]: boolean }>({});
  const [generatingTTS, setGeneratingTTS] = useState<{ [sceneIndex: number]: boolean }>({});
  const [ttsProgress, setTtsProgress] = useState<{ [sceneIndex: number]: number }>({});
  const [ttsStatus, setTtsStatus] = useState<{ [sceneIndex: number]: string }>({});

  // Chapter queue UI: useChapterTtsQueue() in a leaf component only —
  // do NOT subscribe here (would re-render whole workspace every progress tick).

  useEffect(() => {
    return () => {
      if (audioPreview) {
        audioPreview.pause();
      }
    };
  }, [audioPreview]);

  const handlePlayTTS = async (text: string, sceneIndex: number, voice: string) => {
    handleStopTTS();
    try {
      const state = useNovelStore.getState();
      const voiceRes = voice?.trim()
        ? { voice: voice.trim(), autoFilled: false }
        : resolveDefaultTtsVoice(state);
      const live = useNovelStore.getState();
      const finalVoice = voiceRes.voice.trim();
      const ttsApiCredentials = getTTSApiCredentials(live);
      const title = (live.ten_tac_pham || '').trim();
      if (!title) {
        throw new Error('Chua nhap ten_tac_pham. App khong tu gan ten truyen.');
      }

      await playTTSAction({
        text,
        voice: finalVoice,
        ttsConfig: live.ttsConfig,
        apiKeys: ttsApiCredentials.apiKeys,
        apiKey: ttsApiCredentials.apiKey,
        ten_tac_pham: title,
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
          setIsPlayingTTS(prev => ({ ...prev, [sceneIndex]: false }));
          toast.error('Nghe thử TTS', msg);
        }
      });
    } catch (err: unknown) {
      setIsPlayingTTS(prev => ({ ...prev, [sceneIndex]: false }));
      toast.error('TTS', err instanceof Error ? err.message : String(err));
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
    let finalVoice = '';
    try {
      finalVoice = (voice || resolveDefaultTtsVoice(state).voice).trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!options.silent) toast.error('TTS', msg);
      throw err;
    }
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
      if (!options.silent) toast.warn('YouTube gate', msg);
      throw new Error(gate.reasons.join(' | '));
    }

    // P1 — One consolidated preflight pass (media + cast + youtube warns)
    // Collect soft warnings; hard-fail once with single toast.
    const softWarns: string[] = [];

    // Media TTS (platform / voice / scene; quality soft-warn)
    try {
      const ttsPf = assertTtsMediaPreflight({
        chapter: chapterNumber,
        sceneIndex,
        sceneText,
        platform: state.ttsConfig.platform,
        voice: finalVoice || state.ttsConfig.voice,
        chu_de: state.setup?.chu_de,
        phong_cach: state.setup?.phong_cach,
        chapterContent: chapter?.noi_dung,
        characterNames: state.nhan_vat,
        wordGoal: state.setup?.so_tu_chuong || 4250,
        userRules: state.userRules,
        editorVerdict: state.editorReviews?.[chapterNumber]?.verdict,
      });
      for (const issue of ttsPf.issues.filter((i) => i.level === 'warn')) {
        softWarns.push(issue.message);
      }
    } catch (pfErr) {
      const msg = pfErr instanceof Error ? pfErr.message : String(pfErr);
      if (!options.silent) toast.error('Preflight TTS', msg);
      throw pfErr;
    }

    for (const w of gate.warnings) softWarns.push(`YouTube: ${w}`);

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
        language: (state.ttsConfig.language || '').trim(),
        globalSpeed: state.ttsConfig.speed ?? 1,
        globalPitch: state.ttsConfig.pitch ?? 0,
      });
      if (!pf.ok) {
        toast.error(
          'Preflight TTS',
          pf.issues
            .filter((i) => i.level === 'block')
            .map((i) => i.message)
            .join(' · '),
        );
        return;
      }
      for (const i of pf.issues.filter((x) => x.level === 'warn')) {
        softWarns.push(i.message);
      }
      // Single confirm for all soft warnings + cast resume cache
      const needsConfirm =
        softWarns.length > 0 ||
        pf.issues.some((i) => i.level === 'warn') ||
        pf.partialCached > 0 ||
        gate.warnings.length > 0;
      if (needsConfirm) {
        const raw = formatPreflightConfirm(pf);
        const body = splitConfirmBody(raw);
        const details = [
          ...softWarns.slice(0, 8),
          ...(body.details || []),
        ].filter(Boolean);
        const proceed = await appConfirm({
          title: 'Preflight TTS',
          message:
            body.message ||
            (softWarns.length
              ? 'Có cảnh báo preflight. Vẫn tiếp tục sinh TTS?'
              : 'Xác nhận preflight TTS'),
          details: details.length ? details : undefined,
          confirmLabel: 'Tiếp tục TTS',
          cancelLabel: 'Hủy',
          tone: 'warn',
        });
        if (!proceed) return;
      }
    } else if (!options.silent && softWarns.length > 0) {
      // skipPreflight / silent cast path: one toast, no spam per issue
      toast.warn('Preflight TTS', softWarns.slice(0, 4).join(' · '));
    }

    if (!options.skipCredit) {
      if (!state.deductCredits(cost)) {
        if (!options.silent) {
          toast.error('Hết tín dụng', `Cần ${cost} tín dụng cho TTS.`);
        }
        return;
      }
    }

    setGeneratingTTS(prev => ({ ...prev, [sceneIndex]: true }));
    setTtsProgress(prev => ({ ...prev, [sceneIndex]: 0 }));
    setTtsStatus(prev => ({ ...prev, [sceneIndex]: 'Đang chuẩn bị…' }));

    const assetKey = sceneAssetKey(chapterNumber, sceneIndex);
    state.addGeneratedAudio(assetKey, '', 0);

    try {
      const title = (state.ten_tac_pham || '').trim();
      if (!title) {
        throw new Error('Chua nhap ten_tac_pham. App khong tu gan ten truyen.');
      }
      const { audioPath, duration, selfRepair, multi, segmentCount } = await generateTTSAction({
        apiKey: ttsApiCredentials.apiKey,
        apiKeys: ttsApiCredentials.apiKeys,
        sceneText,
        chuong_dang_chon: chapterNumber,
        sceneIndex,
        savePathTTS: state.savePathTTS || '',
        googleDrivePath: state.googleDrivePath || '',
        voice: finalVoice,
        ten_tac_pham: title,
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

      // Auto re-sync storyboard timestamps when TTS duration drifts >15%
      try {
        const prompts = latestState.generatedPrompts?.[assetKey] || [];
        if (
          prompts.length > 0 &&
          duration > 0 &&
          timestampsNeedResync(
            prompts as import('@/lib/timestampSync').TimedPrompt[],
            duration,
            0.15,
          )
        ) {
          const synced = resyncPromptTimestamps(
            prompts as import('@/lib/timestampSync').TimedPrompt[],
            duration,
          );
          latestState.addGeneratedPrompts(assetKey, synced as typeof prompts);
          if (!options.silent) {
            toast.info(
              'Đồng bộ timestamp',
              `Prompt scene bám TTS ${duration}s (lệch >15%).`,
            );
          }
        }
      } catch {
        /* non-fatal */
      }
      scheduleSilentChapterTimeline({
        chapterNum: chapterNumber,
        delayMs: 350,
      });

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
        toast.success(
          'TTS xong',
          `${finalVoice}${multiHint} · ${duration}s`,
        );
      }
      try {
        const { markOnboardingStep } = await import('@/lib/onboarding');
        markOnboardingStep('tts');
      } catch {
        /* ignore */
      }
      if (!options.silent && selfRepair?.message) {
        toast.warn('Self-heal TTS', selfRepair.message);
      }
      return duration;
    } catch (err: unknown) {
      setTtsProgress(prev => ({ ...prev, [sceneIndex]: 0 }));
      setTtsStatus(prev => ({ ...prev, [sceneIndex]: '' }));
      if (!options.silent) {
        const e = err as Error & { correlationId?: string };
        const cid = e?.correlationId ? ` · cid ${e.correlationId}` : '';
        toast.error(
          'Lỗi sinh TTS',
          `${err instanceof Error ? err.message : String(err)}${cid}`,
        );
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

  /** Fire-and-forget from UI — generateChapterTts already schedules a detached appWork flow. */
  const handleGenerateChapterTTS = (chapterOpts: ChapterTTSOptions = {}) => {
    const p = generateChapterTts(chapterOpts);
    void p.catch((e) => {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      console.warn('[Chapter TTS]', e);
    });
    return p;
  };

  const handleChapterCastPreflight = (opts?: { exportFile?: boolean }) =>
    runChapterCastPreflightReport(opts);

  return {
    isPlayingTTS,
    generatingTTS,
    ttsProgress,
    ttsStatus,
    handlePlayTTS,
    handleStopTTS,
    handleGenerateTTS,
    handleGenerateChapterTTS,
    handleStopChapterTTS,
    handleChapterCastPreflight,
  };
}
