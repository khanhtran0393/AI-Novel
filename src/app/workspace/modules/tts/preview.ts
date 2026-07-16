import { useNovelStore, type TTSConfig } from '@/store/useNovelStore';
import { cleanVoiceScript } from '../../utils/stringUtils';
import { getTTSCredentialsForConfig } from './credentials';
import { API } from '@/contracts';
import {
  buildClientPreviewKey,
  readBrowserPreviewCache,
  writeBrowserPreviewCache,
} from './previewClientCache';

export interface PlayTTSParams {
  text: string;
  voice: string;
  ttsConfig?: TTSConfig;
  apiKeys: string[];
  apiKey: string;
  ten_tac_pham: string;
  onStart: () => void;
  onSuccess: (audio: HTMLAudioElement) => void;
  onEnded: () => void;
  onError: (msg: string) => void;
}

/** Public URL for /audio/... paths returned by generate-tts */
function resolveAudioUrl(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s) || s.startsWith('blob:') || s.startsWith('data:')) return s;
  if (s.startsWith('/')) return s;
  if (s.startsWith('audio/')) return `/${s}`;
  // Absolute Windows path is not fetchable in browser — reject early
  if (/^[A-Za-z]:[\\/]/.test(s) || s.startsWith('\\\\')) {
    throw new Error(
      `API trả path file máy (${s.slice(0, 60)}…) — cần URL public /audio/.... Kiểm tra generate-tts.`,
    );
  }
  return s;
}

async function playBlobOrUrl(
  src: string,
  onSuccess: (audio: HTMLAudioElement) => void,
  onEnded: () => void,
  onError: (msg: string) => void,
): Promise<void> {
  const audio = new Audio(src);
  try {
    await audio.play();
  } catch (playErr) {
    throw new Error(
      playErr instanceof Error
        ? `Không phát được audio: ${playErr.message}`
        : 'Không phát được audio nghe thử',
    );
  }
  onSuccess(audio);
  audio.onended = onEnded;
  audio.onerror = () => {
    onEnded();
    onError('File âm thanh nghe thử bị lỗi.');
  };
}

/**
 * Nghe thử TTS — tái sử dụng MP3/WAV đã có (session + Cache API + server durable).
 * Chỉ gọi synth khi cache miss.
 */
export async function playTTSAction(params: PlayTTSParams): Promise<void> {
  const {
    text,
    voice,
    ttsConfig,
    apiKeys,
    apiKey,
    ten_tac_pham,
    onStart,
    onSuccess,
    onEnded,
    onError,
  } = params;

  const cleanText = cleanVoiceScript(text);
  if (!cleanText) {
    throw new Error('Không có lời thoại nào khả dụng để nghe thử.');
  }

  const store0 = useNovelStore.getState();
  const baseConfig: TTSConfig = {
    ...(store0.ttsConfig || ({} as TTSConfig)),
    ...(ttsConfig || {}),
    platform:
      ttsConfig?.platform ||
      store0.ttsConfig?.platform ||
      '',
  };
  const resolvedVoice =
    (voice || baseConfig.voice || store0.ttsConfig?.voice || '').trim();
  if (!baseConfig.platform?.trim()) {
    throw new Error('Chua chon engine TTS (platform).');
  }
  if (!resolvedVoice) {
    throw new Error('Chua chon voice TTS. App khong tu gan voice.');
  }
  baseConfig.voice = resolvedVoice;

  // Always resolve platform-correct credentials (OpenAI / Gemini / master keys)
  const creds = getTTSCredentialsForConfig(baseConfig, apiKey, apiKeys);
  const keysToUse =
    creds.apiKeys?.length > 0
      ? creds.apiKeys
      : creds.apiKey
        ? [creds.apiKey]
        : apiKeys?.length
          ? apiKeys
          : apiKey
            ? [apiKey]
            : [];

  onStart();

  const playPreview = async (
    activeConfig: TTSConfig,
    activeVoice: string,
    activeApiKey: string,
    activeApiKeys: string[],
  ) => {
    if (!activeConfig?.platform) {
      throw new Error('Chưa chọn engine TTS (platform). Mở Cấu hình giọng đọc.');
    }
    if (!activeVoice?.trim()) {
      throw new Error('Chưa chọn giọng (voice) để nghe thử.');
    }

    const speed = Number(activeConfig.speed) || 1.0;
    const pitch = Number(activeConfig.pitch) || 0;
    const previewText = cleanText.substring(0, 300);
    const clientKey = buildClientPreviewKey({
      platform: activeConfig.platform,
      voice: activeVoice,
      text: previewText,
      speed,
      pitch,
      speakerSeed: activeConfig.vinaSpeakerSeed,
      styleSeed: activeConfig.vinaStyleSeed,
      vinaGender: activeConfig.vinaGender,
      vinaArea: activeConfig.vinaArea,
      vinaGroup: activeConfig.vinaGroup,
      vinaEmotion: activeConfig.vinaEmotion,
      vinaReferenceAudio: activeConfig.vinaReferenceAudio,
      vinaReferenceAudioB64: activeConfig.vinaReferenceAudioB64,
      vinaReferenceText: activeConfig.vinaReferenceText,
    });

    // 1) Browser cache / session — no API, no re-synth
    const cachedUrl = await readBrowserPreviewCache(clientKey);
    if (cachedUrl) {
      await playBlobOrUrl(cachedUrl, onSuccess, onEnded, onError);
      return;
    }

    const activeKeysToUse =
      activeApiKeys && activeApiKeys.length > 0
        ? activeApiKeys
        : activeApiKey
          ? [activeApiKey]
          : [];
    const storeSnap = useNovelStore.getState();
    const multiSessions = (storeSnap.tiktokSessionIds || []).filter(Boolean);
    let previewConfig: TTSConfig = { ...activeConfig, voice: activeVoice };
    if (activeConfig.platform === 'tiktok_tts' && multiSessions.length) {
      previewConfig = {
        ...previewConfig,
        tiktokSessionId:
          multiSessions[0] ||
          activeConfig.tiktokSessionId ||
          storeSnap.ttsConfig?.tiktokSessionId ||
          '',
      };
    }

    // Early guard: platforms that need keys
    const p = activeConfig.platform;
    if (
      (p === 'openai_tts' || p === 'gemini_tts') &&
      activeKeysToUse.length === 0
    ) {
      throw new Error(
        p === 'openai_tts'
          ? 'OpenAI TTS cần API Key (Header / Settings).'
          : 'Gemini TTS cần Gemini API Key.',
      );
    }
    if (
      p === 'tiktok_tts' &&
      !previewConfig.tiktokSessionId?.trim() &&
      !multiSessions.length
    ) {
      throw new Error(
        'TikTok TTS cần Session ID (Cấu hình giọng đọc → SessionID TikTok).',
      );
    }

    // 2) Server: durable / legacy MP3 → cached:true = no re-synth
    const res = await fetch(API.generateTts, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sceneText: previewText,
        chapterNum: 0,
        sceneIndex: 999,
        isPreview: true,
        voiceName: activeVoice,
        voice: activeVoice,
        apiKeys: activeKeysToUse,
        ten_tac_pham: ten_tac_pham || storeSnap.ten_tac_pham || 'AI Novel',
        ttsConfig: previewConfig,
        applyLoudnorm: false,
        injectBreathPauses: false,
        roomTone: false,
        bgmMix: false,
      }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !data?.audioPath) {
      throw new Error(
        data?.error || `Lỗi API nghe thử TTS (HTTP ${res.status}).`,
      );
    }

    const audioUrl = resolveAudioUrl(String(data.audioPath));
    // Cache hit: play URL directly (no cache-bust that forces re-download storm)
    const fetchUrl = data.cached
      ? audioUrl
      : `${audioUrl}${audioUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
    const audioRes = await fetch(fetchUrl);
    if (!audioRes.ok) {
      throw new Error(`Không tải được audio nghe thử: ${audioUrl}`);
    }

    const blob = await audioRes.blob();
    const contentType =
      audioRes.headers.get('Content-Type') ||
      (audioUrl.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg');

    const blobUrl = await writeBrowserPreviewCache(clientKey, blob, contentType);
    await playBlobOrUrl(blobUrl, onSuccess, onEnded, onError);
  };

  try {
    // Platform is explicit; multi-key rotation stays on the server for quota.
    await playPreview(baseConfig, resolvedVoice, creds.apiKey, keysToUse);
  } catch (err: unknown) {
    onEnded();
    onError(err instanceof Error ? err.message : String(err));
  }
}
