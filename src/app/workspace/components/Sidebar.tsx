'use client';

import React, { useState } from 'react';
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
  Activity,
  UploadCloud
} from 'lucide-react';
import { planArcAction } from '../modules/writeModule';
import { computeStyleStats, StyleStats } from '../modules/styleStatModule';
import StyleStatModal from './StyleStatModal';
import ImportModal from './ImportModal';

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

  // Trạng thái mở rộng accordions của Dàn ý bên trái
  const [openOutlineTab, setOpenOutlineTab] = useState<'chapter' | 'overall' | 'lore' | null>('chapter');
  const [isPlanningArc, setIsPlanningArc] = useState(false);

  const handlePlanNextArc = async () => {
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
      }
    } catch (err) {
      console.error("Lỗi khi lập kế hoạch cung mới:", err);
      alert("Lỗi khi lên kế hoạch: " + (err as Error).message);
    } finally {
      setIsPlanningArc(false);
    }
  };
  
  
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [styleStats, setStyleStats] = useState<StyleStats | null>(null);

  const handleScanStyle = () => {
    const stats = computeStyleStats(store.danh_sach_chuong);
    if (!stats) {
      alert("Chưa có đủ nội dung chương hợp lệ để quét văn phong.");
      return;
    }
    setStyleStats(stats);
  };

  // Khởi động các Custom Hooks hành động mô-đun hóa sạch sẽ
  const { handleResetProject } = useProjectActions('');
  const {
    editingChar,
    setEditingChar,
    gioiTinh,
    setGioiTinh,
    quanAo,
    setQuanAo,
    soThich,
    setSoThich,
    thoiQuen,
    setThoiQuen,
    charPrompt,
    setCharPrompt,
    generatingCharPrompt,
    generatingCharImage,
    regeneratingCharPromptOnly,
    handleCharTagClick,
    handleGenerateCharPrompt,
    handleRegenerateCharPromptOnly,
    handleGenerateCharImage,
    handleSaveChar
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
        
        {/* Nút lập kế hoạch Arc tiếp theo */}
        <button
          type="button"
          disabled={isPlanningArc}
          onClick={handlePlanNextArc}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded bg-sky-500/20 px-3 py-2 text-xs font-bold text-sky-400 hover:bg-sky-500/30 transition-colors disabled:opacity-50"
        >
          {isPlanningArc ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <PlusCircle className="h-3.5 w-3.5" />}
          LÊN DÀN Ý CUNG (ARC) TIẾP THEO
        </button>
      </div>

      {/* Hồ Sơ Nhân Vật Đã Phát Hiện */}
      {store.nhan_vat && store.nhan_vat.length > 0 && (
        <div className="mb-6 border-t border-zinc-900 pt-4">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2.5">
            HỒ SƠ NHÂN VẬT ĐÃ PHÁT HIỆN
          </label>
          <div className="flex flex-wrap gap-1.5">
            {store.nhan_vat.map((char, idx) => {
              const hasPrompt = !!store.nhan_vat_prompts?.[char]?.prompt;
              const isSelected = editingChar === char;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleCharTagClick(char)}
                  className={`flex items-center gap-1 rounded border px-2 py-1 text-xs transition-all duration-200 cursor-pointer font-sans ${
                    isSelected
                      ? 'border-amber-500 bg-amber-500/20 text-amber-400 shadow-md shadow-amber-500/10'
                      : hasPrompt 
                      ? 'bg-emerald-950/20 border-emerald-800/80 text-emerald-400 hover:bg-emerald-900/30'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:text-white'
                  }`}
                  title={`Bấm để cấu hình tạo hình/prompt cho nhân vật "${char}"`}
                >
                  <User className={`h-3 w-3 ${hasPrompt ? 'text-emerald-500' : 'text-amber-500'}`} />
                  <span>{char}</span>
                </button>
              );
            })}
          </div>

          {/* Form Soạn Thảo Hồ Sơ Nhân Vật Co Giãn Trực Tiếp Ở Sidebar Trái */}
          {editingChar && (
            <div className="mt-3 rounded-lg border border-amber-900/40 bg-amber-950/10 p-3 space-y-3 animate-in slide-in-from-top-2 duration-200">
              <div className="flex items-center justify-between border-b border-zinc-900/60 pb-1.5">
                <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest font-sans flex items-center gap-1">
                  👤 Cấu hình: {editingChar}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingChar(null)}
                  className="text-[9px] text-zinc-500 hover:text-zinc-300 font-sans uppercase font-bold cursor-pointer"
                >
                  Thu nhỏ
                </button>
              </div>
              
              <div className="space-y-2 text-xs">
                <div className="flex flex-col gap-1">
                  <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest font-sans">Giới tính</label>
                  <input
                    type="text"
                    placeholder="VD: Nam, Nữ, Phi giới tính..."
                    value={gioiTinh}
                    onChange={(e) => setGioiTinh(e.target.value)}
                    className="h-7 w-full rounded border border-zinc-800 bg-black/60 px-2 text-[11px] text-zinc-300 outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest font-sans">Trang phục</label>
                  <input
                    type="text"
                    placeholder="VD: Áo măng tô rách, mắt kính bảo hộ..."
                    value={quanAo}
                    onChange={(e) => setQuanAo(e.target.value)}
                    className="h-7 w-full rounded border border-zinc-800 bg-black/60 px-2 text-[11px] text-zinc-300 outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest font-sans">Sở thích</label>
                  <input
                    type="text"
                    placeholder="VD: Nghiên cứu thiết bị cơ khí..."
                    value={soThich}
                    onChange={(e) => setSoThich(e.target.value)}
                    className="h-7 w-full rounded border border-zinc-800 bg-black/60 px-2 text-[11px] text-zinc-300 outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest font-sans">Thói quen</label>
                  <input
                    type="text"
                    placeholder="VD: Hút thuốc điện tử, gãi vết sẹo..."
                    value={thoiQuen}
                    onChange={(e) => setThoiQuen(e.target.value)}
                    className="h-7 w-full rounded border border-zinc-800 bg-black/60 px-2 text-[11px] text-zinc-300 outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex flex-col gap-1 pt-1 border-t border-zinc-900">
                  <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                    <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest font-sans">Prompt tạo hình</label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={generatingCharPrompt}
                        onClick={() => handleGenerateCharPrompt(editingChar)}
                        className="text-[8px] font-bold text-amber-500 hover:text-amber-400 transition-colors uppercase flex items-center gap-0.5 cursor-pointer disabled:opacity-50"
                        title="Tự động phân tích truyện để sinh toàn bộ thông tin hồ sơ nhân vật (Giới tính, Trang phục, Sở thích...) bằng AI"
                      >
                        {generatingCharPrompt ? 'Đang viết...' : '✨ Gen Prompt AI'}
                      </button>
                      <span className="text-zinc-700 text-[9px] select-none">|</span>
                      <button
                        type="button"
                        disabled={regeneratingCharPromptOnly}
                        onClick={() => handleRegenerateCharPromptOnly(editingChar)}
                        className="text-[8px] font-bold text-sky-400 hover:text-sky-350 transition-colors uppercase flex items-center gap-0.5 cursor-pointer disabled:opacity-50"
                        title="Chỉ tạo lại prompt vẽ ảnh tiếng Anh an toàn nếu bị lỗi vi phạm bộ lọc chính sách"
                      >
                        {regeneratingCharPromptOnly ? 'Đang tạo lại...' : '🔄 Tạo lại Prompt'}
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={3}
                    placeholder="Prompt vẽ concept art bằng tiếng Anh của nhân vật làm ảnh tham chiếu..."
                    value={charPrompt}
                    onChange={(e) => setCharPrompt(e.target.value)}
                    className="w-full rounded border border-zinc-800 bg-black/60 p-2 text-[10px] text-zinc-300 font-mono leading-relaxed outline-none focus:border-amber-500 font-sans"
                  />
                </div>

                {/* Ảnh chân dung Concept Art */}
                <div className="flex flex-col gap-1.5 pt-2 border-t border-zinc-900/60">
                  <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest font-sans">Ảnh Chân Dung Concept Art</label>
                  {store.generatedImages?.[`char_${editingChar}`] ? (
                    <div className="relative w-full h-40 rounded-xl overflow-hidden border border-zinc-800 bg-black group cursor-zoom-in" onClick={() => onImageZoom(store.generatedImages[`char_${editingChar}`])}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={store.generatedImages[`char_${editingChar}`]}
                        alt={`Concept Art ${editingChar}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="text-[9px] text-zinc-300 font-bold uppercase tracking-widest">Ảnh Tham Chiếu AI</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center w-full h-20 rounded-lg border border-dashed border-zinc-800 bg-black/20 text-center p-2">
                      <p className="text-[9px] text-zinc-500 leading-normal">Chưa có ảnh chân dung AI.<br/>Bấm nút &quot;Gen Ảnh&quot; bên dưới để tạo.</p>
                    </div>
                  )}
                </div>
                
                <div className="flex items-center justify-between gap-1.5 pt-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={generatingCharImage}
                      onClick={() => handleGenerateCharImage(editingChar)}
                      className="rounded bg-gradient-to-r from-amber-500 to-orange-600 px-3 py-1 text-[10px] font-bold uppercase text-black hover:scale-105 active:scale-95 transition-all duration-300 cursor-pointer disabled:opacity-50 flex items-center gap-1 font-sans"
                    >
                      {generatingCharImage ? 'Đang vẽ...' : '🎨 Gen Ảnh'}
                    </button>
                    {store.projectUrls?.[`char_${editingChar}`] && (
                      <button
                        type="button"
                        onClick={() => {
                          const projectUrl = store.projectUrls[`char_${editingChar}`];
                          if (projectUrl) window.open(projectUrl, '_blank');
                        }}
                        className="text-[9px] font-bold uppercase text-zinc-400 hover:text-amber-500 transition-colors flex items-center gap-0.5 cursor-pointer font-sans"
                        title="Mở xem quá trình khởi tạo ảnh trên Google Flow"
                      >
                        🌐 Mở Link
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditingChar(null)}
                      className="rounded border border-zinc-800 bg-zinc-900/40 px-2.5 py-1 text-[10px] font-bold uppercase text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 transition-colors cursor-pointer"
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveChar(editingChar)}
                      className="rounded bg-emerald-500 px-3 py-1 text-[10px] font-bold uppercase text-black hover:bg-emerald-400 transition-colors cursor-pointer"
                    >
                      Lưu hồ sơ
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

        {/* Cụm Nút Hành Động Ở Dưới Cùng */}
        <div className="mt-auto space-y-3 pt-4 border-t border-zinc-900">

        {/* HỆ SINH THÁI CAP-ASSISTANT */}
        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleScanStyle}
            className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-rose-900/50 bg-rose-950/20 py-3 text-rose-400 hover:bg-rose-900/40 hover:text-rose-300 transition-colors"
          >
            <Activity className="h-5 w-5" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-center">Radar<br/>Văn Phong</span>
          </button>
          <button
            type="button"
            onClick={() => setIsImportModalOpen(true)}
            className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-emerald-900/50 bg-emerald-950/20 py-3 text-emerald-400 hover:bg-emerald-900/40 hover:text-emerald-300 transition-colors"
          >
            <UploadCloud className="h-5 w-5" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-center">Kế Thừa<br/>Di Sản</span>
          </button>
        </div>

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

        {/* Nút Sinh Phần Tiếp Theo (Append) */}
        <button
          type="button"
          disabled={store.dang_tai}
          onClick={() => { void handleWriteChapter(false).catch(() => undefined); }}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 py-3 text-xs font-bold uppercase tracking-wider text-black shadow-lg shadow-emerald-500/5 transition-all duration-300 hover:bg-emerald-400 hover:shadow-emerald-500/15 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-sans"
        >
          {store.dang_tai && isStreaming ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ĐANG VIẾT...
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

    <StyleStatModal 
      stats={styleStats} 
      onClose={() => setStyleStats(null)} 
    />

    <ImportModal 
      isOpen={isImportModalOpen} 
      onClose={() => setIsImportModalOpen(false)} 
    />
    </>
  );
}
