'use client';

import React, { useMemo, useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { useFolderActions } from '../hooks/useFolderActions';
import { getWordCount } from '../utils/stringUtils';
import {
  countHumanJokeAsides,
  injectHumanJokeAsides,
  isHookSceneIndex,
  scenePromptCode,
  YOUTUBE_HOOK_DEFAULT_DURATION_SEC,
} from '@/lib/youtubeSafe';
import {
  Sparkles,
  Copy,
  Play,
  Square,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import RoleCastStudioModal from './RoleCastStudioModal';
import { isCastActive, normalizeVoiceCast } from '@/lib/voiceCast';
import {
  clearMultiPartial,
  countPartialParts,
  loadMultiPartial,
} from '@/lib/multiTtsPartialCache';
import { runCastPreflight } from '../modules/castPreflight';

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
  const [castStudioOpen, setCastStudioOpen] = useState(false);
  const [partialTick, setPartialTick] = useState(0);
  const cast = normalizeVoiceCast(store.voiceCast);
  const castActive = isCastActive(cast);
  const chapterNum = store.chuong_dang_chon || 1;

  const partialInfo = useMemo(() => {
    const entry = loadMultiPartial(chapterNum, sceneIndex);
    const cached = countPartialParts(entry);
    return {
      cached,
      total: entry?.total || 0,
      has: cached > 0,
    };
    // partialTick forces re-read after clear
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterNum, sceneIndex, partialTick, generatingTTS, ttsStatus]);

  const castPreview = useMemo(() => {
    if (!scene.content?.trim()) {
      return {
        multi: false,
        segs: 0,
        voices: 0,
        label: '',
        warns: [] as string[],
      };
    }
    try {
      const pf = runCastPreflight({
        sceneText: scene.content,
        chapter: chapterNum,
        sceneIndex,
        cast,
        characterNames: store.nhan_vat || [],
        nhanVatPrompts: store.nhan_vat_prompts || {},
        defaultVoice: store.ttsConfig.voice || '',
        platform: store.ttsConfig.platform || 'edge_tts',
        language: store.ttsConfig.language || 'vi',
        globalSpeed: store.ttsConfig.speed ?? 1,
        globalPitch: store.ttsConfig.pitch ?? 0,
      });
      const warns = pf.issues
        .filter((i) => i.level === 'warn' || i.level === 'block')
        .map((i) => i.message);
      if (!castActive) {
        return {
          multi: false,
          segs: 0,
          voices: 0,
          label: '',
          warns,
        };
      }
      return {
        multi: pf.multi,
        segs: pf.segmentCount,
        voices: pf.voiceCount,
        label: pf.multi
          ? `Multi ${pf.voiceCount} giọng · ${pf.segmentCount} đoạn`
          : pf.segmentCount
            ? `Cast · ${pf.segmentCount} đoạn (đơn giọng)`
            : 'Cast ON',
        warns,
      };
    } catch {
      return {
        multi: false,
        segs: 0,
        voices: 0,
        label: castActive ? 'Cast ON' : '',
        warns: [] as string[],
      };
    }
  }, [
    castActive,
    cast,
    scene.content,
    sceneIndex,
    chapterNum,
    store.nhan_vat,
    store.nhan_vat_prompts,
    store.ttsConfig.voice,
    store.ttsConfig.platform,
    store.ttsConfig.language,
    store.ttsConfig.speed,
    store.ttsConfig.pitch,
  ]);
  const [upscalingImage, setUpscalingImage] = useState<Record<string, boolean>>({});
  const [removingBg, setRemovingBg] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState(false);

  const handleUpscaleImage = async (imagePath: string, key: string) => {
    setUpscalingImage(prev => ({ ...prev, [key]: true }));
    try {
      const outPath = imagePath.replace('.png', '_upscaled.png').replace('.jpg', '_upscaled.jpg');
      const res = await fetch('/api/navtools/upscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath, outPath, targetHeight: 2160 })
      });
      const data = await res.json();
      if (data.success) {
        store.addGeneratedImage(key, data.outPath);
      } else {
        alert("Upscale failed: " + data.error);
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
      const res = await fetch('/api/navtools/bg_remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath, outPath })
      });
      const data = await res.json();
      if (data.success) {
        store.addGeneratedImage(key, data.outPath);
      } else {
        alert("Xóa nền thất bại: " + data.error);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRemovingBg(prev => ({ ...prev, [key]: false }));
    }
  };


  const assetKey = `${store.chuong_dang_chon}_${sceneIndex}`;
  const audioAsset = store.generatedAudioPaths[assetKey];
  const promptsAsset = store.generatedPrompts[assetKey];
  const isHook = isHookSceneIndex(sceneIndex);

  // Tiến độ ảnh + video theo từng prompt
  const promptCount = promptsAsset?.length || 0;
  let imageDone = 0;
  let videoDone = 0;
  if (promptsAsset && promptCount > 0) {
    for (let pIdx = 0; pIdx < promptCount; pIdx++) {
      const imgKey = `${store.chuong_dang_chon}_${sceneIndex}_${pIdx}`;
      const vidKey = `${imgKey}_video`;
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
        <div className="mt-2 rounded-lg border border-amber-900/30 bg-amber-950/10 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-amber-500 uppercase flex items-center gap-2 font-sans">
              <Sparkles className="h-3 w-3" />
              Trình Thu Âm AI Studio
            </h4>
          </div>
          
          <div className="flex flex-col sm:flex-row items-end gap-3">
            <div className="flex-1 w-full flex flex-col gap-1 bg-black/20 px-3 py-1.5 rounded border border-amber-900/20">
              <span className="text-[10px] text-zinc-400 font-sans italic">
                🌍 TTS: {store.ttsConfig.platform.toUpperCase()} · người kể = giọng mặc định
                · thoại <span className="text-sky-500/90">Tên NV:</span> đổi giọng theo hồ sơ
              </span>
              {castActive && castPreview.label ? (
                <span
                  className={`text-[9px] font-bold uppercase tracking-wider font-sans ${
                    castPreview.multi ? 'text-emerald-400' : 'text-sky-400/90'
                  }`}
                >
                  🎭 {castPreview.label}
                </span>
              ) : null}
              {partialInfo.has ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[9px] font-bold text-violet-400 uppercase tracking-wider font-sans">
                    💾 Resume {partialInfo.cached}/{partialInfo.total} đoạn
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      clearMultiPartial(chapterNum, sceneIndex);
                      setPartialTick((t) => t + 1);
                    }}
                    className="text-[8px] font-bold uppercase text-zinc-500 hover:text-rose-400 cursor-pointer"
                    title="Xóa cache partial — gen full lại"
                  >
                    Xóa cache
                  </button>
                </div>
              ) : null}
              {castPreview.warns?.length ? (
                <span className="text-[9px] text-amber-500/90 font-sans leading-snug">
                  ⚠️ {castPreview.warns[0]}
                  {castPreview.warns.length > 1
                    ? ` (+${castPreview.warns.length - 1})`
                    : ''}
                </span>
              ) : null}
            </div>
            
            <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end flex-wrap">
              {/* Phân vai giọng theo cảnh */}
              <button
                type="button"
                onClick={() => {
                  store.ensureVoiceCastSeeded();
                  setCastStudioOpen(true);
                }}
                className={`h-8 px-3 rounded border text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer font-sans ${
                  castActive
                    ? 'border-emerald-700/50 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                    : 'border-sky-900/40 bg-zinc-900 text-sky-400 hover:bg-zinc-850 hover:text-sky-300'
                }`}
                title="Role Casting Studio — gán giọng từng NV cho cảnh này"
              >
                🎭 Phân vai
                {castActive ? <span className="text-[9px] opacity-80">ON</span> : null}
              </button>

              {/* Nút Nghe Thử */}
              <button
                type="button"
                onClick={() => {
                  if (isPlayingTTS) {
                    handleStopTTS();
                  } else {
                    handlePlayTTS(scene.content, sceneIndex, '');
                  }
                }}
                className="h-8 px-3 rounded border border-amber-900/40 bg-zinc-900 text-amber-400 text-xs font-bold hover:bg-zinc-850 hover:text-amber-300 transition-colors flex items-center gap-1 cursor-pointer font-sans"
              >
                {isPlayingTTS ? (
                  <Square className="h-3.5 w-3.5 fill-amber-400 shrink-0 border-none" />
                ) : (
                  <Play className="h-3.5 w-3.5 fill-amber-400 shrink-0 border-none" />
                )}
                {isPlayingTTS ? 'Dừng phát' : 'Nghe thử'}
              </button>
              
              {/* Nút Sinh Âm Thanh AI */}
              <button
                type="button"
                disabled={generatingTTS}
                onClick={async (e) => {
                  const durationVal = manualDuration !== '' 
                    ? parseInt(manualDuration) || 5 
                    : (voiceDurationReference || 5);
                  // Shift+click = force full multi (bỏ resume cache)
                  const forceFull = e.shiftKey;
                    
                  const newDuration = await handleGenerateTTS(
                    scene.content,
                    sceneIndex,
                    '',
                    durationVal,
                    forceFull ? { forceFullMulti: true } : undefined,
                  );
                  
                  // Nếu ở Mode Pro, tự động chốt số giây thực tế vào ô Thời lượng (Auto-Alignment)
                  if (store.ttsConfig.syncMode === 'pro' && newDuration) {
                    setManualDuration(newDuration.toString());
                  }
                }}
                title="Click: gen (resume multi nếu có). Shift+Click: gen full lại mọi đoạn"
                className="h-8 px-4 rounded bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 font-sans"
              >
                {generatingTTS ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    {ttsProgress > 0 ? `${ttsProgress}%` : 'Gen…'}
                  </>
                ) : (
                  <>
                    Gen Audio & Lưu PC
                  </>
                )}
              </button>
            </div>
          </div>

          {generatingTTS && (
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900 border border-zinc-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-600 to-emerald-400 transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(2, ttsProgress))}%` }}
                />
              </div>
              {ttsStatus ? (
                <p className="text-[10px] text-amber-400/90 font-sans truncate" title={ttsStatus}>
                  {ttsStatus}
                </p>
              ) : null}
            </div>
          )}

          {/* Render Audio Player nếu audio đã có */}
          {audioAsset && (
            <div className="bg-zinc-950/60 border border-zinc-900/60 p-3 rounded-lg flex flex-col gap-2 mt-2">
              <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest flex items-center gap-1 font-sans">
                🔊 TỆP ÂM THANH ĐÃ SINH
              </span>
              <audio controls src={audioAsset.path} className="w-full h-8" />
              <span className="text-[9px] text-zinc-500 font-sans">
                Thời lượng: {audioAsset.duration} giây. Tệp: {audioAsset.path}
              </span>
            </div>
          )}
        </div>
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
                handleGenerateImagePrompt(scene.content, sceneIndex, durationVal);
              }}
              className="w-full h-9 rounded bg-emerald-500 text-black text-xs font-bold hover:bg-emerald-400 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-sans"
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
                  {/* Nút Sinh Tất Cả Ảnh Song Song */}
                  <button
                    type="button"
                    onClick={() => handleGenerateAllImages(sceneIndex)}
                    className="text-[9px] font-bold uppercase tracking-wider text-black bg-emerald-500 hover:bg-emerald-400 px-2.5 py-0.5 rounded transition-all shadow-md hover:shadow-emerald-500/20 flex items-center gap-0.5 cursor-pointer font-sans"
                    title="Sinh ảnh ngầm cùng lúc (đa luồng) cho toàn bộ prompts"
                  >
                    🚀 Gen tất cả ảnh
                  </button>
                  
                  {/* Nút Sinh Toàn Bộ Video (Tuần tự) */}
                  <button
                    type="button"
                    onClick={() => handleGenerateAllVideos(sceneIndex)}
                    className="text-[9px] font-bold uppercase tracking-wider text-black bg-cyan-500 hover:bg-cyan-400 px-2.5 py-0.5 rounded transition-all shadow-md hover:shadow-cyan-500/20 flex items-center gap-0.5 cursor-pointer font-sans"
                    title="Sinh video tuần tự qua tất cả các prompt ảnh"
                  >
                    🎬 Gen toàn bộ Video
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => handleCopyScene(promptsAsset.map((p: any) => p.image_prompt || p.prompt || '').filter(Boolean).join('\n'))}
                    className="text-[9px] font-bold uppercase tracking-wider text-zinc-300 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 hover:text-white px-2.5 py-0.5 rounded transition-colors flex items-center gap-0.5 cursor-pointer font-sans"
                    title={`Copy toàn bộ prompt ảnh của ${isHook ? 'Hook' : `cảnh ${sceneIndex + 1}`}, mỗi dòng một prompt`}
                  >
                    📋 Copy All
                  </button>
                </div>
              </div>

              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {promptsAsset.map((promptItem: any, pIdx: number) => {
                const singlePromptKey = `${store.chuong_dang_chon}_${sceneIndex}_${pIdx}`;
                const isRegening = regeneratingSinglePrompt[singlePromptKey] || false;
                const promptCode = scenePromptCode(sceneIndex, pIdx);
                const scriptPromptText = promptItem.script_prompt || promptItem.sentence || '';
                const imagePromptText = promptItem.image_prompt || promptItem.prompt || '';
                const videoPromptText = promptItem.video_prompt || imagePromptText;
                
                // Trạng thái Whisk Automation
                const generatedImg = store.generatedImages?.[singlePromptKey];
                const isImgGenerating = generatingImage[singlePromptKey] || false;
                const videoKey = `${singlePromptKey}_video`;
                const generatedVideo = store.generatedVideos?.[videoKey];

                return (
                  <div key={pIdx} className={`flex w-full flex-row items-start gap-4 rounded-lg border p-3 shadow-sm animate-in fade-in duration-200 ${
                    pIdx % 2 === 0
                      ? 'border-zinc-800/70 bg-zinc-900/25'
                      : 'border-zinc-900/80 bg-zinc-950/45'
                  }`}>
                    {/* Cột Trái: Thông tin và Thao tác */}
                    <div className="flex-1 flex flex-col gap-2 w-full">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wider font-sans flex items-center gap-1">
                          🔑 {promptCode} <span className="text-zinc-600 font-normal">(⏱ {promptItem.timestamp})</span>
                        </span>
                        
                        <div className="flex flex-wrap items-center gap-1.5">
                          {/* NÚT MỞ LINK GOOGLE WHISK TRỰC TIẾP TRÊN MỖI DÒNG */}
                          {store.projectUrls?.[singlePromptKey] && (
                            <button
                              type="button"
                              onClick={() => {
                                const projectUrl = store.projectUrls[singlePromptKey];
                                if (projectUrl) {
                                  window.open(projectUrl, '_blank');
                                }
                              }}
                              className="text-[8px] font-bold uppercase text-zinc-500 hover:text-amber-500 transition-colors flex items-center gap-1 cursor-pointer font-sans"
                              title="Mở xem quá trình khởi tạo ảnh trên Google Flow"
                            >
                              🌐 Mở Link
                            </button>
                          )}

                          {/* NÚT GEN ẢNH / TẠO LẠI ẢNH BẰNG GOOGLE IMAGEN 3 API KHÓA HOẶC COOKIE */}
                          <button
                            type="button"
                            disabled={isImgGenerating}
                            onClick={() => handleGenerateImage(sceneIndex, pIdx, imagePromptText, scriptPromptText)}
                            className={`text-[9px] font-bold uppercase transition-all flex items-center gap-0.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-sans px-2 py-0.5 rounded border ${
                              generatedImg 
                                ? 'text-sky-400 border-sky-900/50 hover:bg-sky-950/20' 
                                : 'text-black bg-emerald-500 border-none hover:bg-emerald-400 shadow-md hover:shadow-emerald-500/20'
                            }`}
                            title={generatedImg ? "Bấm để vẽ lại ảnh mới (Tạo lại ảnh)" : "Sinh ảnh ngầm tự động bằng Google Imagen 3 API hoặc Whisk"}
                          >
                            <RefreshCw className={`h-2.5 w-2.5 ${isImgGenerating ? 'animate-spin' : ''}`} />
                            {isImgGenerating ? 'Đang vẽ...' : (generatedImg ? 'Tạo lại ảnh' : 'Gen ảnh')}
                          </button>

                          {/* NÚT GEN VIDEO */}
                          <button
                            type="button"
                            disabled={generatingVideo[`${store.chuong_dang_chon}_${sceneIndex}_${pIdx}_video`]}
                            onClick={() => {
                              if (pIdx === 0 || pIdx === promptsAsset.length - 1) {
                                // First or Last: Gen video of ITSELF (Single Image Video)
                                handleGenerateVideo(sceneIndex, pIdx, pIdx, videoPromptText);
                              } else {
                                // Middle: Interpolate from previous to this
                                handleGenerateVideo(sceneIndex, pIdx - 1, pIdx, videoPromptText);
                              }
                            }}
                            className={`text-[9px] font-bold uppercase transition-all flex items-center gap-0.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-sans px-2 py-0.5 rounded border text-black bg-cyan-500 border-none hover:bg-cyan-400 shadow-md`}
                            title={pIdx === 0 || pIdx === promptsAsset.length - 1 ? "Sinh Video chuyển động từ ảnh này" : "Sinh Video nội suy giữa ảnh trước và ảnh này"}
                          >
                            <RefreshCw className={`h-2.5 w-2.5 ${generatingVideo[`${store.chuong_dang_chon}_${sceneIndex}_${pIdx}_video`] ? 'animate-spin' : ''}`} />
                            {generatingVideo[`${store.chuong_dang_chon}_${sceneIndex}_${pIdx}_video`] ? 'Đang sinh...' : (pIdx === 0 || pIdx === promptsAsset.length - 1 ? '🎬 Gen Video' : '🎬 Nối Video')}
                          </button>

                          {/* Nút Viết Lại Prompt */}
                          <button
                            type="button"
                            disabled={isRegening}
                            onClick={() => handleRegenPrompt(sceneIndex, pIdx, scriptPromptText, imagePromptText)}
                            className="text-[9px] font-bold uppercase text-amber-500 hover:text-amber-400 border border-amber-900/30 px-2 py-0.5 rounded transition-colors flex items-center gap-0.5 cursor-pointer font-sans disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Sinh lại prompt văn bản nếu bị lỗi chính sách"
                          >
                            <RefreshCw className={`h-2 w-2 ${isRegening ? 'animate-spin' : ''}`} />
                            {isRegening ? 'Đang viết lại...' : 'Viết lại'}
                          </button>
                          
                          <button
                            type="button"
                            onClick={() => handleCopyScene(imagePromptText)}
                            className="text-[9px] font-bold uppercase text-zinc-400 hover:text-white border border-zinc-800 px-2 py-0.5 rounded transition-colors flex items-center justify-center gap-0.5 cursor-pointer font-sans"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 gap-2">
                        <label className="flex flex-col gap-1">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 font-sans">Kịch bản sinh prompt</span>
                          <textarea
                            readOnly
                            value={scriptPromptText}
                            rows={2}
                            className="w-full text-[11px] text-zinc-400 leading-relaxed bg-zinc-950/60 p-2 rounded border border-zinc-900/70 resize-y outline-none focus:border-zinc-700 select-all font-sans"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-500 font-sans">Prompt ảnh</span>
                          <textarea
                            readOnly
                            value={imagePromptText}
                            rows={3}
                            className="w-full text-xs text-zinc-300 leading-relaxed bg-zinc-900/40 p-2.5 rounded border border-zinc-900/50 resize-y outline-none focus:border-emerald-850 select-all font-sans"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-cyan-400 font-sans">Prompt video</span>
                          <textarea
                            readOnly
                            value={videoPromptText}
                            rows={3}
                            className="w-full text-xs text-zinc-300 leading-relaxed bg-cyan-950/10 p-2.5 rounded border border-cyan-950/50 resize-y outline-none focus:border-cyan-800 select-all font-sans"
                          />
                        </label>
                      </div>
                    </div>

                    {/* Cột Phải: Hình ảnh và Video */}
                    <div className="w-96 shrink-0 flex gap-2 items-start pt-1">
                      {/* Box Hình Ảnh */}
                      <div className="w-48 flex flex-col gap-1 items-center justify-start">
                        {generatedImg ? (
                          <>
                            <div 
                              onClick={() => onImageZoom(generatedImg)}
                              className="relative group w-full h-32 overflow-hidden rounded-lg border border-zinc-800/80 shadow-md transition-all duration-300 hover:border-zinc-700 cursor-zoom-in"
                              title="Bấm để phóng to ảnh phân cảnh"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img 
                                src={generatedImg} 
                                alt={`${isHook ? 'Hook' : `Cảnh ${sceneIndex + 1}`} Prompt ${pIdx + 1}`} 
                                className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                              />
                              <div className="absolute bottom-1 right-1 bg-black/75 backdrop-blur-sm rounded px-1.5 py-0.5 text-[7px] font-mono text-zinc-400 border border-zinc-800">
                                {promptCode}.png
                              </div>
                            </div>
                            
                            {/* Nút Upscale và Tách nền */}
                            <div className="mt-1 w-full flex items-center gap-1">
                              <button
                                type="button"
                                disabled={upscalingImage[singlePromptKey]}
                                onClick={() => handleUpscaleImage(generatedImg, singlePromptKey)}
                                className="flex-1 text-[9px] font-bold uppercase tracking-wider text-black bg-emerald-500 hover:bg-emerald-400 px-1 py-1 rounded transition-all shadow-md hover:shadow-emerald-500/20 flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-sans"
                                title="Tăng độ phân giải ảnh (Upscale) bằng NAVTools AI"
                              >
                                <Sparkles className={`h-2.5 w-2.5 ${upscalingImage[singlePromptKey] ? 'animate-spin' : ''}`} />
                                {upscalingImage[singlePromptKey] ? 'Đang Upscale' : 'Upscale'}
                              </button>
                              <button
                                type="button"
                                disabled={removingBg[singlePromptKey]}
                                onClick={() => handleBgRemoveImage(generatedImg, singlePromptKey)}
                                className="flex-1 text-[9px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/40 border border-emerald-900/50 hover:bg-emerald-900/40 hover:text-emerald-300 px-1 py-1 rounded transition-all shadow-md flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-sans"
                                title="Tách phông nền ảnh bằng NAVTools AI"
                              >
                                <span className={removingBg[singlePromptKey] ? 'animate-pulse' : ''}>
                                  ✂ {removingBg[singlePromptKey] ? 'Đang Tách...' : 'Tách Nền'}
                                </span>
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="w-full h-32 rounded-lg border border-dashed border-zinc-900 bg-zinc-950/40 flex flex-col items-center justify-center text-center p-3 transition-colors hover:bg-zinc-900/10">
                            <div className="h-7 w-7 rounded-full bg-zinc-900/80 flex items-center justify-center text-zinc-650 mb-1.5 border border-zinc-850 shadow-sm animate-pulse">
                              🎨
                            </div>
                            <span className="text-[8px] text-zinc-600 uppercase font-sans tracking-wider font-semibold">Chưa sinh ảnh</span>
                          </div>
                        )}
                      </div>

                      {/* Box Video */}
                      <div className="w-48 flex flex-col gap-1 items-center justify-start">
                        {generatedVideo ? (
                          <div className="relative group w-full h-32 overflow-hidden rounded-lg border border-cyan-800/80 shadow-md transition-all duration-300 hover:border-cyan-700 bg-black flex items-center justify-center">
                            <video 
                              src={generatedVideo} 
                              controls
                              className="w-full h-full object-contain"
                            />
                            <div className="absolute top-1 left-1 bg-cyan-900/90 text-white rounded px-1.5 py-0.5 text-[8px] font-bold">
                              VIDEO NỘI SUY
                            </div>
                          </div>
                        ) : (
                          <div className="w-full h-32 rounded-lg border border-dashed border-zinc-900 bg-zinc-950/40 flex flex-col items-center justify-center text-center p-3 transition-colors hover:bg-zinc-900/10">
                            <div className="h-7 w-7 rounded-full bg-zinc-900/80 flex items-center justify-center text-zinc-650 mb-1.5 border border-zinc-850 shadow-sm animate-pulse">
                              🎬
                            </div>
                            <span className="text-[8px] text-zinc-600 uppercase font-sans tracking-wider font-semibold">Chưa sinh video</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      </>
      )}

      <RoleCastStudioModal
        isOpen={castStudioOpen}
        onClose={() => setCastStudioOpen(false)}
        sceneText={scene.content}
        chapter={store.chuong_dang_chon || 1}
        sceneIndex={sceneIndex}
        initialTab="board"
      />
    </div>
  );
}
