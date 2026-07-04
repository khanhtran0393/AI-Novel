'use client';

import React from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  Sparkles,
  Minus,
  Plus,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

interface SetupPhaseProps {
  promptError: string;
  isGeneratingIdea: boolean;
  handleRandomTemplate: () => Promise<void>;
  handleGenerateOutline: () => Promise<void>;
}

export default function SetupPhase({
  promptError,
  isGeneratingIdea,
  handleRandomTemplate,
  handleGenerateOutline
}: SetupPhaseProps) {
  const store = useNovelStore();

  const handleAdjustChapters = (amount: number) => {
    const nextVal = Math.max(1, Math.min(1000, store.setup.so_chuong + amount));
    store.setSetup({ so_chuong: nextVal });
  };

  return (
    <main className="flex-1 overflow-y-auto bg-black">
      <div className="flex min-h-full items-center justify-center p-4 py-12">
        <div className="w-full max-w-3xl shrink-0 rounded-xl border border-zinc-900 bg-zinc-950/50 p-8 shadow-2xl shadow-amber-500/5 glow-amber-sm">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold tracking-wide text-zinc-100">
            THIẾT LẬP THAM SỐ AI NOVEL
          </h2>
          <p className="mt-2 text-xs text-zinc-400 uppercase tracking-widest">
            Định hình kịch bản sinh tồn mạt thế của bạn
          </p>
        </div>

        <div className="space-y-6">
          {/* Khối CHỦ ĐỀ */}
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-amber-500">
              1. Khối Chủ Đề (Theme)
            </label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { name: 'Xuyên Không', desc: 'Vượt qua không gian & thời gian' },
                { name: 'Trùng Sinh', desc: 'Bắt đầu lại cuộc đời, báo thù...' },
                { name: 'Hệ Thống', desc: 'Giao diện nhiệm vụ & thăng cấp' },
                { name: 'Sinh Tồn', desc: 'Vật lộn sống sót khắc nghiệt' },
                { name: 'Võ Hiệp', desc: 'Ân oán giang hồ, kiếm hiệp' },
                { name: 'Trinh Thám', desc: 'Phá án & ly kỳ bí ẩn' }
              ].map((theme) => (
                <button
                  key={theme.name}
                  type="button"
                  onClick={() => store.setSetup({ chu_de: theme.name })}
                  className={`flex flex-col items-start rounded-lg border p-3.5 text-left transition-all duration-300 ${
                    store.setup.chu_de === theme.name
                      ? 'border-amber-500 bg-amber-500/10 shadow-lg shadow-amber-500/10'
                      : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
                  }`}
                >
                  <span className="text-sm font-semibold text-zinc-100">{theme.name}</span>
                  <span className="mt-1 text-[10px] text-zinc-400 leading-normal">{theme.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Khối PHONG CÁCH */}
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-sky-400">
              2. Khối Phong Cách (Style)
            </label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { name: 'Tu Tiên / Tiên Hiệp', desc: 'Trường sinh đạo quả, tiên môn' },
                { name: 'Huyền Huyễn', desc: 'Thần thú, huyết mạch bí ẩn' },
                { name: 'Đô Thị', desc: 'Cuộc chiến ngầm phố thị' },
                { name: 'Viễn Tưởng', desc: 'Khoa học viễn tưởng siêu tưởng' },
                { name: 'Mạt Thế', desc: 'Ngày tàn nhân loại, dị chủng' },
                { name: 'Cổ Đại', desc: 'Cung đấu, lịch sử quân sự cổ kính' }
              ].map((style) => (
                <button
                  key={style.name}
                  type="button"
                  onClick={() => store.setSetup({ phong_cach: style.name })}
                  className={`flex flex-col items-start rounded-lg border p-3.5 text-left transition-all duration-300 ${
                    store.setup.phong_cach === style.name
                      ? 'border-sky-500 bg-sky-500/10 shadow-lg shadow-sky-500/10'
                      : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
                  }`}
                >
                  <span className="text-sm font-semibold text-zinc-100">{style.name}</span>
                  <span className="mt-1 text-[10px] text-zinc-400 leading-normal">{style.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Khối MÔ TẢ CỐT TRUYỆN */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                3. Mô Tả Cốt Truyện (Tùy Chọn)
              </label>
              <button
                type="button"
                onClick={handleRandomTemplate}
                className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-500 transition-colors hover:text-amber-400"
              >
                <Sparkles className="h-3 w-3" />
                ✨ AI Tự Tạo Ý Tưởng
              </button>
            </div>
            <textarea
              rows={6}
              placeholder="Nhập bối cảnh cốt truyện của riêng bạn... Hoặc click nút 'AI Tự Tạo Ý Tưởng' ở trên để AI tạo ngẫu nhiên một bối cảnh mạt thế kịch tính."
              value={store.setup.mo_ta}
              onChange={(e) => {
                store.setSetup({ mo_ta: e.target.value });
              }}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-amber-500 focus:bg-zinc-950 font-sans"
            />
            {promptError && (
              <p className="mt-2 flex items-center gap-1 text-xs text-red-500">
                <AlertCircle className="h-3.5 w-3.5" />
                {promptError}
              </p>
            )}
          </div>

          {/* Khối QUY MÔ TÁC PHẨM */}
          <div className="flex flex-col items-center justify-center rounded-lg border border-zinc-900 bg-zinc-900/20 py-5">
            <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">
              4. Quy Mô Tác Phẩm
            </label>
            <div className="flex items-center gap-6">
              <button
                type="button"
                onClick={() => handleAdjustChapters(-1)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-white transition-colors"
              >
                <Minus className="h-4 w-4" />
              </button>
              <div className="flex flex-col items-center">
                <span className="text-3xl font-extrabold tracking-wider text-zinc-100">
                  {store.setup.so_chuong}
                </span>
                <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mt-1">
                  CHƯƠNG
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleAdjustChapters(1)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-white transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Nút CTA khởi tạo */}
          <button
            type="button"
            disabled={store.dang_tai || isGeneratingIdea}
            onClick={handleGenerateOutline}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 py-4 text-sm font-bold uppercase tracking-wider text-black shadow-lg shadow-amber-500/10 transition-all duration-300 hover:bg-amber-400 hover:shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {store.dang_tai ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Đang thiết lập dàn ý kịch bản...
              </>
            ) : (
              <>
                🚀 TIẾN HÀNH SINH KỊCH BẢN AI
              </>
            )}
          </button>
        </div>
      </div>
      </div>
    </main>
  );
}
