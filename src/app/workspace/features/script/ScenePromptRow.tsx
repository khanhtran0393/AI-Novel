'use client';

/**
 * Một hàng prompt (script / image / video) + preview ảnh/video + actions.
 * Tách khỏi SceneCard để SceneCard chỉ orchestrate scene-level UI.
 */
import React from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { scenePromptCode } from '@/lib/youtubeSafe';

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
  imageGenerating: boolean;
  videoGenerating: boolean;
  generatedImg?: string;
  generatedVideo?: string;
  projectUrl?: string;
  upscaling: boolean;
  removingBg: boolean;
  onOpenProjectUrl: (url: string) => void;
  onGenImage: () => void;
  onGenVideo: () => void;
  onRegenPrompt: () => void;
  onCopy: (text: string) => void;
  onZoom: (url: string) => void;
  onUpscale: () => void;
  onBgRemove: () => void;
};

export default function ScenePromptRow({
  promptItem,
  pIdx,
  sceneIndex,
  isHook,
  promptsLen,
  regenerating,
  imageGenerating,
  videoGenerating,
  generatedImg,
  generatedVideo,
  projectUrl,
  upscaling,
  removingBg,
  onOpenProjectUrl,
  onGenImage,
  onGenVideo,
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

            <button
              type="button"
              disabled={imageGenerating}
              onClick={onGenImage}
              className={`text-[9px] font-bold uppercase transition-all flex items-center gap-0.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-sans px-2 py-0.5 rounded border ${
                generatedImg
                  ? 'text-sky-400 border-sky-900/50 hover:bg-sky-950/20'
                  : 'text-black bg-emerald-500 border-none hover:bg-emerald-400 shadow-md'
              }`}
            >
              <RefreshCw className={`h-2.5 w-2.5 ${imageGenerating ? 'animate-spin' : ''}`} />
              {imageGenerating ? 'Đang vẽ...' : generatedImg ? 'Tạo lại ảnh' : 'Gen ảnh'}
            </button>

            <button
              type="button"
              disabled={videoGenerating}
              onClick={onGenVideo}
              className="text-[9px] font-bold uppercase transition-all flex items-center gap-0.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-sans px-2 py-0.5 rounded border text-black bg-cyan-500 border-none hover:bg-cyan-400 shadow-md"
            >
              <RefreshCw className={`h-2.5 w-2.5 ${videoGenerating ? 'animate-spin' : ''}`} />
              {videoGenerating ? 'Đang sinh...' : isEdge ? '🎬 Gen Video' : '🎬 Nối Video'}
            </button>

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
          {generatedImg ? (
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
                  className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                />
                <div className="absolute bottom-1 right-1 bg-black/75 rounded px-1.5 py-0.5 text-[7px] font-mono text-zinc-400 border border-zinc-800">
                  {promptCode}.png
                </div>
              </div>
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
            </>
          ) : (
            <div className="w-full h-32 rounded-lg border border-dashed border-zinc-900 bg-zinc-950/40 flex flex-col items-center justify-center p-3">
              <div className="h-7 w-7 rounded-full bg-zinc-900/80 flex items-center justify-center mb-1.5 animate-pulse">
                🎨
              </div>
              <span className="text-[8px] text-zinc-600 uppercase font-semibold">Chưa sinh ảnh</span>
            </div>
          )}
        </div>

        <div className="w-48 flex flex-col gap-1 items-center justify-start">
          {generatedVideo ? (
            <div className="relative w-full h-32 overflow-hidden rounded-lg border border-cyan-800/80 bg-black flex items-center justify-center">
              <video src={generatedVideo} controls className="w-full h-full object-contain" />
              <div className="absolute top-1 left-1 bg-cyan-900/90 text-white rounded px-1.5 py-0.5 text-[8px] font-bold">
                VIDEO NỘI SUY
              </div>
            </div>
          ) : (
            <div className="w-full h-32 rounded-lg border border-dashed border-zinc-900 bg-zinc-950/40 flex flex-col items-center justify-center p-3">
              <div className="h-7 w-7 rounded-full bg-zinc-900/80 flex items-center justify-center mb-1.5 animate-pulse">
                🎬
              </div>
              <span className="text-[8px] text-zinc-600 uppercase font-semibold">
                Chưa sinh video
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
