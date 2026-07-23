'use client';

/**
 * Một hàng prompt (script / image / video) + preview ảnh/video + actions.
 * Progress gen chỉ subscribe theo key trong mediaGenSlotStore — chỉ khung preview / nút
 * của slot đó re-render (~2s), không kéo cả workspace.
 */
import React, { useMemo } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { imageAssetKey, sceneAssetKey, videoAssetKey } from '@/contracts';
import { scenePromptCode } from '@/lib/youtubeSafe';
import { useMediaGenSlot } from '../../modules/mediaGenSlotStore';
import { useNovelStore } from '@/store/useNovelStore';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PromptAssetItem = any;

export type ScenePromptRowProps = {
  promptItem: PromptAssetItem;
  pIdx: number;
  chapter: number;
  sceneIndex: number;
  isHook: boolean;
  promptsLen: number;
  regenerating: boolean;
  upscaling: boolean;
  removingBg: boolean;
  onOpenProjectUrl: (url: string) => void;
  onGenImage: () => void;
  onGenVideo: () => void;
  /** B — nối dài clip Flow (cần video + mediaId) */
  onExtendVideo?: () => void;
  onRegenPrompt: () => void;
  onCopy: (text: string) => void;
  onZoom: (url: string) => void;
  onUpscale: () => void;
  onBgRemove: () => void;
};

/** Nút Gen ảnh — chỉ re-render khi progress của imageKey đổi. */
function GenImageButton({
  imageKey,
  hasImage,
  onGen,
}: {
  imageKey: string;
  hasImage: boolean;
  onGen: () => void;
}) {
  const { generating, progress } = useMediaGenSlot(imageKey);
  return (
    <button
      type="button"
      disabled={generating}
      onClick={onGen}
      className={`text-[9px] font-bold uppercase transition-all flex items-center gap-0.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-sans px-2 py-0.5 rounded border ${
        hasImage
          ? 'text-sky-400 border-sky-900/50 hover:bg-sky-950/20'
          : 'text-black bg-emerald-500 border-none hover:bg-emerald-400 shadow-md'
      }`}
      title={
        generating && progress
          ? `${progress.percent}% · ${progress.phase}`
          : undefined
      }
    >
      <RefreshCw className={`h-2.5 w-2.5 ${generating ? 'animate-spin' : ''}`} />
      {generating
        ? progress
          ? `${progress.percent}%`
          : 'Đang vẽ...'
        : hasImage
          ? 'Tạo lại ảnh'
          : 'Gen ảnh'}
    </button>
  );
}

/** Nút Gen video — chỉ re-render khi progress của videoKey đổi. */
function GenVideoButton({
  videoKey,
  isEdge,
  onGen,
  onExtend,
  hasVideo,
}: {
  videoKey: string;
  isEdge: boolean;
  onGen: () => void;
  onExtend?: () => void;
  hasVideo?: boolean;
}) {
  const { generating, progress } = useMediaGenSlot(videoKey);
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={generating}
        onClick={onGen}
        className="text-[9px] font-bold uppercase transition-all flex items-center gap-0.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-sans px-2 py-0.5 rounded border text-black bg-cyan-500 border-none hover:bg-cyan-400 shadow-md"
        title={
          generating && progress
            ? `${progress.percent}% · ${progress.phase}`
            : undefined
        }
      >
        <RefreshCw className={`h-2.5 w-2.5 ${generating ? 'animate-spin' : ''}`} />
        {generating
          ? progress
            ? `${progress.percent}%`
            : 'Đang sinh...'
          : isEdge
            ? '🎬 Gen Video'
            : '🎬 Nối Video'}
      </button>
      {hasVideo && onExtend ? (
        <button
          type="button"
          disabled={generating}
          onClick={onExtend}
          className="text-[9px] font-bold uppercase transition-all flex items-center gap-0.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-sans px-2 py-0.5 rounded border border-violet-700/60 text-violet-300 bg-violet-950/40 hover:bg-violet-900/50"
          title="Nối dài clip (Flow Extend) — giữ nhân vật & chuyển động"
        >
          ⏩ Extend
        </button>
      ) : null}
    </span>
  );
}

/** Thanh % phía trên textareas — chỉ mount khi có gen. */
function SlotProgressBars({
  imageKey,
  videoKey,
}: {
  imageKey: string;
  videoKey: string;
}) {
  const img = useMediaGenSlot(imageKey);
  const vid = useMediaGenSlot(videoKey);
  if (!img.generating && !vid.generating) return null;

  return (
    <div className="space-y-1.5 rounded-md border border-zinc-800/80 bg-black/40 px-2 py-1.5">
      {img.generating && (
        <div className="space-y-0.5">
          <div className="flex items-center justify-between text-[9px] font-semibold tabular-nums">
            <span className="text-emerald-400/90 truncate pr-2">
              Ảnh · {img.progress?.phase || 'Đang gen…'}
            </span>
            <span className="text-emerald-300 shrink-0">
              {img.progress?.percent ?? 0}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-out will-change-[width]"
              style={{
                width: `${Math.min(100, Math.max(2, img.progress?.percent ?? 5))}%`,
              }}
            />
          </div>
        </div>
      )}
      {vid.generating && (
        <div className="space-y-0.5">
          <div className="flex items-center justify-between text-[9px] font-semibold tabular-nums">
            <span className="text-cyan-400/90 truncate pr-2">
              Video · {vid.progress?.phase || 'Đang gen…'}
            </span>
            <span className="text-cyan-300 shrink-0">
              {vid.progress?.percent ?? 0}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
            <div
              className="h-full rounded-full bg-cyan-500 transition-[width] duration-500 ease-out will-change-[width]"
              style={{
                width: `${Math.min(100, Math.max(2, vid.progress?.percent ?? 5))}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Khung preview ảnh — chỉ slot này cập nhật % mỗi ~2s. */
function ImagePreviewSlot({
  imageKey,
  generatedImg,
  promptCode,
  isHook,
  sceneIndex,
  pIdx,
  upscaling,
  removingBg,
  onZoom,
  onUpscale,
  onBgRemove,
}: {
  imageKey: string;
  generatedImg?: string;
  promptCode: string;
  isHook: boolean;
  sceneIndex: number;
  pIdx: number;
  upscaling: boolean;
  removingBg: boolean;
  onZoom: (url: string) => void;
  onUpscale: () => void;
  onBgRemove: () => void;
}) {
  const { generating, progress } = useMediaGenSlot(imageKey);
  const pct = progress?.percent ?? 0;
  const phase = progress?.phase || 'Đang gen ảnh…';

  if (generatedImg) {
    return (
      <>
        <div
          onClick={() => onZoom(generatedImg)}
          className="relative group w-full h-32 overflow-hidden rounded-lg border border-zinc-800/80 shadow-md cursor-zoom-in"
          title="Bấm để phóng to"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={generatedImg}
            alt={`${isHook ? 'Hook' : `Cảnh ${sceneIndex + 1}`} Prompt ${pIdx + 1}`}
            className={`w-full h-full object-cover transition-transform duration-500 hover:scale-105 ${
              generating ? 'opacity-40' : ''
            }`}
          />
          {generating && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 p-2">
              <RefreshCw className="h-4 w-4 text-emerald-400 animate-spin" />
              <span className="text-[10px] font-bold tabular-nums text-emerald-300">
                {pct}%
              </span>
              <span className="text-[8px] text-emerald-400/90 text-center leading-tight">
                {phase}
              </span>
              <div className="h-1 w-[85%] overflow-hidden rounded-full bg-zinc-900">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.min(100, Math.max(2, pct || 5))}%` }}
                />
              </div>
            </div>
          )}
          <div className="absolute bottom-1 right-1 bg-black/75 rounded px-1.5 py-0.5 text-[7px] font-mono text-zinc-400 border border-zinc-800">
            {promptCode}.png
          </div>
        </div>
        {!generating && (
          <div className="mt-1 w-full flex items-center gap-1">
            <button
              type="button"
              disabled={upscaling}
              onClick={onUpscale}
              className="flex-1 text-[9px] font-bold uppercase tracking-wider text-black bg-emerald-500 hover:bg-emerald-400 px-1 py-1 rounded flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40 font-sans"
            >
              <Sparkles className={`h-2.5 w-2.5 ${upscaling ? 'animate-spin' : ''}`} />
              {upscaling ? 'Đang Upscale' : 'Upscale'}
            </button>
            <button
              type="button"
              disabled={removingBg}
              onClick={onBgRemove}
              className="flex-1 text-[9px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/40 border border-emerald-900/50 px-1 py-1 rounded cursor-pointer disabled:opacity-40 font-sans"
            >
              ✂ {removingBg ? 'Đang Tách...' : 'Tách Nền'}
            </button>
          </div>
        )}
      </>
    );
  }

  if (generating) {
    return (
      <div className="w-full h-32 rounded-lg border border-emerald-900/50 bg-emerald-950/20 flex flex-col items-center justify-center p-3 gap-1.5">
        <RefreshCw className="h-5 w-5 text-emerald-400 animate-spin" />
        <span className="text-[10px] font-bold tabular-nums text-emerald-300">{pct}%</span>
        <span className="text-[8px] text-emerald-500/80 text-center leading-tight px-1">
          {phase}
        </span>
        <div className="mt-0.5 h-1 w-full max-w-[90%] overflow-hidden rounded-full bg-zinc-900">
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-out will-change-[width]"
            style={{ width: `${Math.min(100, Math.max(2, pct || 5))}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-32 rounded-lg border border-dashed border-zinc-900 bg-zinc-950/40 flex flex-col items-center justify-center p-3">
      <div className="h-7 w-7 rounded-full bg-zinc-900/80 flex items-center justify-center mb-1.5">
        🎨
      </div>
      <span className="text-[8px] text-zinc-600 uppercase font-semibold">Chưa sinh ảnh</span>
    </div>
  );
}

/** Khung preview video — chỉ slot này cập nhật % mỗi ~2s. */
function VideoPreviewSlot({
  videoKey,
  generatedVideo,
}: {
  videoKey: string;
  generatedVideo?: string;
}) {
  const { generating, progress } = useMediaGenSlot(videoKey);
  const pct = progress?.percent ?? 0;
  const phase = progress?.phase || 'Đang gen video…';

  if (generatedVideo && !generating) {
    return (
      <div className="relative w-full h-32 overflow-hidden rounded-lg border border-cyan-800/80 bg-black flex items-center justify-center">
        <video src={generatedVideo} controls className="w-full h-full object-contain" />
        <div className="absolute top-1 left-1 bg-cyan-900/90 text-white rounded px-1.5 py-0.5 text-[8px] font-bold">
          VIDEO NỘI SUY
        </div>
      </div>
    );
  }

  if (generating) {
    return (
      <div className="relative w-full h-32 rounded-lg border border-cyan-900/50 bg-cyan-950/20 overflow-hidden">
        {generatedVideo ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={generatedVideo}
            className="absolute inset-0 w-full h-full object-contain opacity-30"
            muted
          />
        ) : null}
        <div className="relative z-10 flex h-full flex-col items-center justify-center p-3 gap-1.5">
          <RefreshCw className="h-5 w-5 text-cyan-400 animate-spin" />
          <span className="text-[10px] font-bold tabular-nums text-cyan-300">{pct}%</span>
          <span className="text-[8px] text-cyan-500/80 text-center leading-tight px-1">
            {phase}
          </span>
          <div className="mt-0.5 h-1 w-full max-w-[90%] overflow-hidden rounded-full bg-zinc-900">
            <div
              className="h-full rounded-full bg-cyan-500 transition-[width] duration-500 ease-out will-change-[width]"
              style={{ width: `${Math.min(100, Math.max(2, pct || 5))}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-32 rounded-lg border border-dashed border-zinc-900 bg-zinc-950/40 flex flex-col items-center justify-center p-3">
      <div className="h-7 w-7 rounded-full bg-zinc-900/80 flex items-center justify-center mb-1.5">
        🎬
      </div>
      <span className="text-[8px] text-zinc-600 uppercase font-semibold">Chưa sinh video</span>
    </div>
  );
}

function ScenePromptRow({
  promptItem,
  pIdx,
  chapter,
  sceneIndex,
  isHook,
  promptsLen,
  regenerating,
  upscaling,
  removingBg,
  onOpenProjectUrl,
  onGenImage,
  onGenVideo,
  onExtendVideo,
  onRegenPrompt,
  onCopy,
  onZoom,
  onUpscale,
  onBgRemove,
}: ScenePromptRowProps) {
  const promptCode = scenePromptCode(sceneIndex, pIdx);
  const scriptPromptText = promptItem.script_prompt || promptItem.sentence || '';
  const imagePromptText = promptItem.image_prompt || promptItem.prompt || '';
  const videoPromptText = promptItem.video_prompt || imagePromptText;
  const isEdge = pIdx === 0 || pIdx === promptsLen - 1;

  const imageKey = useMemo(
    () => imageAssetKey(chapter, sceneIndex, pIdx),
    [chapter, sceneIndex, pIdx],
  );
  const videoKey = useMemo(
    () => videoAssetKey(chapter, sceneIndex, pIdx),
    [chapter, sceneIndex, pIdx],
  );
  const sceneKey = useMemo(
    () => sceneAssetKey(chapter, sceneIndex),
    [chapter, sceneIndex],
  );

  // Chỉ path của key này — Zustand selector không re-render hàng khác
  const generatedImg = useNovelStore((state) => state.generatedImages?.[imageKey]);
  const generatedVideo = useNovelStore((state) => state.generatedVideos?.[videoKey]);
  const projectUrl = useNovelStore((state) => state.projectUrls?.[imageKey]);
  const patchGeneratedPrompt = useNovelStore((s) => s.patchGeneratedPrompt);
  const useEndFrame = !!promptItem.use_end_frame;

  return (
    <div
      className={`flex w-full flex-row items-start gap-4 rounded-lg border p-3 shadow-sm animate-in fade-in duration-200 ${
        pIdx % 2 === 0
          ? 'border-zinc-800/70 bg-zinc-900/25'
          : 'border-zinc-900/80 bg-zinc-950/45'
      }`}
    >
      <div className="flex-1 flex flex-col gap-2 w-full">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wider font-sans flex items-center gap-1">
            🔑 {promptCode}{' '}
            <span className="text-zinc-600 font-normal">(⏱ {promptItem.timestamp})</span>
          </span>

          <div className="flex flex-wrap items-center gap-1.5">
            {projectUrl ? (
              <button
                type="button"
                onClick={() => onOpenProjectUrl(projectUrl)}
                className="text-[8px] font-bold uppercase text-zinc-500 hover:text-amber-500 transition-colors flex items-center gap-1 cursor-pointer font-sans"
              >
                🌐 Mở Link
              </button>
            ) : null}

            <GenImageButton
              imageKey={imageKey}
              hasImage={!!generatedImg}
              onGen={onGenImage}
            />
            <GenVideoButton
              videoKey={videoKey}
              isEdge={isEdge}
              onGen={onGenVideo}
              onExtend={onExtendVideo}
              hasVideo={!!generatedVideo}
            />

            <label
              className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide cursor-pointer select-none ${
                useEndFrame
                  ? 'border-cyan-700/50 bg-cyan-950/40 text-cyan-300'
                  : 'border-zinc-800 bg-zinc-950/50 text-zinc-500 hover:text-zinc-300'
              }`}
              title="Keyframe start+end frame (Printfilm P2). Duration vẫn theo timestamp/TTS. Thiếu ảnh end → hard-fail."
            >
              <input
                type="checkbox"
                className="h-2.5 w-2.5 accent-cyan-500"
                checked={useEndFrame}
                onChange={(e) => {
                  const on = e.target.checked;
                  const endKey =
                    pIdx + 1 < promptsLen
                      ? imageAssetKey(chapter, sceneIndex, pIdx + 1)
                      : pIdx > 0
                        ? imageAssetKey(chapter, sceneIndex, pIdx - 1)
                        : imageKey;
                  patchGeneratedPrompt(sceneKey, pIdx, {
                    use_end_frame: on,
                    end_image_key: on ? endKey : undefined,
                  });
                }}
              />
              Start+End
            </label>

            <button
              type="button"
              disabled={regenerating}
              onClick={onRegenPrompt}
              className="text-[9px] font-bold uppercase text-amber-500 hover:text-amber-400 border border-amber-900/30 px-2 py-0.5 rounded transition-colors flex items-center gap-0.5 cursor-pointer font-sans disabled:opacity-40"
            >
              <RefreshCw className={`h-2 w-2 ${regenerating ? 'animate-spin' : ''}`} />
              {regenerating ? 'Đang viết lại...' : 'Viết lại'}
            </button>

            <button
              type="button"
              onClick={() => onCopy(imagePromptText)}
              className="text-[9px] font-bold uppercase text-zinc-400 hover:text-white border border-zinc-800 px-2 py-0.5 rounded transition-colors font-sans"
            >
              Copy
            </button>
          </div>
        </div>

        <SlotProgressBars imageKey={imageKey} videoKey={videoKey} />

        <div className="grid grid-cols-1 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">
              Kịch bản sinh prompt
            </span>
            <textarea
              readOnly
              value={scriptPromptText}
              rows={2}
              className="w-full text-[11px] text-zinc-400 leading-relaxed bg-zinc-950/60 p-2 rounded border border-zinc-900/70 resize-y outline-none select-all font-sans"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-500">
              Prompt ảnh
            </span>
            <textarea
              readOnly
              value={imagePromptText}
              rows={3}
              className="w-full text-xs text-zinc-300 leading-relaxed bg-zinc-900/40 p-2.5 rounded border border-zinc-900/50 resize-y outline-none select-all font-sans"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-cyan-400">
              Prompt video
            </span>
            <textarea
              readOnly
              value={videoPromptText}
              rows={3}
              className="w-full text-xs text-zinc-300 leading-relaxed bg-cyan-950/10 p-2.5 rounded border border-cyan-950/50 resize-y outline-none select-all font-sans"
            />
          </label>
        </div>
      </div>

      <div className="w-96 shrink-0 flex gap-2 items-start pt-1">
        <div className="w-48 flex flex-col gap-1 items-center justify-start">
          <ImagePreviewSlot
            imageKey={imageKey}
            generatedImg={generatedImg}
            promptCode={promptCode}
            isHook={isHook}
            sceneIndex={sceneIndex}
            pIdx={pIdx}
            upscaling={upscaling}
            removingBg={removingBg}
            onZoom={onZoom}
            onUpscale={onUpscale}
            onBgRemove={onBgRemove}
          />
        </div>

        <div className="w-48 flex flex-col gap-1 items-center justify-start">
          <VideoPreviewSlot videoKey={videoKey} generatedVideo={generatedVideo} />
        </div>
      </div>
    </div>
  );
}

/**
 * Memo: parent re-renders không repaint hàng idle.
 * Progress sống trong mediaGenSlotStore — chỉ subcomponent subscribe key đó re-render.
 */
export default React.memo(ScenePromptRow, (a, b) => {
  return (
    a.pIdx === b.pIdx &&
    a.chapter === b.chapter &&
    a.sceneIndex === b.sceneIndex &&
    a.promptsLen === b.promptsLen &&
    a.isHook === b.isHook &&
    a.regenerating === b.regenerating &&
    a.upscaling === b.upscaling &&
    a.removingBg === b.removingBg &&
    a.promptItem === b.promptItem
  );
});
