'use client';

import React, { useEffect, useState } from 'react';
import type { TTSConfig } from '@/store/useNovelStore';
import { Loader2, Play, Volume2 } from 'lucide-react';
import { SELECT_DARK, SELECT_DARK_SM, OPTION_DARK } from '../ttsSelectStyles';

export type CreateCloneProfile = {
  name: string;
  hasSample?: boolean;
  isUser?: boolean;
  source?: string;
  samplePath?: string | null;
};

export type CreateVoiceTabProps = {
  config: TTSConfig;
  updateTTSConfig: (p: Partial<TTSConfig>) => void;
  cloneFileInputRef: React.RefObject<HTMLInputElement | null>;
  cloneSampleLabel: string;
  setCloneSampleLabel: (s: string) => void;
  setCloneSampleFile: (f: File | null) => void;
  cloneRefText: string;
  setCloneRefText: (s: string) => void;
  testText: string;
  setTestText: (s: string) => void;
  isTestGenerating: boolean;
  testAudioUrl: string | null;
  lastCloneResult: { profileName?: string; method?: string } | null;
  handleTestGeneration: () => void | Promise<void>;
  setCastStudioOpen: (v: boolean) => void;
  setVoiceUiTab: (t: 'clone' | 'engine' | 'create') => void;
  ensureVoiceCastSeeded: () => void;
  /** Giọng USER đã clone thành công (có file mẫu) */
  userCloneProfiles: CreateCloneProfile[];
  /** Nghe thử một profile clone */
  onPreviewCloneProfile: (profileName: string) => void | Promise<void>;
  previewingCloneName: string | null;
  isPreviewing: boolean;
};

export default function CreateVoiceTab(props: CreateVoiceTabProps) {
  const {
    config,
    updateTTSConfig,
    cloneFileInputRef,
    cloneSampleLabel,
    setCloneSampleLabel,
    setCloneSampleFile,
    cloneRefText,
    setCloneRefText,
    testText,
    setTestText,
    isTestGenerating,
    testAudioUrl,
    lastCloneResult,
    handleTestGeneration,
    setCastStudioOpen,
    setVoiceUiTab,
    ensureVoiceCastSeeded,
    userCloneProfiles,
    onPreviewCloneProfile,
    previewingCloneName,
    isPreviewing,
  } = props;

  const [selectedCloneName, setSelectedCloneName] = useState('');

  // Ưu tiên clone mới nhất → giọng đang chọn trong list → đầu list
  useEffect(() => {
    if (!userCloneProfiles.length) {
      setSelectedCloneName('');
      return;
    }
    const names = new Set(userCloneProfiles.map((p) => p.name));
    if (lastCloneResult?.profileName && names.has(lastCloneResult.profileName)) {
      setSelectedCloneName(lastCloneResult.profileName);
      return;
    }
    setSelectedCloneName((prev) => {
      if (prev && names.has(prev)) return prev;
      if (config.voice && names.has(config.voice)) return config.voice;
      return userCloneProfiles[0]?.name || '';
    });
  }, [userCloneProfiles, lastCloneResult?.profileName, config.voice]);

  const previewing =
    !!selectedCloneName && previewingCloneName === selectedCloneName;

  return (
    <div className="space-y-4 rounded-xl border border-emerald-900/45 bg-emerald-950/15 p-4">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-400">
          Tạo giọng đọc từ mẫu
        </h3>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500 max-w-lg">
          Tải mẫu 3–12s (một người, không nhạc nền) → gõ đúng lời trong đoạn đó → Tạo
          giọng. Pitch = 0 để bám tần số gốc. Phân vai ở kịch bản hoặc{' '}
          <button
            type="button"
            onClick={() => {
              ensureVoiceCastSeeded();
              setCastStudioOpen(true);
            }}
            className="text-emerald-400/90 underline-offset-2 hover:underline"
          >
            Phân vai giọng
          </button>
          .
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
            setCloneRefText('');
            const reader = new FileReader();
            reader.onloadend = () => {
              const b64 = (reader.result as string).split(',')[1];
              updateTTSConfig({
                vinaReferenceAudioB64: b64,
                vinaReferenceAudio: f.name,
                vinaReferenceText: '',
                vinaUseClone: true,
              });
            };
            reader.readAsDataURL(f);
          } else {
            updateTTSConfig({ vinaReferenceAudioB64: undefined, vinaReferenceAudio: '' });
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
      </div>

      <div className="space-y-1.5">
        <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
          2. Transcript mẫu (bắt buộc)
        </label>
        <input
          type="text"
          value={cloneRefText}
          onChange={(e) => {
            setCloneRefText(e.target.value);
            updateTTSConfig({ vinaReferenceText: e.target.value });
          }}
          placeholder="Chỉ gõ đúng lời trong đoạn mẫu (không dán cả đoạn dài hơn audio)"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[12px] text-zinc-200 outline-none focus:border-emerald-500"
        />
        <p className="text-[10px] text-zinc-600">
          Sai transcript hoặc text dài hơn file (mẫu bị cắt 12s) → model lệch pitch/tần số so
          với giọng gốc.
        </p>
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
          4. Giọng đã clone
        </label>
        {userCloneProfiles.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 bg-black/20 px-3 py-2.5 text-[11px] text-zinc-500">
            Chưa có giọng clone thành công. Hoàn thành bước 1–3 rồi bấm «Tạo giọng đọc».
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedCloneName}
              onChange={(e) => setSelectedCloneName(e.target.value)}
              className={`${SELECT_DARK} flex-1 min-w-[180px]`}
            >
              {userCloneProfiles.map((p) => (
                <option className={OPTION_DARK} key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!selectedCloneName || (isPreviewing && !previewing)}
              onClick={() => {
                if (selectedCloneName) void onPreviewCloneProfile(selectedCloneName);
              }}
              className="inline-flex h-[38px] items-center gap-1.5 rounded-lg border border-emerald-800/50 bg-emerald-500/10 px-3 text-[10px] font-bold uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
              title="Nghe thử giọng đã clone"
            >
              {previewing && isPreviewing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Volume2 className="h-3.5 w-3.5" />
              )}
              Nghe thử
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="space-y-1">
          <label className="text-[9px] font-bold uppercase text-zinc-500">Giới tính</label>
          <select
            value={config.vinaGender || 'male'}
            onChange={(e) =>
              updateTTSConfig({
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
            onChange={(e) => updateTTSConfig({ speed: parseFloat(e.target.value) || 1 })}
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
            onChange={(e) => updateTTSConfig({ pitch: parseInt(e.target.value, 10) || 0 })}
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100"
          />
        </div>
        <div className="space-y-1 flex flex-col justify-end">
          <button
            type="button"
            onClick={() => void handleTestGeneration()}
            disabled={
              isTestGenerating ||
              !cloneSampleLabel ||
              !cloneRefText.trim() ||
              !testText.trim()
            }
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
          <p className="text-[9px] font-bold uppercase text-emerald-500/80">Kết quả clone</p>
          <audio src={testAudioUrl} controls className="h-9 w-full opacity-95" />
          {lastCloneResult && (
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
              <span>
                Profile:{' '}
                <code className="text-emerald-400/90">{lastCloneResult.profileName}</code>
              </span>
              {lastCloneResult.method && (
                <span className="text-zinc-600">· {lastCloneResult.method}</span>
              )}
              <button
                type="button"
                onClick={() => {
                  ensureVoiceCastSeeded();
                  setCastStudioOpen(true);
                }}
                className="rounded border border-emerald-800/50 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-400 hover:bg-emerald-500/10"
              >
                Phân vai giọng
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
