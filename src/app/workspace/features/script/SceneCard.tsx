'use client';

import React, { useState } from 'react';
import {
  API,
  imageAssetKey,
  sceneAssetKey,
  videoAssetKey,
  videoAssetKeyFromImageKey,
} from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';
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
import ScenePromptRow from './ScenePromptRow';
import SceneTtsBar from './SceneTtsBar';

interface SceneCardProps {
  scene: { title: string; content: string };
  sceneIndex: number;
  handleSceneChange: (idx: number, newContent: string) => void;
  handleCopyScene: (text: string) => void;
  handleExpandScene: (idx: number) => Promise<void>;
  handleRewriteScene: (idx: number) => Promise<void>;
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
  handleGenerateAllVideos: (sceneIndex: number) => Promise<void>;
  isPlayingTTS: boolean;
  generatingTTS: boolean;
  ttsProgress: number;
  ttsStatus?: string;
  generatingPrompt: boolean;
  regeneratingSinglePrompt: Record<string, boolean>;
  generatingImage: Record<string, boolean>;
  generatingVideo: Record<string, boolean>;
  onImageZoom: (url: string) => void;
}

type ScenePromptItem = {
  image_prompt?: string;
  prompt?: string;
  script_prompt?: string;
  sentence?: string;
  video_prompt?: string;
};

export default function SceneCard({
  scene,
  sceneIndex,
  handleSceneChange,
  handleCopyScene,
  handleExpandScene,
  handleRewriteScene,
  handlePlayTTS,
  handleStopTTS,
  handleGenerateTTS,
  handleGenerateImagePrompt,
  handleRegenPrompt,
  handleGenerateImage,
  handleGenerateAllImages,
  handleGenerateVideo,
  handleGenerateAllVideos,
  isPlayingTTS,
  generatingTTS,
  ttsProgress,
  ttsStatus = '',
  generatingPrompt,
  regeneratingSinglePrompt,
  generatingImage,
  generatingVideo,
  onImageZoom
}: SceneCardProps) {
  const store = useNovelStore();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { handleOpenFolder } = useFolderActions();
  
  const [openSceneTab, setOpenSceneTab] = useState<'tts' | 'studio' | null>('studio');
  const [manualDuration, setManualDuration] = useState('');
  const chapterNum = store.chuong_dang_chon || 1;

  const [upscalingImage, setUpscalingImage] = useState<Record<string, boolean>>({});
  const [removingBg, setRemovingBg] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState(false);

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
        store.addGeneratedImage(key, data.outPath);
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
        store.addGeneratedImage(key, data.outPath);
      } else {
        toast.info('Notice', "Xóa nền thất bại: " + data.error);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRemovingBg(prev => ({ ...prev, [key]: false }));
    }
  };


  const assetKey = sceneAssetKey(store.chuong_dang_chon, sceneIndex);
  const audioAsset = store.generatedAudioPaths[assetKey];
  const promptsAsset = store.generatedPrompts[assetKey];
  const isHook = isHookSceneIndex(sceneIndex);

  // Tiến độ ảnh + video theo từng prompt
  const promptCount = promptsAsset?.length || 0;
  let imageDone = 0;
  let videoDone = 0;
  if (promptsAsset && promptCount > 0) {
    for (let pIdx = 0; pIdx < promptCount; pIdx++) {
      const imgKey = imageAssetKey(store.chuong_dang_chon, sceneIndex, pIdx);
      const vidKey = videoAssetKey(store.chuong_dang_chon, sceneIndex, pIdx);
      if (store.generatedImages?.[imgKey]) imageDone++;
      if (store.generatedVideos?.[vidKey]) videoDone++;
    }
  }
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
  // Hook cold-open mặc định ~30s; cảnh thường ước từ số từ
  const defaultDuration = isHook
    ? YOUTUBE_HOOK_DEFAULT_DURATION_SEC
    : Math.max(5, Math.round(getWordCount(scene.content) / 2.5));

  return (
    <div
      className={`group relative bg-zinc-950/40 rounded-lg ${
        collapsed ? 'p-3' : 'p-5'
      } flex flex-col gap-3 transition-[border-color,box-shadow] duration-200`}
      style={{
        borderWidth: 2,
        borderStyle: 'solid',
        borderColor,
        boxShadow: mediaComplete
          ? '0 0 14px rgba(16, 185, 129, 0.35)'
          : '0 0 14px rgba(255, 123, 0, 0.35)',
      }}
    >
      {/* 1. Thanh tiêu đề + thu gọn + trạng thái media */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex flex-1 items-center gap-2 min-w-0 text-left rounded-lg px-3 py-2 bg-zinc-900/40 hover:bg-zinc-900/70 transition-colors cursor-pointer"
          style={{ borderWidth: 1, borderStyle: 'solid', borderColor: `${borderColor}66` }}
          title={collapsed ? 'Mở rộng cảnh' : 'Thu gọn chỉ còn tiêu đề'}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
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
              className="text-[9px] font-bold tabular-nums px-1.5 py-0.5 rounded font-sans"
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
              className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"
              title="Đã có file Audio"
            />
          )}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded cursor-pointer font-sans hover:opacity-90"
            style={{
              color: titleColor,
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor,
              backgroundColor: 'transparent',
            }}
          >
            {collapsed ? 'Mở' : 'Thu gọn'}
          </button>
        </div>
      </div>

      {collapsed ? null : (
      <>
      {/* 2. Textarea câu chuyện của cảnh */}
      <textarea
        value={scene.content}
        onChange={(e) => handleSceneChange(sceneIndex, e.target.value)}
        placeholder="Nội dung kịch bản văn học chi tiết đa giác quan cho phân cảnh này..."
        className="w-full min-h-[160px] bg-transparent text-md leading-loose text-zinc-300 resize-y outline-none border border-zinc-900/10 focus:border-zinc-800 focus:bg-zinc-900/20 p-3 rounded transition-all font-sans"
      />
      
      {/* 3. Footer của cảnh: Thống kê + Nút biên soạn */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-900/40 pt-2 text-xs">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-sans">
            📊 {getWordCount(scene.content)} từ
          </span>
          <span className="text-zinc-700 select-none">|</span>
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-sans">
            {scene.content.length} ký tự
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {isHook && (
            <label
              className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 cursor-pointer text-[10px] font-bold uppercase tracking-wider font-sans transition-colors ${
                store.humanEditFlags?.[store.chuong_dang_chon]?.edited
                  ? 'border-emerald-700 bg-emerald-500/15 text-emerald-400'
                  : 'border-zinc-800 bg-black/40 text-zinc-400 hover:border-emerald-900/60 hover:text-emerald-400/80'
              }`}
              title="Human Pass: tick để chèn câu đùa bâng quơ (không dính cốt truyện) vào Hook (+ chương) và mở cổng TTS"
            >
              <input
                type="checkbox"
                className="accent-emerald-500 h-3 w-3"
                checked={!!store.humanEditFlags?.[store.chuong_dang_chon]?.edited}
                onChange={(e) => {
                  const checked = e.target.checked;
                  const ch = store.chuong_dang_chon;
                  if (checked) {
                    // 1) Hook ~30s: chèn ≥1 câu đùa giữa nhịp thoại
                    const hookRaw = (scene.content || store.chapterHooks?.[ch]?.hook || '').trim();
                    if (hookRaw) {
                      const hookJoked = injectHumanJokeAsides(hookRaw, {
                        minCount: 1,
                        enabled: true,
                      });
                      handleSceneChange(sceneIndex, hookJoked);
                      store.setChapterHook(ch, { hook: hookJoked });
                    }
                    // 2) Toàn chương: bảo đảm có câu đùa (nếu AI chưa chèn)
                    const chapter = store.danh_sach_chuong.find((c) => c.so_chuong === ch);
                    const body = (chapter?.noi_dung || '').trim();
                    if (body && countHumanJokeAsides(body) < 1) {
                      store.updateChuong(ch, {
                        noi_dung: injectHumanJokeAsides(body, {
                          minCount: 1,
                          enabled: true,
                        }),
                      });
                    }
                  }
                  store.setHumanEditFlag(ch, {
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
            disabled={store.dang_tai || !scene.content.trim()}
            onClick={() => handleRewriteScene(sceneIndex)}
            title={
              isHook
                ? 'Viết lại Hook ~30s (tính người / humanize) — giữ cốt lõi cold-open'
                : 'Viết lại nhẹ nội dung cảnh — giữ cốt lõi, điều hòa nối tiếp cảnh trước/sau'
            }
            className="flex items-center gap-1 rounded bg-sky-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-sky-400 border border-sky-800/40 hover:bg-sky-500 hover:text-black transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-sans"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${store.dang_tai ? 'animate-spin' : ''}`} />
            Viết lại
          </button>
          <button
            type="button"
            disabled={store.dang_tai || !scene.content.trim()}
            onClick={() => handleExpandScene(sceneIndex)}
            title={
              isHook
                ? 'Mở rộng Hook cold-open (~30–45s) — thêm chi tiết, giữ open loop'
                : 'Mở rộng nội dung cảnh bằng AI (Expart)'
            }
            className="flex items-center gap-1 rounded bg-amber-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-500 border border-amber-800/40 hover:bg-amber-500 hover:text-black transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-sans"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Expart
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
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-emerald-500 uppercase flex items-center gap-2 font-sans">
              <Sparkles className="h-3 w-3" />
              Phân Tích & Sinh Ảnh / Video
            </h4>
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
                value={manualDuration !== '' ? manualDuration : (voiceDurationReference || defaultDuration)}
                onChange={(e) => {
                  setManualDuration(e.target.value);
                }}
                className="h-8 w-20 bg-zinc-900 border border-zinc-800 rounded px-2 text-xs text-zinc-300 outline-none focus:border-emerald-500 text-center font-sans"
              />
              <span className="text-[10px] text-zinc-500 italic font-sans">
                {voiceDurationReference 
                  ? `(Quét từ TTS: ${voiceDurationReference} giây)` 
                  : `(Khuyên dùng: ${defaultDuration} giây)`}
              </span>
            </div>
            
            <button
              type="button"
              disabled={generatingPrompt}
              onClick={() => {
                const durationVal = manualDuration !== '' 
                  ? Math.max(5, parseInt(manualDuration) || 5) 
                  : (voiceDurationReference || defaultDuration);
                // Chỉ sinh prompt — Seedance/công thức nằm trong API, không gộp ảnh/video
                void handleGenerateImagePrompt(scene.content, sceneIndex, durationVal);
              }}
              className="w-full h-9 rounded bg-emerald-500 text-black text-xs font-bold hover:bg-emerald-400 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-sans"
              title="Sinh prompt shot. Công thức đạo diễn (Seedance) áp trong backend."
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
                  
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyScene(
                        promptsAsset
                          .map((p: ScenePromptItem) => p.image_prompt || p.prompt || '')
                          .filter(Boolean)
                          .join('\n'),
                      )
                    }
                    className="text-[9px] font-bold uppercase tracking-wider text-zinc-300 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 hover:text-white px-2.5 py-0.5 rounded transition-colors flex items-center gap-0.5 cursor-pointer font-sans"
                    title={`Copy toàn bộ prompt ảnh của ${isHook ? 'Hook' : `cảnh ${sceneIndex + 1}`}, mỗi dòng một prompt`}
                  >
                    📋 Copy All
                  </button>
                </div>
              </div>

              {promptsAsset.map((promptItem: ScenePromptItem, pIdx: number) => {
                const singlePromptKey = imageAssetKey(
                  store.chuong_dang_chon,
                  sceneIndex,
                  pIdx,
                );
                const scriptPromptText = promptItem.script_prompt || promptItem.sentence || '';
                const imagePromptText = promptItem.image_prompt || promptItem.prompt || '';
                const videoPromptText = promptItem.video_prompt || imagePromptText;
                const videoKey = videoAssetKeyFromImageKey(singlePromptKey);
                return (
                  <ScenePromptRow
                    key={pIdx}
                    promptItem={promptItem}
                    pIdx={pIdx}
                    chapter={store.chuong_dang_chon}
                    sceneIndex={sceneIndex}
                    isHook={isHook}
                    promptsLen={promptsAsset.length}
                    regenerating={!!regeneratingSinglePrompt[singlePromptKey]}
                    imageGenerating={!!generatingImage[singlePromptKey]}
                    videoGenerating={!!generatingVideo[videoKey]}
                    generatedImg={store.generatedImages?.[singlePromptKey]}
                    generatedVideo={store.generatedVideos?.[videoKey]}
                    projectUrl={store.projectUrls?.[singlePromptKey]}
                    upscaling={!!upscalingImage[singlePromptKey]}
                    removingBg={!!removingBg[singlePromptKey]}
                    onOpenProjectUrl={(url) => window.open(url, '_blank')}
                    onGenImage={() =>
                      handleGenerateImage(sceneIndex, pIdx, imagePromptText, scriptPromptText)
                    }
                    onGenVideo={() => {
                      if (pIdx === 0 || pIdx === promptsAsset.length - 1) {
                        handleGenerateVideo(sceneIndex, pIdx, pIdx, videoPromptText);
                      } else {
                        handleGenerateVideo(sceneIndex, pIdx - 1, pIdx, videoPromptText);
                      }
                    }}
                    onRegenPrompt={() =>
                      handleRegenPrompt(sceneIndex, pIdx, scriptPromptText, imagePromptText)
                    }
                    onCopy={handleCopyScene}
                    onZoom={onImageZoom}
                    onUpscale={() => {
                      const img = store.generatedImages?.[singlePromptKey];
                      if (img) void handleUpscaleImage(img, singlePromptKey);
                    }}
                    onBgRemove={() => {
                      const img = store.generatedImages?.[singlePromptKey];
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
