'use client';

import { useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { playTTSAction, generateTTSAction } from '../modules/ttsModule';

export function useTTSActions() {
  const store = useNovelStore();
  const [audioPreview, setAudioPreview] = useState<HTMLAudioElement | null>(null);
  const [isPlayingTTS, setIsPlayingTTS] = useState<{ [sceneIndex: number]: boolean }>({});
  const [generatingTTS, setGeneratingTTS] = useState<{ [sceneIndex: number]: boolean }>({});

  // Nghe thử cục bộ phân cảnh (ưu tiên Gemini TTS API cho đa giọng, fallback Google Translate TTS)
  const handlePlayTTS = async (text: string, sceneIndex: number, voice: string) => {
    handleStopTTS();
    const finalVoice = voice || store.ttsConfig.voice;

    try {
      await playTTSAction({
        text,
        voice: finalVoice,
        ttsConfig: voice ? undefined : store.ttsConfig,
        apiKeys: store.apiKeys || [],
        apiKey: store.apiKey,
        useMock: store.useMock,
        ten_tac_pham: store.ten_tac_pham || 'Kịch Bản Vô Danh',
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
          alert(`❌ Lỗi nghe thử: ${msg}`);
        }
      });
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // Dừng phát thử âm thanh
  const handleStopTTS = () => {
    if (audioPreview) {
      audioPreview.pause();
      setAudioPreview(null);
    }
    setIsPlayingTTS({});
  };

  // Gọi API backend sinh âm thanh TTS (Gemini TTS) và tự động lưu Google Drive
  const handleGenerateTTS = async (sceneText: string, sceneIndex: number, voice: string) => {
    const finalVoice = voice || store.ttsConfig.voice;
    const finalPlatform = voice ? 'google' : store.ttsConfig.platform; // Nếu chọn voice thủ công, tạm để google (hoặc tự detect). Tốt nhất là truyền ttsConfig.
    const isPremium = finalVoice.startsWith('VBEE_') || store.ttsConfig.platform === 'elevenlabs' || store.ttsConfig.platform === 'vbee';
    
    const cost = isPremium ? 3 : 1;
    if (!store.deductCredits(cost)) {
      alert(`⚠️ Bạn đã hết Tín dụng. Sinh giọng đọc này cần ${cost} tín dụng. Vui lòng nâng cấp gói Pro!`);
      return;
    }
    setGeneratingTTS(prev => ({ ...prev, [sceneIndex]: true }));
    try {
      const { audioPath, duration } = await generateTTSAction({
        useMock: store.useMock,
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        sceneText,
        chuong_dang_chon: store.chuong_dang_chon,
        sceneIndex,
        savePathTTS: store.savePathTTS || '',
        googleDrivePath: store.googleDrivePath || '',
        voice: finalVoice,
        ten_tac_pham: store.ten_tac_pham || 'Kịch Bản Vô Danh',
        ttsConfig: voice ? undefined : store.ttsConfig
      });

      const assetKey = `${store.chuong_dang_chon}_${sceneIndex}`;
      store.addGeneratedAudio(assetKey, audioPath, duration);

      alert(`🎉 Đã sinh âm thanh TTS (${finalVoice}) thành công! Thời lượng: ${duration}s`);
    } catch (err: unknown) {
      alert(`❌ Lỗi sinh TTS: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGeneratingTTS(prev => ({ ...prev, [sceneIndex]: false }));
    }
  };

  return {
    isPlayingTTS,
    generatingTTS,
    handlePlayTTS,
    handleStopTTS,
    handleGenerateTTS
  };
}
