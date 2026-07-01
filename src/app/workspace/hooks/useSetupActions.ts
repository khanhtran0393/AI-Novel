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
        useMock: store.useMock,
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
        useMock: store.useMock,
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        setupData: store.setup
      });

      store.updateTenTacPham(data.tieu_de || 'Ký Ức Phai Tàn: Mạng Lưới Hư Vô');
      store.updateDanYTongThe(data.dan_y_tong_the || 'Dàn ý tổng thể.');
      store.updateNhanVat(data.nhan_vat || ['Khải Đăng']);
      
      if (data.lorebook) store.updateLorebook(data.lorebook);
      if (data.tom_tat_cuon_chieu) store.updateTomTatCuonChieu(data.tom_tat_cuon_chieu);
      if (data.tri_nho_ngan_han) store.updateTriNhoNganHan(data.tri_nho_ngan_han);

      // Convert to Chuong format with extremely robust key fallbacks and strict numeric parsing
      const rawChapters = data.danh_sach_chuong || data.danhSachChuong || data.chapters || data.danh_sach_cac_chuong || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const convertedChapters: Chuong[] = rawChapters.map((ch: any, idx: number) => {
        const parsedSo = parseInt(String(ch.so_chuong || ch.chapter || ch.id || ch.index).replace(/\D/g, ''));
        const so_chuong = isNaN(parsedSo) ? (idx + 1) : parsedSo;
        return {
          so_chuong,
          tieu_de: ch.tieu_de || ch.title || ch.ten_chuong || `Chương ${so_chuong}`,
          dan_y: ch.dan_y || ch.summary || ch.outline || ch.dan_y_chi_tiet || 'Dàn ý chi tiết chưa có.',
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
