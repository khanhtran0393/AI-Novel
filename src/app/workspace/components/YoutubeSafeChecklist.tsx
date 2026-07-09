'use client';

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
  generateYoutubeMetaWithQA,
  scoreYoutubeMetaFields,
  normalizeHashtagField,
  YOUTUBE_META_PASS_SCORE,
  type YoutubeExportPack,
  type YoutubeFieldScores,
} from '@/lib/youtubeSafe';
import { countSceneTags, evaluateWordGate, parseScenes } from '@/lib/storyWriting';
import {
  PlaySquare,
  Download,
  Copy,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

function Field({
  label,
  value,
  onChange,
  onBlur,
  rows = 4,
  mono,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  rows?: number;
  mono?: boolean;
  placeholder?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!value?.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="min-w-0 flex flex-col gap-2 rounded-lg border border-zinc-900 bg-zinc-950/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
          {label}
        </label>
        <button
          type="button"
          onClick={() => void handleCopy()}
          disabled={!value?.trim()}
          className="flex items-center gap-1 rounded bg-zinc-900 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 border border-zinc-800/80 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-sans"
          title="Sao chép"
        >
          <Copy className="h-3.5 w-3.5" />
          {copied ? 'Đã chép' : 'Sao chép'}
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        rows={rows}
        placeholder={placeholder}
        className={`w-full min-h-[6rem] resize-y rounded-lg border border-zinc-800 bg-black/50 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-600/50 placeholder:text-zinc-600 ${
          mono ? 'font-mono text-[12px] leading-relaxed' : 'font-sans leading-relaxed'
        }`}
      />
    </div>
  );
}

export default function YoutubeSafeChecklist() {
  const store = useNovelStore();
  const [collapsed, setCollapsed] = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaScores, setMetaScores] = useState<YoutubeFieldScores | null>(null);

  const chapter = store.danh_sach_chuong.find((c) => c.so_chuong === store.chuong_dang_chon);
  const script = chapter?.noi_dung || '';
  const gate = evaluateWordGate(script, store.setup.so_tu_chuong || 4250);
  const review = store.editorReviews[store.chuong_dang_chon];
  const ch = store.chuong_dang_chon;
  const yt = mergeYoutubeSafe(store.youtubeSafe);

  const asset = store.chapterHooks?.[ch] || {
    hook: '',
    thumbnailLine: '',
    seoTitle: '',
    seoDescription: '',
    seoTags: '',
    thumbnailPrompt: '',
  };

  const imageCount = Object.keys(store.generatedImages || {}).filter((k) =>
    k.startsWith(`${ch}_`),
  ).length;
  const videoCount = Object.keys(store.generatedVideos || {}).filter((k) =>
    k.startsWith(`${ch}_`),
  ).length;
  const hasAudio = Object.keys(store.generatedAudioPaths || {}).some(
    (k) => k.startsWith(`${ch}_`) && !!store.generatedAudioPaths[k]?.path,
  );

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
    ttsPlatform: store.ttsConfig.platform,
    ttsPitch: store.ttsConfig.pitch,
    ttsSpeed: store.ttsConfig.speed,
    hasVisualDna: !!(store.visualDnaPrompt?.trim() || store.mediaStylePreset?.trim()),
    hasAudio,
    imageCount,
    videoCount,
    enforceEditorGate: yt.enforceEditorGate !== false,
    humanEdited: !!store.humanEditFlags?.[ch]?.edited,
    requireHumanEdit: yt.requireHumanEdit === true,
    hasHook,
    hasSeoTitle,
    hasSeoDescription,
    hasThumbnailPrompt: hasThumbPrompt,
  });

  const summary = summarizeChecklist(items);

  const patch = (partial: Partial<typeof asset>) => {
    store.setChapterHook(ch, partial);
  };

  const regeneratePublishMeta = async () => {
    if (!script.trim()) return;
    setMetaLoading(true);
    try {
      const scenes = parseScenes(script);
      const sceneMeta = scenes.map((sc, i) => {
        const key = `${ch}_${i}`;
        const dur =
          store.generatedAudioPaths[key]?.duration ||
          Math.max(15, (sc.content?.length || 100) / 12);
        return { title: sc.title, durationSec: dur, content: sc.content };
      });
      const chapters = buildYoutubeChapters(sceneMeta);
      const chaptersText = chapters.map((c) => c.line).join('\n');

      // Local: psych titles · thumb ≤30 · desc theo thumb · chấm điểm · <8.5 viết lại
      let pack = generateYoutubeMetaWithQA({
        script,
        novelTitle: store.ten_tac_pham,
        chaptersText,
        maxRounds: 5,
      });

      // Optional NAV enrich — still re-score; reject weak API title (dialogue-like)
      try {
        const res = await fetch('/api/navtools/youtube-seo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: script.slice(0, 12000),
            novelTitle: store.ten_tac_pham,
            apiKey: store.apiKey,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success !== false) {
          const payload = data.data ?? data.result ?? data;
          let title =
            payload?.title || payload?.seo_title || payload?.seoTitle || '';
          let description =
            payload?.description ||
            payload?.seo_description ||
            payload?.seoDescription ||
            '';
          const tagsRaw =
            (Array.isArray(payload?.tags) ? payload.tags.join(' ') : payload?.tags) ||
            payload?.hashtags ||
            '';
          if (title) {
            // API raw → ép qua formula (không dùng thoại thô)
            title = buildSeoTitleFromHook(String(title), pack.thumbnailLine, store.ten_tac_pham);
          }
          if (description) {
            description = String(description)
              .replace(/——\s*HOOK\s*\(?30s?\)?\s*——/gi, '')
              .replace(/\n{3,}/g, '\n\n')
              .trim()
              .slice(0, 4500);
          }
          const merged = {
            seoTitle: (title || pack.seoTitle).slice(0, 100),
            thumbnailLine: pack.thumbnailLine.slice(0, 30),
            seoDescription:
              description ||
              buildSeoDescription({
                hook: pack.hook,
                thumbnailLine: pack.thumbnailLine,
                tags: tagsRaw || pack.seoTags,
                chaptersText,
                novelTitle: store.ten_tac_pham,
                chapter: ch,
                forceThumbLead: true,
              }),
          };
          const scores = scoreYoutubeMetaFields(merged);
          // Chỉ nhận API nếu điểm ≥ local
          if (scores.average >= pack.scores.average) {
            pack = {
              ...pack,
              ...merged,
              seoTags: tagsRaw ? String(tagsRaw) : pack.seoTags,
              scores,
            };
          }
        }
      } catch {
        /* keep local pack */
      }

      // Final gate: còn dưới 8.5 → một vòng nữa
      if (!pack.scores.pass) {
        pack = generateYoutubeMetaWithQA({
          script,
          novelTitle: store.ten_tac_pham,
          chaptersText,
          maxRounds: 5,
        });
      }

      store.setChapterHook(ch, {
        hook: pack.hook,
        thumbnailLine: pack.thumbnailLine.slice(0, 30),
        seoTitle: pack.seoTitle.slice(0, 100),
        seoDescription: pack.seoDescription,
        seoTags: pack.seoTags,
        thumbnailPrompt: pack.thumbnailPrompt,
      });
      setMetaScores(pack.scores);
    } finally {
      setMetaLoading(false);
    }
  };

  const exportPack = useMemo((): YoutubeExportPack | null => {
    if (!script.trim()) return null;
    const scenes = parseScenes(script);
    const sceneMeta = scenes.map((sc, i) => {
      const key = `${ch}_${i}`;
      const dur =
        store.generatedAudioPaths[key]?.duration ||
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
      const prompts = store.generatedPrompts[`${ch}_${s.index}`] || [];
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
      buildSeoTitleFromHook(asset.hook, asset.thumbnailLine, store.ten_tac_pham);
    const seoTags = normalizeHashtagField(asset.seoTags || '');
    const seoDescription =
      asset.seoDescription ||
      buildSeoDescription({
        hook: asset.hook,
        thumbnailLine: asset.thumbnailLine,
        tags: seoTags,
        chaptersText,
        novelTitle: store.ten_tac_pham,
        chapter: ch,
      });

    return {
      version: 2,
      generatedAt: new Date().toISOString(),
      title: store.ten_tac_pham || 'Untitled',
      chapter: ch,
      hook: asset.hook,
      thumbnailLine: asset.thumbnailLine,
      seoTitle,
      seoDescription,
      seoTags,
      thumbnailPrompt: asset.thumbnailPrompt || '',
      chaptersText,
      chapters,
      cutPlans,
      checklist: items,
      voiceDna: {
        platform: store.ttsConfig.platform,
        voice: store.ttsConfig.voice,
        speed: store.ttsConfig.speed,
        pitch: store.ttsConfig.pitch,
      },
      purpose: [
        '1) Copy seoTitle → Title YouTube',
        '2) Copy seoDescription → Description',
        '3) thumbnailPrompt → gen ảnh thumb',
        '4) Hook ~30s → VO cold open',
      ],
      notes: ['Pack = hồ sơ đăng, không tự upload.'],
    };
  }, [script, ch, store, asset, items]);

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
          {metaScores && (
            <span
              className={`text-[9px] font-bold tabular-nums px-1.5 py-0.5 rounded border shrink-0 ${
                metaScores.pass
                  ? 'border-emerald-800 text-emerald-400 bg-emerald-950/40'
                  : 'border-amber-900 text-amber-400 bg-amber-950/30'
              }`}
              title={`Title ${metaScores.title} · Thumb ${metaScores.thumbnail} · Desc ${metaScores.description} · pass ≥${YOUTUBE_META_PASS_SCORE}`}
            >
              Meta {metaScores.average}/10
            </span>
          )}
        </button>

        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          <button
            type="button"
            onClick={() => void regeneratePublishMeta()}
            disabled={metaLoading || !script.trim()}
            className="flex items-center gap-1 rounded bg-sky-500/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-sky-400 border border-sky-800/40 hover:bg-sky-500/20 disabled:opacity-40 font-sans"
            title="Local + API youtube_seo"
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
            <Field
              label={`SEO Title (${titleLen}/100)${metaScores ? ` · ${metaScores.title}/10` : ''}`}
              value={asset.seoTitle || ''}
              onChange={(v) => {
                patch({ seoTitle: v.slice(0, 100) });
                setMetaScores(null);
              }}
              onBlur={() => {
                const raw = (asset.seoTitle || '').trim().slice(0, 100);
                if (raw !== (asset.seoTitle || '')) patch({ seoTitle: raw });
              }}
              rows={3}
              placeholder="CTR tâm lý · tò mò + đe dọa · KHÔNG thoại · ≤100"
            />
            <Field
              label={`Thumbnail line (${(asset.thumbnailLine || '').length}/30)${
                metaScores ? ` · ${metaScores.thumbnail}/10` : ''
              }`}
              value={asset.thumbnailLine || ''}
              onChange={(v) => {
                patch({ thumbnailLine: v.slice(0, 30) });
                setMetaScores(null);
              }}
              onBlur={() => {
                const raw = (asset.thumbnailLine || '').trim().slice(0, 30);
                if (raw !== (asset.thumbnailLine || '')) patch({ thumbnailLine: raw });
              }}
              rows={2}
              placeholder="≤30 ký tự — chữ trên ảnh, gợi tò mò"
            />
            <div className="sm:col-span-2">
              <Field
                label={`Description (lead = Thumbnail)${
                  metaScores ? ` · ${metaScores.description}/10` : ''
                }`}
                value={asset.seoDescription || ''}
                onChange={(v) => {
                  patch({ seoDescription: v });
                  setMetaScores(null);
                }}
                rows={8}
                placeholder="Mở bằng Thumbnail → khuấy tò mò → chapters + tags"
              />
            </div>
            <div className="sm:col-span-2">
              <Field
                label="Thumb prompt (EN)"
                value={asset.thumbnailPrompt || ''}
                onChange={(v) => patch({ thumbnailPrompt: v })}
                rows={5}
                mono
                placeholder="16:9 cinematic thumbnail still…"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
