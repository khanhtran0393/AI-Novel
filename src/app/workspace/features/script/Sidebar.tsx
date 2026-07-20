'use client';

import React, { useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  selectTenTacPham,
  selectUpdateTenTacPham,
  selectSetSetupKind,
  selectSetGiaiDoan,
  selectSetupKind,
} from '@/store/useNovelStoreSelectors';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { useFolderActions } from '../../hooks/useFolderActions';
import { useProjectActions } from '../../hooks/useProjectActions';
import { RefreshCw, Settings2, UploadCloud, Video, CheckCircle } from 'lucide-react';
import { planArcAction } from '../../modules/writeModule';
import { silentEnrichArcHooks } from '../../modules/integrationsModule';
import { toast } from '@/lib/toastBus';
import { appConfirm } from '@/lib/confirmDialog';
import {
  FREE_LIMITS,
  freeChapterCapMessage,
} from '@/lib/commercial/freeLimitsPolicy';
import { storeIsFreeTier } from '@/app/workspace/hooks/useFreeLimits';
import ChapterList from './ChapterList';
import OutlineAccordions from './OutlineAccordions';
import CharacterRoster from './CharacterRoster';
import ContinueScriptPhase from './ContinueScriptPhase';

interface SidebarProps {
  handleWriteChapter: (overwrite?: boolean, chapterNumber?: number) => Promise<void>;
  isStreaming: boolean;
  onImageZoom: (url: string) => void;
}

export default function Sidebar({
  handleWriteChapter,
  isStreaming,
  onImageZoom,
}: SidebarProps) {
  const tenTacPham = useNovelStore(selectTenTacPham);
  const updateTenTacPham = useNovelStore(selectUpdateTenTacPham);
  const setSetupKind = useNovelStore(selectSetSetupKind);
  const setGiaiDoan = useNovelStore(selectSetGiaiDoan);
  const setupKind = useNovelStore(selectSetupKind);
  const [isPlanningArc, setIsPlanningArc] = useState(false);
  const [isContinueOpen, setIsContinueOpen] = useState(false);

  const openClassicSetup = () => {
    setSetupKind('classic');
    setGiaiDoan(1);
  };

  const openYoutubeSetup = () => {
    setSetupKind('youtube');
    setGiaiDoan(1);
  };

  const handlePlanNextArc = async (): Promise<boolean> => {
    setIsPlanningArc(true);
    try {
      const store = useNovelStore.getState();
      if (storeIsFreeTier(store)) {
        if (store.danh_sach_chuong.length >= FREE_LIMITS.maxChapters) {
          toast.error('Gói Free', freeChapterCapMessage());
          return false;
        }
      }
      const so_chuong_moi_cung = storeIsFreeTier(store)
        ? Math.min(
            FREE_LIMITS.maxChapters,
            Math.max(
              1,
              FREE_LIMITS.maxChapters - store.danh_sach_chuong.length,
            ),
          )
        : store.setup.so_chuong || 10;
      const chuong_bat_dau =
        store.danh_sach_chuong.length > 0
          ? store.danh_sach_chuong[store.danh_sach_chuong.length - 1].so_chuong + 1
          : 1;
      if (storeIsFreeTier(store) && chuong_bat_dau > FREE_LIMITS.maxChapters) {
        toast.error('Gói Free', freeChapterCapMessage());
        return false;
      }

      const tom_tat_cuon_chieu = store.danh_sach_chuong
        .slice(-10)
        .map((c) => `Chương ${c.so_chuong}: ${c.tieu_de}\n${c.dan_y}`)
        .join('\n\n');

      const result = await planArcAction({
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        ten_tac_pham: store.ten_tac_pham,
        lorebook: store.lorebook,
        danh_sach_chuong_da_viet: tom_tat_cuon_chieu,
        cung_hien_tai: store.cung_hien_tai,
        so_chuong_moi_cung,
        chuong_bat_dau,
      });

      if (result.danh_sach_chuong && result.danh_sach_chuong.length > 0) {
        const newChapters = result.danh_sach_chuong.map((c: any) => ({
          ...c,
          noi_dung: '',
          trang_thai: 'empty',
        }));
        store.addChuongMoi(newChapters);
        store.setCungHienTai(store.cung_hien_tai + 1);
        void silentEnrichArcHooks({
          hypothesis: `Arc ${store.cung_hien_tai + 1} của ${store.ten_tac_pham || 'truyện'} — nhánh cốt truyện tiếp theo`,
        });
        toast.success(
          'Arc mới',
          `Đã thêm ${newChapters.length} chương dàn ý cho cung tiếp theo.`,
        );
        return true;
      }
      toast.warn(
        'Arc mới',
        'AI không trả danh sách chương. Thử lại hoặc giảm số chương/cung.',
      );
    } catch (err) {
      console.error('Lỗi khi lập kế hoạch cung mới:', err);
      toast.error('Lên dàn ý arc', (err as Error).message || String(err));
    } finally {
      setIsPlanningArc(false);
    }
    return false;
  };

  const handleAppendOrPlanNextArc = async () => {
    const store = useNovelStore.getState();
    const currentChapterNum = store.chuong_dang_chon;
    const isLastChapter = currentChapterNum === store.danh_sach_chuong.length;
    const currentChapter = store.danh_sach_chuong.find(
      (c) => c.so_chuong === currentChapterNum,
    );
    const hasFinishedContent =
      currentChapter &&
      currentChapter.trang_thai === 'ready' &&
      (currentChapter.noi_dung || '').length > 500;

    if (isLastChapter && hasFinishedContent) {
      const confirmNext = await appConfirm({
        title: 'Hoàn thành arc',
        message: `Bạn đã xong chương cuối của arc hiện tại (Chương ${currentChapterNum}).`,
        details: [
          'Lên dàn ý cung (arc) tiếp theo để viết tiếp tác phẩm',
        ],
        confirmLabel: 'Lên dàn ý arc mới',
        cancelLabel: 'Để sau',
        tone: 'success',
      });
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

  const { handleResetProject } = useProjectActions('');

  return (
    <aside className="app-sidebar flex flex-col overflow-y-auto border-r border-zinc-800/70 bg-zinc-950/90 p-3 font-sans sm:p-4 md:p-5">
      {/* Hai nút Setup song song — cùng kiểu mở modal giữa màn hình */}
      <div className="mb-4 space-y-2">
        <button
          type="button"
          onClick={openClassicSetup}
          className="relative flex w-full min-h-[2.25rem] items-center justify-center gap-1.5 rounded-lg border border-amber-800/50 bg-amber-500/10 px-2 py-2 text-[10px] font-bold uppercase leading-snug tracking-wide text-amber-400 transition-all hover:bg-amber-500/20 hover:border-amber-600/60"
          title="Thiết lập chủ đề · phong cách · cốt truyện"
        >
          <Settings2 className="h-3.5 w-3.5 shrink-0" />
          <span className="text-center leading-snug">Setup · Tham số AI Novel</span>
          {setupKind === 'classic' && (
            <CheckCircle className="absolute right-3 h-4 w-4 text-emerald-500" />
          )}
        </button>
        <button
          type="button"
          onClick={openYoutubeSetup}
          className="relative flex w-full min-h-[2.25rem] items-center justify-center gap-1.5 rounded-lg border border-red-800/50 bg-red-500/10 px-2 py-2 text-[10px] font-bold uppercase leading-snug tracking-wide text-red-400 transition-all hover:bg-red-500/20 hover:border-red-600/60"
          title="Link YouTube · lấy chép lời · % trùng · viết lại tương tự"
        >
          <Video className="h-3.5 w-3.5 shrink-0" />
          <span className="text-center leading-snug">Link YouTube · viết lại tương tự</span>
          {setupKind === 'youtube' && (
            <CheckCircle className="absolute right-3 h-4 w-4 text-emerald-500" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setIsContinueOpen(true)}
          className="flex w-full min-h-[2.25rem] items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-2 py-2 text-[10px] font-bold uppercase leading-snug tracking-wide text-black shadow-lg shadow-emerald-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
          title="Viết lại kịch bản có sẵn · hoặc Kế thừa di sản (import truyện cũ)"
        >
          <UploadCloud className="h-3.5 w-3.5 shrink-0" />
          <span className="text-center leading-snug">Viết Tiếp Kịch Bản</span>
        </button>
      </div>

      <div className="mb-5">
        <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1.5">
          TÊN TÁC PHẨM
        </label>
        <input
          type="text"
          value={tenTacPham}
          onChange={(e) => updateTenTacPham(e.target.value)}
          className="w-full rounded border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs font-semibold text-zinc-200 outline-none focus:border-amber-500 focus:bg-zinc-950 font-sans"
        />
      </div>

      <ChapterList />
      <OutlineAccordions />
      <CharacterRoster onImageZoom={onImageZoom} />

      <div className="mt-auto space-y-3 pt-4 border-t border-zinc-900">
        <button
          type="button"
          // Chỉ khóa khi ĐANG VIẾT CHƯƠNG — không khóa vì gen hồ sơ NV / job khác
          disabled={isStreaming}
          onClick={() => {
            void (async () => {
              const ok = await appConfirm({
                title: 'Viết lại kịch bản',
                message:
                  'Viết lại toàn bộ kịch bản chương này. Nội dung hiện tại sẽ bị ghi đè.',
                details: ['Không thể hoàn tác sau khi gen lại'],
                confirmLabel: 'Viết lại từ đầu',
                cancelLabel: 'Giữ nguyên',
                tone: 'danger',
              });
              if (ok) void handleWriteChapter(true).catch(() => undefined);
            })();
          }}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/60 bg-red-500/10 py-2.5 text-xs font-bold uppercase tracking-wider text-red-500 shadow-lg transition-all duration-300 hover:bg-red-500 hover:text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-sans"
        >
          {isStreaming ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ĐANG VIẾT...
            </>
          ) : (
            <>Viết lại kịch bản từ đầu</>
          )}
        </button>

        <button
          type="button"
          disabled={isStreaming || isPlanningArc}
          onClick={handleAppendOrPlanNextArc}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 py-3 text-xs font-bold uppercase tracking-wider text-black shadow-lg shadow-emerald-500/5 transition-all duration-300 hover:bg-emerald-400 hover:shadow-emerald-500/15 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-sans"
          title="Gen hồ sơ NV chạy song song — không chặn sinh chương"
        >
          {isStreaming || isPlanningArc ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              {isPlanningArc ? 'ĐANG LÊN DÀN Ý ARC...' : 'ĐANG VIẾT...'}
            </>
          ) : (
            <>Sinh phần tiếp theo</>
          )}
        </button>

        <button
          type="button"
          disabled={isStreaming}
          onClick={handleResetProject}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/40 py-2.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200 cursor-pointer font-sans"
        >
          <RefreshCw className="h-3 w-3" />
          Làm Mới Dự Án
        </button>
      </div>

      <ContinueScriptPhase
        isOpen={isContinueOpen}
        onClose={() => setIsContinueOpen(false)}
      />
    </aside>
  );
}
