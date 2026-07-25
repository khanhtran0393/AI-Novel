'use client';
import { API } from '@/contracts';

import React, { useState, useRef, useEffect } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { X, Volume2 } from 'lucide-react';
import {
  getDefaultVoiceConfig,
  getVoiceList,
  isVoiceValidForPlatform,
  STATIC_VOICE_CATALOG,
} from '@/lib/voiceCatalog';
import RoleCastStudioModal from './RoleCastStudioModal';
import { isCastActive, normalizeVoiceCast } from '@/lib/voiceCast';
import { toast } from '@/lib/toastBus';
import LaStudioStudioTab from './tabs/LaStudioStudioTab';
import EngineVoiceTab from './tabs/EngineVoiceTab';
import { useTikTokSessions } from './hooks/useTikTokSessions';
import { useVoiceCatalogPrep } from './hooks/useVoiceCatalogPrep';
import { getTTSCredentialsForConfig } from '../../modules/tts/credentials';
import { ttsPreviewTimeoutMs } from '../../modules/tts/previewTimeout';
import { assertPreviewPreflight } from '../../modules/tts/previewPreflight';
import { FREE_TTS_PLATFORMS } from '@/lib/commercial/featureMatrix';
import {
  isLaStudioEnvPlatform,
  isEngineManualTtsPlatform,
} from '@/lib/tts/activePlatforms';
import { buildClientApiHeaders } from '../../modules/apiClient';
import { TTS_PREVIEW_SCENE_TEXT } from '@/lib/tts/previewDefaults';

/** Free: chỉ edge_tts / piper */
function isFreeTtsPlatform(platform: string): boolean {
  return FREE_TTS_PLATFORMS.has(String(platform || '').trim().toLowerCase());
}

function freeTtsBlockedMessage(platform: string): string {
  return (
    `Gói Free không dùng «${platform || '?'}» (TTS premium). ` +
    `Chọn tab Engine → Edge TTS hoặc Piper, hoặc nhấp logo → Trial/Pro.`
  );
}

interface TTSConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type VoiceUiTab = 'la_studio' | 'engine';

export default function TTSConfigModal({ isOpen, onClose }: TTSConfigModalProps) {
  const store = useNovelStore();
  const config = store.ttsConfig;
  const isFreeTier = !store.is_pro && !store.is_trial && !store.is_vip;
  const {
    tiktokSessions,
    isTikTokWithoutSession,
    isFetchingTikTokSession,
    newTikTokSessionInput,
    setNewTikTokSessionInput,
    copiedTikTokIdx,
    handleAutoFetchTikTokSession,
    handleAddTikTokSessionsFromInput,
    handleCopyTikTokSession,
    handleSetPrimaryTikTokSession,
    handleRemoveTikTokRow,
  } = useTikTokSessions(config);

  const [isPreviewing, setIsPreviewing] = useState(false);
  const [castStudioOpen, setCastStudioOpen] = useState(false);
  const [voiceUiTab, setVoiceUiTab] = useState<VoiceUiTab>(() => {
    const plat = String(store.ttsConfig?.platform || '');
    // Free: only Edge/Piper on Engine. LA Studio / Omni = Trial/Pro tab.
    if (isFreeTier) return 'engine';
    // LA Studio env: la_studio + omnivoice_local (Omni is not on Engine dropdown)
    if (!plat || isLaStudioEnvPlatform(plat) || plat === 'vina_voice') {
      return 'la_studio';
    }
    return 'engine';
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const lastPreviewSigRef = useRef<string | null>(null);
  const suppressPreviewCancelRef = useRef(false);

  const { dynamicVoices, runVoicePrep, capcutDiag } = useVoiceCatalogPrep(isOpen);
  const catalogForUi =
    Object.keys(dynamicVoices).length > 0 ? dynamicVoices : STATIC_VOICE_CATALOG;
  const currentVoices = getVoiceList(
    catalogForUi,
    config.platform,
    config.language,
  );
  const selectedVoice = currentVoices.find((v) => v.id === config.voice) || null;
  const activeVoiceId = selectedVoice?.id || config.voice || '';

  useEffect(() => {
    if (!isOpen) return;
    void runVoicePrep(false);
  }, [isOpen, runVoicePrep]);

  /** Migrate legacy vina / empty platform → Trial/Pro: LA Studio; Free: Edge. */
  useEffect(() => {
    if (!isOpen) return;
    const plat = String(config.platform || '');
    const voice = String(config.voice || '').trim();
    const badVoice =
      !voice ||
      voice === 'default' ||
      /model dang load|model đang load/i.test(voice);
    if (plat === 'vina_voice' || !plat) {
      if (isFreeTier) {
        store.updateTTSConfig({
          platform: 'edge_tts',
          language: config.language || 'vi',
          voice: badVoice ? 'vi-VN-HoaiMyNeural' : voice,
          vinaUseClone: false,
        });
        setVoiceUiTab('engine');
      } else {
        store.updateTTSConfig({
          platform: 'la_studio',
          language: config.language || 'vi',
          voice: badVoice ? 'diem_trinh' : voice,
          laStudioFamily: config.laStudioFamily || 'kokoro-vietnamese',
          vinaUseClone: false,
        });
        setVoiceUiTab('la_studio');
      }
      return;
    }
    if (plat === 'la_studio' && badVoice && !isFreeTier) {
      store.updateTTSConfig({ voice: 'diem_trinh', vinaUseClone: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isFreeTier]);

  /** Free: kick premium platforms (incl. LA Studio) → Edge TTS */
  useEffect(() => {
    if (!isOpen || !isFreeTier) return;
    if (!isFreeTtsPlatform(config.platform || '')) {
      store.updateTTSConfig({
        platform: 'edge_tts',
        language: 'vi',
        voice: 'vi-VN-HoaiMyNeural',
        vinaUseClone: false,
      });
      setVoiceUiTab('engine');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isFreeTier, config.platform]);

  /** Seed empty voice on engine / LA Studio env platforms */
  useEffect(() => {
    if (!isOpen) return;
    if (String(config.voice || '').trim()) return;
    if (!config.platform || config.platform === 'la_studio') {
      if (config.platform === 'la_studio') {
        store.updateTTSConfig({ voice: 'diem_trinh' });
      }
      return;
    }
    if (config.platform === 'omnivoice_local') {
      store.updateTTSConfig({ voice: 'alloy', laStudioFamily: 'omnivoice' });
      return;
    }
    const next = getDefaultVoiceConfig(
      catalogForUi,
      config.platform,
      config.language || 'vi',
    );
    if (next.voice) {
      store.updateTTSConfig({
        language: next.language || config.language || 'vi',
        voice: next.voice,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, config.platform, config.voice, catalogForUi]);

  const stopPreviewAudio = () => {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
    } catch {
      /* ignore */
    }
  };

  const cancelPreview = () => {
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    stopPreviewAudio();
    setIsPreviewing(false);
  };

  useEffect(() => {
    const sig = [
      config.platform,
      config.voice,
      String(config.speed),
      String(config.pitch),
    ].join('|');
    if (lastPreviewSigRef.current === null) {
      lastPreviewSigRef.current = sig;
      return;
    }
    if (lastPreviewSigRef.current === sig) return;
    lastPreviewSigRef.current = sig;
    if (suppressPreviewCancelRef.current) return;
    const timer = window.setTimeout(cancelPreview, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.platform, config.voice, config.speed, config.pitch]);

  useEffect(() => {
    if (!isOpen) {
      const timer = window.setTimeout(cancelPreview, 0);
      return () => window.clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const resolvePlayableUrl = (url: string) => {
    if (!url) return url;
    const u = String(url).trim();
    if (!u) return u;
    if (u.startsWith('blob:') || u.startsWith('http://') || u.startsWith('https://')) {
      return u;
    }
    // Relative app path (/audio/...) — safe to resolve against origin
    if (u.startsWith('/')) {
      if (typeof window !== 'undefined') {
        try {
          return new URL(u, window.location.origin).href;
        } catch {
          return u;
        }
      }
      return u;
    }
    // Windows absolute / file path — never feed to new URL() (throws Invalid URL / drive protocol)
    if (/^[a-zA-Z]:[\\/]/.test(u) || u.startsWith('\\\\') || u.startsWith('file:')) {
      return u;
    }
    if (typeof window !== 'undefined') {
      try {
        return new URL(u, window.location.origin).href;
      } catch {
        return u;
      }
    }
    return u;
  };

  const playPreviewUrl = async (primary: string, fallback?: string) => {
    const playOneUrl = async (url: string) => {
      stopPreviewAudio();
      const audio = new Audio(resolvePlayableUrl(url));
      audioRef.current = audio;
      await audio.play();
    };
    try {
      await playOneUrl(primary);
    } catch (firstErr) {
      if (fallback && fallback !== primary) {
        await playOneUrl(fallback);
        return;
      }
      throw firstErr;
    }
  };

  const fetchPreviewAudio = async (
    voiceId: string,
    voiceLabel: string,
    ttsCfg: typeof config,
    apiKeys: string[],
    signal: AbortSignal,
  ): Promise<string> => {
    const sceneText = TTS_PREVIEW_SCENE_TEXT;
    const speedN = Number(ttsCfg.speed);
    const pitchN = Number(ttsCfg.pitch);
    const speed = Number.isFinite(speedN) && speedN > 0 ? speedN : 1;
    const pitch = Number.isFinite(pitchN) ? pitchN : 0;

    const {
      buildClientPreviewKey,
      readBrowserPreviewCache,
      writeBrowserPreviewCache,
    } = await import('../../modules/tts/previewClientCache');

    const clientKey = buildClientPreviewKey({
      platform: ttsCfg.platform,
      voice: voiceId,
      text: sceneText,
      speed,
      pitch,
    });

    const localHit = await readBrowserPreviewCache(clientKey);
    if (localHit) {
      try {
        const probe = await fetch(localHit, { signal });
        if (probe.ok) {
          const b = await probe.blob();
          if (b.size >= 800) {
            toast.info(
              'Notice',
              `Phát lại bản nghe thử «${voiceLabel}» (đã lưu — không gen lại).`,
            );
            return localHit;
          }
        }
      } catch {
        /* server */
      }
    }

    if (
      !store.is_pro &&
      !store.is_trial &&
      !store.is_vip &&
      !isFreeTtsPlatform(ttsCfg.platform)
    ) {
      throw new Error(freeTtsBlockedMessage(ttsCfg.platform));
    }

    const response = await fetch(API.generateTts, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildClientApiHeaders(),
      },
      signal,
      body: JSON.stringify({
        sceneText,
        chapterNum: 0,
        sceneIndex: 999,
        isPreview: true,
        voiceName: voiceId,
        ttsConfig: {
          ...ttsCfg,
          voice: voiceId,
          speed,
          pitch,
        },
        apiKeys,
        ten_tac_pham: store.ten_tac_pham || 'AI Novel',
        applyLoudnorm: false,
        injectBreathPauses: false,
        roomTone: false,
        bgmMix: false,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.success || !data?.audioPath) {
      throw new Error(
        `Lỗi nghe thử «${voiceLabel}» · ${ttsCfg.platform}: ${data?.error || `HTTP ${response.status}`}`,
      );
    }

    const url = String(data.audioPath || '');
    const fetchUrl = data.cached
      ? url
      : `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
    const absoluteServer = resolvePlayableUrl(fetchUrl);

    try {
      const audioRes = await fetch(absoluteServer, { signal });
      if (audioRes.ok) {
        const blob = await audioRes.blob();
        if (blob.size < 800) {
          throw new Error(`File nghe thử quá nhỏ (${blob.size}B).`);
        }
        const ct =
          audioRes.headers.get('Content-Type') ||
          (url.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg');
        const blobUrl = await writeBrowserPreviewCache(clientKey, blob, ct);
        try {
          const w = window as unknown as {
            __ttsPreviewFallback?: Map<string, string>;
          };
          if (!w.__ttsPreviewFallback) w.__ttsPreviewFallback = new Map();
          w.__ttsPreviewFallback.set(blobUrl, absoluteServer);
        } catch {
          /* ignore */
        }
        return blobUrl;
      }
    } catch (e) {
      if (signal.aborted) throw e;
    }
    return absoluteServer;
  };

  const getPreviewApiKeys = (platform: string) => {
    const creds = getTTSCredentialsForConfig(
      { ...config, platform: platform as typeof config.platform },
      store.apiKey || '',
      store.apiKeys || [],
    );
    return creds.apiKeys;
  };

  const assertPreviewReady = (
    platform: string,
    voiceId: string,
    ttsCfg: typeof config = config,
  ) => {
    if (!voiceId?.trim()) {
      throw new Error(
        platform === 'la_studio'
          ? 'Chưa chọn giọng LA Studio. Chọn trong Voice library rồi Nghe thử.'
          : `Chưa chọn giọng cho «${platform}».`,
      );
    }
    return assertPreviewPreflight({
      platform,
      voiceId,
      ttsConfig: ttsCfg,
      apiKeys: getPreviewApiKeys(platform),
      isPro: !!store.is_pro,
      isTrial: !!store.is_trial,
      isVip: !!store.is_vip,
      tiktokSessionIds: tiktokSessions,
    });
  };

  /**
   * Nghe thử giọng. Có thể truyền voiceId tường minh (nút Play từng hàng Voice library).
   * Không truyền → dùng giọng đang chọn trong store/catalog.
   */
  const handlePreviewVoice = async (overrideVoiceId?: string) => {
    if (isPreviewing) {
      cancelPreview();
      return;
    }

    previewAbortRef.current?.abort();
    const ac = new AbortController();
    previewAbortRef.current = ac;

    // LA Studio tab owns la_studio + omnivoice_local (Omni family stays in this env)
    const liveFamilyPeek =
      String(
        useNovelStore.getState().ttsConfig?.laStudioFamily ||
          config.laStudioFamily ||
          'kokoro-vietnamese',
      ).trim() || 'kokoro-vietnamese';
    const isOmniEnv =
      liveFamilyPeek === 'omnivoice' || config.platform === 'omnivoice_local';
    const platform: typeof config.platform =
      voiceUiTab === 'la_studio'
        ? isOmniEnv
          ? 'omnivoice_local'
          : 'la_studio'
        : config.platform;
    let voiceId = (
      (typeof overrideVoiceId === 'string' && overrideVoiceId.trim()) ||
      activeVoiceId ||
      config.voice ||
      ''
    ).trim();
    // LA Studio Kokoro: "default"/placeholder → real Kokoro id (CLI gen offline)
    if (
      platform === 'la_studio' &&
      (!voiceId ||
        voiceId === 'default' ||
        /model dang load|model đang load/i.test(voiceId))
    ) {
      voiceId = 'diem_trinh';
    }
    if (platform === 'omnivoice_local' && !voiceId) {
      voiceId = 'alloy';
    }
    const language = config.language || 'vi';
    const voiceLabel =
      getVoiceList(catalogForUi, platform, language).find((v) => v.id === voiceId)
        ?.name ||
      (voiceId === selectedVoice?.id ? selectedVoice?.name : undefined) ||
      voiceId ||
      '(chưa chọn)';

    if (voiceUiTab === 'engine' && platform && voiceId) {
      const valid = isVoiceValidForPlatform(
        catalogForUi,
        platform,
        language,
        voiceId,
      );
      if (!valid && !isLaStudioEnvPlatform(platform)) {
        toast.error(
          'Nghe thử — sai giọng',
          `Giọng «${voiceId}» không thuộc nền tảng «${platform}». Chọn lại trong Voice library.`,
        );
        previewAbortRef.current = null;
        return;
      }
    }

    if (voiceUiTab === 'la_studio') {
      // Keep latest family from store (selectVoice may have just set it).
      const liveFamily = liveFamilyPeek;
      const targetPlatform =
        liveFamily === 'omnivoice' ? 'omnivoice_local' : 'la_studio';
      if (
        config.platform !== targetPlatform ||
        config.voice !== voiceId ||
        config.laStudioFamily !== liveFamily
      ) {
        suppressPreviewCancelRef.current = true;
        store.updateTTSConfig({
          platform: targetPlatform,
          voice: voiceId,
          laStudioFamily: liveFamily,
          vinaUseClone: false,
        });
        lastPreviewSigRef.current = [
          targetPlatform,
          voiceId,
          String(config.speed),
          String(config.pitch),
        ].join('|');
        window.setTimeout(() => {
          suppressPreviewCancelRef.current = false;
        }, 0);
      }
      if (targetPlatform === 'omnivoice_local') {
        void fetch(API.omnivoiceStatus, {
          method: 'POST',
          cache: 'no-store',
        }).catch(() => undefined);
      } else {
        // Do NOT await spawn/poll — Kokoro CLI gen works without GUI model.
        // Fire-and-forget: keep API warm in background only.
        void fetch(API.laStudioStatus, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spawnApp: true, hidden: true, pollMs: 4_000 }),
        }).catch(() => undefined);
      }
    }

    const timeoutMs = ttsPreviewTimeoutMs(platform);
    const timeoutId = window.setTimeout(() => ac.abort(), timeoutMs);
    setIsPreviewing(true);
    stopPreviewAudio();

    try {
      const { ttsConfigPatch } = assertPreviewReady(platform, voiceId);

      if (platform === 'omnivoice_local') {
        try {
          await fetch(API.omnivoiceStatus, {
            method: 'POST',
            signal: ac.signal,
            cache: 'no-store',
          });
        } catch {
          /* ignore */
        }
      }

      // Fresh store after selectVoice / family switch — avoid stale laStudioFamily
      const liveCfg = useNovelStore.getState().ttsConfig || config;
      const speedN = Number(liveCfg.speed ?? config.speed);
      const pitchN = Number(liveCfg.pitch ?? config.pitch);
      const speed = Number.isFinite(speedN) && speedN > 0 ? speedN : 1;
      const pitch = Number.isFinite(pitchN) ? pitchN : 0;
      const previewCfg = {
        ...config,
        ...liveCfg,
        ...ttsConfigPatch,
        platform,
        language,
        voice: voiceId,
        speed,
        pitch,
        laStudioFamily:
          String(liveCfg.laStudioFamily || config.laStudioFamily || '').trim() ||
          'kokoro-vietnamese',
        vinaUseClone: false,
      };
      toast.info(
        'Nghe thử',
        platform === 'la_studio'
          ? `Đang gen LA Studio «${voiceLabel}»…`
          : `Đang gen «${voiceLabel}» · ${platform}…`,
      );
      const previewAudioUrl = await fetchPreviewAudio(
        voiceId,
        voiceLabel,
        previewCfg,
        getPreviewApiKeys(platform),
        ac.signal,
      );
      if (ac.signal.aborted) return;
      const fallbackUrl = (() => {
        try {
          const w = window as unknown as {
            __ttsPreviewFallback?: Map<string, string>;
          };
          return w.__ttsPreviewFallback?.get(previewAudioUrl);
        } catch {
          return undefined;
        }
      })();
      await playPreviewUrl(previewAudioUrl, fallbackUrl);
      toast.info('Notice', `Đang phát «${voiceLabel}».`);
    } catch (error) {
      if (
        ac.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        const timedOut =
          (error instanceof DOMException && error.name === 'AbortError') ||
          (error instanceof Error && /abort/i.test(error.message));
        if (timedOut && previewAbortRef.current !== null) {
          toast.error(
            'Nghe thử — timeout',
            `Giọng «${voiceLabel}» · ${platform}: quá ${Math.round(timeoutMs / 1000)}s. ` +
              (platform === 'la_studio'
                ? 'Chọn giọng Kokoro-VI thật (Diễm Trinh / Mai Linh…), không chờ load GUI. Bấm Nghe thử lại — CLI gen thường <10s.'
                : 'Kiểm tra engine đã chọn (không đổi engine ngầm).'),
          );
        }
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      if (!ac.signal.aborted) {
        toast.error(
          'Nghe thử thất bại',
          `Giọng «${voiceLabel}» · ${platform}: ${msg}`,
        );
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (previewAbortRef.current === ac) previewAbortRef.current = null;
      setIsPreviewing(false);
    }
  };

  // Esc + body scroll lock while open
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelPreview();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
    };
    // cancelPreview is stable enough for close path; avoid re-bind thrash
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open/close only
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 font-sans animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label="Cấu hình giọng đọc TTS"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          cancelPreview();
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-3xl rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col max-h-[92vh] relative z-[61] pointer-events-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 p-4 bg-zinc-900/50 shrink-0">
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2 text-zinc-100">
              <Volume2 className="h-5 w-5 text-violet-400 shrink-0" />
              <h2 className="text-sm font-bold uppercase tracking-wider">
                Cấu Hình Giọng Đọc Toàn Cục
              </h2>
              {isPreviewing ? (
                <span className="text-[9px] font-bold uppercase text-amber-400 animate-pulse">
                  Đang nghe thử… (bấm Hủy)
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2 pl-7 text-[9px] text-zinc-500 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  store.ensureVoiceCastSeeded();
                  setCastStudioOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded border border-emerald-800/60 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400 hover:bg-emerald-500/20"
              >
                🎭 Phân vai giọng
                {isCastActive(normalizeVoiceCast(store.voiceCast)) ? (
                  <span className="text-emerald-300">ON</span>
                ) : null}
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              cancelPreview();
              onClose();
            }}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors shrink-0"
            aria-label="Đóng"
            title="Đóng (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {isFreeTier ? (
            <div className="rounded-lg border border-amber-800/40 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-100/90 leading-relaxed">
              <span className="font-bold text-amber-300">Gói Free · TTS: </span>
              chỉ tab <strong>Engine chọn tay</strong> →{' '}
              <strong>Edge TTS</strong> hoặc <strong>Piper</strong> (3 lượt/ngày).
              LA Studio / multi-cast cần Trial hoặc Pro (nhấp logo).
            </div>
          ) : null}
          <div className="flex rounded-lg border border-zinc-800 overflow-hidden">
            <button
              type="button"
              onClick={() => {
                if (isFreeTier) {
                  toast.error(
                    'LA Studio · Trial/Pro',
                    'LA Studio (Kokoro multi-family) chỉ dành cho gói Trial hoặc Pro. Nhấp logo → kích hoạt Trial/Pro.',
                  );
                  return;
                }
                setVoiceUiTab('la_studio');
                const v =
                  config.platform === 'la_studio' &&
                  config.voice &&
                  config.voice !== 'default'
                    ? config.voice
                    : 'diem_trinh';
                store.updateTTSConfig({
                  platform: 'la_studio',
                  language: config.language || 'vi',
                  voice: v,
                  laStudioFamily: config.laStudioFamily || 'kokoro-vietnamese',
                  vinaUseClone: false,
                });
              }}
              className={`flex-1 px-2 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                voiceUiTab === 'la_studio'
                  ? 'bg-violet-500 text-white'
                  : 'bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
              } ${isFreeTier ? 'opacity-60' : ''}`}
              title={
                isFreeTier
                  ? 'LA Studio — Trial/Pro only'
                  : 'LA Studio local — Kokoro-VI + family tải on-demand (Trial/Pro)'
              }
            >
              LA Studio{isFreeTier ? ' · Pro' : ''}
            </button>
            <button
              type="button"
              onClick={() => {
                setVoiceUiTab('engine');
                let plat = config.platform;
                // Leave LA Studio env (la_studio / omnivoice) when entering Engine tab
                if (isFreeTier) {
                  plat = isFreeTtsPlatform(plat) ? plat : 'edge_tts';
                } else if (
                  isLaStudioEnvPlatform(plat) ||
                  plat === 'vina_voice' ||
                  !isEngineManualTtsPlatform(plat)
                ) {
                  plat = 'edge_tts';
                }
                const next = getDefaultVoiceConfig(
                  catalogForUi,
                  plat,
                  config.language || 'vi',
                );
                const keepVoice =
                  plat === config.platform &&
                  !!String(config.voice || '').trim() &&
                  getVoiceList(catalogForUi, plat, next.language).some(
                    (v) => v.id === config.voice,
                  );
                store.updateTTSConfig({
                  platform: plat,
                  language: next.language || config.language || 'vi',
                  voice: keepVoice
                    ? config.voice
                    : next.voice ||
                      (plat === 'edge_tts' ? 'vi-VN-NamMinhNeural' : config.voice) ||
                      '',
                  vinaUseClone: false,
                });
              }}
              className={`flex-1 px-2 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors border-l border-zinc-800 ${
                voiceUiTab === 'engine'
                  ? 'bg-sky-500 text-black'
                  : 'bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Engine chọn tay
            </button>
          </div>

          {voiceUiTab === 'la_studio' ? (
            <LaStudioStudioTab
              config={config}
              updateTTSConfig={store.updateTTSConfig}
              dynamicVoices={catalogForUi}
              isFreeTier={isFreeTier}
              isPreviewing={isPreviewing}
              onPreviewVoice={handlePreviewVoice}
              setCastStudioOpen={setCastStudioOpen}
              ensureVoiceCastSeeded={() => store.ensureVoiceCastSeeded()}
            />
          ) : (
            <EngineVoiceTab
              config={config}
              updateTTSConfig={store.updateTTSConfig}
              dynamicVoices={catalogForUi}
              currentVoices={currentVoices}
              activeVoiceId={activeVoiceId}
              isPreviewing={isPreviewing}
              handlePreviewVoice={handlePreviewVoice}
              tiktokSessions={tiktokSessions}
              newTikTokSessionInput={newTikTokSessionInput}
              setNewTikTokSessionInput={setNewTikTokSessionInput}
              isFetchingTikTokSession={isFetchingTikTokSession}
              copiedTikTokIdx={copiedTikTokIdx}
              isTikTokWithoutSession={!!isTikTokWithoutSession}
              handleAutoFetchTikTokSession={handleAutoFetchTikTokSession}
              handleSetPrimaryTikTokSession={handleSetPrimaryTikTokSession}
              handleCopyTikTokSession={handleCopyTikTokSession}
              handleRemoveTikTokRow={handleRemoveTikTokRow}
              handleAddTikTokSessionsFromInput={handleAddTikTokSessionsFromInput}
              capcutDiag={capcutDiag}
            />
          )}
        </div>

        <div className="border-t border-zinc-800 p-4 bg-zinc-900/50 flex justify-end gap-2">
          {isPreviewing ? (
            <button
              type="button"
              onClick={cancelPreview}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-xs font-bold text-zinc-300 hover:bg-zinc-800"
            >
              Hủy nghe thử
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (activeVoiceId && activeVoiceId !== config.voice) {
                store.updateTTSConfig({ voice: activeVoiceId });
              }
              onClose();
            }}
            className="rounded-lg bg-violet-500 px-6 py-2 text-xs font-bold text-white hover:bg-violet-400 transition-colors"
          >
            Lưu Cấu Hình
          </button>
        </div>
      </div>

      <RoleCastStudioModal
        isOpen={castStudioOpen}
        onClose={() => setCastStudioOpen(false)}
        chapter={store.chuong_dang_chon || 1}
        sceneIndex={0}
        initialTab="roles"
        sceneText={
          store.danh_sach_chuong?.find((c) => c.so_chuong === store.chuong_dang_chon)
            ?.noi_dung || ''
        }
      />
    </div>
  );
}
