'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { useFolderActions } from '../hooks/useFolderActions';
import { useCharacterActions } from '../hooks/useCharacterActions';
import { useProjectActions } from '../hooks/useProjectActions';
import {
  Sparkles,
  RefreshCw,
  Copy,
  BookOpen,
  Award,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Video,
  Settings,
  Book,
  PlusCircle,
  User,
  Clapperboard
} from 'lucide-react';
import { planArcAction } from '../modules/writeModule';
import {
  charImageKey,
  getCharacterProfileSetupStatus,
} from '@/lib/characterProfile';
import {
  getCharacterVoiceOptions,
  suggestVoiceFromProfile,
} from '@/lib/characterVoice';
import { prepareVoiceCatalog } from '@/lib/voiceCatalogPrep';

interface SidebarProps {
  handleWriteChapter: (overwrite?: boolean, chapterNumber?: number) => Promise<void>;
  isStreaming: boolean;
  onImageZoom: (url: string) => void;
}

export default function Sidebar({
  handleWriteChapter,
  isStreaming,
  onImageZoom
}: SidebarProps) {
  const store = useNovelStore();
  const currentChapter = store.danh_sach_chuong.find(c => c.so_chuong === store.chuong_dang_chon);
  const [voiceListTick, setVoiceListTick] = useState(0);

  // Hậu trường: nạp full catalog (static + dynamic) để dropdown NV đủ giọng
  useEffect(() => {
    void prepareVoiceCatalog().then(() => setVoiceListTick((t) => t + 1));
  }, []);

  const characterVoiceOptions = useMemo(() => {
    void voiceListTick;
    return getCharacterVoiceOptions(
      store.ttsConfig?.platform || 'edge_tts',
      store.ttsConfig?.language || 'vi',
      { includeAllLanguages: true },
    );
  }, [store.ttsConfig?.platform, store.ttsConfig?.language, voiceListTick]);

  // Trạng thái mở rộng accordions của Dàn ý bên trái
  const [openOutlineTab, setOpenOutlineTab] = useState<'chapter' | 'overall' | 'lore' | null>('chapter');
  const [isPlanningArc, setIsPlanningArc] = useState(false);

  const handlePlanNextArc = async (): Promise<boolean> => {
    setIsPlanningArc(true);
    try {
      const so_chuong_moi_cung = store.setup.so_chuong || 10;
      const chuong_bat_dau = store.danh_sach_chuong.length > 0 ? store.danh_sach_chuong[store.danh_sach_chuong.length - 1].so_chuong + 1 : 1;
      
      const tom_tat_cuon_chieu = store.danh_sach_chuong
        .slice(-10)
        .map(c => `Chương ${c.so_chuong}: ${c.tieu_de}\n${c.dan_y}`)
        .join('\n\n');

      const result = await planArcAction({
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        ten_tac_pham: store.ten_tac_pham,
        lorebook: store.lorebook,
        danh_sach_chuong_da_viet: tom_tat_cuon_chieu,
        cung_hien_tai: store.cung_hien_tai,
        so_chuong_moi_cung,
        chuong_bat_dau
      });

      if (result.danh_sach_chuong && result.danh_sach_chuong.length > 0) {
        const newChapters = result.danh_sach_chuong.map((c: any) => ({
          ...c,
          noi_dung: '',
          trang_thai: 'empty'
        }));
        store.addChuongMoi(newChapters);
        store.setCungHienTai(store.cung_hien_tai + 1);
        return true;
      }
    } catch (err) {
      console.error("Lỗi khi lập kế hoạch cung mới:", err);
      alert("Lỗi khi lên kế hoạch: " + (err as Error).message);
    } finally {
      setIsPlanningArc(false);
    }
    return false;
  };

  const handleAppendOrPlanNextArc = async () => {
    const currentChapterNum = store.chuong_dang_chon;
    const isLastChapter = currentChapterNum === store.danh_sach_chuong.length;
    const currentChapter = store.danh_sach_chuong.find(c => c.so_chuong === currentChapterNum);
    const hasFinishedContent = currentChapter && currentChapter.trang_thai === 'ready' && (currentChapter.noi_dung || '').length > 500;

    if (isLastChapter && hasFinishedContent) {
      const confirmNext = confirm(
        `🎉 Bạn đã hoàn thành chương cuối cùng của Arc hiện tại (Chương ${currentChapterNum}).\n\nBạn có muốn tự động LÊN DÀN Ý CUNG (ARC) TIẾP THEO để tiếp tục viết tiếp tác phẩm không?`
      );
      if (confirmNext) {
        const success = await handlePlanNextArc();
        if (success) {
          const nextChapterNum = currentChapterNum + 1;
          store.selectChuong(nextChapterNum);
          setTimeout(() => {
            void handleWriteChapter(false, nextChapterNum).catch(() => undefined);
          }, 200);
        }
      }
    } else {
      void handleWriteChapter(false).catch(() => undefined);
    }
  };
  
  
  // Khởi động các Custom Hooks hành động mô-đun hóa sạch sẽ
  const { handleResetProject } = useProjectActions('');
  const {
    editingChar,
    setEditingChar,
    profileDraft,
    patchDraft,
    generatingCharPrompt,
    generatingCharImage,
    regeneratingCharPromptOnly,
    renameDraft,
    setRenameDraft,
    replaceNameInText,
    setReplaceNameInText,
    handleCharTagClick,
    handleGenerateCharPrompt,
    handleRegenerateCharPromptOnly,
    handleGenerateCharImage,
    handleSaveChar,
    handleRenameChar,
  } = useCharacterActions();

  return (
    <>
    <aside className="w-80 flex flex-col border-r border-zinc-900 bg-zinc-950 p-5 shrink-0 overflow-y-auto font-sans">
      
      {/* Khối Cấu Hình tag (Read-only) */}
      <div className="mb-5 flex flex-wrap gap-2">
        <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400 border border-amber-800/40">
          {store.setup.chu_de}
        </span>
        <span className="rounded-full bg-sky-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-400 border border-sky-800/40">
          {store.setup.phong_cach}
        </span>
        <span className="rounded-full bg-zinc-900 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 border border-zinc-800">
          {store.setup.so_chuong} Chương
        </span>
      </div>

      {/* Tên Tác Phẩm */}
      <div className="mb-5">
        <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1.5">
          TÊN TÁC PHẨM
        </label>
        <input
          type="text"
          value={store.ten_tac_pham}
          onChange={(e) => store.updateTenTacPham(e.target.value)}
          className="w-full rounded border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs font-semibold text-zinc-200 outline-none focus:border-amber-500 focus:bg-zinc-950 font-sans"
        />
      </div>


      {/* Danh Sách Chương */}
      <div className="mb-5">
        <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">
          DANH SÁCH CHƯƠNG
        </label>
        <div className="grid grid-cols-5 gap-2 max-h-[140px] overflow-y-auto pr-1">
          {store.danh_sach_chuong.map((ch) => {
            const isActive = ch.so_chuong === store.chuong_dang_chon;
            const hasContent = ch.trang_thai === 'ready';
            return (
              <button
                key={ch.so_chuong}
                type="button"
                onClick={() => {
                  store.selectChuong(ch.so_chuong);
                }}
                className={`flex h-9 items-center justify-center rounded border text-xs font-bold transition-all duration-200 cursor-pointer ${
                  isActive
                    ? 'border-amber-500 bg-amber-500/10 text-amber-500 glow-amber-sm'
                    : hasContent
                    ? 'border-emerald-800 bg-emerald-950/20 text-emerald-400'
                    : 'border-zinc-800 bg-zinc-900/30 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                {ch.so_chuong}
              </button>
            );
          })}
        </div>
      </div>

      {/* HỆ THỐNG DI CƯ DÀN Ý KỊCH BẢN */}
      <div className="mb-5 border-t border-zinc-900 pt-4 space-y-2">
        <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">
          DÀN Ý & CẤU TRÚC KỊCH BẢN
        </label>
        
        {/* Accordion 1: Tóm tắt chương hiện tại */}
        <div className="rounded-lg border border-zinc-900 overflow-hidden bg-zinc-950/40">
          <button
            type="button"
            onClick={() => setOpenOutlineTab(prev => prev === 'chapter' ? null : 'chapter')}
            className="w-full flex items-center justify-between px-3 py-2 bg-zinc-900/40 text-xs font-bold text-amber-500 hover:bg-zinc-900/70 transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5" />
              Tóm Tắt Chương {store.chuong_dang_chon}
            </span>
            {openOutlineTab === 'chapter' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          
          {openOutlineTab === 'chapter' && currentChapter && (
            <div className="p-3 text-[11px] leading-relaxed text-zinc-300 bg-zinc-950/90 italic border-t border-zinc-900 font-sans whitespace-pre-line max-h-32 overflow-y-auto">
              {currentChapter.dan_y || 'Chưa có dàn ý cụ thể cho chương này.'}
            </div>
          )}
        </div>

        {/* Accordion 2: Dàn ý tổng quan toàn truyện */}
        <div className="rounded-lg border border-zinc-900 overflow-hidden bg-zinc-950/40">
          <button
            type="button"
            onClick={() => setOpenOutlineTab(prev => prev === 'overall' ? null : 'overall')}
            className="w-full flex items-center justify-between px-3 py-2 bg-zinc-900/40 text-xs font-bold text-zinc-300 hover:bg-zinc-900/70 transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <Award className="h-3.5 w-3.5 text-sky-500" />
              Dàn Ý Tổng Quan
            </span>
            {openOutlineTab === 'overall' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          
          {openOutlineTab === 'overall' && (
            <div className="p-3 text-[10px] leading-relaxed text-zinc-400 bg-zinc-950/90 border-t border-zinc-900 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
              {store.dan_y_tong_the || 'Chưa có dàn ý tổng quan.'}
            </div>
          )}
        </div>

        {/* Accordion 3: Lorebook (Lõi bất biến) */}
        <div className="rounded-lg border border-zinc-900 overflow-hidden bg-zinc-950/40">
          <button
            type="button"
            onClick={() => setOpenOutlineTab(prev => prev === 'lore' ? null : 'lore')}
            className="w-full flex items-center justify-between px-3 py-2 bg-zinc-900/40 text-xs font-bold text-zinc-300 hover:bg-zinc-900/70 transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <Book className="h-3.5 w-3.5 text-emerald-500" />
              Luật Lorebook (Lõi)
            </span>
            {openOutlineTab === 'lore' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          
          {openOutlineTab === 'lore' && (
            <div className="p-3 text-[10px] leading-relaxed text-zinc-400 bg-zinc-950/90 border-t border-zinc-900 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
              {store.lorebook || 'Chưa cấu hình Lorebook.'}
            </div>
          )}
        </div>
        
      </div>

      {/* Hồ Sơ Nhân Vật Đã Phát Hiện */}
      {store.nhan_vat && store.nhan_vat.length > 0 && (
        <div className="mb-6 border-t border-zinc-900 pt-4">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2.5">
            HỒ SƠ NHÂN VẬT ĐÃ PHÁT HIỆN
          </label>
          <div className="flex flex-wrap gap-1.5">
            {store.nhan_vat.map((char, idx) => {
              const status = getCharacterProfileSetupStatus(
                store.nhan_vat_prompts?.[char],
                {
                  hasReferenceImage: !!store.generatedImages?.[charImageKey(char)],
                },
              );
              const setupDone = status.complete;
              const isSelected = editingChar === char;
              // Đỏ = chưa setup · Xanh = đủ trường + ảnh + giọng TTS
              const frameColor = setupDone ? '#10b981' : '#ef4444';
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleCharTagClick(char)}
                  className="flex items-center gap-1 rounded border-2 px-2 py-1 text-xs transition-all duration-200 cursor-pointer font-sans font-semibold"
                  style={{
                    borderColor: frameColor,
                    color: frameColor,
                    backgroundColor: setupDone
                      ? 'rgba(16, 185, 129, 0.12)'
                      : 'rgba(239, 68, 68, 0.12)',
                    boxShadow: isSelected
                      ? `0 0 0 2px ${frameColor}55, 0 0 12px ${frameColor}44`
                      : `0 0 8px ${frameColor}22`,
                  }}
                  title={
                    setupDone
                      ? `"${char}" — đã setup đủ (trường + ảnh + giọng TTS) ✓`
                      : `"${char}" — CHƯA đủ: ${status.missing.join(', ') || 'thiếu dữ liệu'}`
                  }
                >
                  <User className="h-3 w-3 shrink-0" style={{ color: frameColor }} />
                  <span>{char}</span>
                  <span className="text-[8px] font-bold uppercase opacity-80">
                    {setupDone ? 'OK' : '!'}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Form hồ sơ NV: identity lock + 4 chiều + biểu cảm */}
          {editingChar && (() => {
            // Live theo draft + ảnh sheet đã gen
            const formStatus = getCharacterProfileSetupStatus(profileDraft, {
              hasReferenceImage: !!store.generatedImages?.[charImageKey(editingChar)],
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
                  <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">Khuyết tật / thương tật</label>
                  <input
                    type="text"
                    placeholder="Mất ngón út trái, chân khập khiễng..."
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
                        const suggested = suggestVoiceFromProfile(
                          profileDraft,
                          store.ttsConfig?.platform || 'edge_tts',
                          store.ttsConfig?.language || 'vi',
                        );
                        if (suggested) {
                          patchDraft({ tts_voice: suggested });
                          store.setCharacterVoice(editingChar, suggested);
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
                      store.setCharacterVoice(editingChar, v);
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
                    <span className="text-zinc-400">{store.ttsConfig?.platform || 'edge_tts'}</span>.
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
                  {store.generatedImages?.[charImageKey(editingChar)] ? (
                    <div
                      className="relative w-full h-48 rounded-xl overflow-hidden border border-zinc-800 bg-black group cursor-zoom-in"
                      onClick={() => onImageZoom(store.generatedImages[charImageKey(editingChar)])}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={store.generatedImages[charImageKey(editingChar)]}
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
                    {store.projectUrls?.[charImageKey(editingChar)] && (
                      <button
                        type="button"
                        onClick={() => {
                          const projectUrl = store.projectUrls[charImageKey(editingChar)];
                          if (projectUrl) window.open(projectUrl, '_blank');
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
        </div>
      )}

        {/* Cụm Nút Hành Động Ở Dưới Cùng */}
        <div className="mt-auto space-y-3 pt-4 border-t border-zinc-900">

        {/* Nút Viết Lại Toàn Bộ Kịch Bản (Overwrite) */}
        <button
          type="button"
          disabled={store.dang_tai}
          onClick={() => {
            if (confirm('⚠️ Bạn có chắc chắn muốn viết lại toàn bộ kịch bản Chương này? Nội dung hiện tại của chương sẽ bị ghi đè!')) {
              void handleWriteChapter(true).catch(() => undefined); // Ghi đè toàn bộ chương
            }
          }}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/60 bg-red-500/10 py-2.5 text-xs font-bold uppercase tracking-wider text-red-500 shadow-lg transition-all duration-300 hover:bg-red-500 hover:text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-sans"
        >
          {store.dang_tai && isStreaming ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ĐANG VIẾT...
            </>
          ) : (
            <>
              Viết lại kịch bản từ đầu
            </>
          )}
        </button>

        {/* Nút Sinh Phần Tiếp Theo (Append hoặc Auto-Plan Arc) */}
        <button
          type="button"
          disabled={store.dang_tai || isPlanningArc}
          onClick={handleAppendOrPlanNextArc}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 py-3 text-xs font-bold uppercase tracking-wider text-black shadow-lg shadow-emerald-500/5 transition-all duration-300 hover:bg-emerald-400 hover:shadow-emerald-500/15 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-sans"
        >
          {store.dang_tai || isPlanningArc ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              {isPlanningArc ? 'ĐANG LÊN DÀN Ý ARC...' : 'ĐANG VIẾT...'}
            </>
          ) : (
            <>
              Sinh phần tiếp theo
            </>
          )}
        </button>

        <button
          type="button"
          disabled={store.dang_tai}
          onClick={handleResetProject}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/40 py-2.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200 cursor-pointer font-sans"
        >
          <RefreshCw className="h-3 w-3" />
          Làm Mới Dự Án
        </button>


      </div>
    </aside>
    </>
  );
}
