'use client';

import { useState } from 'react';
import { useNovelStore, Chuong } from '@/store/useNovelStore';
import {
  randomTemplateAction,
  generateOutlineAction,
  getFriendlyErrorMessage
} from '../modules/setupModule';

export function useSetupActions() {
  const store = useNovelStore();
  const [promptError, setPromptError] = useState('');
  const [isGeneratingIdea, setIsGeneratingIdea] = useState(false);

  // Sinh ý tưởng bối cảnh ngẫu nhiên qua API
  const handleRandomTemplate = async () => {
    const prevMoTa = store.setup.mo_ta;
    setPromptError('');
    setIsGeneratingIdea(true);
    store.setSetup({ mo_ta: 'Đang kết nối siêu trí tuệ AI để sáng tạo kịch bản...' });

    try {
      const idea = await randomTemplateAction({
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        chu_de: store.setup.chu_de,
        phong_cach: store.setup.phong_cach
      });
      store.setSetup({ mo_ta: idea });
    } catch (err: unknown) {
      setPromptError(getFriendlyErrorMessage(err));
      // Khôi phục lại mô tả trước đó
      store.setSetup({ mo_ta: (prevMoTa && prevMoTa !== 'Đang kết nối siêu trí tuệ AI để sáng tạo kịch bản...') ? prevMoTa : '' });
    } finally {
      setIsGeneratingIdea(false);
    }
  };

  // Nút khởi tạo kịch bản AI (Phase 1 -> Phase 2)
  const handleGenerateOutline = async () => {
    if (!store.setup.mo_ta.trim()) {
      setPromptError('⚠️ Vui lòng nhập mô tả cốt truyện hoặc bấm nút "AI Tự Tạo Ý Tưởng"!');
      return;
    }

    setPromptError('');
    store.setDangTai(true);

    try {
      const data = await generateOutlineAction({
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        setupData: store.setup
      }) as Record<string, unknown>;

      const title = typeof data.tieu_de === 'string' ? data.tieu_de.trim() : '';
      const outline = typeof data.dan_y_tong_the === 'string' ? data.dan_y_tong_the.trim() : '';
      const characters = Array.isArray(data.nhan_vat)
        ? data.nhan_vat.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
        : [];
      if (!title || !outline || characters.length === 0) {
        throw new Error('AI outline response is missing required title, outline, or character data.');
      }

      store.updateTenTacPham(title);
      store.updateDanYTongThe(outline);
      store.updateNhanVat(characters);
      
      if (data.lorebook) store.updateLorebook(data.lorebook as string);
      if (data.tom_tat_cuon_chieu) store.updateTomTatCuonChieu(data.tom_tat_cuon_chieu as string);
      if (data.tri_nho_ngan_han) store.updateTriNhoNganHan(data.tri_nho_ngan_han as string[]);
      if (data.world_state) store.updateWorldState(data.world_state as any);

      // Convert to Chuong format with strict key parsing.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawChapters = Array.isArray(data.danh_sach_chuong) ? data.danh_sach_chuong as any[] : [];
      if (rawChapters.length === 0) {
        throw new Error('AI outline response is missing required danh_sach_chuong data.');
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const convertedChapters: Chuong[] = rawChapters.map((ch: any, idx: number) => {
        const parsedSo = parseInt(String(ch.so_chuong).replace(/\D/g, ''));
        if (isNaN(parsedSo)) {
          throw new Error(`Chapter item ${idx + 1} is missing required so_chuong.`);
        }
        const so_chuong = parsedSo;
        const chapterTitle = typeof ch.tieu_de === 'string' ? ch.tieu_de.trim() : '';
        const chapterOutline = typeof ch.dan_y === 'string' ? ch.dan_y.trim() : '';
        if (!chapterTitle || !chapterOutline) {
          throw new Error(`Chapter item ${idx + 1} is missing required tieu_de or dan_y.`);
        }
        return {
          so_chuong,
          tieu_de: chapterTitle,
          dan_y: chapterOutline,
          noi_dung: '',
          trang_thai: 'empty'
        };
      });

      store.setDanhSachChuong(convertedChapters);
      store.selectChuong(1);
      store.setGiaiDoan(2);
    } catch (err: unknown) {
      setPromptError(getFriendlyErrorMessage(err));
    } finally {
      store.setDangTai(false);
    }
  };

  return {
    promptError,
    setPromptError,
    isGeneratingIdea,
    handleRandomTemplate,
    handleGenerateOutline
  };
}

