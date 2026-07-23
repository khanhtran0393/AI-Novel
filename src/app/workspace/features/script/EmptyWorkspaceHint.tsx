'use client';

/**
 * Smart empty state when project has no outline / empty chapter content.
 * Single CTA only — do not duplicate write-chapter buttons in ContentTab.
 */
import React from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { FileText, Mic2, ImageIcon, Sparkles } from 'lucide-react';

type Props = {
  onWriteChapter?: () => void;
};

export default function EmptyWorkspaceHint({ onWriteChapter }: Props) {
  // Selector-only — full store re-render empty state mỗi media tick
  const chuongDangChon = useNovelStore((s) => s.chuong_dang_chon);
  const hasContent = useNovelStore((s) => {
    const ch = s.danh_sach_chuong.find((c) => c.so_chuong === s.chuong_dang_chon);
    return !!(ch?.noi_dung || '').trim();
  });
  const hasOutline = useNovelStore((s) => !!(s.dan_y_tong_the || '').trim());
  const hasSetupGenre = useNovelStore((s) => {
    const cd = String(s.setup?.chu_de || '').trim();
    const pc = String(s.setup?.phong_cach || '').trim();
    return !!(cd && pc);
  });
  const hasApiKey = useNovelStore(
    (s) =>
      !!(s.apiKey || '').trim() ||
      (s.apiKeys || []).some((k) => !!(k || '').trim()),
  );
  const giaiDoan = useNovelStore((s) => s.giai_doan);
  const setGiaiDoan = useNovelStore((s) => s.setGiaiDoan);

  if (hasContent) return null;

  const nextStep = !hasSetupGenre
    ? {
        title: 'Bước 1 · Setup Chủ đề + Phong cách',
        body: 'Mở Setup → chọn Chủ đề và Phong cách (bắt buộc). Free: ≤2 chương · ≤600 từ · 3 lượt/ngày.',
        cta: 'Mở Setup',
      }
    : !hasApiKey
      ? {
          title: 'Bước 2 · API Key LLM',
          body: 'Mở Cài đặt (⚙️) → dán Gemini/OpenAI key trước khi sinh dàn ý / viết chương.',
          cta: 'Mở Setup (nhắc key)',
        }
      : !hasOutline
        ? {
            title: 'Bước 3 · Sinh dàn ý',
            body: 'Trong Setup: nhập cốt truyện (hoặc AI ý tưởng) → «Tiến hành sinh kịch bản AI».',
            cta: 'Về Setup / Outline',
          }
        : {
            title: 'Bước 4 · Viết chương',
            body: 'Bấm «Sinh Chi Tiết Chương» — AI soạn phân cảnh, Cổng Từ, Quality Gate, rồi TTS → Prompt → Ảnh.',
            cta: null as string | null,
          };

  return (
    <div className="mx-3 my-4 max-w-md rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/50 p-6 text-center sm:mx-4">
      <FileText className="mx-auto h-8 w-8 text-zinc-600" />
      <h3 className="mt-3 text-sm font-bold text-zinc-200">{nextStep.title}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-[11px] leading-relaxed text-zinc-500">
        {nextStep.body}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {!hasOutline && nextStep.cta && (
          <button
            type="button"
            onClick={() => setGiaiDoan(1)}
            className="rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-1.5 text-[10px] font-bold uppercase text-amber-400 hover:bg-amber-900/40 cursor-pointer"
          >
            {nextStep.cta}
          </button>
        )}
        {hasOutline && onWriteChapter && (
          <button
            type="button"
            // Không khóa theo dang_tai global (gen NV / job khác) — chỉ client gate khi đang viết
            onClick={() => {
              void onWriteChapter();
            }}
            className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-black shadow hover:bg-amber-400 transition-colors cursor-pointer disabled:opacity-40 animate-pulse"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Sinh Chi Tiết Chương {chuongDangChon}
          </button>
        )}
      </div>
      <div className="mt-4 flex justify-center gap-4 text-[10px] text-zinc-600">
        <span className="inline-flex items-center gap-1 opacity-60">
          <Mic2 className="h-3 w-3" /> TTS sau khi có chữ
        </span>
        <span className="inline-flex items-center gap-1 opacity-60">
          <ImageIcon className="h-3 w-3" /> Ảnh sau khi có prompt
        </span>
      </div>
      {giaiDoan === 2 && !hasOutline ? (
        <p className="mt-3 text-[9px] text-zinc-600">
          Core loop: Setup → Outline → Viết → TTS → Prompt → Ảnh → Export
        </p>
      ) : null}
    </div>
  );
}
