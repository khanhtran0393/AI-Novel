'use client';

import React from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { X, Volume2, Globe, Settings, Cpu } from 'lucide-react';

interface TTSConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const VOICES: Record<string, Record<string, {id: string, name: string}[]>> = {
  tiktok_tts: {
    vi: [
      { id: 'vn_tiktok_girl', name: 'Cô Gái Hoạt Ngôn' },
      { id: 'vn_tiktok_boy', name: 'Thanh Niên Tự Tin' },
      { id: 'vn_tiktok_sweet', name: 'Nhỏ Ngọt Ngào' }
    ],
    en: [
      { id: 'en_us_001', name: 'US Female' },
      { id: 'en_us_006', name: 'US Male' }
    ],
    ja: [
      { id: 'jp_001', name: 'Japanese Female 1' },
      { id: 'jp_006', name: 'Japanese Male' }
    ]
  },
  edge_tts: {
    vi: [
      { id: 'vi-VN-HoaiMyNeural', name: 'Hoài My (Nữ)' },
      { id: 'vi-VN-NamMinhNeural', name: 'Nam Minh (Nam)' }
    ],
    en: [
      { id: 'en-US-AriaNeural', name: 'Aria (Female)' },
      { id: 'en-US-GuyNeural', name: 'Guy (Male)' }
    ],
    ja: [
      { id: 'ja-JP-NanamiNeural', name: 'Nanami (Female)' },
      { id: 'ja-JP-KeitaNeural', name: 'Keita (Male)' }
    ],
    zh: [
      { id: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao (Female)' },
      { id: 'zh-CN-YunxiNeural', name: 'Yunxi (Male)' }
    ],
    ko: [
      { id: 'ko-KR-SunHiNeural', name: 'SunHi (Female)' },
      { id: 'ko-KR-InJoonNeural', name: 'InJoon (Male)' }
    ]
  },
  capcut_tts: {
    vi: [
      { id: 'BV074_streaming', name: 'Giọng Nữ CapCut' },
      { id: 'BV075_streaming', name: 'Giọng Nam CapCut' },
      { id: 'BV076_streaming', name: 'Cô Gái Ngọt Ngào' }
    ],
    en: [
      { id: 'en_us_001', name: 'Narrator Female' },
      { id: 'en_us_002', name: 'Jessie' }
    ],
    ja: [
      { id: 'jp_001', name: 'Japanese Female' }
    ]
  },
  vieneu_tts: {
    vi: [
      { id: 'Bình An', name: 'Bình An (Mặc định v3)' },
      { id: 'Xuân Vĩnh', name: 'Xuân Vĩnh (Nam)' },
      { id: 'Ngọc Linh', name: 'Ngọc Linh (Nữ)' }
    ],
    en: [
      { id: 'Bình An', name: 'Bình An (Bilingual)' }
    ]
  },
  vbee: {
    vi: [
      { id: 'VBEE_MaiPhuong', name: '👑 Mai Phương (Chuẩn VTV)' },
      { id: 'VBEE_ThaoTrinh', name: '👑 Thảo Trinh (Sôi động)' },
      { id: 'VBEE_MinhHoang', name: '👑 Minh Hoàng (Trầm ấm)' }
    ],
    en: []
  },
  google: {
    vi: [{ id: 'vi-VN-Standard-A', name: 'Google Nữ Chuẩn' }],
    en: [{ id: 'en-US-Standard-A', name: 'Google Female Standard' }]
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
  { code: 'ja', label: 'Tiếng Nhật (Japanese)' },
  { code: 'zh', label: 'Tiếng Trung (Chinese)' },
  { code: 'ko', label: 'Tiếng Hàn (Korean)' }
];

export default function TTSConfigModal({ isOpen, onClose }: TTSConfigModalProps) {
  const store = useNovelStore();
  const config = store.ttsConfig;

  if (!isOpen) return null;

  const currentVoices = VOICES[config.platform as string]?.[config.language] || [];

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
              <select
                value={config.platform}
                onChange={(e) => {
                  const newPlatform = e.target.value as typeof config.platform;
                  const availableVoices = VOICES[newPlatform]?.[config.language];
                  store.updateTTSConfig({ 
                    platform: newPlatform,
                    voice: availableVoices && availableVoices.length > 0 ? availableVoices[0].id : ''
                  });
                }}
                className="w-full rounded-lg border border-zinc-800 bg-black/60 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-500 transition-colors"
              >
                <option value="edge_tts">Edge-TTS (Miễn phí)</option>
                <option value="tiktok_tts">TikTok TTS (Miễn phí)</option>
                <option value="capcut_tts">CapCut TTS (Direct API)</option>
                <option value="vieneu_tts">VieNeu-TTS (Local AI)</option>
                <option value="google">Google Cloud (Fallback)</option>
                <option value="vbee">VBEE (Tài khoản VIP+)</option>
                <option value="elevenlabs">ElevenLabs (Pro)</option>
              </select>
            </div>

            {/* Language */}
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                <Globe className="h-3.5 w-3.5 text-emerald-400" /> Ngôn Ngữ
              </label>
              <select
                value={config.language}
                onChange={(e) => {
                  const newLang = e.target.value;
                  const availableVoices = VOICES[config.platform]?.[newLang];
                  store.updateTTSConfig({ 
                    language: newLang,
                    voice: availableVoices && availableVoices.length > 0 ? availableVoices[0].id : ''
                  });
                }}
                className="w-full rounded-lg border border-zinc-800 bg-black/60 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-500 transition-colors"
              >
                {LANGUAGES.map(lang => (
                  <option key={lang.code} value={lang.code}>{lang.label}</option>
                ))}
              </select>
            </div>

            {/* Voice */}
            <div className="space-y-2 md:col-span-2">
              <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                <Volume2 className="h-3.5 w-3.5 text-amber-400" /> Giọng Đọc
              </label>
              <select
                value={config.voice}
                onChange={(e) => store.updateTTSConfig({ voice: e.target.value })}
                className="w-full rounded-lg border border-zinc-800 bg-black/60 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-500 transition-colors"
              >
                {currentVoices.length === 0 && <option value="">Không có giọng nào hỗ trợ</option>}
                {currentVoices.map((v: { id: string, name: string }) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
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
                  placeholder="Nhập sessionid cookie của Tiktok.com vào đây (Tuỳ chọn)"
                  value={config.tiktokSessionId}
                  onChange={(e) => store.updateTTSConfig({ tiktokSessionId: e.target.value })}
                  className="w-full rounded-lg border border-zinc-800 bg-black/60 px-3 py-2.5 text-sm font-mono text-zinc-200 outline-none focus:border-sky-500 transition-colors"
                />
              </div>
            )}

            {/* VieNeu-TTS API URL */}
            {config.platform === 'vieneu_tts' && (
              <div className="space-y-2 md:col-span-2 mt-2 pt-4 border-t border-zinc-800">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                    VieNeu-TTS Server API (Ví dụ: http://localhost:23333/v1)
                  </label>
                </div>
                <input
                  type="text"
                  placeholder="http://localhost:23333/v1"
                  value={config.api_url_vieneu || 'http://localhost:23333/v1'}
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
            onClick={onClose}
            className="rounded-lg bg-amber-500 px-6 py-2 text-xs font-bold text-black hover:bg-amber-400 transition-colors"
          >
            Lưu Cấu Hình
          </button>
        </div>

      </div>
    </div>
  );
}
