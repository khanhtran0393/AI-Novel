'use client';

import React from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { FileText, Sparkles } from 'lucide-react';
import { parseScenes } from '../utils/stringUtils';
import SceneCard from './SceneCard';
import EditorPanel from './EditorPanel';

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
  handleWriteChapter: (overwrite?: boolean) => Promise<void>;
  handleIntervene: (text: string) => void;
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
  handleIntervene,
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

  const wordCount = (isStreaming ? streamText : currentChapter?.noi_dung || '')
    .split(/\s+/)
    .filter(Boolean).length;
  const targetWords = store.setup.so_tu_chuong || 4000;
  const progressPercent = Math.min(100, Math.max(0, (wordCount / targetWords) * 100));
  const isGoalReached = wordCount >= targetWords;

  // Render ProgressBar
  const renderProgressBar = () => (
    <div className="mb-6 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          Chỉ tiêu số từ (Word-Gate)
        </span>
        <span className={`text-[10px] font-bold ${isGoalReached ? 'text-emerald-500' : 'text-amber-500'}`}>
          {wordCount} / {targetWords} từ
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900 border border-zinc-800">
        <div
          className={`h-full transition-all duration-500 ${
            isGoalReached
              ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]'
              : 'bg-gradient-to-r from-amber-600 to-orange-500 shadow-[0_0_8px_#f59e0b]'
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );

  if (isStreaming) {
    return (
      <div className="flex flex-col">
        {renderProgressBar()}
        <div className="whitespace-pre-line bg-zinc-950/30 border border-zinc-900/50 rounded-lg p-6 text-md leading-loose font-sans">
          {streamText}
          <span className="inline-block h-4 w-2 bg-amber-500 animate-blink ml-1">▋</span>
        </div>
        
        {/* Intervention Input */}
        <div className="mt-4 p-4 border border-sky-500/50 bg-sky-900/20 rounded-lg shadow-[0_0_15px_rgba(14,165,233,0.15)] flex flex-col gap-2 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-sky-500 to-transparent animate-pulse" />
          <label className="text-[10px] font-bold text-sky-400 uppercase tracking-widest flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Can Thiệp Trực Tiếp Thời Gian Thực
          </label>
          <input
            type="text"
            placeholder="Nhập lệnh bẻ lái (VD: Cho nam chính rút gươm ra đỡ đòn)... Nhấn Enter để gửi"
            className="w-full bg-black border border-sky-800/50 rounded p-3 text-sm text-zinc-200 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-all placeholder:text-zinc-600"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                handleIntervene(e.currentTarget.value.trim());
                e.currentTarget.value = '';
              }
            }}
          />
        </div>
      </div>
    );
  }

  if (currentChapter?.noi_dung) {
    const scenes = parseScenes(currentChapter.noi_dung);
    return (
      <div className="flex flex-col gap-6">
        {renderProgressBar()}
        
        {/* Sticky Navigation */}
        <div className="sticky top-16 z-40 -mx-4 px-4 py-2 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-900/80 shadow-lg flex items-center gap-2 overflow-x-auto">
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex-none">
            Chuyển cảnh:
          </span>
          <div className="flex items-center gap-2">
            {scenes.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  const el = document.getElementById(`scene-card-container-${idx}`);
                  if (el) {
                    const yOffset = -120; // Trừ bớt chiều cao của header và sticky nav
                    const y = el.getBoundingClientRect().top + window.pageYOffset + yOffset;
                    window.scrollTo({ top: y, behavior: 'smooth' });
                  }
                }}
                className="flex-none rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-[10px] font-bold text-zinc-400 hover:border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-500 transition-all duration-200 cursor-pointer"
              >
                Cảnh {idx + 1}
              </button>
            ))}
          </div>
        </div>

        {scenes.map((scene, idx) => (
          <div 
            key={idx}
            id={`scene-card-container-${idx}`}
            className="scroll-mt-32 transition-all duration-350 animate-in fade-in-50 duration-200"
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
        
        <EditorPanel 
          chapterIndex={store.chuong_dang_chon} 
          isRewriting={store.dang_tai} 
          onRewrite={() => handleWriteChapter(true)} 
        />
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
