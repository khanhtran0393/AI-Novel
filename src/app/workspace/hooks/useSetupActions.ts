'use client';

import { useState } from 'react';
import { useNovelStore, Chuong } from '@/store/useNovelStore';
import {
  randomTemplateAction,
  generateOutlineAction,
  analyzeYoutubePlotAction,
  fetchYoutubeSourceAction,
  getFriendlyErrorMessage,
} from '../modules/setupModule';

function isRawYoutubeMoTa(mo: string): boolean {
  const t = (mo || '').trim();
  return (
    t.startsWith('[NGUỒN YOUTUBE') ||
    t.startsWith('[RAW YOUTUBE') ||
    t.includes('BẢN CHÉP LỜI (phụ đề nguồn):')
  );
}

/** Parse nhan_vat from AI — string[] or {ten|name|tên}[] */
function parseCharacterNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      out.push(item.trim());
      continue;
    }
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const name =
        (typeof o.ten === 'string' && o.ten) ||
        (typeof o.name === 'string' && o.name) ||
        (typeof o.tên === 'string' && o.tên) ||
        (typeof o.ten_nhan_vat === 'string' && o.ten_nhan_vat) ||
        '';
      if (name.trim()) out.push(name.trim());
    }
  }
  return out;
}

function pickStr(data: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export function useSetupActions() {
  const store = useNovelStore();
  const [promptError, setPromptError] = useState('');
  const [isGeneratingIdea, setIsGeneratingIdea] = useState(false);
  const [isAnalyzingPlot, setIsAnalyzingPlot] = useState(false);

  // Sinh ý tưởng bối cảnh ngẫu nhiên qua API (classic setup)
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
        phong_cach: store.setup.phong_cach,
      });
      store.setSetup({ mo_ta: idea });
    } catch (err: unknown) {
      setPromptError(getFriendlyErrorMessage(err));
      store.setSetup({
        mo_ta:
          prevMoTa && prevMoTa !== 'Đang kết nối siêu trí tuệ AI để sáng tạo kịch bản...'
            ? prevMoTa
            : '',
      });
    } finally {
      setIsGeneratingIdea(false);
    }
  };

  /**
   * Nút «Phân tích» (YouTube setup):
   * 1) Lấy captions/chép lời → cache (youtubeSourceText) để đối chiếu % trùng
   * 2) AI bóc cốt truyện → điền ô «3. Cốt truyện» (mo_ta)
   * Không dump transcript thô vào mo_ta.
   */
  const handlePhanTichYoutube = async (urlOverride?: string) => {
    const url = (urlOverride ?? store.youtubeRewriteUrl ?? '').trim();
    if (!url) {
      setPromptError('⚠️ Dán link YouTube trước khi Phân tích.');
      return;
    }

    setPromptError('');
    setIsAnalyzingPlot(true);
    try {
      const ngon = (store.setup.ngon_ngu || '').toLowerCase();
      const preferredLangs =
        ngon.includes('việt') || ngon.includes('viet')
          ? ['vi', 'en', 'en-US']
          : ngon.includes('english')
            ? ['en', 'en-US', 'vi']
            : ['vi', 'en', 'en-US', 'ja', 'ko', 'zh'];

      // Reuse cache if same URL already has captions
      let transcript = (store.youtubeSourceText || '').trim();
      let title = store.youtubeSourceTitle || '';
      const cachedUrl = (store.youtubeRewriteUrl || '').trim();
      const canReuseCache =
        transcript.length >= 40 &&
        cachedUrl &&
        (url === cachedUrl || url.includes(cachedUrl) || cachedUrl.includes(url));

      if (!canReuseCache) {
        const data = await fetchYoutubeSourceAction({ url, preferredLangs });
        transcript = (data.transcript || '').trim();
        if (transcript.length < 20) {
          throw new Error(
            data.error ||
              'Không lấy được bản chép lời (phụ đề). Video phải có captions.',
          );
        }
        title = data.title || title;
        // Cache captions — dùng đối chiếu %; xóa khi sinh kịch bản xong
        store.setYoutubeRewrite({
          url: data.url || url,
          sourceTitle: title,
          sourceText: transcript,
        });
      } else {
        store.setYoutubeRewrite({ url, sourceTitle: title || store.youtubeSourceTitle });
      }

      const mo_ta = await analyzeYoutubePlotAction({
        sourceText: transcript,
        title: title || store.youtubeSourceTitle || '',
        similarityTarget: store.youtubeSimilarityTarget ?? 80,
      });
      store.setSetup({ mo_ta });
    } catch (err: unknown) {
      setPromptError(getFriendlyErrorMessage(err));
    } finally {
      setIsAnalyzingPlot(false);
    }
  };

  /** @deprecated alias — UI YouTube dùng handlePhanTichYoutube */
  const handleAnalyzeYoutubePlot = () => handlePhanTichYoutube();

  // Nút khởi tạo kịch bản AI (Phase 1 -> Phase 2)
  const handleGenerateOutline = async () => {
    const ytMode =
      store.setupKind === 'youtube' ||
      !!(store.youtubeSourceText || '').trim() ||
      !!(store.youtubeRewriteUrl || '').trim();

    let moTa = (store.setup.mo_ta || '').trim();
    const captionCache = (store.youtubeSourceText || '').trim();

    // YouTube: bắt buộc đã có cốt truyện (bấm Phân tích) — không auto dump captions
    if (ytMode && (!moTa || isRawYoutubeMoTa(moTa))) {
      setPromptError(
        '⚠️ Bấm «Phân tích» (cạnh link) để lấy chép lời + điền cốt truyện trước khi sinh kịch bản.',
      );
      return;
    }

    if (!moTa) {
      setPromptError(
        ytMode
          ? '⚠️ Bấm «Phân tích» để điền cốt truyện (ô 3) trước khi sinh kịch bản!'
          : '⚠️ Vui lòng nhập mô tả cốt truyện hoặc bấm nút "AI Tự Tạo Ý Tưởng"!',
      );
      return;
    }

    // Chuẩn hóa quy mô
    const soChuongRaw = Number(store.setup.so_chuong);
    const soChuong =
      Number.isFinite(soChuongRaw) && soChuongRaw >= 1
        ? Math.min(500, Math.round(soChuongRaw))
        : 10;
    const soTuRaw = Number(store.setup.so_tu_chuong);
    const soTu =
      Number.isFinite(soTuRaw) && soTuRaw >= 500
        ? Math.min(10000, Math.round(soTuRaw))
        : 4250;
    if (store.setup.so_chuong !== soChuong || store.setup.so_tu_chuong !== soTu) {
      store.setSetup({ so_chuong: soChuong, so_tu_chuong: soTu });
    }

    setPromptError('');
    store.setDangTai(true);

    try {
      const live = useNovelStore.getState();
      const data = (await generateOutlineAction({
        apiKey: live.apiKey,
        apiKeys: live.apiKeys || [],
        setupData: {
          ...live.setup,
          mo_ta: moTa,
          so_chuong: soChuong,
          so_tu_chuong: soTu,
        },
        youtubeRewrite: ytMode
          ? {
              enabled: true,
              similarityTarget: live.youtubeSimilarityTarget ?? 80,
              sourceTitle: live.youtubeSourceTitle || '',
              // Captions cache → đối chiếu % trùng trong prompt, rồi xóa sau
              captionCache: captionCache || live.youtubeSourceText || '',
            }
          : { enabled: false },
      })) as Record<string, unknown>;

      const title = pickStr(data, ['tieu_de', 'title', 'ten_tac_pham']);
      const outline = pickStr(data, [
        'dan_y_tong_the',
        'outline',
        'dan_y',
        'world_outline',
      ]);
      let characters = parseCharacterNames(data.nhan_vat ?? data.characters);
      if (characters.length === 0 && title) {
        characters = ['Nhân vật chính'];
      }
      if (!title || !outline) {
        throw new Error(
          'AI không trả đủ tiêu đề / dàn ý tổng thể. Kiểm tra API Key và bấm «Phân tích» lại.',
        );
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
        : Array.isArray(data.chapters)
          ? (data.chapters as any[])
          : [];
      if (rawChapters.length === 0) {
        throw new Error(
          'AI không trả danh_sach_chuong. Thử giảm số chương rồi sinh lại.',
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const convertedChapters: Chuong[] = rawChapters.map((ch: any, idx: number) => {
        const parsedSo = parseInt(
          String(ch?.so_chuong ?? ch?.chapter ?? idx + 1).replace(/\D/g, ''),
          10,
        );
        const so_chuong = Number.isFinite(parsedSo) && parsedSo > 0 ? parsedSo : idx + 1;
        const chapterTitle = String(
          ch?.tieu_de ?? ch?.title ?? `Chương ${so_chuong}`,
        ).trim();
        const chapterOutline = String(
          ch?.dan_y ?? ch?.outline ?? ch?.summary ?? '',
        ).trim();
        if (!chapterOutline) {
          throw new Error(
            `Chương ${idx + 1} thiếu dàn ý (dan_y). Thử sinh lại với số chương ít hơn.`,
          );
        }
        return {
          so_chuong,
          tieu_de: chapterTitle || `Chương ${so_chuong}`,
          dan_y: chapterOutline,
          noi_dung: '',
          trang_thai: 'empty' as const,
        };
      });

      store.setDanhSachChuong(convertedChapters);
      store.selectChuong(1);

      // Xóa captions cache sau khi sinh kịch bản thành công
      if (ytMode) {
        store.setYoutubeRewrite({ sourceText: '' });
      }

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
    isAnalyzingPlot,
    handleRandomTemplate,
    handleAnalyzeYoutubePlot,
    handlePhanTichYoutube,
    handleGenerateOutline,
  };
}
