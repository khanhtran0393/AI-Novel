'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  charImageKey,
  getCharacterProfileSetupStatus,
} from '@/lib/characterProfile';
import {
  getCharacterVoiceOptions,
  suggestVoiceFromProfile,
} from '@/lib/characterVoice';
import { prepareVoiceCatalog } from '@/lib/voiceCatalogPrep';

type CharacterProfileDraft = {
  gioi_tinh: string;
  tuoi: string;
  dang_nguoi: string;
  vai_tro: string;
  quan_ao: string;
  ngoai_hinh: string;
  dac_diem_nhan_dang: string;
  khuet_tat: string;
  so_thich: string;
  thoi_quen: string;
  dong_co: string;
  giong_thoai: string;
  prompt: string;
  tts_voice?: string;
};

type CharacterProfileFormProps = {
  editingChar: string | null;
  profileDraft: CharacterProfileDraft;
  patchDraft: (patch: Partial<CharacterProfileDraft>) => void;
  renameDraft: string;
  setRenameDraft: (value: string) => void;
  replaceNameInText: boolean;
  setReplaceNameInText: (value: boolean) => void;
  generatingCharPrompt: boolean;
  generatingCharImage: boolean;
  regeneratingCharPromptOnly: boolean;
  handleGenerateCharPrompt: (name: string) => void;
  handleRegenerateCharPromptOnly: (name: string) => void;
  handleGenerateCharImage: (name: string) => void;
  handleSaveChar: (name: string) => void;
  handleRenameChar: (name: string) => void;
  setEditingChar: (name: string | null) => void;
  onImageZoom: (url: string) => void;
};

/**
 * Form hồ sơ 1 NV khi đang edit (identity / voice / sheet).
 */
export default function CharacterProfileForm(props: CharacterProfileFormProps) {
  const {
    editingChar,
    profileDraft,
    patchDraft,
    renameDraft,
    setRenameDraft,
    replaceNameInText,
    setReplaceNameInText,
    generatingCharPrompt,
    generatingCharImage,
    regeneratingCharPromptOnly,
    handleGenerateCharPrompt,
    handleRegenerateCharPromptOnly,
    handleGenerateCharImage,
    handleSaveChar,
    handleRenameChar,
    setEditingChar,
    onImageZoom,
  } = props;

  const ttsPlatform = useNovelStore((s) => s.ttsConfig?.platform || '');
  const ttsLanguage = useNovelStore((s) => s.ttsConfig?.language || '');
  const sheetImage = useNovelStore((s) =>
    editingChar ? s.generatedImages?.[charImageKey(editingChar)] : undefined,
  );
  const sheetProjectUrl = useNovelStore((s) =>
    editingChar ? s.projectUrls?.[charImageKey(editingChar)] : undefined,
  );
  const setCharacterVoice = useNovelStore((s) => s.setCharacterVoice);
  const [voiceListTick, setVoiceListTick] = useState(0);
  useEffect(() => {
    void prepareVoiceCatalog().then(() => setVoiceListTick((t) => t + 1));
  }, []);
  const characterVoiceOptions = useMemo(() => {
    void voiceListTick;
    const platform = (ttsPlatform || '').trim();
    const language = (ttsLanguage || '').trim();
    if (!platform || !language) return [];
    return getCharacterVoiceOptions(platform, language, { includeAllLanguages: true });
  }, [ttsPlatform, ttsLanguage, voiceListTick]);

  if (!editingChar) return null;

  // Original IIFE block (includes formStatus + return)
  return (
    <>
          {editingChar && (() => {
            // Live theo draft + ảnh sheet đã gen
            const formStatus = getCharacterProfileSetupStatus(profileDraft, {
              hasReferenceImage: !!sheetImage,
            });
            const formSetupDone = formStatus.complete;
            const formColor = formSetupDone ? '#10b981' : '#ef4444';
            return (
            <div
              className="mt-3 rounded-lg border-2 p-3 space-y-3 animate-in slide-in-from-top-2 duration-200"
              style={{
                borderColor: formColor,
                backgroundColor: formSetupDone
                  ? 'rgba(16, 185, 129, 0.08)'
                  : 'rgba(239, 68, 68, 0.08)',
                boxShadow: formSetupDone
                  ? '0 0 14px rgba(16, 185, 129, 0.25)'
                  : '0 0 14px rgba(239, 68, 68, 0.25)',
              }}
            >
              <div className="flex items-center justify-between border-b border-zinc-900/60 pb-1.5 gap-2">
                <span
                  className="text-[10px] font-bold uppercase tracking-widest font-sans flex items-center gap-1 min-w-0"
                  style={{ color: formColor }}
                >
                  👤 {editingChar}{' '}
                  {formSetupDone ? '· Đã setup đủ' : '· Chưa đủ'}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingChar(null)}
                  className="text-[9px] text-zinc-500 hover:text-zinc-300 font-sans uppercase font-bold cursor-pointer shrink-0"
                >
                  Thu nhỏ
                </button>
              </div>
              {!formSetupDone && formStatus.missing.length > 0 && (
                <div
                  className="rounded border px-2 py-1.5 text-[9px] leading-relaxed font-sans"
                  style={{
                    borderColor: `${formColor}66`,
                    color: formColor,
                    backgroundColor: 'rgba(0,0,0,0.35)',
                  }}
                >
                  <span className="font-bold uppercase tracking-wider">Thiếu: </span>
                  {formStatus.missing.join(' · ')}
                  <div className="mt-1 text-[8px] opacity-80 text-zinc-400">
                    Xanh khi đủ mọi trường + giọng TTS + ảnh tham chiếu (Gen Sheet).
                  </div>
                </div>
              )}

              {/* Đổi tên nhân vật */}
              <div className="rounded border border-zinc-800/80 bg-black/40 p-2 space-y-1.5">
                <label className="text-[9px] text-sky-500/90 font-bold uppercase tracking-widest">
                  Tên nhân vật (đổi nếu không thích)
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleRenameChar(editingChar);
                      }
                    }}
                    placeholder="Tên mới..."
                    className="h-7 flex-1 min-w-0 rounded border border-zinc-800 bg-black/60 px-2 text-[11px] font-semibold text-zinc-100 outline-none focus:border-sky-500"
                  />
                  <button
                    type="button"
                    disabled={!renameDraft.trim() || renameDraft.trim() === editingChar}
                    onClick={() => handleRenameChar(editingChar)}
                    className="shrink-0 rounded bg-sky-500/90 px-2.5 py-1.5 text-[10px] font-bold uppercase text-black hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    title="Đổi tên hồ sơ + key ảnh (và kịch bản nếu bật)"
                  >
                    Đổi tên
                  </button>
                </div>
                <label className="flex items-center gap-1.5 text-[9px] text-zinc-500 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={replaceNameInText}
                    onChange={(e) => setReplaceNameInText(e.target.checked)}
                    className="rounded border-zinc-700"
                  />
                  Thay tên trong kịch bản, dàn ý &amp; lore
                </label>
              </div>

              <div className="space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">Giới tính</label>
                    <input
                      type="text"
                      placeholder="Nam / Nữ..."
                      value={profileDraft.gioi_tinh}
                      onChange={(e) => patchDraft({ gioi_tinh: e.target.value })}
                      className="h-7 w-full rounded border border-zinc-800 bg-black/60 px-2 text-[11px] text-zinc-300 outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">Tuổi</label>
                    <input
                      type="text"
                      placeholder="~28"
                      value={profileDraft.tuoi}
                      onChange={(e) => patchDraft({ tuoi: e.target.value })}
                      className="h-7 w-full rounded border border-zinc-800 bg-black/60 px-2 text-[11px] text-zinc-300 outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">Dáng người</label>
                    <input
                      type="text"
                      placeholder="Cao gầy..."
                      value={profileDraft.dang_nguoi}
                      onChange={(e) => patchDraft({ dang_nguoi: e.target.value })}
                      className="h-7 w-full rounded border border-zinc-800 bg-black/60 px-2 text-[11px] text-zinc-300 outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">Vai trò</label>
                    <input
                      type="text"
                      placeholder="Chính / Phụ..."
                      value={profileDraft.vai_tro}
                      onChange={(e) => patchDraft({ vai_tro: e.target.value })}
                      className="h-7 w-full rounded border border-zinc-800 bg-black/60 px-2 text-[11px] text-zinc-300 outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">Trang phục signature</label>
                  <input
                    type="text"
                    placeholder="Áo măng tô rách, kính bảo hộ..."
                    value={profileDraft.quan_ao}
                    onChange={(e) => patchDraft({ quan_ao: e.target.value })}
                    className="h-7 w-full rounded border border-zinc-800 bg-black/60 px-2 text-[11px] text-zinc-300 outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[9px] text-amber-600/90 font-bold uppercase tracking-widest">
                    Face lock (ngoại hình khuôn mặt)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Tóc, mắt, da, xương mặt — khóa cố định mọi shot..."
                    value={profileDraft.ngoai_hinh}
                    onChange={(e) => patchDraft({ ngoai_hinh: e.target.value })}
                    className="w-full rounded border border-amber-900/40 bg-black/60 p-2 text-[10px] text-zinc-300 outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[9px] text-rose-400/90 font-bold uppercase tracking-widest">
                    Đặc điểm nhận dạng (bắt buộc giữ)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Sẹo chữ V thái dương trái, nốt ruồi dưới mắt phải, xăm..."
                    value={profileDraft.dac_diem_nhan_dang}
                    onChange={(e) => patchDraft({ dac_diem_nhan_dang: e.target.value })}
                    className="w-full rounded border border-rose-900/40 bg-black/60 p-2 text-[10px] text-zinc-300 outline-none focus:border-rose-500"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">Khuyết điểm (điểm yếu / thói xấu / nỗi sợ)</label>
                  <input
                    type="text"
                    placeholder="VD: kiêu ngạo che sợ bị bỏ rơi; nghiện cờ bạc; nói dối khi sợ..."
                    value={profileDraft.khuet_tat}
                    onChange={(e) => patchDraft({ khuet_tat: e.target.value })}
                    className="h-7 w-full rounded border border-zinc-800 bg-black/60 px-2 text-[11px] text-zinc-300 outline-none focus:border-amber-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">Sở thích</label>
                    <input
                      type="text"
                      value={profileDraft.so_thich}
                      onChange={(e) => patchDraft({ so_thich: e.target.value })}
                      className="h-7 w-full rounded border border-zinc-800 bg-black/60 px-2 text-[11px] text-zinc-300 outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">Thói quen</label>
                    <input
                      type="text"
                      value={profileDraft.thoi_quen}
                      onChange={(e) => patchDraft({ thoi_quen: e.target.value })}
                      className="h-7 w-full rounded border border-zinc-800 bg-black/60 px-2 text-[11px] text-zinc-300 outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">Động cơ</label>
                  <input
                    type="text"
                    placeholder="Tìm em gái / báo thù..."
                    value={profileDraft.dong_co}
                    onChange={(e) => patchDraft({ dong_co: e.target.value })}
                    className="h-7 w-full rounded border border-zinc-800 bg-black/60 px-2 text-[11px] text-zinc-300 outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[9px] text-sky-500/90 font-bold uppercase tracking-widest">Giọng thoại / quirk</label>
                  <input
                    type="text"
                    placeholder="Cộc, câu ngắn / mỉa nửa cười..."
                    value={profileDraft.giong_thoai}
                    onChange={(e) => patchDraft({ giong_thoai: e.target.value })}
                    className="h-7 w-full rounded border border-zinc-800 bg-black/60 px-2 text-[11px] text-zinc-300 outline-none focus:border-sky-500"
                  />
                </div>

                {/* Voice TTS theo nhân vật — dùng khi sinh đa giọng theo lượt thoại */}
                <div className="flex flex-col gap-1 rounded border border-sky-900/40 bg-sky-950/10 p-2">
                  <div className="flex items-center justify-between gap-1">
                    <label className="text-[9px] text-sky-400 font-bold uppercase tracking-widest">
                      Voice TTS (đối thoại)
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const platform = (ttsPlatform || '').trim();
                        const language = (ttsLanguage || '').trim();
                        if (!platform || !language) return;
                        const suggested = suggestVoiceFromProfile(
                          profileDraft,
                          platform,
                          language,
                        );
                        if (suggested) {
                          patchDraft({ tts_voice: suggested });
                          setCharacterVoice(editingChar, suggested);
                        }
                      }}
                      className="text-[8px] font-bold uppercase text-amber-500 hover:text-amber-400 cursor-pointer"
                      title="Gợi ý voice theo giới tính + quirk thoại"
                    >
                      ✨ Gợi ý từ quirk
                    </button>
                  </div>
                  <select
                    value={profileDraft.tts_voice || ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      patchDraft({ tts_voice: v });
                      setCharacterVoice(editingChar, v);
                    }}
                    className="h-7 w-full rounded border border-zinc-700 bg-zinc-900 px-2 text-[11px] text-zinc-100 outline-none focus:border-sky-500 cursor-pointer [color-scheme:dark]"
                  >
                    <option className="bg-zinc-900 text-zinc-100" value="">
                      — Dùng giọng mặc định / auto —
                    </option>
                    {characterVoiceOptions.map((v) => (
                      <option className="bg-zinc-900 text-zinc-100" key={v.id} value={v.id}>
                        {v.name} ({v.id})
                      </option>
                    ))}
                  </select>
                  <p className="text-[8px] text-zinc-600 leading-snug">
                    {characterVoiceOptions.length} giọng · platform{' '}
                    <span className="text-zinc-400">{ttsPlatform || 'chưa chọn'}</span>.
                    Kịch bản <span className="text-zinc-400">Tên NV: lời thoại</span> → TTS đổi giọng theo NV.
                    Dual-write Studio cast khi đã seed.
                  </p>
                </div>

                <div className="flex flex-col gap-1 pt-1 border-t border-zinc-900">
                  <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                    <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">
                      Master identity lock (EN)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={generatingCharPrompt}
                        onClick={() => handleGenerateCharPrompt(editingChar)}
                        className="text-[8px] font-bold text-amber-500 hover:text-amber-400 transition-colors uppercase cursor-pointer disabled:opacity-50"
                        title="Sinh toàn bộ hồ sơ + prompt 4 góc + 8 biểu cảm"
                      >
                        {generatingCharPrompt ? 'Đang viết...' : '✨ Gen Prompt AI'}
                      </button>
                      <span className="text-zinc-700 text-[9px] select-none">|</span>
                      <button
                        type="button"
                        disabled={regeneratingCharPromptOnly}
                        onClick={() => handleRegenerateCharPromptOnly(editingChar)}
                        className="text-[8px] font-bold text-sky-400 hover:text-sky-300 transition-colors uppercase cursor-pointer disabled:opacity-50"
                      >
                        {regeneratingCharPromptOnly ? 'Đang tạo lại...' : '🔄 Tạo lại Prompt'}
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={3}
                    placeholder="English master identity lock portrait..."
                    value={profileDraft.prompt}
                    onChange={(e) => patchDraft({ prompt: e.target.value })}
                    className="w-full rounded border border-zinc-800 bg-black/60 p-2 text-[10px] text-zinc-300 font-mono leading-relaxed outline-none focus:border-amber-500"
                  />
                </div>

                {/* 1 ảnh sheet: front + 4 chiều + biểu cảm */}
                <div className="flex flex-col gap-1.5 pt-2 border-t border-zinc-900/60">
                  <label className="text-[9px] text-amber-500/90 font-bold uppercase tracking-widest">
                    Ảnh tham chiếu (1 sheet)
                  </label>
                  <p className="text-[8px] text-zinc-600 leading-relaxed">
                    Gộp: chân dung front · turnaround 4 chiều · hàng biểu cảm — cùng 1 file
                  </p>
                  {sheetImage ? (
                    <div
                      className="relative w-full h-48 rounded-xl overflow-hidden border border-zinc-800 bg-black group cursor-zoom-in"
                      onClick={() => onImageZoom(sheetImage)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={sheetImage}
                        alt={`Sheet ${editingChar}`}
                        className="w-full h-full object-contain group-hover:scale-[1.02] transition-transform duration-500"
                      />
                      <div className="absolute bottom-0 inset-x-0 bg-black/70 py-1 text-center">
                        <span className="text-[8px] text-zinc-300 font-bold uppercase tracking-widest">
                          Bấm phóng to · Front + 4 góc + Expr
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center w-full h-20 rounded-lg border border-dashed border-zinc-800 bg-black/20 text-center p-2">
                      <p className="text-[9px] text-zinc-500">
                        Chưa có sheet — bấm <span className="text-amber-500/80">Gen Sheet</span>
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1.5 pt-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={generatingCharImage}
                      onClick={() => handleGenerateCharImage(editingChar)}
                      className="rounded bg-gradient-to-r from-amber-500 to-orange-600 px-3 py-1 text-[10px] font-bold uppercase text-black hover:scale-105 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                      title="Sinh 1 ảnh gộp front + 4 chiều + biểu cảm"
                    >
                      {generatingCharImage ? 'Đang vẽ sheet...' : '🎨 Gen Sheet'}
                    </button>
                    {sheetProjectUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          if (sheetProjectUrl) window.open(sheetProjectUrl, '_blank');
                        }}
                        className="text-[9px] font-bold uppercase text-zinc-400 hover:text-amber-500 cursor-pointer"
                      >
                        🌐 Mở Link
                      </button>
                    )}
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => setEditingChar(null)}
                      className="rounded border border-zinc-800 bg-zinc-900/40 px-2.5 py-1 text-[10px] font-bold uppercase text-zinc-400 hover:bg-zinc-900 cursor-pointer"
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveChar(editingChar)}
                      className="rounded bg-emerald-500 px-3 py-1 text-[10px] font-bold uppercase text-black hover:bg-emerald-400 cursor-pointer"
                    >
                      Lưu hồ sơ
                    </button>
                  </div>
                </div>
              </div>
            </div>
            );
          })()}
    </>
  );
}
