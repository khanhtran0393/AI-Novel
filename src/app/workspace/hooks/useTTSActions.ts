'use client';

import { useState, useEffect } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { playTTSAction, generateTTSAction } from '../modules/ttsModule';
import { recordEngineCheckpoint, recordEngineSnapshot } from '../modules/engineModule';

interface SceneAutomationOptions {
  chapterNumber?: number;
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
        useMock: false,
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
    const isPremium = finalVoice.startsWith('VBEE_') || state.ttsConfig.platform === 'elevenlabs' || state.ttsConfig.platform === 'vbee';
    const cost = isPremium ? 3 : 1;

    if (!state.deductCredits(cost)) {
      if (!options.silent) {
        alert(`Bạn đã hết Tín dụng. Sinh giọng đọc này cần ${cost} tín dụng.`);
      }
      return;
    }

    setGeneratingTTS(prev => ({ ...prev, [sceneIndex]: true }));
    setTtsProgress(prev => ({ ...prev, [sceneIndex]: 0 }));

    const progressInterval = setInterval(() => {
      setTtsProgress(prev => {
        const current = prev[sceneIndex] || 0;
        if (current >= 95) return prev;
        return { ...prev, [sceneIndex]: current + Math.floor(Math.random() * 5) + 1 };
      });
    }, 500);

    const assetKey = `${chapterNumber}_${sceneIndex}`;
    state.addGeneratedAudio(assetKey, '', 0);

    try {
      const { audioPath, duration } = await generateTTSAction({
        useMock: false,
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
        syncMode: state.ttsConfig.syncMode
      });

      setTtsProgress(prev => ({ ...prev, [sceneIndex]: 100 }));
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
        alert(`Đã sinh âm thanh TTS (${finalVoice}) thành công. Thời lượng: ${duration}s`);
      }
      return duration;
    } catch (err: unknown) {
      setTtsProgress(prev => ({ ...prev, [sceneIndex]: 0 }));
      if (!options.silent) {
        alert(`Lỗi sinh TTS: ${err instanceof Error ? err.message : String(err)}`);
      }
      throw err;
    } finally {
      clearInterval(progressInterval);
      setGeneratingTTS(prev => ({ ...prev, [sceneIndex]: false }));
      setTimeout(() => {
        setTtsProgress(prev => ({ ...prev, [sceneIndex]: 0 }));
      }, 1000);
    }
  };

  return {
    isPlayingTTS,
    generatingTTS,
    ttsProgress,
    handlePlayTTS,
    handleStopTTS,
    handleGenerateTTS
  };
}
