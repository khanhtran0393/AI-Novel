'use client';
import {
  API,
  chapterAssetPrefix,
  imageAssetKey,
  sceneAssetKey,
} from '@/contracts';

import React, { useMemo, useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  buildYoutubeChecklist,
  summarizeChecklist,
  buildYoutubeChapters,
  buildCutPlan,
  mergeYoutubeSafe,
  buildSeoDescription,
  buildSeoTitleFromHook,
  blendThumbPromptWithCompetitorDna,
  buildThumbnailPrompt,
  normalizeHashtagField,
  scoreYoutubeMetaFields,
  YOUTUBE_META_PASS_SCORE,
  YOUTUBE_THUMB_SCENE_INDEX,
  YOUTUBE_MOBILE_TITLE_MAX,
  YOUTUBE_TITLE_HARD_MAX,
  buildFiveTitleFormulas,
  enforceMobileTitle,
  isValidThumbOverlay,
  scoreTitleMobileDiscipline,
  suggestThumbOverlayTexts,
  type ThumbCompositionId,
  type YoutubeExportPack,
} from '@/lib/youtubeSafe';
import { countSceneTags, evaluateWordGate, parseScenes } from '@/lib/storyWriting';
import {
  composeMatrix,
  matrixThumbOverlaySuggestions,
} from '@/lib/matrixEngine';
import {
  generateImageAction,
  regenPromptAction,
} from '../../modules/imageModule';
import {
  fetchYoutubeMetaWithQA,
  formatMetaScoreLine,
} from '../../modules/youtubeMetaModule';
import {
  PlaySquare,
  Download,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { pushToast, toast } from '@/lib/toastBus';
import SeoField, { hasImageCredentials } from './SeoField';
import YoutubeThumbPanel from './YoutubeThumbPanel';
import { appendImageCacheBust } from '@/lib/mediaReference';

/** Stable empty hook — never allocate new {} in selector (causes getSnapshot infinite loop). */
const EMPTY_CHAPTER_HOOK = Object.freeze({
  hook: '',
  thumbnailLine: '',
  seoTitle: '',
  seoDescription: '',
  seoTags: '',
  thumbnailPrompt: '',
  thumbnailImagePath: '',
  thumbCompositionId: '',
  seoTitleVariants: [] as Array<{ id: string; labelVi: string; title: string }>,
});

export default function YoutubeSafeChecklist() {
  /**
   * Primitive selectors only (React 19 + zustand): never return a fresh `{}` from
   * getSnapshot — that causes "Maximum update depth exceeded" / infinite loop.
   * Handlers use useNovelStore.getState() for one-shot actions.
   */
  const ch = useNovelStore((s) => s.chuong_dang_chon);
  const script = useNovelStore((s) => {
    const chapter = s.danh_sach_chuong.find((c) => c.so_chuong === s.chuong_dang_chon);
    return chapter?.noi_dung || '';
  });
  const soTuChuong = useNovelStore((s) => s.setup?.so_tu_chuong || 4250);
  const review = useNovelStore((s) => s.editorReviews[s.chuong_dang_chon]);
  const youtubeSafe = useNovelStore((s) => s.youtubeSafe);
  const chapterHook = useNovelStore((s) => s.chapterHooks?.[s.chuong_dang_chon]);
  const asset = chapterHook || EMPTY_CHAPTER_HOOK;
  const thumbAssetKey = imageAssetKey(ch, YOUTUBE_THUMB_SCENE_INDEX, 0);
  const thumbImageFromStore = useNovelStore(
    (s) => s.generatedImages?.[imageAssetKey(s.chuong_dang_chon, YOUTUBE_THUMB_SCENE_INDEX, 0)] || '',
  );
  const imageCount = useNovelStore((s) => {
    const prefix = chapterAssetPrefix(s.chuong_dang_chon);
    let n = 0;
    for (const k of Object.keys(s.generatedImages || {})) {
      if (k.startsWith(prefix)) n++;
    }
    return n;
  });
  const videoCount = useNovelStore((s) => {
    const prefix = chapterAssetPrefix(s.chuong_dang_chon);
    let n = 0;
    for (const k of Object.keys(s.generatedVideos || {})) {
      if (k.startsWith(prefix)) n++;
    }
    return n;
  });
  const hasAudio = useNovelStore((s) => {
    const prefix = chapterAssetPrefix(s.chuong_dang_chon);
    for (const k of Object.keys(s.generatedAudioPaths || {})) {
      if (k.startsWith(prefix) && s.generatedAudioPaths[k]?.path) return true;
    }
    return false;
  });
  const ttsPlatform = useNovelStore((s) => s.ttsConfig.platform);
  const ttsPitch = useNovelStore((s) => s.ttsConfig.pitch);
  const ttsSpeed = useNovelStore((s) => s.ttsConfig.speed);
  const hasVisualDna = useNovelStore(
    (s) => !!(s.visualDnaPrompt?.trim() || s.mediaStylePreset?.trim()),
  );
  const humanEdited = useNovelStore(
    (s) => !!s.humanEditFlags?.[s.chuong_dang_chon]?.edited,
  );

  const store = useNovelStore.getState;
  const [collapsed, setCollapsed] = useState(true);
  const [metaLoading, setMetaLoading] = useState(false);
  const [thumbRegenLoading, setThumbRegenLoading] = useState(false);
  const [thumbFromLineLoading, setThumbFromLineLoading] = useState(false);
  const [thumbImageLoading, setThumbImageLoading] = useState(false);
  const [competitorDnaLoading, setCompetitorDnaLoading] = useState(false);
  const [zoomThumbUrl, setZoomThumbUrl] = useState<string | null>(null);

  const gate = evaluateWordGate(script, soTuChuong);
  const yt = mergeYoutubeSafe(youtubeSafe);

  const thumbImageUrl =
    (asset.thumbnailImagePath || '').trim() ||
    (thumbImageFromStore || '').trim() ||
    '';

  const hasHook = (asset.hook || '').trim().length > 40;
  const hasSeoTitle = (asset.seoTitle || '').trim().length > 8;
  const hasSeoDescription = (asset.seoDescription || '').trim().length > 40;
  const hasThumbPrompt = (asset.thumbnailPrompt || '').trim().length > 20;
  const titleLen = (asset.seoTitle || '').length;
  const mobileTitle = useMemo(
    () => scoreTitleMobileDiscipline(asset.seoTitle || ''),
    [asset.seoTitle],
  );
  const overlaySuggestions = useMemo(() => {
    const base = suggestThumbOverlayTexts({
      seoTitle: asset.seoTitle || '',
      hook: asset.hook || script.slice(0, 400),
      thumbnailLine: asset.thumbnailLine || '',
      max: 4,
    });
    const st = store();
    const extra = matrixThumbOverlaySuggestions(
      composeMatrix({
        chu_de: st.setup?.chu_de,
        phong_cach: st.setup?.phong_cach,
        mo_ta: st.setup?.mo_ta,
      }),
    );
    return Array.from(new Set([...extra, ...base])).slice(0, 6);
  }, [asset.seoTitle, asset.hook, asset.thumbnailLine, script, store]);
  const titleVariants = useMemo(() => {
    const stored = asset.seoTitleVariants || [];
    if (stored.length >= 3) return stored;
    const hook = (asset.hook || script.slice(0, 600) || '').trim();
    if (hook.length < 20) return stored;
    return buildFiveTitleFormulas({
      hook,
      novelTitle: store().ten_tac_pham,
      seed: ch * 97,
    });
  }, [asset.seoTitleVariants, asset.hook, script, ch, store]);

  // Tự chấm psych SEO — lọc pass/fail checklist khi điểm thấp
  const metaScores = useMemo(() => {
    if (!hasSeoTitle && !hasSeoDescription && !(asset.thumbnailLine || '').trim()) {
      return null;
    }
    return scoreYoutubeMetaFields({
      seoTitle: asset.seoTitle || '',
      thumbnailLine: asset.thumbnailLine || '',
      seoDescription: asset.seoDescription || '',
    });
  }, [
    asset.seoTitle,
    asset.thumbnailLine,
    asset.seoDescription,
    hasSeoTitle,
    hasSeoDescription,
  ]);

  const overlayOk =
    !(asset.thumbnailLine || '').trim() ||
    isValidThumbOverlay(asset.thumbnailLine || '', asset.seoTitle || '');

  const items = buildYoutubeChecklist({
    hasScript: script.trim().length > 0,
    wordOk: gate.wordsOk,
    sceneCount: countSceneTags(script),
    minScenes: 3,
    editorVerdict: review?.verdict,
    ttsPlatform,
    ttsPitch,
    ttsSpeed,
    hasVisualDna,
    hasAudio,
    imageCount,
    videoCount,
    enforceEditorGate: yt.enforceEditorGate !== false,
    humanEdited,
    requireHumanEdit: yt.requireHumanEdit === true,
    hasHook,
    hasSeoTitle,
    hasSeoDescription,
    hasThumbnailPrompt: hasThumbPrompt,
    metaScores,
    seoTitleText: asset.seoTitle || '',
    hasThumbComposition: !!(asset.thumbCompositionId || '').trim(),
    overlayDisciplineOk: overlayOk && !!(asset.thumbnailLine || '').trim(),
  });

  const summary = summarizeChecklist(items);

  const patch = (partial: Partial<typeof asset>) => {
    store().setChapterHook(ch, partial);
  };

  const resolveMediaStyle = () =>
    store().visualDnaPrompt?.trim() ||
    store().mediaStylePreset?.trim() ||
    'cinematic natural realism, grounded production design, expressive lighting, tactile materials';

  /** Prefer competitor thumb DNA for thumb rewrite/gen style (does not touch global DNA). */
  const resolveThumbStyle = () =>
    (asset.competitorThumbDna || '').trim() || resolveMediaStyle();

  const readImageFile = (file: File): Promise<{ name: string; mimeType: string; data: string }> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Không đọc được ${file.name}`));
      reader.onload = () => {
        const result = String(reader.result || '');
        const data = result.includes(',') ? result.split(',')[1] : result;
        resolve({ name: file.name, mimeType: file.type || 'image/png', data });
      };
      reader.readAsDataURL(file);
    });

  const getVisionKeys = () => {
    if (store().aiMasterModel === 'llama' || store().aiMasterModel === 'grok') {
      return store().grokApiKeys?.length
        ? store().grokApiKeys
        : store().grokApiKey
          ? [store().grokApiKey]
          : [];
    }
    if (store().aiMasterModel === 'gpt4o') {
      return store().openaiApiKeys?.length
        ? store().openaiApiKeys
        : store().openaiApiKey
          ? [store().openaiApiKey]
          : [];
    }
    return store().apiKeys?.length ? store().apiKeys : store().apiKey ? [store().apiKey] : [];
  };

  /** Upload 1–3 competitor thumbs → extract DNA (thumb-only, not global visual DNA). */
  const handleUploadCompetitorThumb = async (files: FileList | null) => {
    const imageFiles = Array.from(files || []).filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length < 1 || imageFiles.length > 3) {
      toast.info('Notice', 'Chọn 1–3 ảnh thumbnail đối thủ để quét DNA.');
      return;
    }
    const apiKeys = getVisionKeys();
    if (apiKeys.length === 0) {
      toast.info(
        'Notice',
        'Chưa có API key cho AI vision (Cài đặt / Header) để phân tích DNA thumbnail.',
      );
      return;
    }

    setCompetitorDnaLoading(true);
    try {
      // Preview first image as data URL (capped ~900KB to avoid bloating persist)
      const first = imageFiles[0];
      const previewDataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(new Error('preview fail'));
        r.onload = () => resolve(String(r.result || ''));
        r.readAsDataURL(first);
      });
      if (previewDataUrl.length <= 900_000) {
        patch({ competitorThumbPreview: previewDataUrl });
      } else {
        patch({ competitorThumbPreview: '' });
        toast.info('Notice', 'Ảnh lớn — chỉ lưu DNA, bỏ preview để tránh phình store().');
      }

      const images = await Promise.all(imageFiles.map(readImageFile));
      const res = await fetch(API.generate, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestType: 'ANALYZE_VISUAL_DNA',
          apiKeys,
          model: store().aiMasterModel,
          payload: { images, mode: 'thumb_competitor' },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Lỗi phân tích DNA thumbnail đối thủ.');
      }
      const data = await res.json();
      const dna = String(data.visualDnaPrompt || data.prompt || '').trim();
      if (!dna) throw new Error('AI không trả về DNA thumbnail hợp lệ.');
      patch({ competitorThumbDna: dna });
      toast.info(
        'Notice',
        `Đã khóa DNA từ ${imageFiles.length} thumbnail đối thủ. Gen ảnh sẽ nhái DNA, giữ Thumb prompt.`,
      );
    } catch (err: unknown) {
      toast.info(
        'Notice',
        `❌ Lỗi DNA đối thủ: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setCompetitorDnaLoading(false);
    }
  };

  const handleClearCompetitor = () => {
    patch({ competitorThumbDna: '', competitorThumbPreview: '' });
    toast.info('Notice', 'Đã xóa DNA thumbnail đối thủ.');
  };

  const characterHint = () => {
    const names = store().nhan_vat || [];
    if (!names.length) return '';
    const primary = names[0];
    const prof = store().nhan_vat_prompts?.[primary];
    const look =
      (typeof prof === 'object' && prof
        ? (prof as { prompt?: string; ngoai_hinh?: string }).prompt ||
          (prof as { ngoai_hinh?: string }).ngoai_hinh
        : '') || '';
    return [primary, look].filter(Boolean).join(' — ').slice(0, 220);
  };

  const styleEngineSeo = () => {
    const s = store();
    return {
      chu_de: s.setup?.chu_de,
      phong_cach: s.setup?.phong_cach,
      styleEngineId: s.activeStyleEngineId,
    };
  };

  /** Apply High-CTR composition preset + rebuild formula thumb prompt */
  const handleSelectComposition = (id: ThumbCompositionId) => {
    try {
      const base = buildThumbnailPrompt({
        hook: asset.hook || script.slice(0, 400),
        thumbnailLine: asset.thumbnailLine || '',
        visualDna: resolveMediaStyle(),
        characterHint: characterHint(),
        compositionId: id,
        competitorThumbDna: undefined, // keep stored prompt clean; DNA blends at gen
        styleEngine: styleEngineSeo(),
      });
      patch({ thumbCompositionId: id, thumbnailPrompt: base });
      toast.info('Notice', `Đã khóa bố cục: ${id.replace(/_/g, ' ')}`);
    } catch (err: unknown) {
      // Still save selection if formula fails (e.g. missing DNA) — user can Meta later
      patch({ thumbCompositionId: id });
      toast.info(
        'Notice',
        err instanceof Error
          ? err.message
          : 'Đã chọn bố cục — cần Visual DNA để rebuild prompt.',
      );
    }
  };

  const applyTitleVariant = (title: string) => {
    const t = enforceMobileTitle(title.normalize('NFC').trim(), YOUTUBE_MOBILE_TITLE_MAX);
    if (!t) return;
    patch({ seoTitle: t.slice(0, YOUTUBE_TITLE_HARD_MAX) });
  };

  const applyOverlaySuggestion = (line: string) => {
    const t = line.normalize('NFC').trim().slice(0, 30);
    if (!t) return;
    patch({ thumbnailLine: t });
  };

  /** Viết lại không Thumbnail line — AI đổi wording, không bám text overlay */
  const handleRewriteThumbPrompt = async () => {
    const current = (asset.thumbnailPrompt || '').trim();
    // Content prompt only — competitor DNA stays in competitorThumbDna and blends at gen-time
    const seed =
      current ||
      buildThumbnailPrompt({
        hook: asset.hook || script.slice(0, 400),
        thumbnailLine: '',
        visualDna: resolveMediaStyle(),
        characterHint: characterHint(),
        compositionId: asset.thumbCompositionId || undefined,
        styleEngine: styleEngineSeo(),
      });
    setThumbRegenLoading(true);
    try {
      const next = await regenPromptAction({
        apiKey: store().apiKey,
        apiKeys: store().apiKeys || [],
        sceneIndex: YOUTUBE_THUMB_SCENE_INDEX,
        promptIndex: 0,
        sentence:
          asset.hook?.slice(0, 200) ||
          'YouTube thumbnail still — high CTR, readable face, negative space for bold text. Do NOT bake on-image overlay text into the prompt.',
        currentPrompt: seed,
        // Style hint for rewrite; competitor DNA preferred when set (not written into stored prompt)
        style: resolveThumbStyle(),
        nhan_vat_prompts: store().nhan_vat_prompts || {},
      });
      if (next?.trim()) {
        patch({ thumbnailPrompt: next.trim() });
      } else {
        toast.info('Notice', 'Không nhận được prompt mới. Thử lại.');
      }
    } catch (err: unknown) {
      toast.info('Notice', `❌ Lỗi viết lại Thumb prompt: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setThumbRegenLoading(false);
    }
  };

  /**
   * Viết lại với Thumbnail line —
   * rebuild formula + AI polish với sentence = thumbnail line (≤30).
   */
  const handleRewriteThumbFromLine = async () => {
    const line = (asset.thumbnailLine || '').trim().slice(0, 30);
    if (!line) {
      toast.info('Notice', '⚠️ Chưa có Thumbnail line. Nhập dòng chữ trên ảnh (≤30) trước.');
      return;
    }
    setThumbFromLineLoading(true);
    try {
      const base = buildThumbnailPrompt({
        hook: asset.hook || script.slice(0, 400),
        thumbnailLine: line,
        visualDna: resolveMediaStyle(),
        characterHint: characterHint(),
        compositionId: asset.thumbCompositionId || undefined,
        styleEngine: styleEngineSeo(),
      });
      let next = base;
      try {
        const polished = await regenPromptAction({
          apiKey: store().apiKey,
          apiKeys: store().apiKeys || [],
          sceneIndex: YOUTUBE_THUMB_SCENE_INDEX,
          promptIndex: 0,
          sentence: `YouTube thumbnail text overlay mood: "${line}". Build a cinematic EN still prompt; leave clean space for bold overlay text "${line}" (2-4 words only, not full video title).`,
          currentPrompt: base,
          style: resolveThumbStyle(),
          nhan_vat_prompts: store().nhan_vat_prompts || {},
        });
        if (polished?.trim()) next = polished.trim();
      } catch {
        // formula base is enough if AI fails
      }
      patch({ thumbnailPrompt: next });
    } catch (err: unknown) {
      toast.info('Notice', 
        `❌ Lỗi viết lại theo Thumbnail line: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setThumbFromLineLoading(false);
    }
  };

  /** Gen / tạo lại ảnh thumbnail — blend competitor DNA at gen-time, keep stored prompt clean */
  const handleGenThumbImage = async () => {
    let contentPrompt = (asset.thumbnailPrompt || '').trim();
    if (!contentPrompt) {
      contentPrompt = buildThumbnailPrompt({
        hook: asset.hook || 'High tension mystery scene',
        thumbnailLine: asset.thumbnailLine || '',
        visualDna: resolveThumbStyle(),
        characterHint: characterHint(),
        compositionId: asset.thumbCompositionId,
        competitorThumbDna: asset.competitorThumbDna,
        styleEngine: styleEngineSeo(),
      });
      patch({ thumbnailPrompt: contentPrompt });
    }
    if (!hasImageCredentials(useNovelStore.getState())) {
      toast.info('Notice', 'Chưa cấu hình credential cho engine sinh ảnh (Cấu hình đầu ra).');
      return;
    }
    if (!store().deductCredits(1)) {
      toast.info('Notice', '⚠️ Hết Tín dụng. Nạp thêm để gen ảnh thumbnail.');
      return;
    }

    const competitorDna = (asset.competitorThumbDna || '').trim();
    const prompt = competitorDna
      ? blendThumbPromptWithCompetitorDna({
          thumbnailPrompt: contentPrompt,
          competitorDna,
        })
      : contentPrompt;

    setThumbImageLoading(true);

    try {
      const st = useNovelStore.getState();
      const cookiesList = st.googleStudioCookies || [];
      const selectedCookie = cookiesList[0] || st.googleStudioCookie || '';
      let resolvedImageApiKey = '';
      if (st.imageProvider === 'openai') {
        resolvedImageApiKey = st.openaiApiKey || st.openaiApiKeys?.[0] || '';
      } else if (st.imageProvider === 'gemini') {
        resolvedImageApiKey = st.apiKey || st.apiKeys?.[0] || '';
      } else if (st.imageProvider === 'grok') {
        resolvedImageApiKey = st.grokApiKey || st.grokApiKeys?.[0] || '';
      }

      const data = await generateImageAction({
        prompt,
        sentence: asset.thumbnailLine || asset.hook || 'YouTube thumbnail',
        chapterNum: ch,
        sceneIndex: YOUTUBE_THUMB_SCENE_INDEX,
        promptIndex: 0,
        savePathImage: st.savePathImage || '',
        googleDrivePath: st.googleDrivePath || '',
        ten_tac_pham: st.ten_tac_pham || 'Kịch Bản Vô Danh',
        selectedCookie,
        nhan_vat: st.nhan_vat || [],
        nhan_vat_prompts: st.nhan_vat_prompts,
        apiKey: st.apiKey,
        apiKeys: st.apiKeys || [],
        model: st.imageModel,
        imageProvider: st.imageProvider,
        imageApiKey: resolvedImageApiKey,
        // Thumb YouTube vẫn ưu tiên 16:9 (không đè aspect scene dọc nếu user chỉ gen short)
        imageAspectRatio: '16:9',
        imageCount: Math.min(4, Math.max(2, st.imageCount || 2)),
        aiMasterApiKey: st.aiMasterApiKey,
      });

      if (data.usedApiKey) {
        st.prioritizeApiKey(data.usedApiKey);
      }

      const cacheBust = Date.now();
      const imagePaths =
        data.imagePaths && data.imagePaths.length > 0 ? data.imagePaths : [data.imagePath];
      const cacheBusted = imagePaths
        .filter(Boolean)
        .map((path) => appendImageCacheBust(path, cacheBust));
      const primary =
        cacheBusted[0] || appendImageCacheBust(data.imagePath, cacheBust);

      store().addGeneratedImage(thumbAssetKey, primary);
      store().addGeneratedImageVariants(thumbAssetKey, cacheBusted);
      patch({ thumbnailImagePath: primary });
    } catch (err: unknown) {
      toast.info('Notice', `❌ Lỗi gen ảnh thumbnail: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setThumbImageLoading(false);
    }
  };

  /**
   * Meta: psych SEO via /api/youtube-meta — server score→rewrite (maxRounds),
   * client re-score + outer rewrite nếu dưới YOUTUBE_META_PASS_SCORE.
   * CẤM soft-success điểm thấp (B10).
   */
  const regeneratePublishMeta = async () => {
    if (!script.trim()) return;

    const visualDna = (
      store().visualDnaPrompt ||
      store().mediaStylePreset ||
      ''
    ).trim();
    if (!visualDna) {
      toast.error(
        'Meta SEO',
        'Thiếu Visual DNA / Media Style — mở Media Config trước khi gen Meta.',
      );
      return;
    }

    setMetaLoading(true);
    try {
      const scenes = parseScenes(script);
      const sceneMeta = scenes.map((sc, i) => {
        const key = sceneAssetKey(ch, i);
        const dur =
          store().generatedAudioPaths[key]?.duration ||
          Math.max(15, (sc.content?.length || 100) / 12);
        return { title: sc.title, durationSec: dur, content: sc.content };
      });
      const chapters = buildYoutubeChapters(sceneMeta);
      const chaptersText = chapters.map((c) => c.line).join('\n');

      const chProfile = store().channels?.[store().activeChannelId || ''];
      // Ban current weak fields so rewrite must diversify
      const usedTitles = [
        ...(chProfile?.usedHooks || []),
        asset.seoTitle || '',
      ].filter(Boolean);
      const usedThumbLines = [
        ...(chProfile?.usedThumbnailNotes || []),
        asset.thumbnailLine || '',
      ].filter(Boolean);

      const result = await fetchYoutubeMetaWithQA({
        script,
        novelTitle: store().ten_tac_pham,
        chapter: ch,
        chaptersText,
        visualDna,
        characterHint:
          (store().nhan_vat || []).slice(0, 2).join(' and ') || undefined,
        usedTitles,
        usedThumbLines,
        maxRounds: 5,
        outerRetries: 2,
        ...styleEngineSeo(),
      });

      const variants = buildFiveTitleFormulas({
        hook: result.hook || result.seoTitle,
        novelTitle: store().ten_tac_pham,
        seed: (ch || 1) * 97 + result.rounds,
      });
      // Prefer mobile title: if meta title >70, try best formula ≤70 with solid length
      let seoTitle = (result.seoTitle || '').normalize('NFC').trim();
      if (seoTitle.length > YOUTUBE_MOBILE_TITLE_MAX) {
        const clipped = enforceMobileTitle(seoTitle, YOUTUBE_MOBILE_TITLE_MAX);
        if (clipped.length >= 28) seoTitle = clipped;
      }
      // Rebuild thumb prompt with saved composition when present
      let thumbPrompt = result.thumbnailPrompt || '';
      const compositionId = (asset.thumbCompositionId || '').trim();
      if (compositionId && (result.hook || result.thumbnailLine)) {
        try {
          thumbPrompt = buildThumbnailPrompt({
            hook: result.hook || result.seoTitle,
            thumbnailLine: result.thumbnailLine,
            visualDna,
            characterHint:
              (store().nhan_vat || []).slice(0, 2).join(' and ') || undefined,
            compositionId,
            styleEngine: styleEngineSeo(),
          });
        } catch {
          /* keep server prompt */
        }
      }

      store().setChapterHook(ch, {
        hook: result.hook,
        thumbnailLine: result.thumbnailLine,
        seoTitle,
        seoTitleVariants: variants,
        seoDescription: result.seoDescription,
        seoTags: normalizeHashtagField(result.seoTags),
        thumbnailPrompt: thumbPrompt,
        thumbCompositionId: compositionId || asset.thumbCompositionId,
      });

      try {
        if (result.seoTitle) {
          store().rememberChannelMotif?.('hook', result.seoTitle.slice(0, 120));
        }
        if (result.thumbnailLine) {
          store().rememberChannelMotif?.(
            'thumb',
            result.thumbnailLine.slice(0, 80),
          );
        }
      } catch {
        /* ignore */
      }

      const scoreLine = formatMetaScoreLine(result.scores);
      if (!result.passed) {
        pushToast(
          'error',
          'Meta QA — điểm thấp',
          `${scoreLine} · đã rewrite ${result.rounds} vòng · chưa đạt ≥${YOUTUBE_META_PASS_SCORE}. Bấm Meta lại hoặc sửa tay Title/Thumb/Desc.`,
          14_000,
        );
        return;
      }
      pushToast(
        'success',
        'Meta SEO',
        `✅ Pass · ${scoreLine} · ${result.source} · ${result.rounds} vòng`,
        8_000,
      );
    } catch (err) {
      toast.error(
        'Meta SEO',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setMetaLoading(false);
    }
  };

  const exportPack = useMemo((): YoutubeExportPack | null => {
    if (!script.trim()) return null;
    const scenes = parseScenes(script);
    const sceneMeta = scenes.map((sc, i) => {
      const key = sceneAssetKey(ch, i);
      const dur =
        store().generatedAudioPaths[key]?.duration ||
        Math.max(15, (sc.content?.length || 100) / 12);
      return { title: sc.title, durationSec: dur, content: sc.content, index: i };
    });
    const chapters = buildYoutubeChapters(
      sceneMeta.map((s) => ({
        title: s.title,
        durationSec: s.durationSec,
        content: s.content,
      })),
    );
    const chaptersText = chapters.map((c) => c.line).join('\n');
    const cutPlans = sceneMeta.map((s) => {
      const prompts = store().generatedPrompts[sceneAssetKey(ch, s.index)] || [];
      return buildCutPlan({
        chapter: ch,
        sceneIndex: s.index,
        durationSec: s.durationSec,
        prompts: prompts as {
          timestamp?: string;
          image_prompt?: string;
          video_prompt?: string;
          emotion?: string;
        }[],
      });
    });

    const st = store();
    const seoTitle =
      asset.seoTitle ||
      buildSeoTitleFromHook(asset.hook, asset.thumbnailLine, st.ten_tac_pham, {
        chu_de: st.setup?.chu_de,
        phong_cach: st.setup?.phong_cach,
        styleEngineId: st.activeStyleEngineId,
      });
    const seoTags = normalizeHashtagField(asset.seoTags || '');
    const seoDescription =
      asset.seoDescription ||
      buildSeoDescription({
        hook: asset.hook,
        thumbnailLine: asset.thumbnailLine,
        tags: seoTags,
        chaptersText,
        novelTitle: store().ten_tac_pham,
        chapter: ch,
      });

    return {
      version: 2,
      generatedAt: new Date().toISOString(),
      title: store().ten_tac_pham || 'Untitled',
      chapter: ch,
      hook: asset.hook,
      thumbnailLine: asset.thumbnailLine,
      seoTitle,
      seoDescription,
      seoTags,
      thumbnailPrompt: asset.thumbnailPrompt || '',
      thumbnailImagePath: thumbImageUrl || asset.thumbnailImagePath || '',
      chaptersText,
      chapters,
      cutPlans,
      checklist: items,
      voiceDna: {
        platform: store().ttsConfig.platform,
        voice: store().ttsConfig.voice,
        speed: store().ttsConfig.speed,
        pitch: store().ttsConfig.pitch,
      },
      purpose: [
        '1) Copy seoTitle → Title YouTube',
        '2) Copy seoDescription → Description',
        '3) thumbnailPrompt → gen ảnh thumb (nút Gen ảnh)',
        '4) Hook ~30s → VO cold open',
      ],
      notes: ['Pack = hồ sơ đăng, không tự upload.'],
    };
  }, [script, ch, store, asset, items, thumbImageUrl]);

  if (!script.trim() && !review) return null;

  const downloadPack = () => {
    if (!exportPack) return;
    const blob = new Blob([JSON.stringify(exportPack, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `youtube_pack_ch${ch}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    const txt = [
      '=== YOUTUBE PUBLISH SHEET ===',
      `Series: ${exportPack.title} · Ch.${exportPack.chapter}`,
      '',
      '--- TITLE ---',
      exportPack.seoTitle,
      '',
      '--- DESCRIPTION ---',
      exportPack.seoDescription,
      '',
      '--- TAGS ---',
      exportPack.seoTags,
      '',
      '--- HOOK ~30s ---',
      exportPack.hook,
      '',
      '--- THUMBNAIL LINE ---',
      exportPack.thumbnailLine,
      '',
      '--- THUMBNAIL PROMPT ---',
      exportPack.thumbnailPrompt,
      '',
      '--- THUMBNAIL IMAGE ---',
      exportPack.thumbnailImagePath || '(chưa gen)',
      '',
      '--- CHAPTERS ---',
      exportPack.chaptersText,
    ].join('\n');
    const blob2 = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url2 = URL.createObjectURL(blob2);
    const a2 = document.createElement('a');
    a2.href = url2;
    a2.download = `youtube_publish_ch${ch}.txt`;
    a2.click();
    URL.revokeObjectURL(url2);
  };

  const border =
    summary.ready
      ? 'border-emerald-500/70 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]'
      : summary.fail > 0
        ? 'border-red-900/50'
        : 'border-amber-500/70 shadow-[0_0_0_1px_rgba(245,158,11,0.12)]';

  return (
    <div
      id="youtube-studio-panel"
      className={`group relative bg-zinc-950/20 border-2 ${border} rounded-lg ${
        collapsed ? 'p-3' : 'p-5'
      } transition-colors flex flex-col gap-3 shrink-0 w-full min-w-0`}
    >
      {/* Header — giống SceneCard (thu gọn / mở) */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex flex-1 items-center gap-2 min-w-0 text-left rounded-lg px-3 py-2 border border-zinc-900 bg-zinc-900/30 hover:bg-zinc-900/50 transition-colors cursor-pointer"
          title={collapsed ? 'Mở rộng YouTube' : 'Thu gọn YouTube'}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          )}
          <PlaySquare className="h-3.5 w-3.5 text-red-500 shrink-0" />
          <h4
            className={`text-xs font-bold uppercase tracking-widest font-sans truncate ${
              summary.ready ? 'text-emerald-400' : 'text-amber-500'
            }`}
          >
            YouTube Studio
          </h4>
          <span
            className={`text-[9px] font-bold tabular-nums px-1.5 py-0.5 rounded border shrink-0 ${
              summary.ready
                ? 'border-emerald-800 text-emerald-400 bg-emerald-950/40'
                : summary.fail > 0
                  ? 'border-red-900 text-red-400 bg-red-950/30'
                  : 'border-amber-900/50 text-amber-400/90 bg-amber-950/30'
            }`}
            title={items
              .map((i) => `${i.level === 'pass' ? '✓' : i.level === 'fail' ? '✗' : '~'} ${i.label}`)
              .join('\n')}
          >
            {summary.pass}/{items.length}
          </span>
          {metaScores ? (
            <span
              className={`text-[9px] font-bold tabular-nums px-1.5 py-0.5 rounded border shrink-0 ${
                metaScores.pass
                  ? 'border-sky-800 text-sky-300 bg-sky-950/40'
                  : 'border-red-900/80 text-red-300 bg-red-950/30'
              }`}
              title={formatMetaScoreLine(metaScores)}
            >
              SEO {metaScores.average}
              {metaScores.pass ? '✓' : '↓'}
            </span>
          ) : null}
        </button>

        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          <button
            type="button"
            onClick={() => void regeneratePublishMeta()}
            disabled={metaLoading || !script.trim()}
            className="flex items-center gap-1 rounded bg-sky-500/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-sky-400 border border-sky-800/40 hover:bg-sky-500/20 disabled:opacity-40 font-sans"
            title={`Psych SEO: tự chấm + rewrite đến ≥${YOUTUBE_META_PASS_SCORE}/10 (Title·Thumb·Desc)`}
          >
            {metaLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Meta
          </button>
          <button
            type="button"
            onClick={downloadPack}
            disabled={!exportPack}
            className="flex items-center gap-1 rounded bg-red-500/15 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-red-300 border border-red-900/40 hover:bg-red-500/25 disabled:opacity-40 font-sans"
          >
            <Download className="h-3.5 w-3.5" />
            Pack
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 hover:text-white border border-zinc-800 px-2 py-1 rounded cursor-pointer font-sans"
          >
            {collapsed ? 'Mở' : 'Thu gọn'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0 flex flex-col gap-2">
              <SeoField
                label={`SEO Title (${titleLen}/${YOUTUBE_TITLE_HARD_MAX} · mobile ≤${YOUTUBE_MOBILE_TITLE_MAX}${
                  mobileTitle.mobileOk ? ' ✓' : ' ⚠ cắt app'
                })`}
                value={asset.seoTitle || ''}
                onChange={(v) => {
                  patch({ seoTitle: v.slice(0, YOUTUBE_TITLE_HARD_MAX) });
                }}
                onBlur={() => {
                  const raw = (asset.seoTitle || '').trim().slice(0, YOUTUBE_TITLE_HARD_MAX);
                  if (raw !== (asset.seoTitle || '')) patch({ seoTitle: raw });
                }}
                rows={3}
                placeholder="5 công thức tâm lý · tò mò · KHÔNG thoại · ưu tiên ≤70 ký tự mobile"
              />
              {titleVariants.length > 0 ? (
                <div className="rounded-lg border border-sky-900/40 bg-sky-950/15 p-2.5 flex flex-col gap-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-sky-300">
                    5 công thức title
                  </div>
                  <div className="flex flex-col gap-1 max-h-44 overflow-y-auto pr-0.5">
                    {titleVariants.map((v) => {
                      const active =
                        (asset.seoTitle || '').trim() === v.title.trim();
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => applyTitleVariant(v.title)}
                          className={`text-left rounded-md border px-2 py-1.5 transition-colors cursor-pointer ${
                            active
                              ? 'border-sky-500/60 bg-sky-500/15'
                              : 'border-zinc-800 bg-black/30 hover:border-sky-800/50'
                          }`}
                          title={v.labelVi}
                        >
                          <div className="text-[8px] font-bold uppercase tracking-wide text-sky-400/90">
                            {v.labelVi}
                            <span className="text-zinc-600 font-mono ml-1.5 normal-case">
                              {v.title.length} ký tự
                            </span>
                          </div>
                          <div className="text-[11px] text-zinc-200 leading-snug mt-0.5">
                            {v.title}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="min-w-0 flex flex-col gap-2">
              <SeoField
                label={`Thumbnail line / chữ đè (${(asset.thumbnailLine || '').length}/30 · 2–4 từ)`}
                value={asset.thumbnailLine || ''}
                onChange={(v) => {
                  patch({ thumbnailLine: v.slice(0, 30) });
                }}
                onBlur={() => {
                  const raw = (asset.thumbnailLine || '').trim().slice(0, 30);
                  if (raw !== (asset.thumbnailLine || '')) patch({ thumbnailLine: raw });
                }}
                rows={2}
                placeholder="2–4 từ · KHÔNG lặp title · vd. CHÊ TÔI YẾU?"
              />
              {overlaySuggestions.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[9px] font-bold uppercase text-zinc-500 self-center">
                    Gợi ý đè:
                  </span>
                  {overlaySuggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => applyOverlaySuggestion(s)}
                      className="text-[10px] font-bold uppercase tracking-wide rounded-full border border-amber-900/40 bg-amber-950/30 text-amber-200 px-2 py-0.5 hover:bg-amber-500/20 cursor-pointer"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
              {!overlayOk && (asset.thumbnailLine || '').trim() ? (
                <p className="text-[10px] text-rose-400/90">
                  Chữ đè đang trùng title hoặc quá dài — chọn gợi ý 2–4 từ.
                </p>
              ) : null}
            </div>

            <div className="sm:col-span-2">
              <SeoField
                label="Description (lead = Thumbnail)"
                value={asset.seoDescription || ''}
                onChange={(v) => {
                  patch({ seoDescription: v });
                }}
                rows={8}
                placeholder="Mở bằng Thumbnail → khuấy tò mò → chapters + tags"
              />
            </div>
            <YoutubeThumbPanel
              ch={ch}
              thumbAssetKey={thumbAssetKey}
              thumbnailLine={asset.thumbnailLine || ''}
              thumbnailPrompt={asset.thumbnailPrompt || ''}
              thumbImageUrl={thumbImageUrl}
              competitorThumbDna={asset.competitorThumbDna || ''}
              competitorThumbPreview={asset.competitorThumbPreview || ''}
              compositionId={asset.thumbCompositionId || ''}
              thumbRegenLoading={thumbRegenLoading}
              thumbFromLineLoading={thumbFromLineLoading}
              thumbImageLoading={thumbImageLoading}
              competitorDnaLoading={competitorDnaLoading}
              zoomThumbUrl={zoomThumbUrl}
              setZoomThumbUrl={setZoomThumbUrl}
              onPromptChange={(v) => patch({ thumbnailPrompt: v })}
              onRewriteNoLine={() => void handleRewriteThumbPrompt()}
              onRewriteWithLine={() => void handleRewriteThumbFromLine()}
              onGenImage={() => void handleGenThumbImage()}
              onUploadCompetitor={(files) => void handleUploadCompetitorThumb(files)}
              onClearCompetitor={() => handleClearCompetitor()}
              onSelectComposition={handleSelectComposition}
              onPickVariant={(src) => {
                store().addGeneratedImage(thumbAssetKey, src);
                patch({ thumbnailImagePath: src });
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
