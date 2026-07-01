'use client';

import React, { useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { useFolderActions } from '../hooks/useFolderActions';
import { getWordCount } from '../utils/stringUtils';
import {
  Sparkles,
  Copy,
  Play,
  Square,
  RefreshCw
} from 'lucide-react';

interface SceneCardProps {
  scene: { title: string; content: string };
  sceneIndex: number;
  handleSceneChange: (idx: number, newContent: string) => void;
  handleCopyScene: (text: string) => void;
  handleExpandScene: (idx: number) => Promise<void>;
  handlePlayTTS: (text: string, sceneIndex: number, voice: string) => Promise<void>;
  handleStopTTS: () => void;
  handleGenerateTTS: (sceneText: string, sceneIndex: number, voice: string) => Promise<void>;
  handleGenerateImagePrompt: (sceneText: string, sceneIndex: number, duration: number) => Promise<void>;
  handleRegenPrompt: (sceneIndex: number, promptIndex: number, sentence: string, currentPrompt: string) => Promise<void>;
  handleGenerateImage: (sceneIndex: number, promptIndex: number, prompt: string, sentence: string) => Promise<void>;
  handleGenerateAllImages: (sceneIndex: number) => Promise<void>;
  handleGenerateVideo: (sceneIndex: number, startPromptIndex: number, endPromptIndex: number, prompt: string) => Promise<void>;
  handleGenerateAllVideos: (sceneIndex: number) => Promise<void>;
  isPlayingTTS: boolean;
  generatingTTS: boolean;
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
  const [selectedVoice, setSelectedVoice] = useState('');
  const [manualDuration, setManualDuration] = useState('');

  const assetKey = `${store.chuong_dang_chon}_${sceneIndex}`;
  const audioAsset = store.generatedAudioPaths[assetKey];
  const promptsAsset = store.generatedPrompts[assetKey];

  // Tự động quét và lấy thời gian voice bên TTS để làm tham chiếu
  const voiceDurationReference = audioAsset ? audioAsset.duration : null;
  const defaultDuration = Math.max(5, Math.round(getWordCount(scene.content) / 2.5));

  return (
    <div className="group relative bg-zinc-950/20 border border-zinc-900/30 rounded-lg p-5 hover:border-zinc-800 transition-colors flex flex-col gap-3">
      
      {/* 1. Tiêu đề cảnh (ngoài ô Textarea) */}
      {scene.title !== 'MỞ ĐẦU' && scene.title !== 'KỊCH BẢN' && (
        <div className="px-4 py-2.5 border border-zinc-900 bg-zinc-900/30 rounded-lg flex items-center justify-between">
          <h4 className="text-xs font-bold text-amber-500 uppercase tracking-widest flex items-center gap-1.5 font-sans">
            🎬 {scene.title}
          </h4>
          {audioAsset && (
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" title="Đã có file Audio"></span>
          )}
        </div>
      )}

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

        <div className="flex items-center gap-2">
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
            disabled={store.dang_tai}
            onClick={() => handleExpandScene(sceneIndex)}
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
            <div className="flex-1 w-full">
              <label className="text-[10px] text-zinc-500 uppercase block mb-1 font-sans">Chọn Giọng Đọc</label>
              <select
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                className="w-full h-8 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-300 outline-none px-2 focus:border-amber-500 cursor-pointer font-sans"
              >
                <option value="">🌍 Theo Cấu Hình Chung ({store.ttsConfig.platform.toUpperCase()})</option>
                <optgroup label="Tùy chỉnh riêng lẻ">
                  <option value="Aoede">Nữ 1 (Aoede) - Truyền cảm</option>
                  <option value="Charon">Nam 1 (Charon) - Trầm ấm</option>
                  <option value="Fenrir">Nam 2 (Fenrir) - Sáng sủa</option>
                  <option value="Kore">Nữ 2 (Kore) - Nhẹ nhàng</option>
                  <option value="Puck">Nam 3 (Puck) - Năng động</option>
                </optgroup>
              </select>
            </div>
            
            <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end">
              {/* Nút Nghe Thử */}
              <button
                type="button"
                onClick={() => {
                  if (isPlayingTTS) {
                    handleStopTTS();
                  } else {
                    handlePlayTTS(scene.content, sceneIndex, selectedVoice);
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
                onClick={() => handleGenerateTTS(scene.content, sceneIndex, selectedVoice)}
                className="h-8 px-4 rounded bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 font-sans"
              >
                {generatingTTS ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Đang Gen...
                  </>
                ) : (
                  <>
                    Gen Audio & Lưu PC
                  </>
                )}
              </button>
            </div>
          </div>



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
            {/* Tùy chọn Model Ảnh & Video */}
            <div className="flex flex-col sm:flex-row items-center gap-3 bg-black/20 p-2 rounded border border-emerald-900/20">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <label className="text-[10px] text-zinc-400 uppercase font-sans whitespace-nowrap">Model Ảnh:</label>
                <select
                  value={store.imageModel}
                  onChange={(e) => store.setImageModel(e.target.value)}
                  className="h-8 bg-zinc-900 border border-zinc-800 rounded px-2 text-xs text-zinc-300 outline-none focus:border-emerald-500 cursor-pointer w-full sm:w-auto font-sans"
                >
                  <option value="imagen3">Google Imagen 3</option>
                  <option value="midjourney">Midjourney</option>
                  <option value="flux">Flux.1 Pro</option>
                  <option value="dalle3">DALL-E 3</option>
                </select>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <label className="text-[10px] text-zinc-400 uppercase font-sans whitespace-nowrap">Model Video:</label>
                <select
                  value={store.videoModel}
                  onChange={(e) => store.setVideoModel(e.target.value)}
                  className="h-8 bg-zinc-900 border border-zinc-800 rounded px-2 text-xs text-zinc-300 outline-none focus:border-cyan-500 cursor-pointer w-full sm:w-auto font-sans"
                >
                  <option value="veo">Google Veo</option>
                  <option value="sora">OpenAI Sora</option>
                  <option value="kling">Kling AI</option>
                  <option value="luma">Luma Dream Machine</option>
                </select>
              </div>
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
                    onClick={() => handleCopyScene(promptsAsset.map((p: { prompt: string }, idx: number) => `[c${sceneIndex+1}-${String(idx+1).padStart(2, '0')}] ${p.prompt}`).join('\n\n'))}
                    className="text-[9px] font-bold uppercase tracking-wider text-zinc-300 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 hover:text-white px-2.5 py-0.5 rounded transition-colors flex items-center gap-0.5 cursor-pointer font-sans"
                  >
                    Copy All
                  </button>
                </div>
              </div>

              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {promptsAsset.map((promptItem: any, pIdx: number) => {
                const singlePromptKey = `${store.chuong_dang_chon}_${sceneIndex}_${pIdx}`;
                const isRegening = regeneratingSinglePrompt[singlePromptKey] || false;
                const promptCode = `c${sceneIndex+1}-${String(pIdx+1).padStart(2, '0')}`;
                
                // Trạng thái Whisk Automation
                const generatedImg = store.generatedImages?.[singlePromptKey];
                const isImgGenerating = generatingImage[singlePromptKey] || false;
                const videoKey = `${singlePromptKey}_video`;
                const generatedVideo = store.generatedVideos?.[videoKey];

                return (
                  <div key={pIdx} className="flex flex-row gap-4 border-b border-zinc-900/60 pb-3 last:border-b-0 last:pb-0 animate-in fade-in duration-200 items-start w-full">
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
                            onClick={() => handleGenerateImage(sceneIndex, pIdx, promptItem.prompt, promptItem.sentence || '')}
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
                                handleGenerateVideo(sceneIndex, pIdx, pIdx, promptItem.prompt);
                              } else {
                                // Middle: Interpolate from previous to this
                                handleGenerateVideo(sceneIndex, pIdx - 1, pIdx, promptItem.prompt);
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
                            onClick={() => handleRegenPrompt(sceneIndex, pIdx, promptItem.sentence || '', promptItem.prompt)}
                            className="text-[9px] font-bold uppercase text-amber-500 hover:text-amber-400 border border-amber-900/30 px-2 py-0.5 rounded transition-colors flex items-center gap-0.5 cursor-pointer font-sans disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Sinh lại prompt văn bản nếu bị lỗi chính sách"
                          >
                            <RefreshCw className={`h-2 w-2 ${isRegening ? 'animate-spin' : ''}`} />
                            {isRegening ? 'Đang viết lại...' : 'Viết lại'}
                          </button>
                          
                          <button
                            type="button"
                            onClick={() => handleCopyScene(promptItem.prompt)}
                            className="text-[9px] font-bold uppercase text-zinc-400 hover:text-white border border-zinc-800 px-2 py-0.5 rounded transition-colors flex items-center gap-0.5 cursor-pointer font-sans"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                      
                      {promptItem.sentence && (
                        <p className="text-[10px] text-zinc-500 italic bg-zinc-950/40 p-1.5 rounded border border-zinc-900/30 font-sans leading-relaxed">
                          &ldquo;{promptItem.sentence}&rdquo;
                        </p>
                      )}
                      
                      <textarea
                        readOnly
                        value={promptItem.prompt}
                        rows={2}
                        className="w-full text-xs text-zinc-300 font-mono leading-relaxed bg-zinc-900/40 p-2.5 rounded border border-zinc-900/50 resize-y outline-none focus:border-emerald-850 select-all font-sans"
                      />
                    </div>

                    {/* Cột Phải: Hình ảnh và Video */}
                    <div className="w-96 shrink-0 flex gap-2 items-start pt-1">
                      {/* Box Hình Ảnh */}
                      <div className="w-48 flex flex-col gap-1 items-center justify-start">
                        {generatedImg ? (
                          <div 
                            onClick={() => onImageZoom(generatedImg)}
                            className="relative group w-full h-32 overflow-hidden rounded-lg border border-zinc-800/80 shadow-md transition-all duration-300 hover:border-zinc-700 cursor-zoom-in"
                            title="Bấm để phóng to ảnh phân cảnh"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img 
                              src={generatedImg} 
                              alt={`Cảnh ${sceneIndex+1} Prompt ${pIdx+1}`} 
                              className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                            />
                            <div className="absolute bottom-1 right-1 bg-black/75 backdrop-blur-sm rounded px-1.5 py-0.5 text-[7px] font-mono text-zinc-400 border border-zinc-800">
                              {promptCode}.png
                            </div>
                          </div>
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

    </div>
  );
}
