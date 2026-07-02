'use client';

import React from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { X, Key, Palette, Camera, Copy } from 'lucide-react';

interface MediaConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MediaConfigModal({ isOpen, onClose }: MediaConfigModalProps) {
  const store = useNovelStore();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      {/* Modal Container */}
      <div className="relative w-full max-w-5xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500 text-black shadow-lg shadow-indigo-500/20">
              <Palette className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-100">Cấu Hình Đầu Ra</h2>
              <p className="text-[10px] text-indigo-400 uppercase tracking-widest font-semibold">
                Image / Video Generation
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Section A: CẤU HÌNH KẾT NỐI API AI MASTER (Dành cho Kịch bản) */}
          <div className="rounded-xl border border-amber-500/50 bg-amber-950/10 p-5 shadow-[0_0_15px_rgba(245,158,11,0.05)]">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-amber-500 uppercase tracking-wide">
              <Key className="h-4 w-4" />
              Cấu Hình AI Tổng (Kịch bản & Phân tích)
            </h3>
            
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <select
                value={store.aiMasterModel}
                onChange={(e) => store.setAiMasterModel(e.target.value)}
                className="w-full sm:w-64 appearance-none rounded-lg border border-amber-500/30 bg-black px-4 py-2.5 text-xs font-semibold text-zinc-300 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 cursor-pointer"
              >
                <option value="gemini">Google Gemini 2.5 Pro</option>
                <option value="gpt4o">OpenAI GPT-4o</option>
                <option value="llama">Groq Llama 3.3</option>
                <option value="aistudio">🔥 AI STUDIO (MIỄN PHÍ)</option>
              </select>

              <div className="flex-1 flex items-center gap-2 w-full">
                <span className="text-xs font-semibold text-zinc-400 whitespace-nowrap">API Key:</span>
                {store.aiMasterModel === 'aistudio' ? (
                  <div className="flex-1 rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-4 py-2.5 text-xs font-semibold text-emerald-500 flex items-center">
                    🔥 AI STUDIO: Chạy Auto-Web không cần API Key!
                  </div>
                ) : (
                  <input
                    type="password"
                    placeholder="Nhập API Key..."
                    value={store.aiMasterApiKey}
                    onChange={(e) => store.setAiMasterApiKey(e.target.value)}
                    className="flex-1 rounded-lg border border-zinc-700 bg-black px-4 py-2.5 text-xs text-zinc-300 outline-none focus:border-amber-500 transition-colors"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Section A2: CẤU HÌNH ĐẦU RA ẢNH & VIDEO */}
          <div className="rounded-xl border border-cyan-500/50 bg-cyan-950/10 p-5 shadow-[0_0_15px_rgba(6,182,212,0.05)] flex flex-col gap-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-cyan-400 uppercase tracking-wide">
              <Camera className="h-4 w-4" />
              Cấu Hình Động Cơ Sinh Ảnh & Video
            </h3>

            {/* Trình Sinh Ảnh */}
            <div className="flex flex-col sm:flex-row items-center gap-4 bg-black/40 p-3 rounded-lg border border-zinc-800">
              <span className="text-xs font-bold text-zinc-300 w-24">IMAGE AI:</span>
              <select
                value={store.imageProvider || 'pollinations'}
                onChange={(e) => store.setImageProvider(e.target.value)}
                className="w-full sm:w-56 rounded-lg border border-zinc-700 bg-black px-3 py-2 text-xs font-semibold text-zinc-300 outline-none focus:border-cyan-500"
              >
                <option value="pollinations">Pollinations AI (Miễn phí)</option>
                <option value="openai">OpenAI (DALL-E 3)</option>
                <option value="falai">Grok/Flux (Fal.ai)</option>
                <option value="huggingface">Meta (Llama 3/HuggingFace)</option>
                <option value="gemini">Google (Imagen 3)</option>
              </select>
              <input
                type="password"
                placeholder={store.imageProvider === 'pollinations' ? "Không yêu cầu API Key" : "Nhập Image API Key..."}
                value={store.imageApiKey || ''}
                onChange={(e) => store.setImageApiKey(e.target.value)}
                disabled={store.imageProvider === 'pollinations'}
                className="flex-1 rounded-lg border border-zinc-700 bg-black px-3 py-2 text-xs text-zinc-300 outline-none focus:border-cyan-500 disabled:opacity-50"
              />
            </div>

            {/* Trình Sinh Video */}
            <div className="flex flex-col sm:flex-row items-center gap-4 bg-black/40 p-3 rounded-lg border border-zinc-800">
              <span className="text-xs font-bold text-zinc-300 w-24">VIDEO AI:</span>
              <select
                value={store.videoProvider || 'ffmpeg'}
                onChange={(e) => store.setVideoProvider(e.target.value)}
                className="w-full sm:w-56 rounded-lg border border-zinc-700 bg-black px-3 py-2 text-xs font-semibold text-zinc-300 outline-none focus:border-cyan-500"
              >
                <option value="ffmpeg">FFmpeg Builder (Miễn phí)</option>
                <option value="luma">Luma Dream Machine</option>
                <option value="runway">Runway Gen-3</option>
                <option value="sora">OpenAI Sora</option>
                <option value="veo">Google Veo</option>
              </select>
              <input
                type="password"
                placeholder={store.videoProvider === 'ffmpeg' ? "Không yêu cầu API Key" : "Nhập Video API Key..."}
                value={store.videoApiKey || ''}
                onChange={(e) => store.setVideoApiKey(e.target.value)}
                disabled={store.videoProvider === 'ffmpeg'}
                className="flex-1 rounded-lg border border-zinc-700 bg-black px-3 py-2 text-xs text-zinc-300 outline-none focus:border-cyan-500 disabled:opacity-50"
              />
            </div>
          </div>

          {/* Section B: BƯỚC 1: THIẾT LẬP DNA (PHONG CÁCH THỊ GIÁC) CHỦ ĐẠO */}
          <div className="rounded-xl border border-rose-500/50 bg-rose-950/10 p-5 shadow-[0_0_15px_rgba(244,63,94,0.05)]">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-rose-500 uppercase tracking-wide">
              <Palette className="h-4 w-4" />
              BƯỚC 1: THIẾT LẬP DNA (PHONG CÁCH THỊ GIÁC) CHỦ ĐẠO
            </h3>
            
            <div className="flex flex-col lg:flex-row gap-6">
              <div className="flex-1 space-y-6">
                <div className="flex items-start gap-2 text-zinc-400 text-xs leading-relaxed font-semibold">
                  <span className="text-amber-500 text-sm">👉</span>
                  <p>
                    Upload tối đa 6 ảnh cắt từ Video.<br />
                    AI sẽ quét và trích xuất DNA Phong cách.
                  </p>
                </div>
                
                <div className="flex items-center gap-3">
                  <button className="flex flex-1 items-center justify-center gap-2 rounded bg-[#8b5cf6] px-4 py-2.5 text-xs font-bold text-white shadow-[0_0_15px_rgba(139,92,246,0.4)] transition-transform hover:scale-[1.02] active:scale-95 cursor-pointer uppercase">
                    <Camera className="h-4 w-4" />
                    QUÉT 6 ẢNH (CẦN API)
                  </button>
                  <button 
                    onClick={() => {
                      if (typeof navigator !== 'undefined' && navigator.clipboard) {
                        navigator.clipboard.writeText(store.visualDnaPrompt);
                        alert('Đã copy DNA thị giác!');
                      }
                    }}
                    className="flex flex-1 items-center justify-center gap-2 rounded bg-[#3b82f6] px-4 py-2.5 text-xs font-bold text-white shadow-[0_0_15px_rgba(59,130,246,0.4)] transition-transform hover:scale-[1.02] active:scale-95 cursor-pointer uppercase"
                  >
                    <Copy className="h-4 w-4" />
                    COPY PROMPT
                  </button>
                </div>
              </div>

              <div className="flex-[2]">
                <textarea
                  placeholder="Nhập vào DNA thị giác..."
                  value={store.visualDnaPrompt}
                  onChange={(e) => store.setVisualDnaPrompt(e.target.value)}
                  className="w-full h-32 rounded-lg border-2 border-dashed border-cyan-500/50 bg-black/50 p-4 text-sm text-amber-500 outline-none focus:border-cyan-400 focus:bg-black transition-colors resize-none font-mono"
                />
              </div>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
