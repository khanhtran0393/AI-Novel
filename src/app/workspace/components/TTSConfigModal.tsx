'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNovelStore, type TTSConfig } from '@/store/useNovelStore';
import { X, Volume2, Globe, Settings, Cpu, Play, Loader2, ChevronDown, RefreshCw } from 'lucide-react';
import {
  applyMediaSelfHealPatch,
  collectAudioRepairRoutes,
  diagnoseMediaSelfHeal,
  resolveMediaSelfHealLog,
} from '../utils/mediaSelfRepair';
import {
  STATIC_VOICE_CATALOG,
  TTS_LANGUAGES,
  getVoiceList,
  getDefaultVoiceConfig,
  type VoiceCatalog,
} from '@/lib/voiceCatalog';
import { prepareVoiceCatalog } from '@/lib/voiceCatalogPrep';
import { filterCloneProfilesByFields } from '@/lib/vinaVoice/profileFilter';
import RoleCastStudioModal from './RoleCastStudioModal';
import { isCastActive, normalizeVoiceCast } from '@/lib/voiceCast';

interface TTSConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const LANGUAGES = [...TTS_LANGUAGES];

/** Select tối: tránh Windows dropdown nền trắng + chữ trắng */
const SELECT_DARK =
  'w-full appearance-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 pr-10 text-sm text-zinc-100 outline-none focus:border-amber-500 cursor-pointer [color-scheme:dark]';
const SELECT_DARK_SM =
  'w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100 outline-none focus:border-amber-500 cursor-pointer [color-scheme:dark]';
const OPTION_DARK = 'bg-zinc-900 text-zinc-100';

export default function TTSConfigModal({ isOpen, onClose }: TTSConfigModalProps) {
  const store = useNovelStore();
  const config = store.ttsConfig;
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [castStudioOpen, setCastStudioOpen] = useState(false);
  /** clone = catalog Vina | engine = TTS cloud/local | create = clone từ file mẫu MP3/WAV */
  const [voiceUiTab, setVoiceUiTab] = useState<'clone' | 'engine' | 'create'>(() =>
    store.ttsConfig?.platform === 'vina_voice' ? 'clone' : 'engine',
  );
  const [testText, setTestText] = useState('Xin chào, đây là giọng đọc được clone từ mẫu của tôi.');
  const [cloneRefText, setCloneRefText] = useState('');
  const [cloneSampleFile, setCloneSampleFile] = useState<File | null>(null);
  const [cloneSampleLabel, setCloneSampleLabel] = useState('');
  const cloneFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isTestGenerating, setIsTestGenerating] = useState(false);
  const [testAudioUrl, setTestAudioUrl] = useState<string | null>(null);
  /** Gán clone sau khi tạo: global | narrator | tên NV */
  const [cloneAssignTarget, setCloneAssignTarget] = useState<string>('global');
  const [lastCloneResult, setLastCloneResult] = useState<{
    profileName: string;
    refPath?: string;
    method?: string;
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);
  const [dynamicVoices, setDynamicVoices] = useState<VoiceCatalog>(STATIC_VOICE_CATALOG);
  const [prepMeta, setPrepMeta] = useState<{ sources: string[]; total: number; loading: boolean }>({
    sources: ['static'],
    total: 0,
    loading: false,
  });
  const currentVoices = getVoiceList(dynamicVoices, config.platform, config.language);
  const selectedVoice = currentVoices.find(v => v.id === config.voice) || currentVoices[0] || null;
  const activeVoiceId = selectedVoice?.id || config.voice || '';
  const isTikTokWithoutSession = config.platform === 'tiktok_tts' && !config.tiktokSessionId?.trim();

  // Load ALL Clone Voice profiles (Vina catalog) into global voice config
  const [cloneProfiles, setCloneProfiles] = useState<
    {
      name: string;
      hasSample?: boolean;
      samplePath?: string | null;
      text?: string;
      speaker_seed?: number;
      style_seed?: number;
      pitch_shift?: number;
      filename?: string;
    }[]
  >([]);
  const [cloneStatus, setCloneStatus] = useState<{
    profilesCount?: number;
    samplesResolved?: number;
    userCloneFiles?: number;
    ffmpeg?: boolean;
  } | null>(null);
  const [engineHealth, setEngineHealth] = useState<{
    online: boolean;
    xtts?: boolean;
    cloneMode?: string;
    message?: string;
    loading?: boolean;
  }>({ online: false, loading: false });
  const [engineStarting, setEngineStarting] = useState(false);

  /** Hậu trường: chuẩn bị full catalog (static + piper + omnivoice + vina) */
  const runVoicePrep = async (forceRefresh = false) => {
    setPrepMeta((m) => ({ ...m, loading: true }));
    try {
      const result = await prepareVoiceCatalog({ forceRefresh });
      setDynamicVoices(result.catalog);
      const total = Object.values(result.counts || {}).reduce((a, b) => a + b, 0);
      setPrepMeta({
        sources: result.sources,
        total,
        loading: false,
      });
      console.info(
        `[TTS Voices Prep UI] sources=${result.sources.join('+')} total=${total}`,
        result.counts,
      );
    } catch (err) {
      console.error('[TTS Voices Prep UI] failed', err);
      setPrepMeta((m) => ({ ...m, loading: false }));
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void runVoicePrep(false);
    // Đồng bộ tab UI khi mở modal (giữ create nếu user đang ở đó)
    setVoiceUiTab((prev) => {
      if (prev === 'create') return 'create';
      return store.ttsConfig?.platform === 'vina_voice' ? 'clone' : 'engine';
    });
  }, [isOpen]);

  const refreshCloneStack = useCallback(async () => {
    try {
      const [profRes, stRes] = await Promise.all([
        fetch('/api/vina-voice/profiles').then((r) => r.json()),
        fetch('/api/vina-voice/status').then((r) => r.json()),
      ]);
      if (profRes?.ok && Array.isArray(profRes.profiles)) {
        setCloneProfiles(profRes.profiles);
        setCloneStatus(profRes.status || stRes || null);
      }
      if (stRes?.ok) {
        setEngineHealth({
          online: !!stRes.engine?.online,
          xtts: !!stRes.engine?.xtts_available,
          cloneMode: stRes.cloneMode,
          message: stRes.engine?.online
            ? stRes.readyForTrueTimbre
              ? 'Engine + XTTS — clone tembre'
              : 'Engine online — fallback Edge+match'
            : 'Engine offline — builtin Edge+post',
          loading: false,
        });
      }
    } catch (err) {
      console.error('Failed to load clone stack:', err);
      setEngineHealth((h) => ({ ...h, loading: false, online: false }));
    }
  }, []);

  // Chi tiết profile clone + health engine
  useEffect(() => {
    if (!isOpen) return;
    setEngineHealth((h) => ({ ...h, loading: true }));
    void refreshCloneStack();
    const t = window.setInterval(() => {
      if (voiceUiTab === 'create' || voiceUiTab === 'clone') {
        void refreshCloneStack();
      }
    }, 12000);
    return () => window.clearInterval(t);
  }, [isOpen, voiceUiTab, refreshCloneStack]);

  const startCloneEngine = async () => {
    setEngineStarting(true);
    try {
      const res = await fetch('/api/vina-voice/engine/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engineUrl: config.vinaEngineUrl || 'http://127.0.0.1:8765',
        }),
      });
      const data = await res.json().catch(() => ({}));
      await refreshCloneStack();
      void runVoicePrep(true);
      alert(
        data.message ||
          (data.ok
            ? 'Engine đã sẵn sàng.'
            : data.error || 'Không khởi động được engine. Chạy tools/vina_voice_engine/RUN_ENGINE.bat'),
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setEngineStarting(false);
    }
  };

  const filteredCloneProfiles = filterCloneProfilesByFields(cloneProfiles, {
    gender: config.vinaGender || 'male',
    area: config.vinaArea || 'southern',
    group: config.vinaGroup || 'story',
    emotion: config.vinaEmotion || 'neutral',
  });

  const applyCloneProfile = (profileName: string) => {
    const p = cloneProfiles.find((x) => x.name === profileName);
    const gender: 'male' | 'female' = /nữ|nu |female|cô |chị /i.test(profileName)
      ? 'female'
      : 'male';
    store.updateTTSConfig({
      platform: 'vina_voice',
      language: 'vi',
      voice: profileName,
      vinaUseClone: true,
      vinaGender: gender,
      vinaReferenceAudio: p?.samplePath || store.ttsConfig.vinaReferenceAudio || '',
      vinaReferenceText: p?.text || store.ttsConfig.vinaReferenceText || '',
      vinaSpeakerSeed: p?.speaker_seed ?? store.ttsConfig.vinaSpeakerSeed ?? 2336,
      vinaStyleSeed: p?.style_seed ?? store.ttsConfig.vinaStyleSeed ?? 4125,
      pitch: typeof p?.pitch_shift === 'number' ? p.pitch_shift : store.ttsConfig.pitch,
    });
  };

  /** Khi đổi bộ lọc mà giọng đang chọn không còn trong list → chọn giọng đầu list lọc */
  const onCloneFilterChange = (partial: Partial<typeof config>) => {
    const next = { ...config, ...partial, platform: 'vina_voice' as const };
    store.updateTTSConfig(partial);
    const filtered = filterCloneProfilesByFields(cloneProfiles, {
      gender: next.vinaGender || 'male',
      area: next.vinaArea || 'southern',
      group: next.vinaGroup || 'story',
      emotion: next.vinaEmotion || 'neutral',
    });
    if (filtered.length && !filtered.some((p) => p.name === next.voice)) {
      applyCloneProfile(filtered[0].name);
    }
  };

  const previewAbortRef = useRef<AbortController | null>(null);
  const PREVIEW_TIMEOUT_MS = 45_000;

  useEffect(() => {
    return () => {
      previewAbortRef.current?.abort();
      if (audioRef.current) {
        try {
          audioRef.current.pause();
          audioRef.current.src = '';
        } catch {
          /* ignore */
        }
        audioRef.current = null;
      }
      if (testAudioRef.current) {
        testAudioRef.current.pause();
        testAudioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen || currentVoices.length === 0) return;
    if (!currentVoices.some(v => v.id === config.voice)) {
      store.updateTTSConfig({ voice: currentVoices[0].id });
    }
  }, [isOpen, config.platform, config.language, config.voice, currentVoices, store]);

  const stopPreviewAudio = () => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.src = '';
      } catch {
        /* ignore */
      }
      audioRef.current = null;
    }
  };

  const cancelPreview = () => {
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    stopPreviewAudio();
    setIsPreviewing(false);
  };

  const playPreviewUrl = async (url: string) => {
    stopPreviewAudio();
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => {
      if (audioRef.current === audio) audioRef.current = null;
    };
    audio.onerror = () => {
      if (audioRef.current === audio) audioRef.current = null;
    };
    try {
      await audio.play();
    } catch (playErr) {
      throw new Error(
        playErr instanceof Error
          ? `Không phát được audio: ${playErr.message}`
          : 'Không phát được audio nghe thử',
      );
    }
  };

  const fetchPreviewAudio = async (
    voiceId: string,
    voiceLabel: string,
    ttsCfg: typeof config,
    apiKeys: string[],
    signal: AbortSignal,
  ): Promise<string> => {
    const label = (voiceLabel || voiceId || 'Giọng').split('(')[0].trim();
    const response = await fetch('/api/generate-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        sceneText: `${label}, chào mừng bạn đến với thế giới AI Novel`,
        chapterNum: 0,
        sceneIndex: 999,
        isPreview: true,
        voiceName: voiceId,
        ttsConfig: { ...ttsCfg, voice: voiceId },
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
      throw new Error(data?.error || `Lỗi tạo bản nghe thử (HTTP ${response.status})`);
    }
    return `${data.audioPath}?t=${Date.now()}`;
  };

  const getPreviewApiKeys = (platform: string) => {
    if (platform === 'openai_tts') {
      return store.openaiApiKeys?.length
        ? store.openaiApiKeys
        : store.openaiApiKey
          ? [store.openaiApiKey]
          : [];
    }
    return store.apiKeys?.length ? store.apiKeys : store.apiKey ? [store.apiKey] : [];
  };

  const handlePreviewVoice = async () => {
    // Đang chạy → bấm lại = hủy (không kẹt disabled vĩnh viễn)
    if (isPreviewing) {
      cancelPreview();
      return;
    }

    previewAbortRef.current?.abort();
    const ac = new AbortController();
    previewAbortRef.current = ac;
    const timeoutId = window.setTimeout(() => ac.abort(), PREVIEW_TIMEOUT_MS);

    setIsPreviewing(true);
    stopPreviewAudio();

    try {
      const selectedVoiceObj = selectedVoice;
      const voiceId = activeVoiceId || config.voice;
      if (!voiceId) {
        throw new Error('Chưa chọn giọng để nghe thử.');
      }

      let previewAudioUrl = '';
      if (
        config.platform === 'omnivoice_local' &&
        selectedVoiceObj?.previewUrl
      ) {
        previewAudioUrl = selectedVoiceObj.previewUrl;
      } else {
        previewAudioUrl = await fetchPreviewAudio(
          voiceId,
          selectedVoiceObj?.name || voiceId,
          config,
          getPreviewApiKeys(config.platform),
          ac.signal,
        );
      }

      if (ac.signal.aborted) return;
      await playPreviewUrl(previewAudioUrl);
    } catch (error) {
      if (ac.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        console.info('[TTS Preview] đã hủy / timeout');
        return;
      }
      console.error('[TTS Preview]', error);

      // Self-heal gọn: tối đa 2 route, mỗi route có timeout riêng, không await log treo
      try {
        const diagnosis = await Promise.race([
          diagnoseMediaSelfHeal(store, 'audio', error, {
            operation: 'tts_modal_preview',
            ttsPlatform: config.platform,
            ttsVoice: activeVoiceId,
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
        ]);
        if (!diagnosis || ac.signal.aborted) {
          alert(
            'Không thể nghe thử: ' +
              (error instanceof Error ? error.message : String(error)),
          );
          return;
        }

        const routes = collectAudioRepairRoutes(
          useNovelStore.getState(),
          diagnosis,
          config.platform,
          activeVoiceId,
        ).slice(0, 2);

        console.info(
          `[Self-Heal Brain] TTS modal: kind=${diagnosis.issue.kind}, routes=${routes.length}`,
        );

        if (routes.length === 0) {
          alert(
            'Không thể nghe thử: ' +
              (error instanceof Error ? error.message : String(error)),
          );
          return;
        }

        applyMediaSelfHealPatch(useNovelStore.getState(), diagnosis.patch);
        let lastError: unknown = error;
        let healed = false;

        for (const route of routes) {
          if (ac.signal.aborted) break;
          applyMediaSelfHealPatch(useNovelStore.getState(), {
            ttsConfig: {
              platform: route.platform as typeof store.ttsConfig.platform,
              voice: route.voice,
            },
          });
          const patchedConfig = useNovelStore.getState().ttsConfig;
          const patchedVoice = route.voice || patchedConfig.voice || activeVoiceId;
          try {
            const url = await fetchPreviewAudio(
              patchedVoice,
              patchedVoice,
              patchedConfig,
              getPreviewApiKeys(patchedConfig.platform),
              ac.signal,
            );
            if (ac.signal.aborted) break;
            await playPreviewUrl(url);
            void resolveMediaSelfHealLog(diagnosis.logId).catch(() => undefined);
            healed = true;
            break;
          } catch (retryError) {
            lastError = retryError;
            console.warn(
              `[Self-Heal Brain] TTS modal route failed ${route.platform}:`,
              retryError,
            );
          }
        }

        if (!healed && !ac.signal.aborted) {
          alert(
            'Không nghe thử được sau tự sửa: ' +
              (lastError instanceof Error ? lastError.message : String(lastError)),
          );
        }
      } catch (healErr) {
        console.warn('[TTS Preview] self-heal error', healErr);
        alert(
          'Không thể nghe thử: ' +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (previewAbortRef.current === ac) previewAbortRef.current = null;
      setIsPreviewing(false);
    }
  };

  /**
   * TẠO GIỌNG ĐỌC = Clone + tự tối ưu:
   * 1) Auto-start engine nếu offline
   * 2) Server trim/loudnorm/cap mẫu + seed ổn định + gender/prosody auto
   * 3) Gán Role Cast / NV
   */
  const handleTestGeneration = async () => {
    if (!testText.trim()) {
      alert('Nhập nội dung cần đọc bằng giọng clone.');
      return;
    }
    if (!cloneSampleFile) {
      alert(
        'Clone Voice cần file mẫu MP3/WAV.\nBấm «Chọn file mẫu» và tải lên giọng người thật (như tab Clone của Vina).',
      );
      cloneFileInputRef.current?.click();
      return;
    }
    try {
      setIsTestGenerating(true);
      setTestAudioUrl(null);
      if (testAudioRef.current) {
        testAudioRef.current.pause();
        testAudioRef.current = null;
      }

      // Tự bật engine nếu offline (best-effort)
      if (!engineHealth.online) {
        try {
          setEngineStarting(true);
          await fetch('/api/vina-voice/engine/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              engineUrl: config.vinaEngineUrl || 'http://127.0.0.1:8765',
            }),
          });
          await refreshCloneStack();
        } catch {
          /* tiếp tục builtin */
        } finally {
          setEngineStarting(false);
        }
      }

      const target = cloneAssignTarget || 'global';
      const charProfile =
        target !== 'global' && target !== 'narrator'
          ? store.nhan_vat_prompts?.[target]
          : undefined;

      const fd = new FormData();
      fd.append('audio', cloneSampleFile);
      fd.append('text', testText.trim());
      if (cloneRefText.trim()) fd.append('ref_text', cloneRefText.trim());
      fd.append('gender', 'auto'); // server tự suy
      fd.append('speed', String(config.speed ?? 1));
      fd.append('pitch', String(config.pitch ?? 0));
      fd.append('auto_optimize', '1');
      fd.append('assign_target', target);
      if (charProfile?.giong_thoai || charProfile?.thoi_quen) {
        fd.append(
          'char_quirk',
          `${charProfile.giong_thoai || ''} ${charProfile.thoi_quen || ''}`.trim(),
        );
      }
      if (charProfile?.gioi_tinh) {
        fd.append('char_gender', charProfile.gioi_tinh);
      }
      // seed 0 → server stableSeed
      fd.append('speaker_seed', '0');
      fd.append('style_seed', '0');
      if (config.vinaEngineUrl) fd.append('engine_url', config.vinaEngineUrl);

      const response = await fetch('/api/vina-voice/clone', {
        method: 'POST',
        body: fd,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Lỗi clone giọng đọc');
      }

      const profileName = String(data.profileName || '').trim() || config.voice;
      const refPath = data.refPath ? String(data.refPath) : undefined;
      const refText = cloneRefText.trim() || testText.trim().slice(0, 120);
      const opt = data.optimized || {};
      const finalSpeed =
        typeof opt.speed === 'number' ? opt.speed : config.speed ?? 1;
      const finalPitch =
        typeof opt.pitch === 'number' ? opt.pitch : config.pitch ?? 0;

      // Đồng bộ slider UI theo kết quả auto
      if (typeof opt.speed === 'number' || typeof opt.pitch === 'number') {
        store.updateTTSConfig({
          speed: finalSpeed,
          pitch: finalPitch,
          ...(opt.gender
            ? { vinaGender: opt.gender as 'male' | 'female' }
            : {}),
          vinaSpeakerSeed: opt.speakerSeed ?? config.vinaSpeakerSeed,
          vinaStyleSeed: opt.styleSeed ?? config.vinaStyleSeed,
        });
      }

      store.assignCloneProfile({
        profileName,
        refPath,
        refText,
        target,
        speed: finalSpeed,
        pitch: finalPitch,
      });

      setLastCloneResult({
        profileName,
        refPath,
        method: [
          data.method,
          opt.steps ? `opt:${(opt.steps as string[]).slice(0, 6).join('+')}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      });

      const url = `${data.audioPath}?t=${Date.now()}`;
      setTestAudioUrl(url);
      const audio = new Audio(url);
      testAudioRef.current = audio;
      void audio.play().catch(() => undefined);

      void refreshCloneStack();
      void runVoicePrep(true);

      console.info(
        `[Clone AutoOK] ${profileName} → ${target} · spd=${finalSpeed} pitch=${finalPitch} · ${data.method || ''}`,
        opt.steps,
      );
    } catch (error) {
      console.error('Clone generation error:', error);
      alert(
        'Không clone được giọng: ' +
          (error instanceof Error ? error.message : String(error)) +
          '\n\nGợi ý: bấm «Khởi động Engine Clone» hoặc chạy tools/vina_voice_engine/RUN_ENGINE.bat',
      );
    } finally {
      setIsTestGenerating(false);
    }
  };

  // Reset preview state khi đóng modal
  useEffect(() => {
    if (!isOpen) {
      cancelPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-sans animate-in fade-in duration-200">
      <div className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 p-4 bg-zinc-900/50">
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2 text-zinc-100">
              <Volume2 className="h-5 w-5 text-amber-500 shrink-0" />
              <h2 className="text-sm font-bold uppercase tracking-wider">Cấu Hình Giọng Đọc Toàn Cục</h2>
            </div>
            <div className="flex items-center gap-2 pl-7 text-[9px] text-zinc-500 flex-wrap">
              <span>
                Hậu trường: {prepMeta.loading ? 'đang chuẩn bị…' : prepMeta.sources.join(' + ')}
                {prepMeta.total > 0 ? ` · ~${prepMeta.total} giọng` : ''}
              </span>
              <button
                type="button"
                onClick={() => void runVoicePrep(true)}
                disabled={prepMeta.loading}
                title="Làm mới catalog (Piper / OmniVoice / Vina)"
                className="inline-flex items-center gap-1 rounded border border-zinc-800 px-1.5 py-0.5 text-amber-500/90 hover:bg-zinc-800 hover:text-amber-400 disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${prepMeta.loading ? 'animate-spin' : ''}`} />
                Prep
              </button>
              <button
                type="button"
                onClick={() => {
                  store.ensureVoiceCastSeeded();
                  setCastStudioOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded border border-emerald-800/60 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400 hover:bg-emerald-500/20"
                title="Phân vai giọng theo nhân vật (Role Casting Studio)"
              >
                🎭 Phân vai giọng
                {isCastActive(normalizeVoiceCast(store.voiceCast)) ? (
                  <span className="text-emerald-300">ON</span>
                ) : null}
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Hàng tab: Clone Voice catalog | Engine khác | Tạo giọng từ file mẫu */}
          <div className="flex rounded-lg border border-zinc-800 overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setVoiceUiTab('clone');
                store.updateTTSConfig({ platform: 'vina_voice', vinaUseClone: true });
                if (cloneProfiles[0] && !cloneProfiles.some((p) => p.name === config.voice)) {
                  applyCloneProfile(cloneProfiles[0].name);
                }
              }}
              className={`flex-1 px-2 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                voiceUiTab === 'clone'
                  ? 'bg-amber-500 text-black'
                  : 'bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Clone Voice
            </button>
            <button
              type="button"
              onClick={() => {
                setVoiceUiTab('engine');
                const nextPlatform =
                  config.platform === 'vina_voice'
                    ? ('edge_tts' as const)
                    : config.platform;
                const nextVoiceConfig = getDefaultVoiceConfig(
                  dynamicVoices,
                  nextPlatform,
                  config.language || 'vi',
                );
                store.updateTTSConfig({
                  platform: nextPlatform,
                  language: nextVoiceConfig.language,
                  voice: nextVoiceConfig.voice,
                  vinaUseClone: false,
                });
              }}
              className={`flex-1 px-2 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors border-l border-zinc-800 ${
                voiceUiTab === 'engine'
                  ? 'bg-sky-500 text-black'
                  : 'bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Engine khác
            </button>
            <button
              type="button"
              onClick={() => {
                setVoiceUiTab('create');
                store.updateTTSConfig({ platform: 'vina_voice', vinaUseClone: true });
              }}
              title="Tạo giọng đọc: tải MP3/WAV mẫu → nhập text → clone (kiểu Vina)"
              className={`flex items-center justify-center gap-1.5 flex-1 min-w-0 px-2 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors border-l border-zinc-800 ${
                voiceUiTab === 'create'
                  ? 'bg-emerald-500 text-black'
                  : 'bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="truncate">Tạo giọng đọc</span>
            </button>
          </div>

          {/* ===== Tab Tạo giọng đọc: clone từ MP3/WAV mẫu ===== */}
          {voiceUiTab === 'create' ? (
            <div className="space-y-4 rounded-xl border border-emerald-900/45 bg-emerald-950/15 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-400">
                    Tạo giọng đọc từ mẫu
                  </h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 max-w-lg">
                    Tải mẫu → chọn gán NV →{' '}
                    <span className="text-emerald-500/90">Tạo giọng đọc</span>. Hệ thống{' '}
                    <span className="text-amber-400/90">tự tối ưu</span>: bật engine, trim/loudnorm
                    mẫu, seed ổn định, gender/prosody từ quirk, gán Role Cast.
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span
                    className="rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide bg-emerald-500/20 text-emerald-300"
                  >
                    ● AI Novel Native Engine (Độc lập 100%)
                  </span>
                  <button
                    type="button"
                    disabled={true}
                    className="rounded border border-emerald-800/60 px-2 py-1 text-[9px] font-bold uppercase text-emerald-400 opacity-70"
                  >
                    Không cần khởi động phụ thuộc
                  </button>
                </div>
              </div>

              <input
                ref={cloneFileInputRef}
                type="file"
                accept="audio/mpeg,audio/mp3,audio/wav,audio/*,.mp3,.wav,.m4a,.ogg,.flac"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setCloneSampleFile(f);
                  setCloneSampleLabel(f ? f.name : '');
                  if (f) {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      const b64 = (reader.result as string).split(',')[1];
                      store.updateTTSConfig({ vinaReferenceAudioB64: b64, vinaReferenceAudio: f.name, vinaUseClone: true });
                    };
                    reader.readAsDataURL(f);
                  } else {
                    store.updateTTSConfig({ vinaReferenceAudioB64: undefined, vinaReferenceAudio: '' });
                  }
                }}
              />

              <div className="space-y-1.5">
                <label className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/80">
                  1. File mẫu (MP3 / WAV)
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => cloneFileInputRef.current?.click()}
                    className="rounded-lg border border-emerald-700/70 bg-emerald-500/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/20"
                  >
                    {cloneSampleLabel ? 'Đổi file mẫu' : 'Chọn file mẫu'}
                  </button>
                  <span
                    className={`text-[11px] truncate max-w-[260px] ${
                      cloneSampleLabel ? 'text-zinc-200' : 'text-zinc-600'
                    }`}
                    title={cloneSampleLabel}
                  >
                    {cloneSampleLabel || 'Chưa chọn — bắt buộc để clone'}
                  </span>
                </div>
                {config.vinaReferenceAudio ? (
                  <p className="text-[9px] text-zinc-600">
                    Mẫu đang dùng trong store:{' '}
                    <code className="text-zinc-500 break-all">
                      {config.vinaReferenceAudio}
                    </code>
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                  2. Transcript mẫu (tuỳ chọn)
                </label>
                <input
                  type="text"
                  value={config.vinaReferenceText ?? cloneRefText}
                  onChange={(e) => {
                    setCloneRefText(e.target.value);
                    store.updateTTSConfig({ vinaReferenceText: e.target.value });
                  }}
                  placeholder="Câu đang được nói trong file mẫu — giúp clone chuẩn hơn"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[12px] text-zinc-200 outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                  3. Nội dung muốn đọc bằng giọng clone
                </label>
                <textarea
                  value={testText}
                  onChange={(e) => setTestText(e.target.value)}
                  rows={3}
                  placeholder="Ví dụ: Xin chào, đây là giọng đọc được clone từ mẫu của tôi."
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/80">
                  4. Gán vào (Role Casting / NV)
                </label>
                <select
                  value={cloneAssignTarget}
                  onChange={(e) => setCloneAssignTarget(e.target.value)}
                  className={SELECT_DARK}
                >
                  <option className={OPTION_DARK} value="global">
                    Người kể + giọng toàn cục (mặc định)
                  </option>
                  <option className={OPTION_DARK} value="narrator">
                    Chỉ Người kể (Role Cast)
                  </option>
                  {(store.nhan_vat || []).map((name) => (
                    <option className={OPTION_DARK} key={name} value={name}>
                      Nhân vật: {name}
                    </option>
                  ))}
                </select>
                <p className="text-[9px] text-zinc-600 leading-snug">
                  Sau khi tạo, profile USER được gán vào mục trên + bật Role Casting (nếu chọn NV
                  thì dual-write <code className="text-zinc-500">tts_voice</code> + speed/pitch từ
                  quirk hồ sơ).
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase text-zinc-500">Giới tính</label>
                  <select
                    value={config.vinaGender || 'male'}
                    onChange={(e) =>
                      store.updateTTSConfig({
                        platform: 'vina_voice',
                        vinaGender: e.target.value as 'male' | 'female',
                      })
                    }
                    className={SELECT_DARK_SM}
                  >
                    <option className={OPTION_DARK} value="male">
                      Nam
                    </option>
                    <option className={OPTION_DARK} value="female">
                      Nữ
                    </option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase text-zinc-500">Tốc độ</label>
                  <input
                    type="number"
                    step={0.05}
                    min={0.5}
                    max={2}
                    value={config.speed ?? 1}
                    onChange={(e) =>
                      store.updateTTSConfig({ speed: parseFloat(e.target.value) || 1 })
                    }
                    className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase text-zinc-500">Pitch</label>
                  <input
                    type="number"
                    step={1}
                    min={-12}
                    max={12}
                    value={config.pitch ?? 0}
                    onChange={(e) =>
                      store.updateTTSConfig({ pitch: parseInt(e.target.value, 10) || 0 })
                    }
                    className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100"
                  />
                </div>
                <div className="space-y-1 flex flex-col justify-end">
                  <button
                    type="button"
                    onClick={() => void handleTestGeneration()}
                    disabled={isTestGenerating || !testText.trim()}
                    className="flex h-[34px] items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-[11px] font-bold uppercase tracking-wider text-black hover:bg-emerald-400 disabled:opacity-45"
                  >
                    {isTestGenerating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    {isTestGenerating ? 'Đang clone…' : 'Tạo giọng đọc'}
                  </button>
                </div>
              </div>

              {testAudioUrl && (
                <div className="space-y-2 rounded-lg border border-emerald-900/40 bg-black/30 p-2.5">
                  <p className="text-[9px] font-bold uppercase text-emerald-500/80">
                    Kết quả clone
                  </p>
                  <audio src={testAudioUrl} controls className="h-9 w-full opacity-95" />
                  {lastCloneResult && (
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
                      <span>
                        Profile:{' '}
                        <code className="text-emerald-400/90">
                          {lastCloneResult.profileName}
                        </code>
                      </span>
                      {lastCloneResult.method && (
                        <span className="text-zinc-600">· {lastCloneResult.method}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          store.ensureVoiceCastSeeded();
                          setCastStudioOpen(true);
                        }}
                        className="rounded border border-emerald-800/50 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-400 hover:bg-emerald-500/10"
                      >
                        Mở Role Casting
                      </button>
                      <button
                        type="button"
                        onClick={() => setVoiceUiTab('clone')}
                        className="rounded border border-zinc-700 px-2 py-0.5 text-[9px] font-bold uppercase text-zinc-400 hover:bg-zinc-800"
                      >
                        Xem catalog Clone
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-lg border border-zinc-800/80 bg-black/25 p-2.5 text-[9px] leading-relaxed text-zinc-500 space-y-1">
                <p>
                  <span className="text-zinc-400 font-bold">Tích hợp full:</span> upload →{' '}
                  <code className="text-zinc-500">/api/vina-voice/clone</code> → engine{' '}
                  <code className="text-zinc-500">8765</code> (XTTS nếu có) → lưu{' '}
                  <code className="text-zinc-500">user-clones/</code> +{' '}
                  <code className="text-zinc-500">profiles_user.json</code> → catalog Clone Voice
                  + gen TTS <code className="text-zinc-500">vina_voice</code>.
                </p>
                <p>
                  Profiles: {cloneStatus?.profilesCount ?? cloneProfiles.length} · Mẫu resolve:{' '}
                  {cloneStatus?.samplesResolved ?? '—'} · User files:{' '}
                  {cloneStatus?.userCloneFiles ?? '—'} · Mode:{' '}
                  <span className="text-emerald-600/80">
                    {engineHealth.cloneMode || '—'}
                  </span>
                </p>
                <p>
                  Offline: <code className="text-zinc-500">tools/vina_voice_engine/RUN_ENGINE.bat</code>
                  {' · '}
                  XTTS: <code className="text-zinc-500">INSTALL_XTTS.bat</code>
                </p>
              </div>
            </div>
          ) : voiceUiTab === 'clone' ? (
            /* ===== Catalog Clone Voice — lọc + list profile ===== */
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase text-zinc-500">Giới tính</label>
                  <select
                    value={config.vinaGender || 'male'}
                    onChange={(e) =>
                      onCloneFilterChange({
                        vinaGender: e.target.value as 'male' | 'female',
                      })
                    }
                    className={SELECT_DARK_SM}
                  >
                    <option className={OPTION_DARK} value="male">Nam</option>
                    <option className={OPTION_DARK} value="female">Nữ</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase text-zinc-500">Vùng miền</label>
                  <select
                    value={config.vinaArea || 'southern'}
                    onChange={(e) =>
                      onCloneFilterChange({
                        vinaArea: e.target.value as 'northern' | 'central' | 'southern',
                      })
                    }
                    className={SELECT_DARK_SM}
                  >
                    <option className={OPTION_DARK} value="northern">Bắc</option>
                    <option className={OPTION_DARK} value="central">Trung</option>
                    <option className={OPTION_DARK} value="southern">Nam</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase text-zinc-500">Phong cách</label>
                  <select
                    value={config.vinaGroup || 'story'}
                    onChange={(e) => onCloneFilterChange({ vinaGroup: e.target.value })}
                    className={SELECT_DARK_SM}
                  >
                    <option className={OPTION_DARK} value="story">Kể chuyện</option>
                    <option className={OPTION_DARK} value="news">Tin tức</option>
                    <option className={OPTION_DARK} value="audiobook">Sách nói</option>
                    <option className={OPTION_DARK} value="ads">Quảng cáo</option>
                    <option className={OPTION_DARK} value="dubbing">Lồng tiếng</option>
                    <option className={OPTION_DARK} value="review">Review</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase text-zinc-500">Cảm xúc</label>
                  <select
                    value={config.vinaEmotion || 'neutral'}
                    onChange={(e) => onCloneFilterChange({ vinaEmotion: e.target.value })}
                    className={SELECT_DARK_SM}
                  >
                    <option className={OPTION_DARK} value="neutral">Trung tính</option>
                    <option className={OPTION_DARK} value="happy">Vui</option>
                    <option className={OPTION_DARK} value="sad">Buồn</option>
                    <option className={OPTION_DARK} value="angry">Giận</option>
                    <option className={OPTION_DARK} value="fear">Sợ</option>
                    <option className={OPTION_DARK} value="gentle">Dịu dàng</option>
                    <option className={OPTION_DARK} value="tired">Mệt</option>
                  </select>
                </div>
              </div>
              <p className="text-[9px] text-zinc-600 -mt-2">
                List giọng bên dưới đã lọc theo 4 trường trên
                {cloneProfiles.length
                  ? ` (${filteredCloneProfiles.length}/${cloneProfiles.length})`
                  : ''}
                .
              </p>

              <div className="space-y-2">
                <label className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <Volume2 className="h-3.5 w-3.5 text-amber-400" />
                    Chọn giọng
                    <span className="normal-case font-medium text-zinc-600 tracking-normal">
                      ({filteredCloneProfiles.length || 0})
                    </span>
                  </span>
                  {config.voice && (
                    <button
                      type="button"
                      onClick={() => void handlePreviewVoice()}
                      title={isPreviewing ? 'Bấm để hủy nghe thử' : 'Nghe thử giọng đang chọn'}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded transition-colors ${
                        isPreviewing
                          ? 'bg-rose-500/15 text-rose-400 hover:bg-rose-500/25'
                          : 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                      }`}
                    >
                      {isPreviewing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      {isPreviewing ? 'Hủy' : 'Nghe thử'}
                    </button>
                  )}
                </label>
                <select
                  value={
                    filteredCloneProfiles.some((p) => p.name === (config.voice || ''))
                      ? config.voice
                      : filteredCloneProfiles[0]?.name || ''
                  }
                  onChange={(e) => {
                    if (e.target.value) applyCloneProfile(e.target.value);
                  }}
                  className={SELECT_DARK}
                >
                  {filteredCloneProfiles.length === 0 && (
                    <option className={OPTION_DARK} value="">
                      Không có giọng khớp bộ lọc
                    </option>
                  )}
                  {filteredCloneProfiles.map((p) => (
                    <option className={OPTION_DARK} key={p.name} value={p.name}>
                      {p.hasSample ? '🎤' : '○'} {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label
                    className="text-[9px] font-bold uppercase text-zinc-500"
                    title="Mã số định danh “người nói”. Đổi số = cùng style nhưng tembre/biến thể giọng khác (như chọn ID nhân vật)."
                  >
                    Speaker seed
                  </label>
                  <input
                    type="number"
                    value={config.vinaSpeakerSeed ?? 2336}
                    onChange={(e) =>
                      store.updateTTSConfig({
                        vinaSpeakerSeed: parseInt(e.target.value, 10) || 0,
                      })
                    }
                    className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100"
                  />
                  <p className="text-[8px] text-zinc-600 leading-snug">
                    ID giọng / tembre. Đổi số → biến thể người nói khác (cùng profile).
                  </p>
                </div>
                <div className="space-y-1">
                  <label
                    className="text-[9px] font-bold uppercase text-zinc-500"
                    title="Mã số điệu bộ: ngắt nghỉ, nhấn nhá, ngữ điệu câu. Đổi số = cùng tembre nhưng cách đọc khác."
                  >
                    Style seed
                  </label>
                  <input
                    type="number"
                    value={config.vinaStyleSeed ?? 4125}
                    onChange={(e) =>
                      store.updateTTSConfig({
                        vinaStyleSeed: parseInt(e.target.value, 10) || 0,
                      })
                    }
                    className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100"
                  />
                  <p className="text-[8px] text-zinc-600 leading-snug">
                    Điệu bộ / ngắt nghỉ / nhấn nhá. Đổi số → cách đọc khác, tembre giữ.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                    Tốc độ
                  </label>
                  <div className="flex items-center gap-3 bg-black/60 border border-zinc-800 rounded-lg p-2">
                    <input
                      type="range"
                      min="0.5"
                      max="2.0"
                      step="0.1"
                      value={config.speed}
                      onChange={(e) =>
                        store.updateTTSConfig({ speed: parseFloat(e.target.value) })
                      }
                      className="w-full accent-amber-500 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="text-sm font-bold text-zinc-300 w-10 text-right">
                      {Number(config.speed || 1).toFixed(1)}x
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                    Pitch
                  </label>
                  <div className="flex items-center gap-3 bg-black/60 border border-zinc-800 rounded-lg p-2">
                    <input
                      type="range"
                      min="-12"
                      max="12"
                      step="1"
                      value={config.pitch || 0}
                      onChange={(e) =>
                        store.updateTTSConfig({ pitch: parseInt(e.target.value, 10) })
                      }
                      className="w-full accent-indigo-500 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="text-sm font-bold text-zinc-300 w-12 text-right">
                      {(config.pitch || 0) > 0 ? `+${config.pitch}` : config.pitch || 0}
                    </span>
                  </div>
                </div>
              </div>




            </div>
          ) : (
            /* ===== CHỈ Engine khác ===== */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  <Cpu className="h-3.5 w-3.5 text-sky-400" /> Nền tảng
                </label>
                <div className="relative w-full">
                  <select
                    value={config.platform}
                    onChange={(e) => {
                      const newPlatform = e.target.value as TTSConfig['platform'];
                      if ((newPlatform as string) === 'vina_voice') {
                        store.updateTTSConfig({ platform: 'vina_voice', vinaUseClone: true });
                        return;
                      }
                      const nextVoiceConfig = getDefaultVoiceConfig(
                        dynamicVoices,
                        newPlatform,
                        config.language,
                      );
                      store.updateTTSConfig({
                        platform: newPlatform,
                        language: nextVoiceConfig.language,
                        voice: nextVoiceConfig.voice,
                        vinaUseClone: false,
                      });
                      // Warm-start OmniVoice Local (port 8880) khi chọn platform
                      if (newPlatform === 'omnivoice_local') {
                        void fetch('/api/omnivoice/status', { method: 'POST' }).catch(() => {});
                      }
                    }}
                    className={SELECT_DARK}
                  >
                    <option className={OPTION_DARK} value="edge_tts">Microsoft Edge TTS</option>
                    <option className={OPTION_DARK} value="omnivoice_local">OmniVoice Local</option>
                    <option className={OPTION_DARK} value="piper">Piper Local</option>
                    <option className={OPTION_DARK} value="hotai_tts">Hotai TTS</option>
                    <option className={OPTION_DARK} value="openai_tts">OpenAI TTS</option>
                    <option className={OPTION_DARK} value="capcut_tts">CapCut TTS</option>
                    <option className={OPTION_DARK} value="tiktok_tts">TikTok TTS</option>
                    <option className={OPTION_DARK} value="gemini_tts">Google Gemini TTS</option>
                    <option className={OPTION_DARK} value="vieneu_tts">VieNeu-TTS</option>
                    <option className={OPTION_DARK} value="elevenlabs">ElevenLabs</option>
                    <option className={OPTION_DARK} value="vbee">VBee Studio</option>
                    <option className={OPTION_DARK} value="google">Google Cloud</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  <Globe className="h-3.5 w-3.5 text-emerald-400" /> Ngôn ngữ
                </label>
                <div className="relative w-full">
                  <select
                    value={config.language}
                    onChange={(e) => {
                      const newLang = e.target.value;
                      const nextVoiceConfig = getDefaultVoiceConfig(
                        dynamicVoices,
                        config.platform,
                        newLang,
                      );
                      store.updateTTSConfig({
                        language: nextVoiceConfig.language,
                        voice: nextVoiceConfig.voice,
                      });
                    }}
                    className={SELECT_DARK}
                  >
                    {LANGUAGES.map((lang) => (
                      <option className={OPTION_DARK} key={lang.code} value={lang.code}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
                </div>
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="flex items-center justify-between gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <Volume2 className="h-3.5 w-3.5 text-amber-400" /> Giọng đọc
                    <span className="normal-case font-medium text-zinc-600 tracking-normal">
                      ({currentVoices.length})
                    </span>
                  </span>
                  {config.voice && (
                    <button
                      type="button"
                      onClick={() => void handlePreviewVoice()}
                      title={
                        isPreviewing
                          ? 'Bấm để hủy nghe thử'
                          : isTikTokWithoutSession
                            ? 'Thiếu SessionID TikTok, bản nghe thử có thể fallback Edge'
                            : 'Nghe thử giọng đang chọn'
                      }
                      className={`flex items-center gap-1.5 px-3 py-1 rounded transition-colors ${
                        isPreviewing
                          ? 'bg-rose-500/15 text-rose-400 hover:bg-rose-500/25'
                          : 'bg-sky-500/10 text-sky-400 hover:bg-sky-500/20'
                      }`}
                    >
                      {isPreviewing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      {isPreviewing ? 'Hủy' : 'Nghe thử'}
                    </button>
                  )}
                </label>
                <div className="relative w-full">
                  <select
                    value={activeVoiceId}
                    onChange={(e) => store.updateTTSConfig({ voice: e.target.value })}
                    className={SELECT_DARK}
                  >
                    {currentVoices.length === 0 && (
                      <option className={OPTION_DARK} value="">
                        Không có giọng
                      </option>
                    )}
                    {currentVoices.map((v: { id: string; name: string }) => (
                      <option className={OPTION_DARK} key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  Tốc độ
                </label>
                <div className="flex items-center gap-3 bg-black/60 border border-zinc-800 rounded-lg p-2">
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={config.speed}
                    onChange={(e) =>
                      store.updateTTSConfig({ speed: parseFloat(e.target.value) })
                    }
                    className="w-full accent-amber-500 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-sm font-bold text-zinc-300 w-10 text-right">
                    {Number(config.speed || 1).toFixed(1)}x
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  Pitch
                </label>
                <div className="flex items-center gap-3 bg-black/60 border border-zinc-800 rounded-lg p-2">
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="1"
                    value={config.pitch || 0}
                    onChange={(e) =>
                      store.updateTTSConfig({ pitch: parseInt(e.target.value, 10) })
                    }
                    className="w-full accent-indigo-500 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-sm font-bold text-zinc-300 w-12 text-right">
                    {(config.pitch || 0) > 0 ? `+${config.pitch}` : config.pitch || 0}
                  </span>
                </div>
              </div>

              {config.platform === 'tiktok_tts' && (
                <div className="space-y-2 md:col-span-2 pt-2 border-t border-zinc-800">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                    SessionID TikTok
                  </label>
                  <input
                    type="text"
                    placeholder="sessionid cookie (tuỳ chọn)"
                    value={config.tiktokSessionId}
                    onChange={(e) => store.updateTTSConfig({ tiktokSessionId: e.target.value })}
                    className="w-full rounded-lg border border-zinc-800 bg-black/60 px-3 py-2.5 text-sm font-mono text-zinc-200 outline-none focus:border-sky-500"
                  />
                </div>
              )}

              {config.platform === 'vieneu_tts' && (
                <div className="space-y-2 md:col-span-2 pt-2 border-t border-zinc-800">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                    VieNeu API URL
                  </label>
                  <input
                    type="text"
                    placeholder="http://localhost:3000/api/v1"
                    value={config.api_url_vieneu || ''}
                    onChange={(e) => store.updateTTSConfig({ api_url_vieneu: e.target.value })}
                    className="w-full rounded-lg border border-zinc-800 bg-black/60 px-3 py-2.5 text-sm font-mono text-zinc-200 outline-none focus:border-emerald-500"
                  />
                </div>
              )}

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 p-4 bg-zinc-900/50 flex justify-end">
          <button
            onClick={() => {
              if (activeVoiceId && activeVoiceId !== config.voice) {
                store.updateTTSConfig({ voice: activeVoiceId });
              }
              onClose();
            }}
            className="rounded-lg bg-amber-500 px-6 py-2 text-xs font-bold text-black hover:bg-amber-400 transition-colors"
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
