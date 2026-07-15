'use client';

import React from 'react';
import type { TTSConfig } from '@/store/useNovelStore';
import { Loader2, Play } from 'lucide-react';
import { SELECT_DARK, SELECT_DARK_SM, OPTION_DARK } from '../ttsSelectStyles';

export type CreateVoiceTabProps = {
  config: TTSConfig;
  updateTTSConfig: (p: Partial<TTSConfig>) => void;
  nhan_vat: string[];
  cloneFileInputRef: React.RefObject<HTMLInputElement | null>;
  cloneSampleLabel: string;
  setCloneSampleLabel: (s: string) => void;
  setCloneSampleFile: (f: File | null) => void;
  cloneRefText: string;
  setCloneRefText: (s: string) => void;
  cloneAssignTarget: string;
  setCloneAssignTarget: (s: string) => void;
  testText: string;
  setTestText: (s: string) => void;
  isTestGenerating: boolean;
  testAudioUrl: string | null;
  lastCloneResult: { profileName?: string; method?: string } | null;
  handleTestGeneration: () => void | Promise<void>;
  setCastStudioOpen: (v: boolean) => void;
  setVoiceUiTab: (t: 'clone' | 'engine' | 'create') => void;
  ensureVoiceCastSeeded: () => void;
};

export default function CreateVoiceTab(props: CreateVoiceTabProps) {
  const {
    config,
    updateTTSConfig,
    nhan_vat,
    cloneFileInputRef,
    cloneSampleLabel,
    setCloneSampleLabel,
    setCloneSampleFile,
    cloneRefText,
    setCloneRefText,
    cloneAssignTarget,
    setCloneAssignTarget,
    testText,
    setTestText,
    isTestGenerating,
    testAudioUrl,
    lastCloneResult,
    handleTestGeneration,
    setCastStudioOpen,
    setVoiceUiTab,
    ensureVoiceCastSeeded,
  } = props;

  const store = {
    updateTTSConfig,
    nhan_vat,
    ensureVoiceCastSeeded,
  };

  return (
            <div className="space-y-4 rounded-xl border border-emerald-900/45 bg-emerald-950/15 p-4">
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
            </div>
  );
}
