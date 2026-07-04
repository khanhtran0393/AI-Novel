'use client';

import React from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { FileText, Sparkles } from 'lucide-react';
import { parseScenes } from '../utils/stringUtils';
import SceneCard from './SceneCard';

interface ContentTabProps {
  isStreaming: boolean;
  streamText: string;
  handleSceneChange: (idx: number, newContent: string) => void;
  handleCopyScene: (text: string) => void;
  handleExpandScene: (idx: number) => Promise<void>;
  handlePlayTTS: (text: string, sceneIndex: number, voice: string) => Promise<void>;
  handleStopTTS: () => void;
  handleGenerateTTS: (sceneText: string, sceneIndex: number, voice: string, targetDuration?: number) => Promise<number | undefined>;
  handleGenerateImagePrompt: (sceneText: string, sceneIndex: number, duration: number) => Promise<void>;
  handleRegenPrompt: (sceneIndex: number, promptIndex: number, sentence: string, currentPrompt: string) => Promise<void>;
  handleWriteChapter: () => Promise<void>;
  handleGenerateImage: (sceneIndex: number, promptIndex: number, prompt: string, sentence: string) => Promise<void>;
  handleGenerateAllImages: (sceneIndex: number) => Promise<void>;
  handleGenerateVideo: (sceneIndex: number, startPromptIndex: number, endPromptIndex: number, prompt: string) => Promise<void>;
  handleGenerateAllVideos: (sceneIndex: number) => Promise<void>;
  isPlayingTTS: { [sceneIndex: number]: boolean };
  generatingTTS: { [sceneIndex: number]: boolean };
  ttsProgress: { [sceneIndex: number]: number };
  generatingPrompt: { [sceneIndex: number]: boolean };
  regeneratingSinglePrompt: Record<string, boolean>;
  generatingImage: Record<string, boolean>;
  generatingVideo: Record<string, boolean>;
  onImageZoom: (url: string) => void;
}

export default function ContentTab({
  isStreaming,
  streamText,
  handleSceneChange,
  handleCopyScene,
  handleExpandScene,
  handlePlayTTS,
  handleStopTTS,
  handleGenerateTTS,
  handleGenerateImagePrompt,
  handleRegenPrompt,
  handleWriteChapter,
  handleGenerateImage,
  handleGenerateAllImages,
  handleGenerateVideo,
  handleGenerateAllVideos,
  isPlayingTTS,
  generatingTTS,
  ttsProgress,
  generatingPrompt,
  regeneratingSinglePrompt,
  generatingImage,
  generatingVideo,
  onImageZoom
}: ContentTabProps) {
  const store = useNovelStore();
  const currentChapter = store.danh_sach_chuong.find(c => c.so_chuong === store.chuong_dang_chon);

  if (isStreaming) {
    return (
      <div className="whitespace-pre-line bg-zinc-950/30 border border-zinc-900/50 rounded-lg p-6 text-md leading-loose font-sans">
        {streamText}
        <span className="inline-block h-4 w-2 bg-amber-500 animate-blink ml-1">▋</span>
      </div>
    );
  }

  if (currentChapter?.noi_dung) {
    const scenes = parseScenes(currentChapter.noi_dung);
    return (
      <div className="flex flex-col gap-6">
        {scenes.map((scene, idx) => (
          <div 
            key={idx}
            id={`scene-card-container-${idx}`}
            className="scroll-mt-12 transition-all duration-350 animate-in fade-in-50 duration-200"
          >
            <SceneCard
              scene={scene}
              sceneIndex={idx}
              handleSceneChange={handleSceneChange}
              handleCopyScene={handleCopyScene}
              handleExpandScene={handleExpandScene}
              handlePlayTTS={handlePlayTTS}
              handleStopTTS={handleStopTTS}
              handleGenerateTTS={handleGenerateTTS}
              handleGenerateImagePrompt={handleGenerateImagePrompt}
              handleRegenPrompt={handleRegenPrompt}
              handleGenerateImage={handleGenerateImage}
              handleGenerateAllImages={handleGenerateAllImages}
              handleGenerateVideo={handleGenerateVideo}
              handleGenerateAllVideos={handleGenerateAllVideos}
              isPlayingTTS={!!isPlayingTTS[idx]}
              generatingTTS={!!generatingTTS[idx]}
              ttsProgress={ttsProgress[idx] || 0}
              generatingPrompt={!!generatingPrompt[idx]}
              regeneratingSinglePrompt={regeneratingSinglePrompt}
              generatingImage={generatingImage}
              generatingVideo={generatingVideo}
              onImageZoom={onImageZoom}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-zinc-800 rounded-lg bg-zinc-950/20">
      <FileText className="h-12 w-12 text-zinc-700 mb-4" />
      <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider font-sans">
        Chương này chưa có nội dung văn học
      </h3>
      <p className="text-xs text-zinc-600 mt-1 mb-5 max-w-xs font-sans">
        Bấm vào nút &ldquo;Sinh phần tiếp theo&rdquo; hoặc &ldquo;Sinh Chi Tiết Chương&rdquo; để kích hoạt AI viết kịch bản.
      </p>
      <button
        type="button"
        disabled={store.dang_tai}
        onClick={() => handleWriteChapter()}
        className="flex items-center gap-1.5 rounded-md bg-amber-500 px-4 py-2 text-xs font-bold text-black shadow hover:bg-amber-400 transition-colors font-sans cursor-pointer animate-pulse"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Sinh Chi Tiết Chương {store.chuong_dang_chon}
      </button>
    </div>
  );
}
