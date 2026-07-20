'use client';

/**
 * Viết Tiếp Kịch Bản — 2 trường hợp:
 * 1) Viết lại kịch bản (kịch bản hoàn thiện có sẵn) — Setup-like
 * 2) Kế thừa di sản (import truyện cũ)
 *
 * Chung: 1. Dán nội dung · 2. Nút Tóm gọn dàn ý → cốt truyện
 * Viết lại: quy mô + sinh dàn ý mới
 * Di sản: nạp foundation (NV, lore, dàn ý) vào store
 */
import React, { useEffect, useState } from 'react';
import { useNovelStore, type Chuong } from '@/store/useNovelStore';
import {
  AlertCircle,
  FileText,
  Library,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  generateOutlineAction,
  getFriendlyErrorMessage,
  importFoundationAction,
  summarizeScriptOutlineAction,
} from '../../modules/setupModule';
import {
  chapterWordsMinutes,
  resolveWpm,
  totalScaleMinutes,
} from './setupScaleDuration';
import { toast } from '@/lib/toastBus';

export type ContinueMode = 'rewrite' | 'legacy';

interface ContinueScriptPhaseProps {
  isOpen: boolean;
  onClose: () => void;
  /** Mở thẳng một tab; mặc định rewrite */
  initialMode?: ContinueMode;
}

function pickStr(data: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function parseCharacterNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) out.push(item.trim());
    else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const name =
        (typeof o.ten === 'string' && o.ten) ||
        (typeof o.name === 'string' && o.name) ||
        '';
      if (name.trim()) out.push(name.trim());
    }
  }
  return out;
}

export default function ContinueScriptPhase({
  isOpen,
  onClose,
  initialMode = 'rewrite',
}: ContinueScriptPhaseProps) {
  const store = useNovelStore();
  const [mode, setMode] = useState<ContinueMode>(initialMode);
  const [pasted, setPasted] = useState('');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  /** % trùng ý tưởng mẫu — mặc định 80, đồng bộ store để giữ khi mở lại */
  const sim = store.youtubeSimilarityTarget ?? 80;

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError('');
    }
  }, [isOpen, initialMode]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isWorking && !isSummarizing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isWorking, isSummarizing, onClose]);

  if (!isOpen) return null;

  // Busy cục bộ modal — không store.dang_tai (tránh khóa nút workspace)
  const busy = isWorking || isSummarizing;

  const handleAdjustChapters = (amount: number) => {
    const free =
      !store.is_pro && !store.is_trial && !store.is_vip;
    const maxCh = free ? 2 : 1000;
    const nextVal = Math.max(1, Math.min(maxCh, store.setup.so_chuong + amount));
    store.setSetup({ so_chuong: nextVal });
  };

  const handleTomGon = async () => {
    const text = pasted.trim();
    if (text.length < 80) {
      const msg = '⚠️ Dán kịch bản/truyện (≥80 ký tự) ở mục 1 trước khi tóm gọn.';
      setError(msg);
      toast.warn('Tóm gọn', msg.replace(/^⚠️\s*/, ''));
      return;
    }
    setError('');
    setIsSummarizing(true);
    toast.info('Tóm gọn', 'Đang tóm cốt truyện / dàn ý…');
    try {
      const res = await summarizeScriptOutlineAction({ textContent: text });
      setSummary(res.mo_ta);
      store.setSetup({ mo_ta: res.mo_ta });
      if (res.tieu_de_goi_y && !(store.ten_tac_pham || '').trim()) {
        store.updateTenTacPham(res.tieu_de_goi_y);
      }
      toast.success('Tóm gọn', 'Đã tóm gọn dàn ý / cốt truyện.');
    } catch (err: unknown) {
      const friendly = getFriendlyErrorMessage(err);
      setError(friendly);
      toast.error('Tóm gọn', friendly.slice(0, 220));
    } finally {
      setIsSummarizing(false);
    }
  };

  /** Apply IMPORT_FOUNDATION result → store */
  const applyFoundation = (foundation: Record<string, unknown>) => {
    if (typeof foundation.mo_ta === 'string' && foundation.mo_ta.trim()) {
      store.setSetup({ mo_ta: foundation.mo_ta.trim() });
      setSummary(foundation.mo_ta.trim());
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chars = foundation.nhan_vat as any[] | undefined;
    if (Array.isArray(chars) && chars.length) {
      const names = chars
        .map((c) => String(c?.name || c?.ten || '').trim())
        .filter(Boolean);
      if (names.length) store.updateNhanVat(names);
      for (const c of chars) {
        const name = String(c?.name || c?.ten || '').trim();
        if (!name) continue;
        store.updateNhanVatPrompt(name, {
          gioi_tinh: c.gioi_tinh || '',
          tuoi: c.tuoi || '',
          dang_nguoi: c.dang_nguoi || '',
          vai_tro: c.vai_tro || '',
          quan_ao: c.quan_ao || '',
          so_thich: c.so_thich || '',
          thoi_quen: c.thoi_quen || '',
          dong_co: c.dong_co || '',
          giong_thoai: c.giong_thoai || '',
          ngoai_hinh: c.ngoai_hinh || '',
          dac_diem_nhan_dang: c.dac_diem_nhan_dang || '',
          khuet_tat: c.khuet_tat || '',
          prompt: c.prompt || '',
          angle_prompts: c.angle_prompts || {},
          expression_prompts: c.expression_prompts || {},
        });
      }
    }

    if (foundation.lorebook) {
      const lore =
        typeof foundation.lorebook === 'string'
          ? foundation.lorebook
          : Object.entries(foundation.lorebook as Record<string, unknown>)
              .map(([k, v]) => `## ${k}\n${String(v)}`)
              .join('\n\n');
      if (lore.trim()) store.updateLorebook(lore);
    }

    if (foundation.dan_y_tong_the) {
      const outlineStr = Array.isArray(foundation.dan_y_tong_the)
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (foundation.dan_y_tong_the as any[])
            .map(
              (arc) =>
                `### ${arc.ten_cung || arc.title || 'Cung'}\n- Mục tiêu: ${arc.muc_tieu || ''}\n- Mô tả: ${arc.mo_ta || ''}`,
            )
            .join('\n\n')
        : typeof foundation.dan_y_tong_the === 'string'
          ? foundation.dan_y_tong_the
          : JSON.stringify(foundation.dan_y_tong_the, null, 2);
      if (outlineStr.trim()) store.updateDanYTongThe(outlineStr);
    }
  };

  const handleLegacyImport = async () => {
    const text = pasted.trim();
    if (!text) {
      const msg = '⚠️ Dán nội dung truyện cũ ở mục 1.';
      setError(msg);
      toast.warn('Kế thừa di sản', msg.replace(/^⚠️\s*/, ''));
      return;
    }
    setError('');
    setIsWorking(true);
    toast.info('Kế thừa di sản', 'Đang phân tích & nạp foundation…');
    try {
      const foundation = await importFoundationAction({ textContent: text });
      applyFoundation(foundation);
      store.setGiaiDoan(2);
      toast.success(
        'Kế thừa di sản',
        'Bối cảnh, nhân vật và dàn ý đã được nạp.',
      );
      onClose();
    } catch (err: unknown) {
      const friendly = getFriendlyErrorMessage(err);
      setError(friendly);
      toast.error('Kế thừa di sản', friendly.slice(0, 220));
    } finally {
      setIsWorking(false);
    }
  };

  const handleRewriteGenerate = async () => {
    const moTa = (summary || store.setup.mo_ta || '').trim();
    if (!moTa || moTa.length < 40) {
      const msg =
        '⚠️ Bấm «Tóm gọn dàn ý» (mục 2) hoặc dán/chỉnh cốt truyện tóm trước khi sinh kịch bản.';
      setError(msg);
      toast.warn('Sinh viết lại', msg.replace(/^⚠️\s*/, ''));
      return;
    }

    const soChuongN = Number(store.setup.so_chuong);
    const soChuong =
      Number.isFinite(soChuongN) && soChuongN >= 1
        ? Math.min(500, Math.round(soChuongN))
        : 10;
    const soTuN = Number(store.setup.so_tu_chuong);
    const soTu =
      Number.isFinite(soTuN) && soTuN >= 500
        ? Math.min(10000, Math.round(soTuN))
        : 4250;
    const simTarget = Math.max(
      10,
      Math.min(100, Math.round(store.youtubeSimilarityTarget ?? 80)),
    );
    store.setSetup({
      mo_ta: moTa,
      so_chuong: soChuong,
      so_tu_chuong: soTu,
      chu_de: 'Viết lại kịch bản có sẵn',
      phong_cach: `Trùng ý tưởng mẫu ~${simTarget}%`,
    });

    setError('');
    setIsWorking(true);
    toast.info('Sinh viết lại', `Đang tạo dàn ý ~${simTarget}% trùng mẫu…`);
    try {
      const live = useNovelStore.getState();
      // Excerpt kịch bản dán để AI canh % trùng (không dump full)
      const sourceExcerpt = (pasted || '').trim().slice(0, 4500);
      const data = (await generateOutlineAction({
        apiKey: live.apiKey,
        apiKeys: live.apiKeys || [],
        setupData: {
          ...live.setup,
          mo_ta: moTa,
          so_chuong: soChuong,
          so_tu_chuong: soTu,
          chu_de: 'Viết lại kịch bản có sẵn',
          phong_cach: `Trùng ý tưởng mẫu ~${simTarget}%`,
        },
        youtubeRewrite: {
          enabled: true,
          similarityTarget: simTarget,
          sourceTitle: live.ten_tac_pham || 'Kịch bản dán',
          sourceKind: 'script',
          captionCache: sourceExcerpt || moTa.slice(0, 4500),
        },
      })) as Record<string, unknown>;

      const title = pickStr(data, ['tieu_de', 'title', 'ten_tac_pham']);
      const outline = pickStr(data, [
        'dan_y_tong_the',
        'outline',
        'dan_y',
        'world_outline',
      ]);
      let characters = parseCharacterNames(data.nhan_vat ?? data.characters);
      if (characters.length === 0 && title) characters = ['Nhân vật chính'];
      if (!title || !outline) {
        throw new Error('AI không trả đủ tiêu đề / dàn ý. Thử tóm gọn lại rồi sinh.');
      }

      store.updateTenTacPham(title);
      store.updateDanYTongThe(outline);
      store.updateNhanVat(characters);
      if (data.lorebook) store.updateLorebook(data.lorebook as string);
      if (data.tom_tat_cuon_chieu) {
        store.updateTomTatCuonChieu(data.tom_tat_cuon_chieu as string);
      }
      if (data.tri_nho_ngan_han) {
        store.updateTriNhoNganHan(data.tri_nho_ngan_han as string[]);
      }
      if (data.world_state) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        store.updateWorldState(data.world_state as any);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawChapters = Array.isArray(data.danh_sach_chuong)
        ? (data.danh_sach_chuong as any[])
        : [];
      if (!rawChapters.length) {
        throw new Error('AI không trả danh_sach_chuong. Thử giảm số chương.');
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const converted: Chuong[] = rawChapters.map((ch: any, idx: number) => {
        const parsedSo = parseInt(
          String(ch?.so_chuong ?? idx + 1).replace(/\D/g, ''),
          10,
        );
        const so_chuong = Number.isFinite(parsedSo) && parsedSo > 0 ? parsedSo : idx + 1;
        const tieu_de = String(ch?.tieu_de ?? ch?.title ?? `Chương ${so_chuong}`).trim();
        const dan_y = String(ch?.dan_y ?? ch?.outline ?? '').trim();
        if (!dan_y) {
          throw new Error(`Chương ${idx + 1} thiếu dàn ý.`);
        }
        return {
          so_chuong,
          tieu_de: tieu_de || `Chương ${so_chuong}`,
          dan_y,
          noi_dung: '',
          trang_thai: 'empty' as const,
        };
      });

      store.setDanhSachChuong(converted);
      store.selectChuong(1);
      store.setGiaiDoan(2);
      toast.success(
        'Sinh viết lại xong',
        `«${title}» · ${converted.length} chương · trùng mẫu ~${simTarget}%.`,
      );
      onClose();
    } catch (err: unknown) {
      const friendly = getFriendlyErrorMessage(err);
      setError(friendly);
      toast.error('Sinh viết lại', friendly.slice(0, 220));
    } finally {
      setIsWorking(false);
    }
  };

  const wpm = resolveWpm(store.wpm);
  const wordsPer = store.setup.so_tu_chuong || 4250;
  const chapters = Number(store.setup.so_chuong) > 0 ? Number(store.setup.so_chuong) : 0;
  const perChapter = chapterWordsMinutes(wordsPer, wpm);
  const total = totalScaleMinutes(chapters, wordsPer, wpm);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[80] flex items-stretch justify-center p-2 sm:p-3 md:p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200"
      style={{ top: 'var(--app-chrome-h, 32px)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="continue-script-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Đóng"
        onClick={() => !busy && onClose()}
      />

      <div
        className="relative z-[1] flex h-full w-full max-w-[min(96rem,100%)] flex-col overflow-hidden rounded-[var(--app-radius-lg)] border border-emerald-900/40 bg-zinc-950/97 shadow-2xl shadow-emerald-500/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 flex-col gap-2 border-b border-zinc-800/80 bg-zinc-950/95 px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h2
                id="continue-script-title"
                className="truncate text-[clamp(12px,1.5vw,15px)] font-bold leading-snug tracking-wide text-emerald-400 uppercase"
              >
                Viết tiếp kịch bản
              </h2>
              <p className="text-[9px] leading-snug text-zinc-500 mt-0.5">
                Hai trường hợp: viết lại từ kịch bản hoàn thiện · kế thừa di sản truyện cũ
              </p>
            </div>
            <button
              type="button"
              onClick={() => !busy && onClose()}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/60 text-zinc-400 transition-colors hover:border-red-900/50 hover:bg-red-950/30 hover:text-red-400"
              title="Đóng"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Mode tabs */}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode('rewrite')}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                mode === 'rewrite'
                  ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                  : 'border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              1. Viết lại kịch bản
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode('legacy')}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                mode === 'legacy'
                  ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-300'
                  : 'border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
              }`}
            >
              <Library className="h-3.5 w-3.5" />
              2. Kế thừa di sản
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 md:p-5 space-y-4">
          <p className="text-[11px] text-zinc-400 leading-relaxed rounded-lg border border-zinc-800/80 bg-zinc-900/30 px-3 py-2">
            {mode === 'rewrite' ? (
              <>
                <strong className="text-amber-400">Viết lại kịch bản:</strong> dán kịch bản hoàn
                thiện → tóm gọn dàn ý → chỉnh <strong className="text-amber-300">% trùng</strong> với
                mẫu → sinh dàn ý / nhân vật mới.
              </>
            ) : (
              <>
                <strong className="text-indigo-400">Kế thừa di sản:</strong> dán truyện cũ → (tuỳ
                chọn) tóm gọn dàn ý → phân tích & nạp foundation (NV, lore, dàn ý) để viết tiếp.
              </>
            )}
          </p>

          {/* 1. Nội dung dán */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-3">
            <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              <UploadCloud className="h-3.5 w-3.5" />
              1. Nội dung {mode === 'rewrite' ? 'kịch bản hoàn thiện' : 'truyện cũ'} (dán vào)
            </label>
            <p className="mb-2 text-[10px] text-zinc-500">
              Dán toàn bộ hoặc nhiều chương (tối đa ~50.000 ký tự gửi AI). Không dùng link — chỉ
              văn bản.
            </p>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              disabled={busy}
              rows={10}
              placeholder={
                mode === 'rewrite'
                  ? 'Dán kịch bản hoàn thiện cần viết lại…'
                  : 'Dán nội dung truyện / chương cũ cần kế thừa…'
              }
              className="w-full resize-y min-h-[10rem] rounded-lg border border-zinc-800 bg-black/50 p-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-emerald-600/50 font-sans"
            />
            <p className="mt-1 text-[9px] text-zinc-600 tabular-nums">
              {(pasted || '').length.toLocaleString()} ký tự
            </p>
          </div>

          {/* 2. Tóm gọn dàn ý */}
          <div className="rounded-lg border border-sky-900/40 bg-sky-950/10 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-sky-400">
                2. Tóm gọn dàn ý
              </label>
              <button
                type="button"
                disabled={busy || pasted.trim().length < 80}
                onClick={() => void handleTomGon()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-700/50 bg-sky-500/20 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-sky-300 hover:bg-sky-500/30 disabled:opacity-40"
              >
                {isSummarizing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Đang tóm gọn…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    Tóm gọn dàn ý
                  </>
                )}
              </button>
            </div>
            <p className="mb-2 text-[10px] text-zinc-500">
              AI bóc cốt truyện + dàn ý tóm từ mục 1 → điền ô dưới (có thể chỉnh tay). Viết lại:
              dùng làm nguồn sinh kịch bản. Di sản: hỗ trợ trước khi kế thừa.
            </p>
            <textarea
              value={summary}
              onChange={(e) => {
                setSummary(e.target.value);
                store.setSetup({ mo_ta: e.target.value });
              }}
              disabled={busy}
              rows={6}
              placeholder="Kết quả tóm gọn dàn ý / cốt truyện hiện ở đây…"
              className="w-full resize-y min-h-[6rem] rounded-lg border border-zinc-800 bg-black/50 p-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-sky-600/50 font-sans"
            />
          </div>

          {/* 3. % trùng — chỉ Viết lại (giống YouTube rewrite) */}
          {mode === 'rewrite' && (
            <div className="rounded-lg border border-amber-900/40 bg-amber-950/10 p-3">
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-amber-400">
                3. % Độ trùng lặp với ý tưởng mẫu
              </label>
              <p className="mb-2 text-[10px] text-zinc-500">
                Mức bám cốt truyện / nhịp / ý tưởng từ kịch bản dán khi viết lại (mặc định 80%).
                Tên NV, chi tiết, thoại phải gốc — không copy nguyên văn. Đối chiếu excerpt nguồn
                lúc sinh dàn ý.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={sim}
                  onChange={(e) =>
                    store.setYoutubeRewrite({
                      similarityTarget: parseInt(e.target.value, 10) || 80,
                    })
                  }
                  className="min-w-[160px] flex-1 accent-amber-500"
                />
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      store.setYoutubeRewrite({
                        similarityTarget: Math.max(10, sim - 5),
                      })
                    }
                    className="rounded border border-zinc-800 p-1 text-zinc-400 hover:text-white"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <input
                    type="number"
                    min={10}
                    max={100}
                    value={sim}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v)) store.setYoutubeRewrite({ similarityTarget: v });
                    }}
                    className="w-16 rounded border border-zinc-800 bg-black py-1.5 text-center text-lg font-black text-amber-400 outline-none focus:border-amber-500"
                  />
                  <span className="text-sm font-bold text-amber-500">%</span>
                  <button
                    type="button"
                    onClick={() =>
                      store.setYoutubeRewrite({
                        similarityTarget: Math.min(100, sim + 5),
                      })
                    }
                    className="rounded border border-zinc-800 p-1 text-zinc-400 hover:text-white"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {[60, 70, 80, 90].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => store.setYoutubeRewrite({ similarityTarget: p })}
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                        sim === p
                          ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                          : 'border-zinc-800 text-zinc-500 hover:border-zinc-600'
                      }`}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 4–5: rewrite scale + YT-safe; legacy skips */}
          {mode === 'rewrite' && (
            <>
              <div className="rounded-lg border border-zinc-900 bg-zinc-900/20 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    4. Quy mô (kịch bản viết lại)
                  </label>
                  <span className="text-[9px] font-semibold text-zinc-500">
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
                        <button
                          type="button"
                          onClick={() => handleAdjustChapters(1)}
                          className="text-zinc-500 hover:text-white"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAdjustChapters(-1)}
                          className="text-zinc-500 hover:text-white"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    <p className="mt-1.5 text-center text-[10px] font-bold tabular-nums text-amber-400/90">
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
                      value={
                        store.setup.so_tu_chuong ||
                        (!store.is_pro && !store.is_trial && !store.is_vip
                          ? 600
                          : 4250)
                      }
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val) && val > 0) store.setSetup({ so_tu_chuong: val });
                      }}
                      className="w-full rounded border border-zinc-800 bg-black p-2.5 text-center text-xl font-extrabold text-zinc-100 outline-none focus:border-emerald-500"
                    />
                    <p className="mt-1.5 text-center text-[10px] font-bold tabular-nums text-emerald-400/90">
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
                      <option value="Tiếng Việt">Tiếng Việt</option>
                      <option value="English">English</option>
                      <option value="中文 (Chinese)">中文 · Chinese</option>
                      <option value="日本語 (Japanese)">日本語 · Japanese</option>
                      <option value="한국어 (Korean)">한국어 · Korean</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-red-900/50 bg-red-950/10 p-3">
                <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-red-500">
                  <AlertCircle className="h-3.5 w-3.5" />
                  5. Chống AI & YT-Safe
                </label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[9px] font-bold uppercase text-red-400">
                      Từ cấm
                    </label>
                    <input
                      type="text"
                      value={store.userRules.forbidden_words}
                      onChange={(e) =>
                        store.updateUserRules({ forbidden_words: e.target.value })
                      }
                      className="w-full rounded border border-red-900/50 bg-black p-2 text-[12px] text-zinc-200 outline-none focus:border-red-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[9px] font-bold uppercase text-orange-400">
                      Từ sáo
                    </label>
                    <input
                      type="text"
                      value={store.userRules.fatigue_words}
                      onChange={(e) =>
                        store.updateUserRules({ fatigue_words: e.target.value })
                      }
                      className="w-full rounded border border-orange-900/50 bg-black p-2 text-[12px] text-zinc-200 outline-none focus:border-orange-500"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {mode === 'legacy' && (
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              Sau khi dán (và tuỳ chọn tóm gọn), bấm <strong className="text-indigo-300">Phân
              tích &amp; Kế thừa</strong> — AI dịch ngược foundation: cốt truyện, nhân vật,
              lorebook, dàn ý cung.
            </p>
          )}

          {error ? (
            <p className="flex items-start gap-1.5 text-xs text-red-400 leading-snug">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="whitespace-pre-wrap">{error}</span>
            </p>
          ) : null}
        </div>

        {/* Footer CTA */}
        <div className="shrink-0 border-t border-zinc-800/80 bg-zinc-950/95 p-3 sm:px-4">
          {mode === 'rewrite' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleRewriteGenerate()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 py-3 text-sm font-bold uppercase tracking-wider text-black shadow-lg shadow-amber-500/10 transition-all hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isWorking ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Đang sinh dàn ý viết lại…
                </>
              ) : (
                <>🚀 Sinh kịch bản viết lại</>
              )}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleLegacyImport()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-3 text-sm font-bold uppercase tracking-wider text-white shadow-lg shadow-indigo-500/20 transition-all hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isWorking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Đang phân tích &amp; kế thừa…
                </>
              ) : (
                <>
                  <UploadCloud className="h-4 w-4" />
                  Phân tích &amp; Kế thừa di sản
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
