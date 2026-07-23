'use client';

import React, { useEffect, useState } from 'react';
import {
  API,
  imageAssetKey,
  sceneAssetKey,
  videoAssetKey,
} from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';
import { useShallow } from 'zustand/react/shallow';
import { useFolderActions } from '../../hooks/useFolderActions';
import { getWordCount } from '../../utils/stringUtils';
import {
  countHumanJokeAsides,
  injectHumanJokeAsides,
  isHookSceneIndex,
  YOUTUBE_HOOK_DEFAULT_DURATION_SEC,
} from '@/lib/youtubeSafe';
import {
  Sparkles,
  Copy,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { toast } from '@/lib/toastBus';
import FloatingMenu from '../../shared/FloatingMenu';
import ScenePromptRow from './ScenePromptRow';
import SceneTtsBar from './SceneTtsBar';
import { resolveVideoKeyframeRange } from '@/lib/projectProgress';
import QualityGateBadge from './QualityGateBadge';

interface SceneCardProps {
  scene: { title: string; content: string };
  sceneIndex: number;
  handleSceneChange: (idx: number, newContent: string) => void;
  handleCopyScene: (text: string) => void;
  handleExpandScene: (idx: number) => Promise<void>;
  handleRewriteScene: (idx: number) => Promise<void>;
  /** Busy chỉ của NÚT này (không dùng dang_tai global) */
  expandingThis?: boolean;
  rewritingThis?: boolean;
  handlePlayTTS: (text: string, sceneIndex: number, voice: string) => Promise<void>;
  handleStopTTS: () => void;
  handleGenerateTTS: (
    sceneText: string,
    sceneIndex: number,
    voice: string,
    targetDuration?: number,
    options?: { forceFullMulti?: boolean; silent?: boolean; bypassYoutubeGate?: boolean },
  ) => Promise<number | undefined>;
  handleGenerateImagePrompt: (sceneText: string, sceneIndex: number, duration: number) => Promise<void>;
  handleRegenPrompt: (sceneIndex: number, promptIndex: number, sentence: string, currentPrompt: string) => Promise<void>;
  handleGenerateImage: (sceneIndex: number, promptIndex: number, prompt: string, sentence: string) => Promise<void>;
  handleGenerateAllImages: (sceneIndex: number) => Promise<void>;
  handleGenerateVideo: (sceneIndex: number, startPromptIndex: number, endPromptIndex: number, prompt: string) => Promise<void>;
  handleExtendVideo?: (sceneIndex: number, promptIndex: number) => Promise<void>;
  handleGenerateAllVideos: (sceneIndex: number) => Promise<void>;
  isPlayingTTS: boolean;
  generatingTTS: boolean;
  ttsProgress: number;
  ttsStatus?: string;
  generatingPrompt: boolean;
  regeneratingSinglePrompt: Record<string, boolean>;
  onImageZoom: (url: string) => void;
  collapsed?: boolean;
  /** Prefer this: parent sets expandedScene without double-toggle race */
  onExpandChange?: (open: boolean) => void;
  /** @deprecated use onExpandChange */
  onToggleCollapse?: () => void;
}

type ScenePromptItem = {
  image_prompt?: string;
  prompt?: string;
  script_prompt?: string;
  sentence?: string;
  video_prompt?: string;
  use_end_frame?: boolean;
  end_image_key?: string;
};

function SceneCard({
  scene,
  sceneIndex,
  handleSceneChange,
  handleCopyScene,
  handleExpandScene,
  handleRewriteScene,
  expandingThis = false,
  rewritingThis = false,
  handlePlayTTS,
  handleStopTTS,
  handleGenerateTTS,
  handleGenerateImagePrompt,
  handleRegenPrompt,
  handleGenerateImage,
  handleGenerateAllImages,
  handleGenerateVideo,
  handleExtendVideo,
  handleGenerateAllVideos,
  isPlayingTTS,
  generatingTTS,
  ttsProgress,
  ttsStatus = '',
  generatingPrompt,
  regeneratingSinglePrompt,
  onImageZoom,
  collapsed = true,
  onExpandChange,
  onToggleCollapse,
}: SceneCardProps) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { handleOpenFolder } = useFolderActions();

  /**
   * Local open state is source of truth for expand/collapse.
   * Parent `collapsed` syncs nav strip (Hook/C1…) — click "Mở" always flips local first.
   */
  const [isOpen, setIsOpen] = useState(() => !collapsed);
  useEffect(() => {
    if (collapsed === false) setIsOpen(true);
    if (collapsed === true) setIsOpen(false);
  }, [collapsed]);

  const toggleOpen = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setIsOpen((prev) => {
      const next = !prev;
      requestAnimationFrame(() => {
        if (onExpandChange) onExpandChange(next);
        else onToggleCollapse?.();
      });
      return next;
    });
  };
  
  const [openSceneTab, setOpenSceneTab] = useState<'tts' | 'studio' | null>('studio');
  const [manualDuration, setManualDuration] = useState('');
  
  const chapterNum = Number(useNovelStore(state => state.chuong_dang_chon)) || 1;
  const assetKey = sceneAssetKey(chapterNum, sceneIndex);
  
  const audioAsset = useNovelStore(state => state.generatedAudioPaths[assetKey]);
  const promptsAsset = useNovelStore(state => state.generatedPrompts[assetKey]);
  const isHook = isHookSceneIndex(sceneIndex);
  const hookEdited = useNovelStore(state => state.humanEditFlags?.[chapterNum]?.edited);
  const chapterHookRaw = useNovelStore(state => state.chapterHooks?.[chapterNum]?.hook);
  const addGeneratedImage = useNovelStore(state => state.addGeneratedImage);
  const setChapterHook = useNovelStore(state => state.setChapterHook);
  const updateChuong = useNovelStore(state => state.updateChuong);
  const setHumanEditFlag = useNovelStore(state => state.setHumanEditFlag);

  const [upscalingImage, setUpscalingImage] = useState<Record<string, boolean>>({});
  const [removingBg, setRemovingBg] = useState<Record<string, boolean>>({});
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportBtnRef = React.useRef<HTMLButtonElement>(null);

  const downloadTextFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleUpscaleImage = async (imagePath: string, key: string) => {
    setUpscalingImage(prev => ({ ...prev, [key]: true }));
    try {
      const outPath = imagePath.replace('.png', '_upscaled.png').replace('.jpg', '_upscaled.jpg');
      const res = await fetch(API.navtools.upscale, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath, outPath, targetHeight: 2160 })
      });
      const data = await res.json();
      if (data.success) {
        addGeneratedImage(key, data.outPath);
      } else {
        toast.info('Notice', "Upscale failed: " + data.error);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUpscalingImage(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleBgRemoveImage = async (imagePath: string, key: string) => {
    setRemovingBg(prev => ({ ...prev, [key]: true }));
    try {
      const outPath = imagePath.replace('.png', '_nobg.png').replace('.jpg', '_nobg.png');
      const res = await fetch(API.navtools.bgRemove, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath, outPath })
      });
      const data = await res.json();
      if (data.success) {
        addGeneratedImage(key, data.outPath);
      } else {
        toast.info('Notice', "Xóa nền thất bại: " + data.error);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRemovingBg(prev => ({ ...prev, [key]: false }));
    }
  };

  const { imageDone, videoDone } = useNovelStore(useShallow(state => {
    let iDone = 0;
    let vDone = 0;
    const prompts = state.generatedPrompts[assetKey];
    if (prompts && prompts.length > 0) {
      for (let pIdx = 0; pIdx < prompts.length; pIdx++) {
        const imgKey = imageAssetKey(chapterNum, sceneIndex, pIdx);
        const vidKey = videoAssetKey(chapterNum, sceneIndex, pIdx);
        if (state.generatedImages?.[imgKey]) iDone++;
        if (state.generatedVideos?.[vidKey]) vDone++;
      }
    }
    return { imageDone: iDone, videoDone: vDone };
  }));

  // Tiến độ ảnh + video theo từng prompt
  const promptCount = promptsAsset?.length || 0;
  
  // Xanh chỉ khi đã có prompt và đủ 100% ảnh + video
  const mediaComplete =
    promptCount > 0 && imageDone === promptCount && videoDone === promptCount;
  // Màu đặc (không opacity Tailwind) — tránh viền bị nhạt/trắng
  const borderColor = mediaComplete ? '#10b981' /* emerald */ : '#ff7b00' /* cam neon app */;
  const titleColor = mediaComplete ? '#34d399' : '#ff7b00';

  const displayTitle =
    scene.title && scene.title !== 'KỊCH BẢN'
      ? scene.title
      : isHook
        ? 'MỞ ĐẦU / HOOK (~30s)'
        : `Cảnh ${sceneIndex + 1}`;

  // Tự động quét và lấy thời gian voice bên TTS để làm tham chiếu
  const voiceDurationReference = audioAsset ? audioAsset.duration : null;
  const storeWpm = useNovelStore((s) => s.wpm);
  // Hook cold-open ~30s; cảnh thường ước từ số từ / WPM Media Config (không hardcode /2.5)
  const defaultDuration = (() => {
    if (isHook) return YOUTUBE_HOOK_DEFAULT_DURATION_SEC;
    const words = getWordCount(scene.content);
    const wpm = Number(storeWpm);
    if (!Number.isFinite(wpm) || wpm <= 0) return 0;
    if (words <= 0) return 0;
    return Math.max(1, Math.ceil((words / wpm) * 60));
  })();

  return (
    <div
      className={`group relative z-[1] bg-zinc-950/40 rounded-lg ${
        isOpen ? 'p-5' : 'p-3'
      } flex flex-col gap-3 transition-[border-color,box-shadow] duration-200`}
      style={{
        borderWidth: 2,
        borderStyle: 'solid',
        borderColor,
        boxShadow: mediaComplete
          ? '0 0 14px rgba(16, 185, 129, 0.35)'
          : '0 0 14px rgba(255, 123, 0, 0.35)',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      {/* 1. Thanh tiêu đề + thu gọn + trạng thái media */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <button
          type="button"
          onClick={toggleOpen}
          className="flex flex-1 items-center gap-2 min-w-0 text-left rounded-lg px-3 py-2 bg-zinc-900/40 hover:bg-zinc-900/70 transition-colors cursor-pointer select-none"
          style={{
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: `${borderColor}66`,
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
          title={isOpen ? 'Thu gọn chỉ còn tiêu đề' : 'Mở rộng cảnh'}
          aria-expanded={isOpen}
        >
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          )}
          <h4
            className="text-xs font-bold uppercase tracking-widest flex items-center gap-1.5 font-sans truncate"
            style={{ color: titleColor }}
          >
            🎬 {displayTitle}
          </h4>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {promptCount > 0 && (
            <span
              className="text-[9px] font-bold tabular-nums px-1.5 py-0.5 rounded font-sans pointer-events-none"
              style={{
                color: titleColor,
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor,
                backgroundColor: mediaComplete
                  ? 'rgba(16, 185, 129, 0.12)'
                  : 'rgba(255, 123, 0, 0.12)',
              }}
              title={`Ảnh ${imageDone}/${promptCount} · Video ${videoDone}/${promptCount}`}
            >
              🖼 {imageDone}/{promptCount} · 🎬 {videoDone}/{promptCount}
            </span>
          )}
          {audioAsset && (
            <span
              className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse pointer-events-none"
              title="Đã có file Audio"
            />
          )}
          <button
            type="button"
            onClick={toggleOpen}
            className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded cursor-pointer font-sans hover:opacity-90 select-none"
            style={{
              color: titleColor,
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor,
              backgroundColor: 'transparent',
              WebkitAppRegion: 'no-drag',
            } as React.CSSProperties}
            aria-expanded={isOpen}
          >
            {isOpen ? 'Thu gọn' : 'Mở'}
          </button>
        </div>
      </div>

      {!isOpen ? null : (
      <>
      {/* 2. Textarea câu chuyện của cảnh */}
      <textarea
        value={scene.content}
        onChange={(e) => handleSceneChange(sceneIndex, e.target.value)}
        placeholder="Nội dung kịch bản văn học chi tiết đa giác quan cho phân cảnh này..."
        className="w-full min-h-[160px] bg-transparent text-md leading-loose text-zinc-300 resize-y outline-none border border-zinc-900/10 focus:border-zinc-800 focus:bg-zinc-900/20 p-3 rounded transition-all font-sans"
      />
      
      {/* 3. Footer của cảnh: Thống kê + Quality Gate + Nút biên soạn */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-900/40 pt-2 text-xs">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-sans">
            📊 {getWordCount(scene.content)} từ
          </span>
          <span className="text-zinc-700 select-none">|</span>
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-sans">
            {scene.content.length} ký tự
          </span>
          {/* P0 — chapter Quality Gate (chỉ hiện rõ ở cảnh đầu để tránh spam) */}
          {sceneIndex === 0 || sceneIndex === 990 ? (
            <QualityGateBadge chapter={chapterNum} variant="full" />
          ) : null}
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {isHook && (
            <label
              className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 cursor-pointer text-[10px] font-bold uppercase tracking-wider font-sans transition-colors ${
                hookEdited
                  ? 'border-emerald-700 bg-emerald-500/15 text-emerald-400'
                  : 'border-zinc-800 bg-black/40 text-zinc-400 hover:border-emerald-900/60 hover:text-emerald-400/80'
              }`}
              title="Human Pass: tick để chèn câu đùa bâng quơ (không dính cốt truyện) vào Hook (+ chương) và mở cổng TTS"
            >
              <input
                type="checkbox"
                className="accent-emerald-500 h-3 w-3"
                checked={!!hookEdited}
                onChange={(e) => {
                  const checked = e.target.checked;
                  const ch = chapterNum;
                  if (checked) {
                    // 1) Hook ~30s: chèn ≥1 câu đùa giữa nhịp thoại
                    const hookRaw = (scene.content || chapterHookRaw || '').trim();
                    if (hookRaw) {
                      const hookJoked = injectHumanJokeAsides(hookRaw, {
                        minCount: 1,
                        enabled: true,
                      });
                      handleSceneChange(sceneIndex, hookJoked);
                      setChapterHook(ch, { hook: hookJoked });
                    }
                    // 2) Toàn chương: bảo đảm có câu đùa (nếu AI chưa chèn)
                    const chapter = useNovelStore.getState().danh_sach_chuong.find((c) => c.so_chuong === ch);
                    const body = (chapter?.noi_dung || '').trim();
                    if (body && countHumanJokeAsides(body) < 1) {
                      updateChuong(ch, {
                        noi_dung: injectHumanJokeAsides(body, {
                          minCount: 1,
                          enabled: true,
                        }),
                      });
                    }
                  }
                  setHumanEditFlag(ch, {
                    edited: checked,
                    note: checked
                      ? 'human pass + joke asides activated'
                      : '',
                  });
                }}
              />
              Human
            </label>
          )}
          <button
            type="button"
            onClick={() => handleCopyScene(scene.content)}
            className="flex items-center gap-1 rounded bg-zinc-900 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 border border-zinc-800/80 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer font-sans"
          >
            <Copy className="h-3.5 w-3.5" />
            Sao chép
          </button>
          <button
            type="button"
            disabled={rewritingThis || !scene.content.trim()}
            onClick={() => void handleRewriteScene(sceneIndex)}
            title={
              isHook
                ? 'Viết lại Hook ~30s — nút riêng, không khóa gen NV/chương'
                : 'Viết lại nhẹ — chỉ khóa nút này'
            }
            className="flex items-center gap-1 rounded bg-sky-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-sky-400 border border-sky-800/40 hover:bg-sky-500 hover:text-black transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-sans"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${rewritingThis ? 'animate-spin' : ''}`}
            />
            {rewritingThis ? '…' : 'Viết lại'}
          </button>
          <button
            type="button"
            disabled={expandingThis || !scene.content.trim()}
            onClick={() => void handleExpandScene(sceneIndex)}
            title={
              isHook
                ? 'Expart Hook — nút riêng, không khóa nút khác'
                : 'Expart — chỉ khóa nút này'
            }
            className="flex items-center gap-1 rounded bg-amber-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-500 border border-amber-800/40 hover:bg-amber-500 hover:text-black transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-sans"
          >
            <Sparkles
              className={`h-3.5 w-3.5 ${expandingThis ? 'animate-spin' : ''}`}
            />
            {expandingThis ? '…' : 'Expart'}
          </button>
        </div>
      </div>

      {/* 4. Thanh công cụ Mini kích hoạt TTS / Phân Cảnh Studio */}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-zinc-900/50 pt-3">
        <button
          type="button"
          onClick={() => setOpenSceneTab(prev => (prev === 'tts' ? null : 'tts'))}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer font-sans ${
            openSceneTab === 'tts'
              ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20'
              : 'bg-zinc-900 text-amber-500 hover:bg-zinc-800 border border-amber-900/30'
          }`}
        >
          🎙️ TTS Voice
        </button>
        
        <button
          type="button"
          onClick={() => setOpenSceneTab(prev => (prev === 'studio' ? null : 'studio'))}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer font-sans ${
            openSceneTab === 'studio'
              ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20'
              : 'bg-zinc-900 text-emerald-500 hover:bg-zinc-800 border border-emerald-900/30'
          }`}
        >
          🎬 Studio Cảnh
        </button>
      </div>

      {/* 5. Accordion: TTS Voice */}
      {openSceneTab === 'tts' && (
        <SceneTtsBar
          sceneContent={scene.content}
          sceneIndex={sceneIndex}
          chapterNum={chapterNum}
          manualDuration={manualDuration}
          setManualDuration={setManualDuration}
          voiceDurationReference={voiceDurationReference}
          isPlayingTTS={isPlayingTTS}
          generatingTTS={generatingTTS}
          ttsProgress={ttsProgress}
          ttsStatus={ttsStatus}
          handlePlayTTS={handlePlayTTS}
          handleStopTTS={handleStopTTS}
          handleGenerateTTS={handleGenerateTTS}
        />
      )}

      {/* 6. Accordion: Studio Cảnh */}
      {openSceneTab === 'studio' && (
        <div className="mt-2 rounded-lg border border-emerald-900/30 bg-emerald-950/10 p-4 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="text-xs font-bold text-emerald-500 uppercase flex items-center gap-2 font-sans">
              <Sparkles className="h-3 w-3" />
              Phân Tích & Sinh Ảnh / Video
            </h4>
            <QualityGateBadge chapter={chapterNum} variant="compact" />
          </div>
          

          
          <div className="space-y-3">
            <div className="bg-black/20 px-3 py-1.5 rounded border border-emerald-900/20">
              <span className="text-[10px] text-zinc-400 font-sans italic">
                ✨ Đang sử dụng các Model sinh Ảnh/Video từ Cấu Hình Toàn Cục.
              </span>
            </div>

            {/* Tự động quét và lấy thời lượng voice bên TTS để làm tham chiếu */}
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-zinc-400 uppercase font-sans">
                Thời lượng tham chiếu:
              </label>
              <input
                type="number"
                min="5"
                placeholder="VD: 15"
                value={
                  manualDuration !== ''
                    ? manualDuration
                    : voiceDurationReference
                      ? String(voiceDurationReference)
                      : defaultDuration > 0
                        ? String(defaultDuration)
                        : ''
                }
                onChange={(e) => {
                  setManualDuration(e.target.value);
                }}
                className="h-8 w-20 bg-zinc-900 border border-zinc-800 rounded px-2 text-xs text-zinc-300 outline-none focus:border-emerald-500 text-center font-sans"
              />
              <span className="text-[10px] text-zinc-500 italic font-sans">
                {voiceDurationReference
                  ? `(Quét từ TTS: ${voiceDurationReference} giây)`
                  : defaultDuration > 0
                    ? `(Ước WPM ${storeWpm}: ${defaultDuration} giây)`
                    : '(Cần TTS duration hoặc cấu hình WPM + nội dung cảnh)'}
              </span>
            </div>
            
            <button
              type="button"
              disabled={generatingPrompt}
              onClick={() => {
                let durationVal = 0;
                if (manualDuration !== '') {
                  durationVal = Math.max(1, parseInt(manualDuration, 10) || 0);
                } else if (voiceDurationReference && voiceDurationReference > 0) {
                  durationVal = voiceDurationReference;
                } else if (defaultDuration > 0) {
                  durationVal = defaultDuration;
                }
                if (!scene.content.trim()) {
                  toast.error(
                    'Cảnh trống',
                    'Viết / sinh kịch bản cảnh trước khi Gen Prompt Studio.',
                  );
                  return;
                }
                if (!durationVal) {
                  toast.error(
                    'Thiếu thời lượng',
                    'Thứ tự: 1) TTS Voice (hoặc nhập giây) → 2) Gen Prompt Studio → 3) Gen ảnh. Hoặc cấu hình WPM trong Ảnh/Video. App không tự gán duration.',
                  );
                  return;
                }
                // Chỉ sinh prompt — Seedance/công thức nằm trong API, không gộp ảnh/video
                void handleGenerateImagePrompt(scene.content, sceneIndex, durationVal);
              }}
              className="w-full h-9 rounded bg-emerald-500 text-black text-xs font-bold hover:bg-emerald-400 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-sans"
              title="Sinh prompt shot. Công thức đạo diễn (Seedance) áp trong backend — style từ Visual DNA, genre từ Setup."
            >
              {generatingPrompt ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Đang sinh Prompt...
                </>
              ) : (
                <>
                  Gen Prompt Studio
                </>
              )}
            </button>
          </div>

          {/* Render Prompts vẽ ảnh theo câu */}
          {promptsAsset && promptsAsset.length > 0 && (
            <div className="not-prose bg-zinc-950/60 border border-zinc-900/60 p-3 rounded-lg flex flex-col gap-3 mt-2 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest font-sans">
                  💡 {promptsAsset.length} PROMPT VẼ ẢNH VÀ NHÂN VẬT THAM CHIẾU
                </span>
                
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleGenerateAllImages(sceneIndex)}
                    className="text-[9px] font-bold uppercase tracking-wider text-black bg-emerald-500 hover:bg-emerald-400 px-2.5 py-0.5 rounded transition-all shadow-md hover:shadow-emerald-500/20 flex items-center gap-0.5 cursor-pointer font-sans"
                    title="Sinh ảnh ngầm cùng lúc (đa luồng) cho toàn bộ prompts"
                  >
                    🚀 Gen tất cả ảnh
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => void handleGenerateAllVideos(sceneIndex)}
                    className="text-[9px] font-bold uppercase tracking-wider text-black bg-cyan-500 hover:bg-cyan-400 px-2.5 py-0.5 rounded transition-all shadow-md hover:shadow-cyan-500/20 flex items-center gap-0.5 cursor-pointer font-sans"
                    title="Sinh video tuần tự qua các prompt ảnh (Seedance trong API)"
                  >
                    🎬 Gen toàn bộ Video
                  </button>
                  
                  <div className="relative">
                    <button
                      ref={exportBtnRef}
                      type="button"
                      onClick={() => setExportMenuOpen(v => !v)}
                      className="text-[9px] font-bold uppercase tracking-wider text-zinc-300 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 hover:text-white px-2.5 py-0.5 rounded transition-colors flex items-center gap-0.5 cursor-pointer font-sans"
                      title="Xuất (Copy/Download) Prompt"
                    >
                      📋 Export...
                    </button>
                    <FloatingMenu
                      open={exportMenuOpen}
                      anchorRef={exportBtnRef}
                      onClose={() => setExportMenuOpen(false)}
                      align="right"
                      width="200px"
                      className="rounded border border-zinc-800 bg-zinc-950 p-1 shadow-xl flex flex-col gap-1"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          handleCopyScene(
                            promptsAsset
                              .map((p: ScenePromptItem) => p.image_prompt || p.prompt || '')
                              .filter(Boolean)
                              .join('\n')
                          );
                          setExportMenuOpen(false);
                        }}
                        className="w-full text-left rounded px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
                      >
                        📋 Copy Prompts Ảnh
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleCopyScene(
                            promptsAsset
                              .map((p: ScenePromptItem) => p.video_prompt || p.image_prompt || p.prompt || '')
                              .filter(Boolean)
                              .join('\n')
                          );
                          setExportMenuOpen(false);
                        }}
                        className="w-full text-left rounded px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
                      >
                        📋 Copy Prompts Video
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const content = promptsAsset
                            .map((p: ScenePromptItem) => p.image_prompt || p.prompt || '')
                            .filter(Boolean)
                            .join('\n');
                          downloadTextFile(`prompts_image_c${sceneIndex + 1}.txt`, content);
                          setExportMenuOpen(false);
                        }}
                        className="w-full text-left rounded px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
                      >
                        ⬇️ Tải Prompts Ảnh (.txt)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const content = promptsAsset
                            .map((p: ScenePromptItem) => p.video_prompt || p.image_prompt || p.prompt || '')
                            .filter(Boolean)
                            .join('\n');
                          downloadTextFile(`prompts_video_c${sceneIndex + 1}.txt`, content);
                          setExportMenuOpen(false);
                        }}
                        className="w-full text-left rounded px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
                      >
                        ⬇️ Tải Prompts Video (.txt)
                      </button>
                    </FloatingMenu>
                  </div>
                </div>
              </div>

              {promptsAsset.map((promptItem: ScenePromptItem, pIdx: number) => {
                const singlePromptKey = imageAssetKey(
                  chapterNum,
                  sceneIndex,
                  pIdx,
                );
                const scriptPromptText = promptItem.script_prompt || promptItem.sentence || '';
                const imagePromptText = promptItem.image_prompt || promptItem.prompt || '';
                const videoPromptText = promptItem.video_prompt || imagePromptText;
                return (
                  <ScenePromptRow
                    key={pIdx}
                    promptItem={promptItem}
                    pIdx={pIdx}
                    chapter={chapterNum}
                    sceneIndex={sceneIndex}
                    isHook={isHook}
                    promptsLen={promptsAsset.length}
                    regenerating={!!regeneratingSinglePrompt[singlePromptKey]}
                    upscaling={!!upscalingImage[singlePromptKey]}
                    removingBg={!!removingBg[singlePromptKey]}
                    onOpenProjectUrl={(url) => window.open(url, '_blank')}
                    onGenImage={() =>
                      handleGenerateImage(sceneIndex, pIdx, imagePromptText, scriptPromptText)
                    }
                    onGenVideo={() => {
                      // P2 keyframe optional: use_end_frame → dual stills; else legacy edge/middle
                      const range = resolveVideoKeyframeRange({
                        promptIndex: pIdx,
                        promptsLen: promptsAsset.length,
                        useEndFrame: !!promptItem.use_end_frame,
                        endImageKey: promptItem.end_image_key,
                        chapter: chapterNum,
                        sceneIndex,
                      });
                      handleGenerateVideo(
                        sceneIndex,
                        range.startPromptIndex,
                        range.endPromptIndex,
                        videoPromptText,
                      );
                    }}
                    onExtendVideo={
                      handleExtendVideo
                        ? () => void handleExtendVideo(sceneIndex, pIdx)
                        : undefined
                    }
                    onRegenPrompt={() =>
                      handleRegenPrompt(sceneIndex, pIdx, scriptPromptText, imagePromptText)
                    }
                    onCopy={handleCopyScene}
                    onZoom={onImageZoom}
                    onUpscale={() => {
                      const img = useNovelStore.getState().generatedImages?.[singlePromptKey];
                      if (img) void handleUpscaleImage(img, singlePromptKey);
                    }}
                    onBgRemove={() => {
                      const img = useNovelStore.getState().generatedImages?.[singlePromptKey];
                      if (img) void handleBgRemoveImage(img, singlePromptKey);
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
      </>
      )}

    </div>
  );
}

function regeneratingKeysForScene(
  map: Record<string, boolean> | undefined,
  sceneIndex: number,
): string {
  if (!map) return '';
  // imageAssetKey = `${ch}_${sc}_${pi}` — match any chapter for this scene index
  const needle = `_${sceneIndex}_`;
  return Object.keys(map)
    .filter((k) => map[k] && k.includes(needle))
    .sort()
    .join('|');
}

function areScenePropsEqual(prev: SceneCardProps, next: SceneCardProps) {
  if (
    prev.scene.content !== next.scene.content ||
    prev.scene.title !== next.scene.title ||
    prev.sceneIndex !== next.sceneIndex ||
    prev.isPlayingTTS !== next.isPlayingTTS ||
    prev.generatingTTS !== next.generatingTTS ||
    prev.ttsProgress !== next.ttsProgress ||
    prev.ttsStatus !== next.ttsStatus ||
    prev.generatingPrompt !== next.generatingPrompt ||
    prev.expandingThis !== next.expandingThis ||
    prev.rewritingThis !== next.rewritingThis
  ) {
    return false;
  }
  // Only re-render this card when *its* regen flags change (not whole map ref)
  if (
    regeneratingKeysForScene(prev.regeneratingSinglePrompt, prev.sceneIndex) !==
    regeneratingKeysForScene(next.regeneratingSinglePrompt, next.sceneIndex)
  ) {
    return false;
  }
  // ScenePromptRow handles image/video progress via mediaGenSlotStore.
  return true;
}

export default React.memo(SceneCard, areScenePropsEqual);
