/**
 * Module quản lý Giọng đọc AI & Studio Thu âm (AI TTS & Audio Production Studio)
 */
import { cleanVoiceScript, getWordCount } from '../utils/stringUtils';
import type { TTSConfig } from '@/store/useNovelStore';

interface PlayTTSParams {
  text: string;
  voice: string;
  ttsConfig?: TTSConfig;
  apiKeys: string[];
  apiKey: string;
  useMock: boolean;
  ten_tac_pham: string;
  onStart: () => void;
  onSuccess: (audio: HTMLAudioElement) => void;
  onEnded: () => void;
  onError: (msg: string) => void;
}

export async function playTTSAction(params: PlayTTSParams): Promise<void> {
  const { text, voice, ttsConfig, apiKeys, apiKey, useMock, ten_tac_pham, onStart, onSuccess, onEnded, onError } = params;

  const cleanText = cleanVoiceScript(text);
  if (!cleanText) {
    throw new Error('⚠️ Không có lời thoại nào khả dụng để nghe thử.');
  }

  const sampleText = cleanText.substring(0, 300); // Lấy mẫu ngắn để nghe thử nhanh
  const keysToUse = (apiKeys && apiKeys.length > 0) ? apiKeys : (apiKey ? [apiKey] : []);

  onStart();

  try {
    // 1. Kiểm tra trong Cache Storage cục bộ của trình duyệt trước
    const cache = await window.caches.open('tts-prelisten-cache-v1');
    const cacheKey = `https://tts-preview-local/play?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(sampleText)}`;
    const cachedResponse = await cache.match(cacheKey);

    if (cachedResponse) {
      console.log(`[TTS Cache] Phát lại trực tiếp từ bộ nhớ cache cục bộ cho giọng đọc: ${voice}`);
      const blob = await cachedResponse.blob();
      const blobUrl = URL.createObjectURL(blob);
      const audio = new Audio(blobUrl);
      audio.play();
      onSuccess(audio);
      audio.onended = onEnded;
      audio.onerror = () => {
        onEnded();
        onError('❌ File âm thanh nghe thử trong cache bị lỗi.');
      };
      return;
    }

    console.log(`[TTS Cache] Chưa có cache. Đang tải giọng đọc "${voice}" từ máy chủ...`);

    // 2. Gọi API để sinh file nghe thử
    if (!useMock) {
      const res = await fetch('/api/generate-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sceneText: sampleText,
          chapterNum: 0,
          sceneIndex: 999, // File mẫu tạm
          voiceName: voice,
          apiKeys: keysToUse,
          ten_tac_pham,
          ttsConfig
        })
      });

      if (res.ok) {
        const data = await res.json();
        // Tải file về dạng blob để đưa vào Cache Storage
        const audioRes = await fetch(data.audioPath);
        if (audioRes.ok) {
          const blob = await audioRes.blob();
          // Lưu vào cache
          await cache.put(cacheKey, new Response(blob, {
            headers: { 'Content-Type': 'audio/wav' }
          }));

          const blobUrl = URL.createObjectURL(blob);
          const audio = new Audio(blobUrl);
          audio.play();
          onSuccess(audio);
          audio.onended = onEnded;
          audio.onerror = () => {
            onEnded();
            onError('❌ File âm thanh bị lỗi, thử lại.');
          };
          return;
        }
      } else {
        // Fallback to Google Translate TTS only if generating through API fails completely
        // and platform is not explicitly required to be something else.
      }
    }

    // 3. Fallback: Google Translate TTS
    const gtSample = sampleText.substring(0, 180);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q=${encodeURIComponent(gtSample)}`;
    
    const audioRes = await fetch(url);
    if (audioRes.ok) {
      const blob = await audioRes.blob();
      await cache.put(cacheKey, new Response(blob, {
        headers: { 'Content-Type': 'audio/mpeg' }
      }));

      const blobUrl = URL.createObjectURL(blob);
      const audio = new Audio(blobUrl);
      audio.play();
      onSuccess(audio);
      audio.onended = onEnded;
      audio.onerror = () => {
        onEnded();
        onError('❌ Không thể tải âm thanh nghe thử từ máy chủ.');
      };
    } else {
      throw new Error('Google Translate TTS phản hồi không thành công.');
    }
  } catch (err: unknown) {
    onEnded();
    onError(err instanceof Error ? err.message : String(err));
  }
}

interface GenerateTTSParams {
  useMock: boolean;
  apiKey: string;
  apiKeys: string[];
  sceneText: string;
  chuong_dang_chon: number;
  sceneIndex: number;
  savePathTTS: string;
  googleDrivePath: string;
  voice: string;
  ten_tac_pham: string;
  ttsConfig?: TTSConfig;
}

export async function generateTTSAction(params: GenerateTTSParams): Promise<{ audioPath: string; duration: number }> {
  const { useMock, apiKey, apiKeys, sceneText, chuong_dang_chon, sceneIndex, savePathTTS, googleDrivePath, voice, ten_tac_pham, ttsConfig } = params;

  let audioPathResult = '';
  let audioDuration = Math.max(5, Math.round(getWordCount(sceneText) / 2.5));

  if (useMock) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    audioPathResult = `/audio/chapter_${chuong_dang_chon}_scene_${sceneIndex}.mp3`;
  } else {
    const keysToUse = (apiKeys && apiKeys.length > 0) ? apiKeys : (apiKey ? [apiKey] : []);
    const drivePath = savePathTTS || (googleDrivePath ? `${googleDrivePath.trim()}${googleDrivePath.trim().includes('/') ? '/' : '\\'}Âm Thanh TTS` : '');

    const res = await fetch('/api/generate-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sceneText,
        chapterNum: chuong_dang_chon,
        sceneIndex,
        drivePath,
        voiceName: voice,
        apiKeys: keysToUse,
        ten_tac_pham,
        ttsConfig
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Lỗi sinh giọng đọc TTS');
    }

    const data = await res.json();
    audioPathResult = data.audioPath;
    if (data.duration) audioDuration = data.duration;
  }

  return { audioPath: audioPathResult, duration: audioDuration };
}
