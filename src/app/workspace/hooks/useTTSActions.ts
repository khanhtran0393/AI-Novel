'use client';

import { useState, useEffect } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { playTTSAction, generateTTSAction } from '../modules/ttsModule';

export function useTTSActions() {
  const store = useNovelStore();
  const [audioPreview, setAudioPreview] = useState<HTMLAudioElement | null>(null);
  const [isPlayingTTS, setIsPlayingTTS] = useState<{ [sceneIndex: number]: boolean }>({});
  const [generatingTTS, setGeneratingTTS] = useState<{ [sceneIndex: number]: boolean }>({});
  const [ttsProgress, setTtsProgress] = useState<{ [sceneIndex: number]: number }>({});

  // Cleanup âm thanh khi component unmount
  useEffect(() => {
    return () => {
      if (audioPreview) {
        audioPreview.pause();
      }
    };
  }, [audioPreview]);

  // Nghe thử cục bộ phân cảnh (ưu tiên Gemini TTS API cho đa giọng, fallback Google Translate TTS)
  const handlePlayTTS = async (text: string, sceneIndex: number, voice: string) => {
    handleStopTTS();
    const finalVoice = voice || store.ttsConfig.voice;

    try {
      await playTTSAction({
        text,
        voice: finalVoice,
        ttsConfig: store.ttsConfig,
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
  const handleGenerateTTS = async (sceneText: string, sceneIndex: number, voice: string, targetDuration?: number): Promise<number | undefined> => {
    const finalVoice = voice || store.ttsConfig.voice;
    const isPremium = finalVoice.startsWith('VBEE_') || store.ttsConfig.platform === 'elevenlabs' || store.ttsConfig.platform === 'vbee';
    
    const cost = isPremium ? 3 : 1;
    if (!store.deductCredits(cost)) {
      alert(`⚠️ Bạn đã hết Tín dụng. Sinh giọng đọc này cần ${cost} tín dụng. Vui lòng nâng cấp gói Pro!`);
      return;
    }
    
    setGeneratingTTS(prev => ({ ...prev, [sceneIndex]: true }));
    setTtsProgress(prev => ({ ...prev, [sceneIndex]: 0 }));
    
    // Fake progress interval
    const progressInterval = setInterval(() => {
      setTtsProgress(prev => {
        const current = prev[sceneIndex] || 0;
        if (current >= 95) return prev;
        // Tăng ngẫu nhiên từ 1 đến 5%
        return { ...prev, [sceneIndex]: current + Math.floor(Math.random() * 5) + 1 };
      });
    }, 500);

    // Xóa audio cũ ngay lập tức để UI không hiển thị nội dung cũ
    const assetKey = `${store.chuong_dang_chon}_${sceneIndex}`;
    store.addGeneratedAudio(assetKey, '', 0);
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
        ttsConfig: store.ttsConfig,
        targetDuration,
        syncMode: store.ttsConfig.syncMode
      });

      setTtsProgress(prev => ({ ...prev, [sceneIndex]: 100 }));
      const currentAssetKey = `${store.chuong_dang_chon}_${sceneIndex}`;
      store.addGeneratedAudio(currentAssetKey, audioPath, duration);

      alert(`🎉 Đã sinh âm thanh TTS (${finalVoice}) thành công! Thời lượng: ${duration}s`);
      return duration;
    } catch (err: unknown) {
      setTtsProgress(prev => ({ ...prev, [sceneIndex]: 0 }));
      alert(`❌ Lỗi sinh TTS: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearInterval(progressInterval);
      setGeneratingTTS(prev => ({ ...prev, [sceneIndex]: false }));
      // Clear progress after a short delay
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
