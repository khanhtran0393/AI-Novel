'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { X, Volume2, Globe, Settings, Cpu, Play, Loader2, ChevronDown } from 'lucide-react';

interface TTSConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type VoiceOption = { id: string; name: string; previewUrl?: string };
type VoiceCatalog = Record<string, Record<string, VoiceOption[]>>;

const OPENAI_VOICE_OPTIONS: VoiceOption[] = [
  { id: 'alloy', name: 'Alloy' },
  { id: 'ash', name: 'Ash' },
  { id: 'ballad', name: 'Ballad' },
  { id: 'coral', name: 'Coral' },
  { id: 'echo', name: 'Echo' },
  { id: 'fable', name: 'Fable' },
  { id: 'nova', name: 'Nova' },
  { id: 'onyx', name: 'Onyx' },
  { id: 'sage', name: 'Sage' },
  { id: 'shimmer', name: 'Shimmer' },
  { id: 'verse', name: 'Verse' },
  { id: 'marin', name: 'Marin' },
  { id: 'cedar', name: 'Cedar' },
];

const GEMINI_VOICE_OPTIONS: VoiceOption[] = [
  { id: 'Kore', name: 'Kore (Firm)' },
  { id: 'Puck', name: 'Puck (Upbeat)' },
  { id: 'Zephyr', name: 'Zephyr (Bright)' },
  { id: 'Aoede', name: 'Aoede (Breezy)' },
  { id: 'Charon', name: 'Charon (Informative)' },
  { id: 'Fenrir', name: 'Fenrir (Excitable)' },
  { id: 'Leda', name: 'Leda (Youthful)' },
  { id: 'Orus', name: 'Orus (Firm)' },
];

const VOICES: VoiceCatalog = {
  omnivoice_local: {
    vi: [],
    en: [],
    ja: [],
    ko: [],
    th: [],
    zh: [],
    fr: [],
    de: [],
    es: [],
    pt: [],
    id: []
  },
  hotai_tts: {
    vi: [
      { id: 'chau_tinh_tri', name: 'Châu Tinh Trì' },
      { id: 'nguyen_ngoc_ngan', name: 'Nguyễn Ngọc Ngạn' },
      { id: 'tao_thao', name: 'Tào Tháo' },
      { id: 'nui_yen_tu', name: 'Núi Yên Tử' },
      { id: 'doraemon', name: 'Doraemon' },
      { id: 'tvb', name: 'TVB Lồng Tiếng' }
    ]
  },
  openai_tts: {
    vi: OPENAI_VOICE_OPTIONS,
    en: OPENAI_VOICE_OPTIONS,
    fr: OPENAI_VOICE_OPTIONS,
    de: OPENAI_VOICE_OPTIONS,
    es: OPENAI_VOICE_OPTIONS,
    pt: OPENAI_VOICE_OPTIONS,
    id: OPENAI_VOICE_OPTIONS,
    ja: OPENAI_VOICE_OPTIONS,
    zh: OPENAI_VOICE_OPTIONS,
    ko: OPENAI_VOICE_OPTIONS
  },
  tiktok_tts: {
    vi: [
      { id: 'BV074_streaming', name: 'Cô Gái Hoạt Ngôn' },
      { id: 'BV075_streaming', name: 'Thanh Niên Tự Tin' },
      { id: 'BV421_vivn_streaming', name: 'Nhỏ Ngọt Ngào' },
      { id: 'vi_female_huong', name: 'Giọng Phổ Thông' },
      { id: 'BV074_streaming_dsp', name: 'Giọng Bé' },
      { id: 'BV075_streaming_vibrato_dsp', name: 'Việt Mèo' },
      { id: 'BV562_streaming', name: 'Mai' }
    ],
    en: [
      { id: 'en_us_001', name: 'Nữ 1 (US)' },
      { id: 'en_us_002', name: 'Nữ 2 (US)' },
      { id: 'en_us_006', name: 'Nam 1 (US)' },
      { id: 'en_us_007', name: 'Nam 2 (US)' },
      { id: 'en_us_009', name: 'Nam 3 (US)' },
      { id: 'en_us_010', name: 'Nam 4 (US)' },
      { id: 'en_uk_001', name: 'Nam 1 (UK)' },
      { id: 'en_uk_003', name: 'Nam 2 (UK)' },
      { id: 'en_au_001', name: 'Nữ 1 (AU)' },
      { id: 'en_au_002', name: 'Nam 1 (AU)' },
      { id: 'en_us_ghostface', name: '👻 Ghostface (Scream)' },
      { id: 'en_us_chewbacca', name: '🦁 Chewbacca' },
      { id: 'en_us_c3po', name: '🤖 C-3PO' },
      { id: 'en_us_stitch', name: '👽 Stitch' },
      { id: 'en_us_stormtrooper', name: '🔫 Stormtrooper' },
      { id: 'en_us_rocket', name: '🦝 Rocket' }
    ],
    fr: [
      { id: 'fr_001', name: 'Nam 1 (Pháp)' },
      { id: 'fr_002', name: 'Nam 2 (Pháp)' }
    ],
    de: [
      { id: 'de_001', name: 'Nữ (Đức)' },
      { id: 'de_002', name: 'Nam (Đức)' }
    ],
    es: [
      { id: 'es_002', name: 'Nam (TBN)' },
      { id: 'es_mx_002', name: 'Nam (Mexico)' }
    ],
    pt: [
      { id: 'br_001', name: 'Nữ 1 (BR)' },
      { id: 'br_003', name: 'Nữ 2 (BR)' },
      { id: 'br_004', name: 'Nữ 3 (BR)' },
      { id: 'br_005', name: 'Nam (BR)' }
    ],
    id: [
      { id: 'id_001', name: 'Nữ (Indonesia)' }
    ],
    ja: [
      { id: 'jp_001', name: 'Nữ 1 (Nhật)' },
      { id: 'jp_003', name: 'Nữ 2 (Nhật)' },
      { id: 'jp_005', name: 'Nữ 3 (Nhật)' },
      { id: 'jp_006', name: 'Nam (Nhật)' }
    ],
    ko: [
      { id: 'kr_002', name: 'Nam 1 (Hàn)' },
      { id: 'kr_003', name: 'Nữ (Hàn)' },
      { id: 'kr_004', name: 'Nam 2 (Hàn)' }
    ]
  },
  capcut_tts: {
    vi: [
      { id: 'BV074_streaming', name: 'Cô Gái Hoạt Ngôn' },
      { id: 'BV075_streaming', name: 'Thanh Niên Tự Tin' },
      { id: 'BV421_vivn_streaming', name: 'Nhỏ Ngọt Ngào' },
      { id: 'vi_female_huong', name: 'Giọng Phổ Thông' },
      { id: 'BV074_streaming_dsp', name: 'Giọng Bé' },
      { id: 'BV075_streaming_vibrato_dsp', name: 'Việt Mèo' },
      { id: 'BV562_streaming', name: 'Mai' }
    ],
    en: [
      { id: 'en_us_001', name: 'Nữ 1 (US)' },
      { id: 'en_us_002', name: 'Nữ 2 (US)' },
      { id: 'en_us_006', name: 'Nam 1 (US)' }
    ]
  },
  gemini_tts: {
    vi: GEMINI_VOICE_OPTIONS,
    en: GEMINI_VOICE_OPTIONS,
    fr: GEMINI_VOICE_OPTIONS,
    de: GEMINI_VOICE_OPTIONS,
    es: GEMINI_VOICE_OPTIONS,
    pt: GEMINI_VOICE_OPTIONS,
    id: GEMINI_VOICE_OPTIONS,
    ja: GEMINI_VOICE_OPTIONS,
    zh: GEMINI_VOICE_OPTIONS,
    ko: GEMINI_VOICE_OPTIONS
  },
  piper: {
    vi: [
      { id: 'ngochuyen.onnx', name: 'Ngọc Huyền (Nữ)' },
      { id: 'manhdung.onnx', name: 'Mạnh Dũng (Nam)' }
    ]
  },
  edge_tts: {
    vi: [
      { id: 'vi-VN-HoaiMyNeural', name: 'Hoài My (Nữ)' },
      { id: 'vi-VN-NamMinhNeural', name: 'Nam Minh (Nam)' }
    ],
    en: [
      { id: 'en-US-AndrewMultilingualNeural', name: 'Andrew (Nam)' },
      { id: 'en-US-JennyNeural', name: 'Jenny (Nữ)' },
      { id: 'en-US-GuyNeural', name: 'Guy (Nam)' },
      { id: 'en-US-AriaNeural', name: 'Aria (Nữ)' },
      { id: 'en-US-DavisNeural', name: 'Davis (Nam)' },
      { id: 'en-US-JaneNeural', name: 'Jane (Nữ)' },
      { id: 'en-US-JasonNeural', name: 'Jason (Nam)' },
      { id: 'en-US-SaraNeural', name: 'Sara (Nữ)' },
      { id: 'en-US-TonyNeural', name: 'Tony (Nam)' },
      { id: 'en-GB-SoniaNeural', name: 'Sonia (Nữ UK)' },
      { id: 'en-GB-RyanNeural', name: 'Ryan (Nam UK)' },
      { id: 'en-AU-NatashaNeural', name: 'Natasha (Nữ AU)' },
      { id: 'en-AU-WilliamNeural', name: 'William (Nam AU)' },
      { id: 'en-CA-ClaraNeural', name: 'Clara (Nữ CA)' },
      { id: 'en-CA-LiamNeural', name: 'Liam (Nam CA)' }
    ],
    fr: [
      { id: 'fr-FR-DeniseNeural', name: 'Denise (Nu)' },
      { id: 'fr-FR-HenriNeural', name: 'Henri (Nam)' }
    ],
    de: [
      { id: 'de-DE-KatjaNeural', name: 'Katja (Nu)' },
      { id: 'de-DE-ConradNeural', name: 'Conrad (Nam)' }
    ],
    es: [
      { id: 'es-ES-ElviraNeural', name: 'Elvira (Nu)' },
      { id: 'es-ES-AlvaroNeural', name: 'Alvaro (Nam)' }
    ],
    pt: [
      { id: 'pt-BR-FranciscaNeural', name: 'Francisca (Nu)' },
      { id: 'pt-BR-AntonioNeural', name: 'Antonio (Nam)' }
    ],
    id: [
      { id: 'id-ID-GadisNeural', name: 'Gadis (Nu)' },
      { id: 'id-ID-ArdiNeural', name: 'Ardi (Nam)' }
    ],
    zh: [
      { id: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao (Nữ)' },
      { id: 'zh-CN-YunxiNeural', name: 'Yunxi (Nam)' },
      { id: 'zh-CN-YunjianNeural', name: 'Yunjian (Nam)' },
      { id: 'zh-CN-XiaoyiNeural', name: 'Xiaoyi (Nữ)' },
      { id: 'zh-CN-YunxiaNeural', name: 'Yunxia (Nam)' },
      { id: 'zh-CN-YunyangNeural', name: 'Yunyang (Nam)' },
      { id: 'zh-TW-HsiaoChenNeural', name: 'HsiaoChen (Nữ Đài)' },
      { id: 'zh-TW-YunJheNeural', name: 'YunJhe (Nam Đài)' }
    ],
    ja: [
      { id: 'ja-JP-NanamiNeural', name: 'Nanami (Nữ)' },
      { id: 'ja-JP-KeitaNeural', name: 'Keita (Nam)' },
      { id: 'ja-JP-AyumiNeural', name: 'Ayumi (Nữ)' }
    ],
    ko: [
      { id: 'ko-KR-SunHiNeural', name: 'SunHi (Nữ)' },
      { id: 'ko-KR-InJoonNeural', name: 'InJoon (Nam)' }
    ]
  },
  vieneu_tts: {
    vi: [
      { id: 'Adam 1', name: 'Adam 1' },
      { id: 'Adam 2', name: 'Adam 2' },
      { id: 'Adam 3', name: 'Adam 3' },
      { id: 'Adam 4', name: 'Adam Trí Dũng' },
      { id: 'Ngọc Huyền', name: 'Ngọc Huyền (Truyện Audio)' },
      { id: 'Đức Trung', name: 'Đức Trung' },
      { id: 'Quang Anh', name: 'Quang Anh' },
      { id: 'Trung Quân', name: 'Trung Quân' },
      { id: 'Trường An', name: 'Trường An (Phật Pháp)' },
      { id: 'Chi Chi', name: 'Chi Chi' },
      { id: 'Vy Tin Tức', name: 'Vy Tin Tức' },
      { id: 'My Review', name: 'My Review' },
      { id: 'Dung Lồng Tiếng', name: 'Dung Lồng Tiếng' },
      { id: 'Hùng Dung', name: 'Hùng Dung' },
      { id: 'Thanh Vân', name: 'Thanh Vân' },
      { id: 'Phương Thảo', name: 'Phương Thảo' },
      { id: 'Thanh Mai', name: 'Thanh Mai' },
      { id: 'Tùng Sơn', name: 'Tùng Sơn' },
      { id: 'Minh Khôi', name: 'Minh Khôi' }
    ],
    en: [
      { id: 'Bình An', name: 'Bình An (Bilingual)' }
    ]
  },
  vbee: {
    vi: [
      { id: 'hn_ngo_ngochuyen_24g_v2', name: '👑 Ngọc Huyền (Cao cấp)' },
      { id: 'hn_male_manhdung_news_48k-v2', name: '👑 Mạnh Dũng (Thời sự)' },
      { id: 'VBEE_MaiPhuong', name: '👑 Mai Phương (Chuẩn VTV)' },
      { id: 'VBEE_ThaoTrinh', name: '👑 Thảo Trinh (Sôi động)' },
      { id: 'VBEE_MinhHoang', name: '👑 Minh Hoàng (Trầm ấm)' }
    ],
    en: [
      { id: 'en_female_1', name: '👑 English Female 1' }
    ]
  },
  google: {
    vi: [
      { id: 'vi-VN-Standard-A', name: 'Google Nữ Chuẩn (A)' },
      { id: 'vi-VN-Standard-B', name: 'Google Nam Chuẩn (B)' },
      { id: 'vi-VN-Standard-C', name: 'Google Nữ Chuẩn (C)' },
      { id: 'vi-VN-Standard-D', name: 'Google Nam Chuẩn (D)' },
      { id: 'vi-VN-Neural2-A', name: 'Google Nữ Neural2 (A)' },
      { id: 'vi-VN-Neural2-D', name: 'Google Nam Neural2 (D)' }
    ],
    en: [
      { id: 'en-US-Journey-F', name: 'Journey Nữ (US)' },
      { id: 'en-US-Journey-D', name: 'Journey Nam (US)' }
    ],
    fr: [
      { id: 'fr-FR-Translate', name: 'Google Translate French' }
    ],
    de: [
      { id: 'de-DE-Translate', name: 'Google Translate German' }
    ],
    es: [
      { id: 'es-ES-Translate', name: 'Google Translate Spanish' }
    ],
    pt: [
      { id: 'pt-BR-Translate', name: 'Google Translate Portuguese' }
    ],
    id: [
      { id: 'id-ID-Translate', name: 'Google Translate Indonesian' }
    ],
    ja: [
      { id: 'ja-JP-Translate', name: 'Google Translate Japanese' }
    ],
    zh: [
      { id: 'zh-CN-Translate', name: 'Google Translate Chinese' }
    ],
    ko: [
      { id: 'ko-KR-Translate', name: 'Google Translate Korean' }
    ]
  },
  elevenlabs: {
    vi: [],
    en: [
      { id: 'EXAVITQu4vr4xnSDxMaL', name: '👑 Bella' },
      { id: 'ErXwobaYiN019PkySvjV', name: '👑 Antoni' }
    ]
  }
};

const LANGUAGES = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'Tiếng Anh (English)' },
  { code: 'fr', label: 'Tiếng Pháp (French)' },
  { code: 'de', label: 'Tiếng Đức (German)' },
  { code: 'es', label: 'Tiếng Tây Ban Nha (Spanish)' },
  { code: 'pt', label: 'Tiếng Bồ Đào Nha (Portuguese)' },
  { code: 'id', label: 'Tiếng Indonesia (Indonesian)' },
  { code: 'ja', label: 'Tiếng Nhật (Japanese)' },
  { code: 'zh', label: 'Tiếng Trung (Chinese)' },
  { code: 'ko', label: 'Tiếng Hàn (Korean)' }
];

function getVoiceList(catalog: VoiceCatalog, platform: string, language: string) {
  return catalog[platform]?.[language] || [];
}

function getDefaultVoiceConfig(catalog: VoiceCatalog, platform: string, preferredLanguage: string) {
  const platformVoices = catalog[platform] || {};
  let language = preferredLanguage;
  let voices = platformVoices[language] || [];

  if (voices.length === 0) {
    const fallbackLanguage = Object.keys(platformVoices).find(code => platformVoices[code]?.length > 0);
    if (fallbackLanguage) {
      language = fallbackLanguage;
      voices = platformVoices[fallbackLanguage] || [];
    }
  }

  return {
    language,
    voice: voices[0]?.id || '',
  };
}

export default function TTSConfigModal({ isOpen, onClose }: TTSConfigModalProps) {
  const store = useNovelStore();
  const config = store.ttsConfig;
  const [isPreviewing, setIsPreviewing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [dynamicVoices, setDynamicVoices] = useState<VoiceCatalog>(VOICES);
  const currentVoices = getVoiceList(dynamicVoices, config.platform, config.language);
  const selectedVoice = currentVoices.find(v => v.id === config.voice) || currentVoices[0] || null;
  const activeVoiceId = selectedVoice?.id || config.voice || '';
  const isTikTokWithoutSession = config.platform === 'tiktok_tts' && !config.tiktokSessionId?.trim();

  
  // Load dynamic Piper models
  useEffect(() => {
    fetch('/api/piper-models')
      .then(r => r.json())
      .then(data => {
        if (data.models && Array.isArray(data.models)) {
          setDynamicVoices(prev => ({
            ...prev,
            piper: {
              ...prev.piper,
              vi: data.models // We overwrite the hardcoded ones with the dynamically found ones
            }
          }));
        }
      })
      .catch(err => console.error("Failed to load Piper models", err));
  }, []);

  // Load OmniVoice Library
  useEffect(() => {
    fetch('/omnivoice-library.json')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          const loadedVoices: Record<string, {id: string, name: string, previewUrl?: string}[]> = {
            vi: [], en: [], ja: [], ko: [], th: [], zh: [], fr: [], de: [], es: [], pt: [], id: []
          };
          
          data.forEach(voice => {
            let langCode = 'vi';
            if (voice.language?.toLowerCase() === 'english') langCode = 'en';
            else if (voice.language?.toLowerCase() === 'japanese') langCode = 'ja';
            else if (voice.language?.toLowerCase() === 'korean') langCode = 'ko';
            else if (voice.language?.toLowerCase() === 'thai') langCode = 'th';
            else if (voice.language?.toLowerCase() === 'chinese') langCode = 'zh';
            
            if (loadedVoices[langCode]) {
              loadedVoices[langCode].push({
                id: voice.id,
                name: `${voice.name} - ${voice.gender === 'male' ? 'Nam' : 'Nữ'} (${voice.location || voice.style || ''})`,
                previewUrl: voice.previewUrl
              });
            }
          });
          
          setDynamicVoices(prev => ({
            ...prev,
            omnivoice_local: loadedVoices
          }));
        }
      })
      .catch(err => console.error('Failed to load omnivoice library:', err));
  }, []);

  useEffect(() => {
    if (!isOpen) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsPreviewing(false);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen || currentVoices.length === 0) return;
    if (!currentVoices.some(v => v.id === config.voice)) {
      store.updateTTSConfig({ voice: currentVoices[0].id });
    }
  }, [isOpen, config.platform, config.language, config.voice, currentVoices, store]);

  if (!isOpen) return null;
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  const handleUpdateConfig = (key: string, value: any) => {
    store.updateTTSConfig({ [key]: value });
  };

  const handlePreviewVoice = async () => {
    try {
      setIsPreviewing(true);
      
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      const selectedVoiceObj = selectedVoice;
      const currentVoiceName = selectedVoiceObj ? selectedVoiceObj.name : config.voice;
      const cleanVoiceName = currentVoiceName.split('(')[0].trim();
      const effectiveConfig = {
        ...config,
        voice: activeVoiceId,
      };
      const previewApiKeys = effectiveConfig.platform === 'openai_tts'
        ? (store.openaiApiKeys?.length ? store.openaiApiKeys : (store.openaiApiKey ? [store.openaiApiKey] : []))
        : (store.apiKeys?.length ? store.apiKeys : (store.apiKey ? [store.apiKey] : []));

      let previewAudioUrl = '';
      if (effectiveConfig.platform === 'omnivoice_local' && selectedVoiceObj?.previewUrl) {
        // Use pre-rendered preview audio for OmniVoice local
        previewAudioUrl = selectedVoiceObj.previewUrl;
      } else {
        const response = await fetch('/api/generate-tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sceneText: `${cleanVoiceName}, chào mừng bạn đến với thế giới AI Novel`,
            chapterNum: 0,
            sceneIndex: 0,
            isPreview: true,
            voiceName: activeVoiceId,
            ttsConfig: effectiveConfig,
            apiKeys: previewApiKeys,
            ten_tac_pham: store.ten_tac_pham || 'AI Novel',
          })
        });

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || 'Lỗi tạo bản nghe thử');
        }
        previewAudioUrl = `${data.audioPath}?t=${Date.now()}`;
      }

      const audio = new Audio(previewAudioUrl);
      audioRef.current = audio;
      audio.play();

    } catch (error) {
      console.error(error);
      alert('Không thể nghe thử giọng: ' + (error as Error).message);
    } finally {
      setIsPreviewing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-sans animate-in fade-in duration-200">
      <div className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 p-4 bg-zinc-900/50">
          <div className="flex items-center gap-2 text-zinc-100">
            <Volume2 className="h-5 w-5 text-amber-500" />
            <h2 className="text-sm font-bold uppercase tracking-wider">Cấu Hình Giọng Đọc Toàn Cục</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Platform */}
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                <Cpu className="h-3.5 w-3.5 text-sky-400" /> Nền Tảng
              </label>
              <div className="relative w-full">
                <select
                  value={config.platform}
                  onChange={(e) => {
                    const newPlatform = e.target.value as typeof config.platform;
                    const nextVoiceConfig = getDefaultVoiceConfig(dynamicVoices, newPlatform, config.language);
                    store.updateTTSConfig({ 
                      platform: newPlatform,
                      language: nextVoiceConfig.language,
                      voice: nextVoiceConfig.voice
                    });
                  }}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-black/60 px-3 py-2.5 pr-10 text-sm text-zinc-200 outline-none focus:border-amber-500 transition-colors cursor-pointer"
                >
                  <option value="omnivoice_local">OmniVoice (Voice Cloning Offline)</option>
                  <option value="hotai_tts">Hotai TTS (Châu Tinh Trì, TVB)</option>
                  <option value="openai_tts">OpenAI TTS (GPT-4o-mini)</option>
                  <option value="piper">Piper (Local AI - Gợi ý)</option>
                  <option value="capcut_tts">CapCut App TTS</option>
                  <option value="edge_tts">Microsoft Edge TTS (Free)</option>
                  <option value="tiktok_tts">TikTok TTS (cần SessionID)</option>
                  <option value="elevenlabs">ElevenLabs (Pro)</option>
                  <option value="vbee">VBee Studio (Pro)</option>
                  <option value="gemini_tts">Google Gemini TTS</option>

                  <option value="vieneu_tts">VieNeu-TTS (Local AI)</option>                  <option value="google">Google Cloud (Fallback)</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
              </div>
            </div>

            {/* Language */}
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                <Globe className="h-3.5 w-3.5 text-emerald-400" /> Ngôn Ngữ
              </label>
              <div className="relative w-full">
                <select
                  value={config.language}
                  onChange={(e) => {
                    const newLang = e.target.value;
                    const nextVoiceConfig = getDefaultVoiceConfig(dynamicVoices, config.platform, newLang);
                    store.updateTTSConfig({ 
                      language: nextVoiceConfig.language,
                      voice: nextVoiceConfig.voice
                    });
                  }}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-black/60 px-3 py-2.5 pr-10 text-sm text-zinc-200 outline-none focus:border-amber-500 transition-colors cursor-pointer"
                >
                  {LANGUAGES.map(lang => (
                    <option key={lang.code} value={lang.code}>{lang.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
              </div>
            </div>

            {/* Voice */}
            <div className="space-y-2 md:col-span-2">
              <label className="flex items-center justify-between gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                <div className="flex items-center gap-1.5">
                  <Volume2 className="h-3.5 w-3.5 text-amber-400" /> Giọng Đọc
                </div>
                {config.voice && (
                  <button
                    onClick={handlePreviewVoice}
                    disabled={isPreviewing}
                    title={isTikTokWithoutSession ? 'Thiếu SessionID TikTok, bản nghe thử sẽ tự dùng Edge TTS tương ứng.' : 'Nghe thử giọng đọc đang chọn'}
                    className="flex items-center gap-1.5 px-3 py-1 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                  >
                    {isPreviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                    Nghe Thử
                  </button>
                )}
              </label>
              <div className="relative w-full">
                <select
                  value={activeVoiceId}
                  onChange={(e) => store.updateTTSConfig({ voice: e.target.value })}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-black/60 px-3 py-2.5 pr-10 text-sm text-zinc-200 outline-none focus:border-amber-500 transition-colors cursor-pointer"
                >
                  {currentVoices.length === 0 && <option value="">Không có giọng nào hỗ trợ</option>}
                  {currentVoices.map((v: { id: string, name: string }) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
              </div>
            </div>

            {/* Speed */}
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                <Settings className="h-3.5 w-3.5 text-rose-400" /> Tốc Độ Đọc
              </label>
              <div className="flex items-center gap-3 bg-black/60 border border-zinc-800 rounded-lg p-2">
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={config.speed}
                  onChange={(e) => store.updateTTSConfig({ speed: parseFloat(e.target.value) })}
                  className="w-full accent-amber-500 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-sm font-bold text-zinc-300 w-10 text-right">{config.speed.toFixed(1)}x</span>
              </div>
            </div>

            {/* Pitch */}
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                <Settings className="h-3.5 w-3.5 text-indigo-400" /> Cao độ / Độ trầm (Pitch)
                {['piper', 'edge_tts', 'tiktok_tts', 'gemini_tts', 'capcut_tts', 'omnivoice_local', 'hotai_tts', 'openai_tts'].includes(store.ttsConfig.platform) ? (
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded ml-2">Miễn phí</span>
                  ) : (
                    <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded ml-2">Trả phí</span>
                  )}
              </label>
              <div className="flex items-center gap-3 bg-black/60 border border-zinc-800 rounded-lg p-2">
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="1"
                  value={config.pitch || 0}
                  onChange={(e) => store.updateTTSConfig({ pitch: parseInt(e.target.value) })}
                  className="w-full accent-indigo-500 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-sm font-bold text-zinc-300 w-12 text-right">
                  {config.pitch > 0 ? `+${config.pitch}` : config.pitch}
                </span>
              </div>
            </div>

            {/* Chế độ đồng bộ Timestamp (Sync Mode) */}
            <div className="space-y-2 md:col-span-2 pt-2">
              <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                <Cpu className="h-3.5 w-3.5 text-blue-400" /> Chế độ Đồng Bộ (Sync Mode)
              </label>
              <div className="flex flex-wrap items-center gap-4 bg-black/60 border border-zinc-800 rounded-lg p-3">
                
                {/* Mặc định */}
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${config.syncMode === 'default' || !config.syncMode ? 'border-orange-500 bg-orange-500/20' : 'border-zinc-600 bg-transparent group-hover:border-orange-500/50'}`}>
                    {(config.syncMode === 'default' || !config.syncMode) && <div className="w-2 h-2 rounded-full bg-orange-500" />}
                  </div>
                  <input
                    type="radio"
                    name="syncMode"
                    value="default"
                    checked={config.syncMode === 'default' || !config.syncMode}
                    onChange={() => store.updateTTSConfig({ syncMode: 'default' })}
                    className="hidden"
                  />
                  <span className={`text-sm font-bold transition-colors ${config.syncMode === 'default' || !config.syncMode ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'}`}>
                    Mặc định
                  </span>
                </label>

                {/* Ép Khớp Timestamp */}
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${config.syncMode === 'force_sync' ? 'border-yellow-500 bg-yellow-500/20' : 'border-zinc-600 bg-transparent group-hover:border-yellow-500/50'}`}>
                    {config.syncMode === 'force_sync' && <div className="w-2 h-2 rounded-full bg-yellow-500" />}
                  </div>
                  <input
                    type="radio"
                    name="syncMode"
                    value="force_sync"
                    checked={config.syncMode === 'force_sync'}
                    onChange={() => store.updateTTSConfig({ syncMode: 'force_sync' })}
                    className="hidden"
                  />
                  <span className={`text-sm font-bold transition-colors ${config.syncMode === 'force_sync' ? 'text-yellow-500' : 'text-zinc-400 group-hover:text-yellow-500/80'}`}>
                    Ép Khớp Timestamp
                  </span>
                </label>

                {/* Mode Pro */}
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${config.syncMode === 'pro' ? 'border-cyan-400 bg-cyan-400/20' : 'border-zinc-600 bg-transparent group-hover:border-cyan-400/50'}`}>
                    {config.syncMode === 'pro' && <div className="w-2 h-2 rounded-full bg-cyan-400" />}
                  </div>
                  <input
                    type="radio"
                    name="syncMode"
                    value="pro"
                    checked={config.syncMode === 'pro'}
                    onChange={() => store.updateTTSConfig({ syncMode: 'pro' })}
                    className="hidden"
                  />
                  <span className={`text-sm font-bold transition-colors ${config.syncMode === 'pro' ? 'text-cyan-400' : 'text-zinc-400 group-hover:text-cyan-400/80'}`}>
                    Mode Pro
                  </span>
                </label>

              </div>
              <p className="text-[10px] text-zinc-500 italic mt-1 leading-relaxed">
                <strong className="text-zinc-300">Mặc định:</strong> Giọng đọc tự nhiên, giữ nguyên tốc độ, thời lượng dài ngắn tùy ý. <br/>
                <strong className="text-yellow-500/80">Ép Khớp Timestamp:</strong> Bóp méo hoặc kéo giãn giọng đọc (FFmpeg) để thời lượng Audio vừa khít 100% với "Thời lượng tham chiếu" của Phân cảnh. <br/>
                <strong className="text-cyan-400/80">Mode Pro:</strong> Giọng đọc tự nhiên, Audio ra bao nhiêu giây thì Phân cảnh tự động chốt bấy nhiêu giây.
              </p>
            </div>

            {/* TikTok Session ID */}
            {config.platform === 'tiktok_tts' && (
              <div className="space-y-2 md:col-span-2 mt-2 pt-4 border-t border-zinc-800">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                    Mã Session TikTok (SessionID)
                  </label>
                </div>
                <input
                  type="text"
                  placeholder="Nhập sessionid cookie của Tiktok.com nếu muốn dùng đúng TikTok TTS"
                  value={config.tiktokSessionId}
                  onChange={(e) => store.updateTTSConfig({ tiktokSessionId: e.target.value })}
                  className="w-full rounded-lg border border-zinc-800 bg-black/60 px-3 py-2.5 text-sm font-mono text-zinc-200 outline-none focus:border-sky-500 transition-colors"
                />
                <p className="text-[10px] text-zinc-500">
                  TikTok TTS cần sessionid hợp lệ. Nếu bỏ trống, app sẽ tự dùng Edge TTS tương ứng để nghe thử và sinh audio không bị lỗi.
                </p>
              </div>
            )}
            
                        {/* VieNeu-TTS API URL */}
            {config.platform === 'vieneu_tts' && (
              <div className="space-y-2 md:col-span-2 mt-2 pt-4 border-t border-zinc-800">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                    VieNeu-TTS Server API (Ví dụ: http://localhost:3000/api/v1)
                  </label>
                </div>
                <input
                  type="text"
                  placeholder="http://localhost:3000/api/v1"
                  value={config.api_url_vieneu || 'http://localhost:3000/api/v1'}
                  onChange={(e) => store.updateTTSConfig({ api_url_vieneu: e.target.value })}
                  className="w-full rounded-lg border border-zinc-800 bg-black/60 px-3 py-2.5 text-sm font-mono text-zinc-200 outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            )}
            
{/* VIP Settings Notifier */}
            {(config.platform === 'vbee' || config.platform === 'elevenlabs') && (
              <div className="md:col-span-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 mt-2">
                <span className="text-xl">👑</span>
                <div>
                  <h4 className="text-xs font-bold text-amber-500 uppercase">Tính năng Premium</h4>
                  <p className="text-[11px] text-zinc-400 mt-1">Giọng đọc chất lượng cao yêu cầu tài khoản PRO/VIP và sẽ tiêu tốn 3 Credits cho mỗi lần sinh.</p>
                </div>
              </div>
            )}

          </div>

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
    </div>
  );
}
