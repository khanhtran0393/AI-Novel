'use client';
import {
  API,
  chapterAssetPrefix,
  imageAssetKey,
  sceneAssetKey,
} from '@/contracts';

import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
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
  YOUTUBE_THUMB_SCENE_INDEX,
  type YoutubeExportPack,
} from '@/lib/youtubeSafe';
import { countSceneTags, evaluateWordGate, parseScenes } from '@/lib/storyWriting';
import {
  generateImageAction,
  regenPromptAction,
} from '../../modules/imageModule';
import {
  PlaySquare,
  Download,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { toast } from '@/lib/toastBus';
import SeoField, { hasImageCredentials } from './SeoField';
import YoutubeThumbPanel from './YoutubeThumbPanel';

export default function YoutubeSafeChecklist() {
  /**
   * Shallow snapshot of only fields that affect this checklist UI.
   * Full useNovelStore() re-rendered on every media/TTS path update → main-thread lag.
   * Handlers still use useNovelStore.getState() for one-shot actions.
   */
  const snap = useNovelStore(
    useShallow((s) => {
      const ch = s.chuong_dang_chon;
      const chapter = s.danh_sach_chuong.find((c) => c.so_chuong === ch);
      const script = chapter?.noi_dung || '';
      const chPrefix = chapterAssetPrefix(ch);
      const thumbAssetKey = imageAssetKey(ch, YOUTUBE_THUMB_SCENE_INDEX, 0);
      const hook = s.chapterHooks?.[ch];
      let imageCount = 0;
      let videoCount = 0;
      let hasAudio = false;
      for (const k of Object.keys(s.generatedImages || {})) {
        if (k.startsWith(chPrefix)) imageCount++;
      }
      for (const k of Object.keys(s.generatedVideos || {})) {
        if (k.startsWith(chPrefix)) videoCount++;
      }
      for (const k of Object.keys(s.generatedAudioPaths || {})) {
        if (k.startsWith(chPrefix) && s.generatedAudioPaths[k]?.path) {
          hasAudio = true;
          break;
        }
      }
      return {
        ch,
        script,
        soTuChuong: s.setup.so_tu_chuong || 4250,
        review: s.editorReviews[ch],
        youtubeSafe: s.youtubeSafe,
        asset: hook || {
          hook: '',
          thumbnailLine: '',
          seoTitle: '',
          seoDescription: '',
          seoTags: '',
          thumbnailPrompt: '',
          thumbnailImagePath: '',
        },
        thumbImageFromStore: s.generatedImages?.[thumbAssetKey] || '',
        imageCount,
        videoCount,
        hasAudio,
        ttsPlatform: s.ttsConfig.platform,
        ttsPitch: s.ttsConfig.pitch,
        ttsSpeed: s.ttsConfig.speed,
        hasVisualDna: !!(s.visualDnaPrompt?.trim() || s.mediaStylePreset?.trim()),
        humanEdited: !!s.humanEditFlags?.[ch]?.edited,
        ten_tac_pham: s.ten_tac_pham,
        visualDnaPrompt: s.visualDnaPrompt,
        mediaStylePreset: s.mediaStylePreset,
      };
    }),
  );

  const store = useNovelStore.getState;
  const [collapsed, setCollapsed] = useState(true);
  const [metaLoading, setMetaLoading] = useState(false);
  const [thumbRegenLoading, setThumbRegenLoading] = useState(false);
  const [thumbFromLineLoading, setThumbFromLineLoading] = useState(false);
  const [thumbImageLoading, setThumbImageLoading] = useState(false);
  const [competitorDnaLoading, setCompetitorDnaLoading] = useState(false);
  const [zoomThumbUrl, setZoomThumbUrl] = useState<string | null>(null);

  const script = snap.script;
  const gate = evaluateWordGate(script, snap.soTuChuong);
  const review = snap.review;
  const ch = snap.ch;
  const yt = mergeYoutubeSafe(snap.youtubeSafe);
  const asset = snap.asset;
  const imageCount = snap.imageCount;
  const videoCount = snap.videoCount;
  const hasAudio = snap.hasAudio;
  const thumbAssetKey = imageAssetKey(ch, YOUTUBE_THUMB_SCENE_INDEX, 0);

  const thumbImageUrl =
    (asset.thumbnailImagePath || '').trim() ||
    (snap.thumbImageFromStore || '').trim() ||
    '';

  const hasHook = (asset.hook || '').trim().length > 40;
  const hasSeoTitle = (asset.seoTitle || '').trim().length > 8;
  const hasSeoDescription = (asset.seoDescription || '').trim().length > 40;
  const hasThumbPrompt = (asset.thumbnailPrompt || '').trim().length > 20;
  const titleLen = (asset.seoTitle || '').length;

  const items = buildYoutubeChecklist({
    hasScript: script.trim().length > 0,
    wordOk: gate.wordsOk,
    sceneCount: countSceneTags(script),
    minScenes: 3,
    editorVerdict: review?.verdict,
    ttsPlatform: snap.ttsPlatform,
    ttsPitch: snap.ttsPitch,
    ttsSpeed: snap.ttsSpeed,
    hasVisualDna: snap.hasVisualDna,
    hasAudio,
    imageCount,
    videoCount,
    enforceEditorGate: yt.enforceEditorGate !== false,
    humanEdited: snap.humanEdited,
    requireHumanEdit: yt.requireHumanEdit === true,
    hasHook,
    hasSeoTitle,
    hasSeoDescription,
    hasThumbnailPrompt: hasThumbPrompt,
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
      });
      let next = base;
      try {
        const polished = await regenPromptAction({
          apiKey: store().apiKey,
          apiKeys: store().apiKeys || [],
          sceneIndex: YOUTUBE_THUMB_SCENE_INDEX,
          promptIndex: 0,
          sentence: `YouTube thumbnail text overlay mood: "${line}". Build a cinematic EN still prompt; leave clean space for bold overlay text "${line}".`,
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
    const contentPrompt = (asset.thumbnailPrompt || '').trim();
    if (!contentPrompt) {
      toast.info('Notice', '⚠️ Chưa có Thumb prompt (EN). Bấm Meta hoặc viết lại prompt trước.');
      return;
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
    store().addGeneratedImage(thumbAssetKey, '');
    store().addGeneratedImageVariants(thumbAssetKey, []);

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
        .map((path) => `${path}?t=${cacheBust}`);
      const primary = cacheBusted[0] || `${data.imagePath}?t=${cacheBust}`;

      store().addGeneratedImage(thumbAssetKey, primary);
      store().addGeneratedImageVariants(thumbAssetKey, cacheBusted);
      patch({ thumbnailImagePath: primary });
    } catch (err: unknown) {
      toast.info('Notice', `❌ Lỗi gen ảnh thumbnail: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setThumbImageLoading(false);
    }
  };

  const regeneratePublishMeta = async () => {
    if (!script.trim()) return;

    const geminiKeys = [
      store().apiKey,
      ...(Array.isArray(store().apiKeys) ? store().apiKeys : []),
    ].filter((k): k is string => typeof k === 'string' && k.trim().length > 0);

    if (geminiKeys.length === 0) {
      toast.info('Notice', '⚠️ Chưa có Gemini API Key. Nhập API Key ở Header rồi bấm Meta.');
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

      // Channel anti-repeat + chính field hiện tại (tránh gen lại y hệt)
      const chProfile = store().channels?.[store().activeChannelId || ''];
      const usedTitles = [
        ...(chProfile?.usedHooks || []),
        asset.seoTitle || '',
      ].filter(Boolean);
      const usedThumbLines = [
        ...(chProfile?.usedThumbnailNotes || []),
        asset.thumbnailLine || '',
      ].filter(Boolean);

      const randomSeed = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${ch}`;

      // API-only: Gemini youtube-seo (không local template)
      const res = await fetch(API.navtools.youtubeSeo, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: script.slice(0, 12000),
          novelTitle: store().ten_tac_pham,
          apiKey: geminiKeys[0],
          apiKeys: geminiKeys,
          chapter: ch,
          randomSeed,
          temperature: 1.0,
          usedTitles,
          usedThumbLines,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(
          data?.error || `Meta API lỗi HTTP ${res.status}`,
        );
      }

      const payload = (data.data ?? data.result ?? data) as Record<string, unknown>;
      const title = String(
        payload.title || payload.seo_title || payload.seoTitle || '',
      )
        .normalize('NFC')
        .trim()
        .slice(0, 100);
      let description = String(
        payload.description ||
          payload.seo_description ||
          payload.seoDescription ||
          '',
      )
        .normalize('NFC')
        .replace(/——\s*HOOK\s*\(?30s?\)?\s*——/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 4500);
      const tagsRaw =
        (Array.isArray(payload.tags) ? payload.tags.join(' ') : payload.tags) ||
        payload.hashtags ||
        payload.seoTags ||
        '';
      const thumbnailLine = String(
        payload.thumbnailLine ||
          payload.thumbnail_line ||
          payload.thumb_line ||
          '',
      )
        .normalize('NFC')
        .trim()
        .slice(0, 30);
      const hook = String(payload.hook || asset.hook || '')
        .normalize('NFC')
        .trim();
      let thumbnailPrompt = String(
        payload.thumbnailPrompt || payload.thumbnail_prompt || '',
      )
        .normalize('NFC')
        .trim();

      if (!title) {
        throw new Error('API không trả SEO title');
      }

      // Nếu thiếu field phụ → bổ sung tối thiểu (vẫn giữ title/thumb từ API)
      if (!description) {
        description = buildSeoDescription({
          hook: hook || title,
          thumbnailLine: thumbnailLine || title.slice(0, 30),
          tags: String(tagsRaw || ''),
          chaptersText,
          novelTitle: store().ten_tac_pham,
          chapter: ch,
          forceThumbLead: true,
        });
      }
      if (!thumbnailPrompt) {
        thumbnailPrompt = buildThumbnailPrompt({
          hook: hook || title,
          thumbnailLine: thumbnailLine || title.slice(0, 30),
          visualDna: store().visualDnaPrompt || store().mediaStylePreset,
          characterHint:
            (store().nhan_vat || []).slice(0, 2).join(' and ') || undefined,
        });
      }

      const merged = {
        hook: hook || title,
        seoTitle: title,
        thumbnailLine: (thumbnailLine || title).slice(0, 30),
        seoDescription: description,
        seoTags: normalizeHashtagField(String(tagsRaw || '')),
        thumbnailPrompt,
      };

      store().setChapterHook(ch, {
        hook: merged.hook,
        thumbnailLine: merged.thumbnailLine,
        seoTitle: merged.seoTitle,
        seoDescription: merged.seoDescription,
        seoTags: merged.seoTags,
        thumbnailPrompt: merged.thumbnailPrompt,
      });

      try {
        if (merged.seoTitle) {
          store().rememberChannelMotif?.('hook', merged.seoTitle.slice(0, 120));
        }
        if (merged.thumbnailLine) {
          store().rememberChannelMotif?.('thumb', merged.thumbnailLine.slice(0, 80));
        }
      } catch {
        /* ignore */
      }

      const src = String(data.source || data.provider || 'gemini');
      if (data.warning || src.includes('local')) {
        toast.error(
          'Meta SEO',
          `API trả local/degraded — không chấp nhận fallback. ${String(data.warning || src).slice(0, 160)}`,
        );
        return;
      }
      toast.info('Notice', `✅ Meta SEO đã cập nhật · ${src}`);
    } catch (err) {
      toast.info('Notice', `❌ Meta API: ${err instanceof Error ? err.message : String(err)}`);
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

    const seoTitle =
      asset.seoTitle ||
      buildSeoTitleFromHook(asset.hook, asset.thumbnailLine, store().ten_tac_pham);
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
        </button>

        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          <button
            type="button"
            onClick={() => void regeneratePublishMeta()}
            disabled={metaLoading || !script.trim()}
            className="flex items-center gap-1 rounded bg-sky-500/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-sky-400 border border-sky-800/40 hover:bg-sky-500/20 disabled:opacity-40 font-sans"
            title="Gemini youtube-seo + parse cứng + fallback local nếu JSON hỏng"
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
            <SeoField
              label={`SEO Title (${titleLen}/100)`}
              value={asset.seoTitle || ''}
              onChange={(v) => {
                patch({ seoTitle: v.slice(0, 100) });
              }}
              onBlur={() => {
                const raw = (asset.seoTitle || '').trim().slice(0, 100);
                if (raw !== (asset.seoTitle || '')) patch({ seoTitle: raw });
              }}
              rows={3}
              placeholder="CTR tâm lý · tò mò + đe dọa · KHÔNG thoại · ≤100"
            />
            <SeoField
              label={`Thumbnail line (${(asset.thumbnailLine || '').length}/30)`}
              value={asset.thumbnailLine || ''}
              onChange={(v) => {
                patch({ thumbnailLine: v.slice(0, 30) });
              }}
              onBlur={() => {
                const raw = (asset.thumbnailLine || '').trim().slice(0, 30);
                if (raw !== (asset.thumbnailLine || '')) patch({ thumbnailLine: raw });
              }}
              rows={2}
              placeholder="≤30 ký tự — chữ trên ảnh, gợi tò mò"
            />
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
