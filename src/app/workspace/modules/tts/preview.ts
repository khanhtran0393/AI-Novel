import { useNovelStore, type TTSConfig } from '@/store/useNovelStore';
import { cleanVoiceScript } from '../../utils/stringUtils';
import { getTTSCredentialsForConfig } from './credentials';
import { API } from '@/contracts';
import { buildClientApiHeaders } from '../apiClient';
import {
  buildClientPreviewKey,
  readBrowserPreviewCache,
  resolvePlayableAudioUrl,
  sealAudioBlob,
  writeBrowserPreviewCache,
} from './previewClientCache';
import { assertPreviewPreflight } from './previewPreflight';
import { ttsPreviewTimeoutMs } from './previewTimeout';
import { VINA_PREVIEW_NFE_DEFAULT } from '@/lib/tts/previewDefaults';

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

/**
 * Load + play with canplay gate and MIME seal (blob: only).
 * Relative /audio paths are resolved against window.origin.
 */
async function playBlobOrUrl(
  src: string,
  onSuccess: (audio: HTMLAudioElement) => void,
  onEnded: () => void,
  onError: (msg: string) => void,
): Promise<void> {
  let playSrc = resolvePlayableAudioUrl(src);
  // Non-blob: fetch → seal MIME → blob URL (avoids wrong Content-Type on static /audio)
  if (playSrc && !playSrc.startsWith('blob:') && !playSrc.startsWith('data:')) {
    let sealFatal: Error | null = null;
    try {
      const res = await fetch(playSrc);
      if (res.ok) {
        const raw = await res.blob();
        if (raw.size < 400) {
          throw new Error(
            `File nghe thử quá nhỏ (${raw.size}B) tại ${playSrc.slice(0, 80)}`,
          );
        }
        const sealed = await sealAudioBlob(
          raw,
          res.headers.get('Content-Type') || undefined,
        );
        playSrc = URL.createObjectURL(sealed);
      } else if (res.status >= 400) {
        sealFatal = new Error(
          `Không tải được file nghe thử HTTP ${res.status}: ${playSrc.slice(0, 96)}`,
        );
      }
    } catch (e) {
      if (e instanceof Error && /quá nhỏ|HTTP \d/.test(e.message)) {
        sealFatal = e;
      }
      /* else keep original URL */
    }
    if (sealFatal) throw sealFatal;
  }

  const audio = new Audio();
  audio.preload = 'auto';

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const LOAD_TIMEOUT_MS = 12_000;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(hardTimer);
      audio.oncanplay = null;
      audio.oncanplaythrough = null;
      audio.onloadeddata = null;
      audio.onerror = null;
      if (err) reject(err);
      else resolve();
    };
    audio.onerror = () =>
      done(
        new Error(
          `Không load được file nghe thử (${playSrc.slice(0, 80)}). Kiểm tra /audio/previews.`,
        ),
      );
    const tryReady = () => {
      if (audio.readyState >= 2) done();
    };
    audio.oncanplay = tryReady;
    audio.oncanplaythrough = tryReady;
    audio.onloadeddata = tryReady;
    // Hard reject — never hang «Đang nghe thử» forever (was: only resolve if ready)
    const hardTimer = window.setTimeout(() => {
      if (audio.readyState >= 2) done();
      else {
        done(
          new Error(
            `Timeout ${Math.round(LOAD_TIMEOUT_MS / 1000)}s khi load audio nghe thử.`,
          ),
        );
      }
    }, LOAD_TIMEOUT_MS);
    audio.src = playSrc;
    void audio.load();
  });

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
    throw new Error(
      'Chưa chọn engine TTS (platform). Mở «Cấu Hình Giọng Đọc Toàn Cục».',
    );
  }
  if (!resolvedVoice) {
    throw new Error(
      'Chưa chọn giọng TTS. Mở «Cấu Hình Giọng Đọc Toàn Cục» → chọn giọng — app không tự gán giọng.',
    );
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

  const timeoutMs = ttsPreviewTimeoutMs(baseConfig.platform);
  const ac = new AbortController();
  const timeoutId =
    typeof window !== 'undefined'
      ? window.setTimeout(() => ac.abort(), timeoutMs)
      : setTimeout(() => ac.abort(), timeoutMs);

  const playPreview = async (
    activeConfig: TTSConfig,
    activeVoice: string,
    activeApiKey: string,
    activeApiKeys: string[],
    signal: AbortSignal,
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
      nfeStep:
        activeConfig.platform === 'vina_voice'
          ? VINA_PREVIEW_NFE_DEFAULT
          : undefined,
      vinaGender: activeConfig.vinaGender,
      vinaArea: activeConfig.vinaArea,
      vinaGroup: activeConfig.vinaGroup,
      vinaEmotion: activeConfig.vinaEmotion,
      vinaReferenceAudio: activeConfig.vinaReferenceAudio,
      vinaReferenceAudioB64: activeConfig.vinaReferenceAudioB64,
      vinaReferenceText: activeConfig.vinaReferenceText,
    });

    // 1) Browser cache / session — only if blob still valid (≥800B)
    const cachedUrl = await readBrowserPreviewCache(clientKey);
    if (cachedUrl) {
      try {
        const probe = await fetch(cachedUrl);
        if (probe.ok) {
          const b = await probe.blob();
          if (b.size >= 800) {
            await playBlobOrUrl(cachedUrl, onSuccess, onEnded, onError);
            return;
          }
        }
      } catch {
        /* re-synth */
      }
    }

    const activeKeysToUse =
      activeApiKeys && activeApiKeys.length > 0
        ? activeApiKeys
        : activeApiKey
          ? [activeApiKey]
          : [];
    const storeSnap = useNovelStore.getState();
    const multiSessions = (storeSnap.tiktokSessionIds || []).filter(Boolean);
    // Shared preflight (Free / keys / TikTok / CapCut) — same as TTSConfigModal
    const { ttsConfigPatch } = assertPreviewPreflight({
      platform: activeConfig.platform,
      voiceId: activeVoice,
      ttsConfig: activeConfig,
      apiKeys: activeKeysToUse,
      tiktokSessionIds: multiSessions,
      isPro: storeSnap.is_pro,
      isTrial: storeSnap.is_trial,
      isVip: storeSnap.is_vip,
    });
    const previewConfig: TTSConfig = {
      ...activeConfig,
      ...ttsConfigPatch,
      voice: activeVoice,
    };

    // 2) Server: durable / legacy MP3 → cached:true = no re-synth
    // Entitlement headers bắt buộc (đồng bộ modal Cấu Hình Giọng) — không silent bypass Free gate
    const res = await fetch(API.generateTts, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildClientApiHeaders(),
      },
      signal,
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
      const detail = data?.error || `HTTP ${res.status}`;
      throw new Error(
        `Lỗi nghe thử giọng «${activeVoice}» · ${activeConfig.platform}: ${detail}`,
      );
    }

    const audioUrl = resolveAudioUrl(String(data.audioPath));
    if (!audioUrl) {
      throw new Error(
        `API nghe thử không trả audioPath (giọng «${activeVoice}» · ${activeConfig.platform}).`,
      );
    }
    // Absolute URL — Electron / nested origin
    const absolute =
      typeof window !== 'undefined' && audioUrl.startsWith('/')
        ? `${window.location.origin}${audioUrl}`
        : audioUrl;
    // Cache hit: play URL directly (no cache-bust that forces re-download storm)
    const fetchUrl = data.cached
      ? absolute
      : `${absolute}${absolute.includes('?') ? '&' : '?'}t=${Date.now()}`;
    const audioRes = await fetch(fetchUrl, { signal });
    if (!audioRes.ok) {
      throw new Error(
        `Không tải được audio nghe thử giọng «${activeVoice}»: ${audioUrl}`,
      );
    }

    const blob = await audioRes.blob();
    if (blob.size < 800) {
      throw new Error(
        `File nghe thử quá nhỏ (${blob.size}B) — engine có thể lỗi im lặng.`,
      );
    }
    const contentType =
      audioRes.headers.get('Content-Type') ||
      (audioUrl.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg');

    const blobUrl = await writeBrowserPreviewCache(clientKey, blob, contentType);
    try {
      await playBlobOrUrl(blobUrl, onSuccess, onEnded, onError);
    } catch (playErr) {
      // Fallback server URL if blob URL fails to decode
      console.warn('[TTS Preview] blob play fail, retry server URL', playErr);
      await playBlobOrUrl(fetchUrl, onSuccess, onEnded, onError);
    }
  };

  try {
    // Platform is explicit; multi-key rotation stays on the server for quota.
    await playPreview(
      baseConfig,
      resolvedVoice,
      creds.apiKey,
      keysToUse,
      ac.signal,
    );
  } catch (err: unknown) {
    onEnded();
    const aborted =
      ac.signal.aborted ||
      (err instanceof DOMException && err.name === 'AbortError') ||
      (err instanceof Error && /abort/i.test(err.message));
    if (aborted) {
      onError(
        `Nghe thử giọng «${resolvedVoice}» · ${baseConfig.platform}: ` +
          `quá ${Math.round(timeoutMs / 1000)}s (timeout). ` +
          `Không đổi sang engine/giọng khác — thử lại hoặc kiểm tra engine.`,
      );
      return;
    }
    onError(err instanceof Error ? err.message : String(err));
  } finally {
    if (typeof window !== 'undefined') window.clearTimeout(timeoutId as number);
    else clearTimeout(timeoutId);
  }
}
