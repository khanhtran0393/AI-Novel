'use client';

/**
 * Thiết lập tham số AI Novel — modal rộng trong khung app.
 * Đóng bằng X hoặc Esc.
 * Portal → document.body để tránh stacking context app-work-surface chặn click.
 */
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNovelStore } from '@/store/useNovelStore';
import {
  Sparkles,
  Minus,
  Plus,
  RefreshCw,
  AlertCircle,
  X,
} from 'lucide-react';
import {
  chapterWordsMinutes,
  resolveWpm,
  totalScaleMinutes,
} from './setupScaleDuration';
import { closeSetupModal, setupModalNoDragStyle } from './closeSetupModal';

interface SetupPhaseProps {
  promptError: string;
  isGeneratingIdea: boolean;
  isGeneratingOutline?: boolean;
  handleRandomTemplate: () => Promise<void>;
  handleGenerateOutline: () => Promise<void>;
  onClose?: () => void;
}

/** 30 chủ đề (Theme) */
const THEMES = [
  { name: 'Xuyên Không', desc: 'Vượt không gian & thời gian' },
  { name: 'Trùng Sinh', desc: 'Bắt đầu lại, báo thù' },
  { name: 'Hệ Thống', desc: 'Nhiệm vụ & thăng cấp' },
  { name: 'Sinh Tồn', desc: 'Sống sót khắc nghiệt' },
  { name: 'Võ Hiệp', desc: 'Ân oán giang hồ' },
  { name: 'Trinh Thám', desc: 'Phá án bí ẩn' },
  { name: 'Dị Năng', desc: 'Siêu năng lực đột biến' },
  { name: 'Linh Khí Khôi Phục', desc: 'Linh khí trỗi dậy' },
  { name: 'Kinh Dị', desc: 'Tâm linh rùng rợn' },
  { name: 'Hài Hước', desc: 'Tấu hài giải trí' },
  { name: 'Cơ Giáp / Mecha', desc: 'Robot chiến đấu' },
  { name: 'Ngôn Tình', desc: 'Tình cảm lãng mạn' },
  { name: 'Báo Thù', desc: 'Trả nợ máu, lật bàn' },
  { name: 'Phản Công', desc: 'Từ đáy vực trỗi dậy' },
  { name: 'Nông Trường', desc: 'Xây dựng, tích lũy' },
  { name: 'Thương Chiến', desc: 'Kinh doanh thôn tính' },
  { name: 'Quân Sự', desc: 'Chiến trường, binh pháp' },
  { name: 'Cung Đấu', desc: 'Hậu cung, mưu kế' },
  { name: 'Học Đường', desc: 'Thanh xuân, cạnh tranh' },
  { name: 'Thể Thao', desc: 'Đấu trường, kỷ lục' },
  { name: 'Ẩm Thực', desc: 'Nấu nướng, vị giác' },
  { name: 'Y Học', desc: 'Cứu người, y đạo' },
  { name: 'Game / Vô Hạn Lưu', desc: 'Sảnh game, ải chết' },
  { name: 'Kỳ Ảo Mạo Hiểm', desc: 'Bí cảnh, bảo vật' },
  { name: 'Thần Thoại', desc: 'Thần linh, tận thế' },
  { name: 'Đồng Nhân', desc: 'Phóng tác IP khác' },
  { name: 'Đạo Tặc / Heist', desc: 'Cướp bóc, kế hoạch' },
  { name: 'Chính Trị', desc: 'Quyền lực, mưu sâu' },
  { name: 'Tình Báo', desc: 'Gián điệp, bí mật' },
  { name: 'Tận Thế / Di Cư', desc: 'Sụp đổ, tìm đất sống' },
] as const;

/** 30 phong cách (Style) */
const STYLES = [
  { name: 'Tu Tiên / Tiên Hiệp', desc: 'Đạo quả, tiên môn' },
  { name: 'Huyền Huyễn', desc: 'Thần thú, huyết mạch' },
  { name: 'Đô Thị', desc: 'Chiến ngầm phố thị' },
  { name: 'Viễn Tưởng', desc: 'Khoa học siêu tưởng' },
  { name: 'Mạt Thế', desc: 'Dị chủng, ngày tàn' },
  { name: 'Cổ Đại', desc: 'Lịch sử, cổ kính' },
  { name: 'Cyberpunk', desc: 'Công nghệ cao' },
  { name: 'Steampunk', desc: 'Máy móc hơi nước' },
  { name: 'Hắc Ám', desc: 'Đen tối, tàn khốc' },
  { name: 'Đồng Nhân', desc: 'Phóng tác IP' },
  { name: 'Kiếm Hiệp', desc: 'Giang hồ, võ lâm' },
  { name: 'Huyền Nghi', desc: 'Bí ẩn, giải mã' },
  { name: 'Tâm Lý Tội Phạm', desc: 'Tội ác, bóng tối' },
  { name: 'Siêu Anh Hùng', desc: 'Anh hùng đô thị' },
  { name: 'Western', desc: 'Biên giới, súng' },
  { name: 'Hải Tặc', desc: 'Biển cả, kho báu' },
  { name: 'Không Gian', desc: 'Hạm đội, hành tinh' },
  { name: 'Hậu Tận Thế', desc: 'Xây dựng lại' },
  { name: 'Đông Phương Kỳ Ảo', desc: 'Yêu ma, sơn hải' },
  { name: 'Phương Tây Kỳ Ảo', desc: 'Phù thủy, rồng' },
  { name: 'LitRPG', desc: 'Level, skill, dungeon' },
  { name: 'Isekai', desc: 'Dị giới chuyển sinh' },
  { name: 'Noir', desc: 'Thám tử, u ám' },
  { name: 'Slice of Life', desc: 'Đời thường nhẹ' },
  { name: 'Epic / Sử Thi', desc: 'Vận mệnh thế giới' },
  { name: 'Gothic', desc: 'Lâu đài, u sầu' },
  { name: 'Post-Apocalypse', desc: 'Hoang tàn, sinh tồn' },
  { name: 'Military Sci-Fi', desc: 'Quân sự tương lai' },
  { name: 'Romantasy', desc: 'Lãng mạn kỳ ảo' },
  { name: 'Hard Sci-Fi', desc: 'Khoa học nghiêm' },
] as const;

export default function SetupPhase({
  promptError,
  isGeneratingIdea,
  isGeneratingOutline = false,
  handleRandomTemplate,
  handleGenerateOutline,
  onClose,
}: SetupPhaseProps) {
  const store = useNovelStore();

  const handleClose = (e?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    // Direct store write — no dependency on parent onClose
    closeSetupModal(onClose);
    console.info('[SetupPhase] close → giai_doan=', useNovelStore.getState().giai_doan);
  };

  const handleAdjustChapters = (amount: number) => {
    const nextVal = Math.max(1, Math.min(1000, store.setup.so_chuong + amount));
    store.setSetup({ so_chuong: nextVal });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleClose(e);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const modal = (
    <div
      className="fixed inset-0 z-[9999] flex items-stretch justify-center bg-black/75 p-2 sm:p-3 md:p-4"
      style={
        {
          paddingTop: 'calc(var(--app-chrome-h, 32px) + 8px)',
          ...setupModalNoDragStyle,
        } as React.CSSProperties
      }
      role="dialog"
      aria-modal="true"
      aria-labelledby="setup-params-title"
      data-setup-modal="classic"
      onClick={(e) => {
        // Click nền (không phải panel) → đóng
        if (e.target === e.currentTarget) handleClose(e);
      }}
    >
      {/* Khung rộng gần full app work area */}
      <div
        className="relative flex h-full w-full max-w-[min(96rem,100%)] flex-col overflow-hidden rounded-[var(--app-radius-lg)] border border-zinc-800/90 bg-zinc-950 shadow-2xl shadow-amber-500/10"
        style={setupModalNoDragStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: title + X */}
        <div
          className="relative flex shrink-0 items-center gap-3 border-b border-zinc-800/80 bg-zinc-950 px-3 py-2.5 sm:px-4 sm:py-3"
          style={setupModalNoDragStyle}
        >
          <div className="min-w-0 flex-1">
            <h2
              id="setup-params-title"
              className="truncate text-[clamp(12px,1.5vw,15px)] font-bold leading-snug tracking-wide text-amber-400 uppercase"
            >
              Setup · Tham số AI Novel
            </h2>
          </div>
          <button
            type="button"
            id="setup-modal-close-x"
            data-testid="setup-close-x"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleClose(e);
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleClose(e);
            }}
            className="relative z-[100] inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-600 bg-zinc-800 text-white transition-colors hover:border-red-500 hover:bg-red-950/50 hover:text-red-400 cursor-pointer select-none"
            style={setupModalNoDragStyle}
            title="Đóng (Esc)"
            aria-label="Đóng"
          >
            <X className="pointer-events-none h-5 w-5" strokeWidth={2.5} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 md:p-5 space-y-4">
          {/* 1. Chủ đề — tên gọn */}
          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-amber-500">
              1. Chủ đề
            </label>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {THEMES.map((theme) => (
                <button
                  key={theme.name}
                  type="button"
                  onClick={() => store.setSetup({ chu_de: theme.name })}
                  title={theme.desc}
                  className={`flex flex-col items-start rounded-md border px-2 py-1.5 text-left transition-all ${
                    store.setup.chu_de === theme.name
                      ? 'border-amber-500 bg-amber-500/10'
                      : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
                  }`}
                >
                  <span className="text-[11px] font-semibold text-zinc-100 leading-tight line-clamp-2">
                    {theme.name}
                  </span>
                  <span className="mt-0.5 text-[9px] text-zinc-500 leading-snug line-clamp-1">
                    {theme.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 2. Phong cách — tên gọn */}
          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-sky-400">
              2. Phong cách
            </label>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {STYLES.map((style) => (
                <button
                  key={style.name}
                  type="button"
                  onClick={() => store.setSetup({ phong_cach: style.name })}
                  title={style.desc}
                  className={`flex flex-col items-start rounded-md border px-2 py-1.5 text-left transition-all ${
                    store.setup.phong_cach === style.name
                      ? 'border-sky-500 bg-sky-500/10'
                      : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
                  }`}
                >
                  <span className="text-[11px] font-semibold text-zinc-100 leading-tight line-clamp-2">
                    {style.name}
                  </span>
                  <span className="mt-0.5 text-[9px] text-zinc-500 leading-snug line-clamp-1">
                    {style.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 3. Cốt truyện */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                3. Cốt truyện
              </label>
              <button
                type="button"
                onClick={() => void handleRandomTemplate()}
                disabled={isGeneratingIdea}
                className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-amber-500 hover:text-amber-400 disabled:opacity-40"
              >
                <Sparkles className="h-3 w-3" />
                AI ý tưởng
              </button>
            </div>
            <textarea
              rows={4}
              placeholder="Bối cảnh cốt truyện... hoặc bấm AI ý tưởng. (Link YouTube nằm ở sidebar.)"
              value={store.setup.mo_ta}
              onChange={(e) => store.setSetup({ mo_ta: e.target.value })}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-amber-500 focus:bg-zinc-950 font-sans"
            />
            {promptError ? (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-red-500">
                <AlertCircle className="h-3.5 w-3.5" />
                {promptError}
              </p>
            ) : null}
          </div>

          {/* 4. Quy mô */}
          {(() => {
            const wpm = resolveWpm(store.wpm);
            const wordsPer = store.setup.so_tu_chuong || 4250;
            const chapters = Number(store.setup.so_chuong) > 0 ? Number(store.setup.so_chuong) : 0;
            const perChapter = chapterWordsMinutes(wordsPer, wpm);
            const total = totalScaleMinutes(chapters, wordsPer, wpm);
            return (
          <div className="rounded-lg border border-zinc-900 bg-zinc-900/20 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                4. Quy mô
              </label>
              <span
                className="text-[9px] font-semibold text-zinc-500"
                title="Cài đặt Tốc độ đọc (WPM) trong Header / media — dùng để quy đổi từ → phút"
              >
                Tốc độ đọc: {wpm} WPM
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-amber-500">
                  <span className="h-1 w-1 rounded-full bg-amber-500" /> Chương
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={store.setup.so_chuong}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val) && val > 0) store.setSetup({ so_chuong: val });
                      else if (e.target.value === '') {
                        store.setSetup({ so_chuong: '' as unknown as number });
                      }
                    }}
                    onBlur={() => {
                      if (!store.setup.so_chuong || store.setup.so_chuong < 1) {
                        store.setSetup({ so_chuong: 1 });
                      }
                    }}
                    className="w-full rounded border border-zinc-800 bg-black p-2.5 pr-8 text-center text-xl font-extrabold text-zinc-100 outline-none focus:border-amber-500"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-0.5">
                    <button type="button" onClick={() => handleAdjustChapters(1)} className="text-zinc-500 hover:text-white">
                      <Plus className="h-3 w-3" />
                    </button>
                    <button type="button" onClick={() => handleAdjustChapters(-1)} className="text-zinc-500 hover:text-white">
                      <Minus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <p
                  className="mt-1.5 text-center text-[10px] font-bold tabular-nums text-amber-400/90"
                  title={`${chapters} chương × ${wordsPer} từ = ${total.totalWords} từ ÷ ${wpm} WPM`}
                >
                  Tổng dự tính: {total.label}
                </p>
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-emerald-500">
                  <span className="h-1 w-1 rounded-full bg-emerald-500" /> Từ/chương
                </label>
                <input
                  type="number"
                  min={500}
                  max={10000}
                  step={500}
                  value={store.setup.so_tu_chuong || 4250}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val > 0) store.setSetup({ so_tu_chuong: val });
                    else if (e.target.value === '') {
                      store.setSetup({ so_tu_chuong: '' as unknown as number });
                    }
                  }}
                  onBlur={() => {
                    if (!store.setup.so_tu_chuong || store.setup.so_tu_chuong < 500) {
                      store.setSetup({ so_tu_chuong: 4250 });
                    }
                  }}
                  className="w-full rounded border border-zinc-800 bg-black p-2.5 text-center text-xl font-extrabold text-zinc-100 outline-none focus:border-emerald-500"
                />
                <p
                  className="mt-1.5 text-center text-[10px] font-bold tabular-nums text-emerald-400/90"
                  title={`${wordsPer} từ ÷ ${wpm} WPM = thời lượng đọc 1 chương`}
                >
                  ≈ {perChapter.label}/chương
                </p>
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-sky-500">
                  <span className="h-1 w-1 rounded-full bg-sky-500" /> Ngôn ngữ
                </label>
                <select
                  value={store.setup.ngon_ngu || 'Tiếng Việt'}
                  onChange={(e) => store.setSetup({ ngon_ngu: e.target.value })}
                  className="w-full rounded border border-zinc-800 bg-black p-2.5 text-sm font-bold text-zinc-100 outline-none focus:border-sky-500 cursor-pointer"
                >
                  {/* 20 ngôn ngữ phổ biến nhất (nội dung / người nói) */}
                  <option value="Tiếng Việt">Tiếng Việt</option>
                  <option value="English">English</option>
                  <option value="中文 (Chinese)">中文 · Chinese</option>
                  <option value="Español (Spanish)">Español · Spanish</option>
                  <option value="हिन्दी (Hindi)">हिन्दी · Hindi</option>
                  <option value="العربية (Arabic)">العربية · Arabic</option>
                  <option value="Português (Portuguese)">Português · Portuguese</option>
                  <option value="বাংলা (Bengali)">বাংলা · Bengali</option>
                  <option value="Русский (Russian)">Русский · Russian</option>
                  <option value="日本語 (Japanese)">日本語 · Japanese</option>
                  <option value="Français (French)">Français · French</option>
                  <option value="Deutsch (German)">Deutsch · German</option>
                  <option value="한국어 (Korean)">한국어 · Korean</option>
                  <option value="Bahasa Indonesia">Bahasa Indonesia</option>
                  <option value="Italiano (Italian)">Italiano · Italian</option>
                  <option value="Türkçe (Turkish)">Türkçe · Turkish</option>
                  <option value="ไทย (Thai)">ไทย · Thai</option>
                  <option value="Polski (Polish)">Polski · Polish</option>
                  <option value="Nederlands (Dutch)">Nederlands · Dutch</option>
                  <option value="Українська (Ukrainian)">Українська · Ukrainian</option>
                </select>
              </div>
            </div>
          </div>
            );
          })()}

          {/* 5. YouTube-safe — tên gọn */}
          <div className="rounded-lg border border-red-900/50 bg-red-950/10 p-3">
            <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-red-500">
              <AlertCircle className="h-3.5 w-3.5" />
              5. Chống AI & YT-Safe
            </label>
            <div className="space-y-2.5">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[9px] font-bold uppercase text-red-400">
                    Từ cấm
                  </label>
                  <input
                    type="text"
                    placeholder="đáng chú ý là, nhìn chung..."
                    value={store.userRules.forbidden_words}
                    onChange={(e) => store.updateUserRules({ forbidden_words: e.target.value })}
                    className="w-full rounded border border-red-900/50 bg-black p-2 text-[12px] text-zinc-200 outline-none focus:border-red-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[9px] font-bold uppercase text-orange-400">
                    Từ sáo
                  </label>
                  <input
                    type="text"
                    placeholder="không khỏi, dường như..."
                    value={store.userRules.fatigue_words}
                    onChange={(e) => store.updateUserRules({ fatigue_words: e.target.value })}
                    className="w-full rounded border border-orange-900/50 bg-black p-2 text-[12px] text-zinc-200 outline-none focus:border-orange-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
                {(
                  [
                    ['enforceEditorGate', 'Chặn TTS Editor'],
                    ['requireHumanEdit', 'Human Pass'],
                    ['humanizeScript', 'Humanize'],
                    ['autoAudioReadability', 'Nhịp audio'],
                    ['injectBreathPauses', 'Nghỉ thở'],
                    ['roomTone', 'Room tone'],
                    ['bgmMix', 'BGM bed'],
                    ['emotionTts', 'Pitch emotion'],
                    ['applyLoudnorm', 'Loudnorm'],
                    ['lockSeriesVoice', 'Voice DNA'],
                    ['enforceShotGraph', 'Shot graph'],
                    ['enforceAntiReuse', 'Anti-reuse'],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-1.5 rounded border border-zinc-800 bg-black/50 px-2 py-1.5 cursor-pointer hover:border-zinc-700"
                  >
                    <input
                      type="checkbox"
                      className="accent-emerald-500 shrink-0"
                      checked={!!(store.youtubeSafe || {})[key as keyof typeof store.youtubeSafe]}
                      onChange={(e) => store.updateYoutubeSafe({ [key]: e.target.checked })}
                    />
                    <span className="text-[10px] text-zinc-300 leading-tight">{label}</span>
                  </label>
                ))}
              </div>
              {store.youtubeSafe?.bgmMix ? (
                <div>
                  <label className="mb-1 block text-[9px] font-bold uppercase text-zinc-400">
                    BGM path
                  </label>
                  <input
                    type="text"
                    placeholder="D:\music\ambient_bed.mp3"
                    value={store.youtubeSafe?.bgmPath || ''}
                    onChange={(e) => store.updateYoutubeSafe({ bgmPath: e.target.value })}
                    className="w-full rounded border border-zinc-800 bg-black p-2 text-[12px] text-zinc-200 outline-none focus:border-amber-500"
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Footer: chỉ CTA sinh kịch bản — đóng bằng nút X (header) / Esc / click nền */}
        <div
          className="shrink-0 border-t border-zinc-800/80 bg-zinc-950 p-3 sm:px-4"
          style={setupModalNoDragStyle}
        >
          <button
            type="button"
            disabled={isGeneratingOutline}
            onClick={() => void handleGenerateOutline()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 py-3 text-sm font-bold uppercase tracking-wider text-black shadow-lg shadow-amber-500/10 transition-all hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
            style={setupModalNoDragStyle}
            title="Nút riêng — không khóa gen NV / viết chương"
          >
            {isGeneratingOutline ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Đang thiết lập dàn ý...
              </>
            ) : (
              <>🚀 TIẾN HÀNH SINH KỊCH BẢN AI</>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return modal;
  return createPortal(modal, document.body);
}
