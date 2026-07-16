'use client';
import { API } from '@/contracts';

import React, { useState, useRef, useEffect } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  X,
  Volume2,
  RefreshCw,
} from 'lucide-react';
import { getVoiceList } from '@/lib/voiceCatalog';
import { filterCloneProfilesByFields } from '@/lib/vinaVoice/profileFilter';
import RoleCastStudioModal from './RoleCastStudioModal';
import { isCastActive, normalizeVoiceCast } from '@/lib/voiceCast';
import { toast } from '@/lib/toastBus';
import CreateVoiceTab from './tabs/CreateVoiceTab';
import CloneVoiceTab from './tabs/CloneVoiceTab';
import EngineVoiceTab from './tabs/EngineVoiceTab';
import { useCloneStack } from './hooks/useCloneStack';
import { useTikTokSessions } from './hooks/useTikTokSessions';
import { useVoiceCatalogPrep } from './hooks/useVoiceCatalogPrep';
import { getTTSCredentialsForConfig } from '../../modules/tts/credentials';

interface TTSConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TTSConfigModal({ isOpen, onClose }: TTSConfigModalProps) {
  const store = useNovelStore();
  const config = store.ttsConfig;
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
  const { dynamicVoices, prepMeta, runVoicePrep } = useVoiceCatalogPrep(isOpen);
  const currentVoices = getVoiceList(dynamicVoices, config.platform, config.language);
  const selectedVoice = currentVoices.find(v => v.id === config.voice) || null;
  const activeVoiceId = selectedVoice?.id || config.voice || '';
  const {
    cloneProfiles,
    engineHealth,
    refreshCloneStack,
    startCloneEngine,
    deleteCloneProfile,
    deleteAllUserClones,
    deletingCloneName,
  } = useCloneStack({
    isOpen,
    voiceUiTab,
    runVoicePrep,
    engineUrl: config.vinaEngineUrl,
  });

  useEffect(() => {
    if (!isOpen) return;
    // Đồng bộ tab UI khi mở modal (giữ create nếu user đang ở đó)
    const timer = window.setTimeout(() => {
      setVoiceUiTab((prev) => {
        if (prev === 'create') return 'create';
        return store.ttsConfig?.platform === 'vina_voice' ? 'clone' : 'engine';
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, store.ttsConfig?.platform]);

  const filteredCloneProfiles = filterCloneProfilesByFields(cloneProfiles, {
    gender: config.vinaGender || 'male',
    // Không lọc vùng miền (Bắc/Trung/Nam)
    group: config.vinaGroup || 'story',
    emotion: config.vinaEmotion || 'neutral',
  });
  const firstUsableCloneProfile = (
    profiles: typeof cloneProfiles,
  ) => profiles.find((p) => p.hasSample !== false) || null;

  const applyCloneProfile = (profileName: string) => {
    const p = cloneProfiles.find((x) => x.name === profileName);
    const gender: 'male' | 'female' = /nữ|nu |female|cô |chị /i.test(profileName)
      ? 'female'
      : 'male';
    // Never keep previous voice's samplePath — that made every preview identical.
    store.updateTTSConfig({
      platform: 'vina_voice',
      language: 'vi',
      voice: profileName,
      vinaUseClone: true,
      vinaGender: gender,
      vinaReferenceAudio: p?.samplePath || '',
      vinaReferenceText: p?.text || '',
      vinaSpeakerSeed: p?.speaker_seed ?? 2336,
      vinaStyleSeed: p?.style_seed ?? 4125,
      pitch: typeof p?.pitch_shift === 'number' ? p.pitch_shift : store.ttsConfig.pitch,
    });
  };

  const handleDeleteCloneProfile = async (name: string) => {
    const ok = await deleteCloneProfile(name);
    if (!ok) return;
    if (store.ttsConfig.voice === name) {
      const remaining = cloneProfiles.filter((p) => p.name !== name);
      const next = firstUsableCloneProfile(remaining);
      if (next) applyCloneProfile(next.name);
      else {
        store.updateTTSConfig({
          voice: '',
          vinaReferenceAudio: '',
          vinaReferenceText: '',
        });
      }
    }
  };

  const handleDeleteAllUserClones = async () => {
    const wasUser =
      /^USER/i.test(store.ttsConfig.voice || '') ||
      cloneProfiles.some(
        (p) => p.name === store.ttsConfig.voice && (p.isUser || /^USER/i.test(p.name)),
      );
    const ok = await deleteAllUserClones();
    if (!ok) return;
    if (wasUser) {
      const catalogFirst = cloneProfiles.find(
        (p) => !p.isUser && !/^USER/i.test(p.name) && p.hasSample !== false,
      );
      if (catalogFirst) applyCloneProfile(catalogFirst.name);
      else {
        store.updateTTSConfig({
          voice: '',
          vinaReferenceAudio: '',
          vinaReferenceText: '',
        });
      }
    }
  };

  /** Khi đổi bộ lọc mà giọng đang chọn không còn trong list → chọn giọng đầu list lọc */
  const onCloneFilterChange = (partial: Partial<typeof config>) => {
    const next = { ...config, ...partial, platform: 'vina_voice' as const };
    store.updateTTSConfig(partial);
    const filtered = filterCloneProfilesByFields(cloneProfiles, {
      gender: next.vinaGender || 'male',
      group: next.vinaGroup || 'story',
      emotion: next.vinaEmotion || 'neutral',
    });
    if (filtered.length && !filtered.some((p) => p.name === next.voice)) {
      const first = firstUsableCloneProfile(filtered);
      if (first) applyCloneProfile(first.name);
    }
  };

  const previewAbortRef = useRef<AbortController | null>(null);
  /** Vina/Omni chậm — timeout riêng; lần đầu load não ONNX ~1.5GB có thể 20–60s */
  const previewTimeoutMs = (platform: string) => {
    if (platform === 'vina_voice') return 75_000;
    // ensure engine (≤120s first load) + synth
    if (platform === 'omnivoice_local') return 180_000;
    if (platform === 'gemini_tts') return 35_000;
    return 25_000;
  };

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
    // Text ngắn cố định → cache HIT khi nghe thử lại (vector/sample đã có, không re-synth)
    const sceneText = 'Xin chào, đây là giọng đọc thử.';
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
      speakerSeed: ttsCfg.vinaSpeakerSeed,
      styleSeed: ttsCfg.vinaStyleSeed,
      vinaGender: ttsCfg.vinaGender,
      vinaArea: ttsCfg.vinaArea,
      vinaGroup: ttsCfg.vinaGroup,
      vinaEmotion: ttsCfg.vinaEmotion,
      vinaReferenceAudio: ttsCfg.vinaReferenceAudio,
      vinaReferenceAudioB64: ttsCfg.vinaReferenceAudioB64,
      vinaReferenceText: ttsCfg.vinaReferenceText,
    });

    // 1) Session / Cache API — có MP3 rồi thì phát ngay, không gọi API
    const localHit = await readBrowserPreviewCache(clientKey);
    if (localHit) {
      toast.info('Notice', `Phát lại bản nghe thử «${voiceLabel}» (đã lưu — không gen lại).`);
      return localHit;
    }

    // 2) Server durable/legacy cache → synth only on miss
    const response = await fetch(API.generateTts, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      throw new Error(data?.error || `Lỗi tạo bản nghe thử (HTTP ${response.status})`);
    }

    const url = String(data.audioPath || '');
    const fetchUrl = data.cached
      ? url
      : `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;

    try {
      const audioRes = await fetch(fetchUrl, { signal });
      if (audioRes.ok) {
        const blob = await audioRes.blob();
        const ct =
          audioRes.headers.get('Content-Type') ||
          (url.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg');
        const blobUrl = await writeBrowserPreviewCache(clientKey, blob, ct);
        if (data.cached) {
          toast.info(
            'Notice',
            `Đã có file nghe thử «${voiceLabel}» trên máy — phát ngay (không gen lại).`,
          );
        }
        return blobUrl;
      }
    } catch {
      /* fall through to raw URL */
    }

    if (data.cached) {
      toast.info('Notice', `Đã có bản nghe thử lưu sẵn cho «${voiceLabel}» — phát ngay.`);
    }
    return data.cached ? url : fetchUrl;
  };

  const getPreviewApiKeys = (platform: string) => {
    const creds = getTTSCredentialsForConfig(
      { ...config, platform: platform as typeof config.platform },
      store.apiKey || '',
      store.apiKeys || [],
    );
    return creds.apiKeys;
  };

  /** Chặn khi chưa chọn giọng — thiếu key/session/engine → hard-fail (không Edge ngầm). */
  const assertPreviewReady = (_platform: string, voiceId: string) => {
    if (!voiceId?.trim()) throw new Error('Chưa chọn giọng để nghe thử.');
  };

  // Hủy preview khi đổi platform/voice/tốc độ/pitch — tránh phát bản cũ hoặc kẹt UI
  useEffect(() => {
    const timer = window.setTimeout(cancelPreview, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.platform, config.voice, config.speed, config.pitch]);

  const handlePreviewVoice = async () => {
    // Đang chạy → bấm lại = hủy (không kẹt disabled vĩnh viễn)
    if (isPreviewing) {
      cancelPreview();
      return;
    }

    previewAbortRef.current?.abort();
    const ac = new AbortController();
    previewAbortRef.current = ac;
    const timeoutMs = previewTimeoutMs(config.platform);
    const timeoutId = window.setTimeout(() => ac.abort(), timeoutMs);

    setIsPreviewing(true);
    stopPreviewAudio();

    try {
      const selectedVoiceObj = selectedVoice;
      const voiceId = activeVoiceId || config.voice;
      assertPreviewReady(config.platform, voiceId);

      // OmniVoice: warm-start engine trước (không cần SuperAudioTools mở tay)
      if (config.platform === 'omnivoice_local') {
        try {
          await fetch(API.omnivoiceStatus, {
            method: 'POST',
            signal: ac.signal,
            cache: 'no-store',
          });
        } catch {
          /* synthesize path will ensure + surface error */
        }
      }

      // Luôn gen thật qua API (không phát file sample tĩnh — kể cả OmniVoice)
      const speedN = Number(config.speed);
      const pitchN = Number(config.pitch);
      const speed = Number.isFinite(speedN) && speedN > 0 ? speedN : 1;
      const pitch = Number.isFinite(pitchN) ? pitchN : 0;
      const previewAudioUrl = await fetchPreviewAudio(
        voiceId,
        selectedVoiceObj?.name || voiceId,
        { ...config, speed, pitch },
        getPreviewApiKeys(config.platform),
        ac.signal,
      );

      if (ac.signal.aborted) return;
      await playPreviewUrl(previewAudioUrl);
    } catch (error) {
      if (ac.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        console.info('[TTS Preview] đã hủy / timeout');
        if (!ac.signal.aborted) {
          // timeout path — ac aborted by timer
        }
        // Nếu abort do timeout → thông báo rõ
        const timedOut =
          (error instanceof DOMException && error.name === 'AbortError') ||
          (error instanceof Error && /abort/i.test(error.message));
        if (timedOut && previewAbortRef.current === null) {
          // cancelled by user via cancelPreview
        } else if (timedOut) {
          toast.info(
            'Notice',
            `Nghe thử quá ${Math.round(timeoutMs / 1000)}s (timeout).\n` +
              (config.platform === 'omnivoice_local'
                ? 'OmniVoice đang load model hoặc engine offline — bấm «Bật engine» / đợi ~1 phút rồi thử lại.'
                : 'Engine chậm hoặc offline — kiểm tra API/engine đã chọn.'),
          );
        }
        return;
      }
      console.error('[TTS Preview]', error);
      // Platform/engine are explicit — surface error only (API key rotation stays server-side).
      const msg = error instanceof Error ? error.message : String(error);
      if (!ac.signal.aborted) {
        toast.info('Notice', 'Không thể nghe thử: ' + msg);
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (previewAbortRef.current === ac) previewAbortRef.current = null;
      // Luôn nhả UI — chống đơ "không click được"
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
      toast.info('Notice', 'Nhập nội dung cần đọc bằng giọng clone.');
      return;
    }
    if (!cloneSampleFile) {
      toast.info('Notice', 
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
          await startCloneEngine();
        } catch {
          /* synth path will surface the selected engine/profile error */
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

      const response = await fetch(API.vinaVoiceClone, {
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
      toast.info('Notice', 
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
      const timer = window.setTimeout(cancelPreview, 0);
      return () => window.clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 font-sans animate-in fade-in duration-200"
      onMouseDown={(e) => {
        // Click backdrop → đóng (không dùng blur nặng gây đơ GPU)
        if (e.target === e.currentTarget) {
          cancelPreview();
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col max-h-[90vh] relative z-[61] pointer-events-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 p-4 bg-zinc-900/50 shrink-0">
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2 text-zinc-100">
              <Volume2 className="h-5 w-5 text-amber-500 shrink-0" />
              <h2 className="text-sm font-bold uppercase tracking-wider">Cấu Hình Giọng Đọc Toàn Cục</h2>
              {isPreviewing ? (
                <span className="text-[9px] font-bold uppercase text-amber-400 animate-pulse">
                  Đang nghe thử… (bấm Hủy)
                </span>
              ) : null}
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
            type="button"
            onClick={() => {
              cancelPreview();
              onClose();
            }}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors shrink-0"
            title="Đóng (thoát nghe thử nếu đang chạy)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Hàng tab: Não Zero-Shot (chính) | Engine chọn tay | Tạo giọng clone */}
          <div className="flex rounded-lg border border-zinc-800 overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setVoiceUiTab('clone');
                store.updateTTSConfig({ platform: 'vina_voice', vinaUseClone: true });
                const first = firstUsableCloneProfile(cloneProfiles);
                if (first && !cloneProfiles.some((p) => p.name === config.voice)) {
                  applyCloneProfile(first.name);
                }
              }}
              className={`flex-1 px-2 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                voiceUiTab === 'clone'
                  ? 'bg-amber-500 text-black'
                  : 'bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
              }`}
              title="Engine chính: catalog + zero-shot ONNX brain — lỗi thì báo lỗi, không Edge ngầm"
            >
              Não Zero-Shot
            </button>
            <button
              type="button"
              onClick={() => {
                setVoiceUiTab('engine');
                store.updateTTSConfig({
                  voice: '',
                  vinaUseClone: false,
                });
              }}
              className={`flex-1 px-2 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors border-l border-zinc-800 ${
                voiceUiTab === 'engine'
                  ? 'bg-sky-500 text-black'
                  : 'bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
              }`}
              title="Chọn tay Edge / Gemini / Piper… — không phải giọng dự phòng tự động"
            >
              Engine chọn tay
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

          {voiceUiTab === 'create' ? (
            <CreateVoiceTab
              config={config}
              updateTTSConfig={store.updateTTSConfig}
              nhan_vat={store.nhan_vat || []}
              cloneFileInputRef={cloneFileInputRef}
              cloneSampleLabel={cloneSampleLabel}
              setCloneSampleLabel={setCloneSampleLabel}
              setCloneSampleFile={setCloneSampleFile}
              cloneRefText={cloneRefText}
              setCloneRefText={setCloneRefText}
              cloneAssignTarget={cloneAssignTarget}
              setCloneAssignTarget={setCloneAssignTarget}
              testText={testText}
              setTestText={setTestText}
              isTestGenerating={isTestGenerating}
              testAudioUrl={testAudioUrl}
              lastCloneResult={lastCloneResult}
              handleTestGeneration={handleTestGeneration}
              setCastStudioOpen={setCastStudioOpen}
              setVoiceUiTab={setVoiceUiTab}
              ensureVoiceCastSeeded={() => store.ensureVoiceCastSeeded()}
            />
          ) : voiceUiTab === 'clone' ? (
            <CloneVoiceTab
              config={config}
              updateTTSConfig={store.updateTTSConfig}
              filteredCloneProfiles={filteredCloneProfiles}
              cloneProfiles={cloneProfiles}
              onCloneFilterChange={onCloneFilterChange}
              applyCloneProfile={applyCloneProfile}
              isPreviewing={isPreviewing}
              handlePreviewVoice={handlePreviewVoice}
              onDeleteCloneProfile={handleDeleteCloneProfile}
              onDeleteAllUserClones={handleDeleteAllUserClones}
              deletingCloneName={deletingCloneName}
            />
          ) : (
            <EngineVoiceTab
              config={config}
              updateTTSConfig={store.updateTTSConfig}
              dynamicVoices={dynamicVoices}
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
            />
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
