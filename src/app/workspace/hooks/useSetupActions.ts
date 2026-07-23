'use client';

import { useState } from 'react';
import { useNovelStore, Chuong } from '@/store/useNovelStore';
import { toast } from '@/lib/toastBus';
import {
  randomTemplateAction,
  generateOutlineAction,
  analyzeYoutubePlotAction,
  fetchYoutubeSourceAction,
  getFriendlyErrorMessage,
  summarizeSetupErrorForToast,
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
  // Local busy only — handlers use getState (no full-store subscribe)
  const getStore = () => useNovelStore.getState();
  const [promptError, setPromptError] = useState('');
  const [isGeneratingIdea, setIsGeneratingIdea] = useState(false);
  /** Sinh outline — busy riêng, không dang_tai global */
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [isAnalyzingPlot, setIsAnalyzingPlot] = useState(false);

  /** Fail-fast UX: toast + promptError sticky — never silent return */
  const failSetup = (title: string, msg: string) => {
    setPromptError(msg);
    toast.warn(title, msg.replace(/^⚠️\s*/, '').slice(0, 220));
  };
  const failOutline = (msg: string) => failSetup('Sinh kịch bản', msg);

  // Sinh ý tưởng bối cảnh ngẫu nhiên qua API (classic setup)
  const handleRandomTemplate = async () => {
    const store = getStore();
    const prevMoTa = store.setup.mo_ta;
    if (!(store.setup.chu_de || '').trim() || !(store.setup.phong_cach || '').trim()) {
      failSetup(
        'AI ý tưởng',
        '⚠️ Chọn Chủ đề + Phong cách trước khi bấm «AI ý tưởng».',
      );
      return;
    }
    setPromptError('');
    setIsGeneratingIdea(true);
    toast.info('AI ý tưởng', 'Đang sinh cốt truyện gợi ý…');
    store.setSetup({ mo_ta: 'Đang kết nối siêu trí tuệ AI để sáng tạo kịch bản...' });

    try {
      const idea = await randomTemplateAction({
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        chu_de: store.setup.chu_de,
        phong_cach: store.setup.phong_cach,
      });
      store.setSetup({ mo_ta: idea });
      toast.success('AI ý tưởng', 'Đã điền cốt truyện — chỉnh rồi bấm Sinh kịch bản.');
    } catch (err: unknown) {
      const friendly = getFriendlyErrorMessage(err);
      setPromptError(friendly);
      toast.error('AI ý tưởng', friendly.slice(0, 220));
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
    const store = getStore();
    const url = (urlOverride ?? store.youtubeRewriteUrl ?? '').trim();
    if (!url) {
      failSetup('Phân tích YouTube', '⚠️ Dán link YouTube trước khi Phân tích.');
      return;
    }

    setPromptError('');
    setIsAnalyzingPlot(true);
    toast.info('Phân tích YouTube', 'Đang lấy captions + bóc cốt truyện…');
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
          // Server already returns WHAT·WHERE·FIX; keep full text for promptError
          throw new Error(
            (data.error || '').trim() ||
              '❌ Không lấy được bản chép lời (phụ đề).\n\n🔎 Vì sao: Video thiếu captions hoặc fetch Python fail.\n📍 Ở đâu: /api/youtube-source → youtube-transcript-api\n✅ Cách khắc phục: Bật CC trên video · pip install youtube-transcript-api · hoặc gõ cốt truyện tay ô 3.',
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
      toast.success('Phân tích xong', 'Cốt truyện đã điền ô 3 — chỉnh rồi Sinh kịch bản.');
    } catch (err: unknown) {
      const friendly = getFriendlyErrorMessage(err);
      setPromptError(friendly);
      // Toast: tóm tắt vì sao + 1 bước sửa (ô lỗi sticky giữ full message)
      toast.error('Phân tích YouTube', summarizeSetupErrorForToast(friendly, 240));
    } finally {
      setIsAnalyzingPlot(false);
    }
  };

  /** @deprecated alias — UI YouTube dùng handlePhanTichYoutube */
  const handleAnalyzeYoutubePlot = () => handlePhanTichYoutube();

  // Nút khởi tạo kịch bản AI (Phase 1 -> Phase 2)
  const handleGenerateOutline = async () => {
    if (isGeneratingOutline) {
      toast.info('Sinh kịch bản', 'Đang chạy rồi — chờ AI trả dàn ý…');
      return;
    }

    const store = getStore();
    const ytMode =
      store.setupKind === 'youtube' ||
      !!(store.youtubeSourceText || '').trim() ||
      !!(store.youtubeRewriteUrl || '').trim();

    const moTa = (store.setup.mo_ta || '').trim();
    const captionCache = (store.youtubeSourceText || '').trim();
    const chuDe = (store.setup.chu_de || '').trim();
    const phongCach = (store.setup.phong_cach || '').trim();
    const hasKey = !!(
      (store.apiKey || '').trim() ||
      (store.apiKeys || []).some((k) => !!(k || '').trim())
    );

    if (!hasKey) {
      failOutline(
        '⚠️ Chưa có API Key LLM. Mở Cài đặt (⚙️) → dán Gemini/OpenAI key rồi thử lại.',
      );
      return;
    }

    // Classic setup: bắt buộc chủ đề + phong cách (YouTube rewrite có default server-side)
    if (!ytMode && (!chuDe || !phongCach)) {
      failOutline(
        !chuDe && !phongCach
          ? '⚠️ Chọn Chủ đề (mục 1) và Phong cách (mục 2) trước khi sinh kịch bản.'
          : !chuDe
            ? '⚠️ Chọn Chủ đề (mục 1) trước khi sinh kịch bản.'
            : '⚠️ Chọn Phong cách (mục 2) trước khi sinh kịch bản.',
      );
      return;
    }

    // YouTube: bắt buộc đã có cốt truyện (bấm Phân tích) — không auto dump captions
    if (ytMode && (!moTa || isRawYoutubeMoTa(moTa))) {
      failOutline(
        '⚠️ Bấm «Phân tích» (cạnh link) để lấy chép lời + điền cốt truyện trước khi sinh kịch bản.',
      );
      return;
    }

    if (!moTa) {
      failOutline(
        ytMode
          ? '⚠️ Bấm «Phân tích» để điền cốt truyện (ô 3) trước khi sinh kịch bản!'
          : '⚠️ Nhập mô tả cốt truyện (mục 3) hoặc bấm «AI ý tưởng» trước khi sinh kịch bản.',
      );
      return;
    }

    // Chuẩn hóa quy mô theo gói (Free ≤2 ch · ≤600 từ — cấm ép 10 ch / 4250)
    const {
      normalizeSetupScaleForTier,
      resolveMeteredTierFromFlags,
    } = await import('@/lib/commercial/freeLimitsPolicy');
    const tier = resolveMeteredTierFromFlags({
      is_pro: store.is_pro,
      is_trial: store.is_trial,
      is_vip: store.is_vip,
    });
    const scaled = normalizeSetupScaleForTier(
      store.setup.so_chuong,
      store.setup.so_tu_chuong,
      tier,
    );
    const soChuong = scaled.so_chuong;
    const soTu = scaled.so_tu_chuong;
    if (store.setup.so_chuong !== soChuong || store.setup.so_tu_chuong !== soTu) {
      store.setSetup({ so_chuong: soChuong, so_tu_chuong: soTu });
    }

    setPromptError('');
    setIsGeneratingOutline(true);
    toast.info(
      'Sinh kịch bản AI',
      `Đang tạo dàn ý ${soChuong} chương… Giữ cửa sổ mở, đợi toast xong.`,
    );
    if (ytMode && !captionCache) {
      toast.info(
        'YouTube rewrite',
        'Không có captions cache — AI bám ô cốt truyện + % trùng (bấm Phân tích để canh % chính xác hơn).',
      );
    }

    try {
      const live = useNovelStore.getState();
      const runOutline = () =>
        generateOutlineAction({
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
        });

      let data: Record<string, unknown>;
      try {
        data = (await runOutline()) as Record<string, unknown>;
      } catch (firstErr: unknown) {
        // One automatic retry after Gemini RPM 429 (common on free keys)
        const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        if (/429|RPM|chờ 30|rate/i.test(msg)) {
          toast.info('Sinh kịch bản', 'Gặp giới hạn RPM — chờ 35s rồi tự thử lại…');
          await new Promise((r) => setTimeout(r, 35_000));
          data = (await runOutline()) as Record<string, unknown>;
        } else {
          throw firstErr;
        }
      }

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
          'AI không trả đủ tiêu đề / dàn ý tổng thể. Kiểm tra API Key và thử lại.',
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
      const { markOnboardingStep } = await import('@/lib/onboarding');
      markOnboardingStep('setup');
      markOnboardingStep('outline');
      toast.success(
        'Sinh kịch bản xong',
        `«${title}» · ${convertedChapters.length} chương — sang workspace viết.`,
      );
    } catch (err: unknown) {
      const friendly = getFriendlyErrorMessage(err);
      setPromptError(friendly);
      toast.error('Sinh kịch bản thất bại', friendly.slice(0, 280));
    } finally {
      setIsGeneratingOutline(false);
    }
  };

  return {
    promptError,
    setPromptError,
    isGeneratingIdea,
    isGeneratingOutline,
    isAnalyzingPlot,
    handleRandomTemplate,
    handleAnalyzeYoutubePlot,
    handlePhanTichYoutube,
    handleGenerateOutline,
  };
}
