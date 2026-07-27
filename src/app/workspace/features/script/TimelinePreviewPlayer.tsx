'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { sceneAssetKey } from '@/contracts/keys';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, X, Film } from 'lucide-react';
import type { PromptAsset } from '@/store/novelTypes';

interface TimelinePreviewPlayerProps {
  onClose: () => void;
}

export default function TimelinePreviewPlayer({ onClose }: TimelinePreviewPlayerProps) {
  const store = useNovelStore();
  const chapterId = store.chuong_dang_chon || 1;
  const currentChapter = store.danh_sach_chuong.find((c) => c.so_chuong === chapterId) || store.danh_sach_chuong[0];
  const scenes: PromptAsset[] = store.generatedPrompts?.[chapterId] || [];

  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const activeScene = scenes[activeIndex] || null;
  const assetKey = sceneAssetKey(chapterId, activeIndex + 1);

  const rawAudio = store.generatedAudioPaths?.[assetKey];
  const audioPath = typeof rawAudio === 'string' ? rawAudio : rawAudio?.path || '';
  const imageUrl = store.generatedImages?.[assetKey] || '';
  const videoUrl = store.generatedVideos?.[assetKey] || '';

  useEffect(() => {
    if (audioRef.current && audioPath) {
      audioRef.current.src = audioPath;
      if (isPlaying) {
        audioRef.current.play().catch(() => setIsPlaying(false));
      }
    }
  }, [activeIndex, audioPath, isPlaying]);

  const handleTogglePlay = () => {
    if (!audioRef.current && !audioPath) return;
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  };

  const handleNext = () => {
    if (activeIndex < scenes.length - 1) {
      setActiveIndex((prev) => prev + 1);
    } else {
      setIsPlaying(false);
    }
  };

  const handlePrev = () => {
    if (activeIndex > 0) {
      setActiveIndex((prev) => prev - 1);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
      <div className="relative flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-emerald-500/10">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <Film className="h-5 w-5 text-emerald-400" />
            <h2 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">
              In-App Timeline Preview Player — Phim Ngắn Kịch Bản (Chương {chapterId})
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Video / Canvas Area */}
        <div className="relative flex flex-1 items-center justify-center bg-black overflow-hidden">
          {videoUrl ? (
            <video
              src={videoUrl}
              autoPlay={isPlaying}
              loop
              muted={isMuted}
              className="h-full w-full object-contain"
            />
          ) : imageUrl ? (
            <img src={imageUrl} alt="Scene" className="h-full w-full object-contain" />
          ) : (
            <div className="flex flex-col items-center justify-center text-zinc-600 gap-2">
              <Film className="h-12 w-12 stroke-[1.5]" />
              <p className="text-xs">Chưa sinh ảnh/video cho phân cảnh này (Asset Key: {assetKey})</p>
            </div>
          )}

          {/* Animated Subtitle Overlay */}
          {(activeScene?.script_prompt || activeScene?.prompt) && (
            <div className="absolute bottom-8 inset-x-6 text-center">
              <span className="inline-block rounded-xl bg-black/80 px-4 py-2 text-sm sm:text-base font-extrabold text-amber-300 shadow-xl border border-amber-500/30 backdrop-blur-md">
                {activeScene.script_prompt || activeScene.prompt}
              </span>
            </div>
          )}
        </div>

        {/* Audio Element */}
        {audioPath && (
          <audio
            ref={audioRef}
            src={audioPath}
            onEnded={handleNext}
            muted={isMuted}
          />
        )}

        {/* Controls Bar */}
        <div className="shrink-0 border-t border-zinc-800 bg-zinc-900/80 p-4 space-y-3">
          {/* Scene Selectors */}
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>
              Cảnh {activeIndex + 1} / {Math.max(1, scenes.length)}
            </span>
            <span className="truncate max-w-md font-semibold text-zinc-200">
              {currentChapter?.tieu_de || `Chương ${chapterId}`}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handlePrev}
                disabled={activeIndex === 0}
                className="rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30"
              >
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleTogglePlay}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-black shadow-lg shadow-emerald-500/30 hover:bg-emerald-400"
              >
                {isPlaying ? <Pause className="h-5 w-5 fill-black" /> : <Play className="h-5 w-5 fill-black ml-0.5" />}
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={activeIndex >= scenes.length - 1}
                className="rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30"
              >
                <SkipForward className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsMuted(!isMuted)}
                className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-zinc-400 hover:text-white"
              >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
