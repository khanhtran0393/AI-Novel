'use client';

import React from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { X, Key, Palette, Camera, Copy, ChevronDown } from 'lucide-react';

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
              <div className="relative w-full sm:w-64">
                <select
                  value={store.aiMasterModel}
                  onChange={(e) => store.setAiMasterModel(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-amber-500/30 bg-black px-4 py-2.5 pr-10 text-xs font-semibold text-zinc-300 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 cursor-pointer"
                >
                  <option value="gemini">Google Gemini 2.5 Pro</option>
                  <option value="gpt4o">OpenAI GPT-4o</option>
                  <option value="llama">Groq Llama 3.3</option>
                  <option value="aistudio">🔥 AI STUDIO (MIỄN PHÍ)</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-amber-500/50 pointer-events-none" />
              </div>

              <div className="flex-1 flex items-center gap-2 w-full">
                <span className="text-xs font-semibold text-zinc-400 whitespace-nowrap">API Key:</span>
                {store.aiMasterModel === 'aistudio' ? (
                  <div className="flex-1 rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-4 py-2.5 text-xs font-semibold text-emerald-500 flex items-center">
                    🔥 AI STUDIO: Chạy Auto-Web không cần API Key!
                  </div>
                ) : (() => {
                  let hasKey = false;
                  let providerLabel = '';
                  if (store.aiMasterModel === 'gemini') {
                    hasKey = (store.apiKeys && store.apiKeys.length > 0) || !!store.apiKey;
                    providerLabel = 'Google Gemini';
                  } else if (store.aiMasterModel === 'gpt4o') {
                    hasKey = (store.openaiApiKeys && store.openaiApiKeys.length > 0) || !!store.openaiApiKey;
                    providerLabel = 'OpenAI';
                  } else if (store.aiMasterModel === 'llama') {
                    hasKey = (store.grokApiKeys && store.grokApiKeys.length > 0) || !!store.grokApiKey;
                    providerLabel = 'Groq / Grok';
                  }

                  return hasKey ? (
                    <div className="flex-1 rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-4 py-2.5 text-xs font-semibold text-emerald-500 flex items-center">
                      🟢 Đã cấu hình {providerLabel} API Key (Lấy từ Cài đặt chung)
                    </div>
                  ) : (
                    <div className="flex-1 rounded-lg border border-red-500/30 bg-red-950/20 px-4 py-2.5 text-xs font-semibold text-red-400 flex items-center">
                      🔴 Chưa cấu hình {providerLabel} API Key trong Cài đặt chung!
                    </div>
                  );
                })()}
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
            <div className="flex flex-col sm:flex-row items-center gap-3 bg-black/40 p-3 rounded-lg border border-zinc-800/50">
              <span className="text-xs font-bold text-zinc-300 w-24 shrink-0">IMAGE AI:</span>
              
              <div className="relative w-full sm:w-48 shrink-0">
                <select
                  value={store.imageProvider || 'pollinations'}
                  onChange={(e) => {
                    const newProvider = e.target.value;
                    store.setImageProvider(newProvider);
                    if (newProvider === 'openai') store.setImageModel('dalle3');
                    else if (newProvider === 'falai') store.setImageModel('flux-pro');
                    else if (newProvider === 'gemini') store.setImageModel('imagen3');
                    else if (newProvider === 'huggingface') store.setImageModel('sd3');
                    else store.setImageModel('flux');
                  }}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none focus:border-cyan-500 transition-colors cursor-pointer"
                  title="Nhà cung cấp (API Provider)"
                >
                  <option value="pollinations">Pollinations (Free)</option>
                  <option value="openai">OpenAI (DALL-E)</option>
                  <option value="falai">Grok/Flux (Fal.ai)</option>
                  <option value="huggingface">Meta (Llama 3)</option>
                  <option value="gemini">Google (Imagen 3)</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
              </div>

              <div className="relative w-full sm:w-40 shrink-0">
                <select
                  value={store.imageModel}
                  onChange={(e) => store.setImageModel(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none focus:border-cyan-500 transition-colors cursor-pointer"
                  title="Mô hình AI (AI Model)"
                >
                  {store.imageProvider === 'openai' ? (
                    <>
                      <option value="dalle3">DALL-E 3 Standard</option>
                      <option value="dalle3-hd">DALL-E 3 HD</option>
                    </>
                  ) : store.imageProvider === 'falai' ? (
                    <>
                      <option value="flux-pro">Flux.1 Pro</option>
                      <option value="flux-schnell">Flux.1 Schnell</option>
                      <option value="flux-dev">Flux.1 Dev</option>
                      <option value="grok">Grok Vision</option>
                    </>
                  ) : store.imageProvider === 'gemini' ? (
                    <>
                      <option value="imagen3">Imagen 3</option>
                      <option value="imagen3-fast">Imagen 3 Fast</option>
                    </>
                  ) : store.imageProvider === 'huggingface' ? (
                    <>
                      <option value="sd35">Stable Diffusion 3.5</option>
                      <option value="sd3">Stable Diffusion 3</option>
                      <option value="sdxl">Stable Diffusion XL</option>
                    </>
                  ) : (
                    <>
                      <option value="flux">Flux</option>
                      <option value="flux-pro">Flux Pro</option>
                      <option value="midjourney">Midjourney</option>
                      <option value="turbo">Turbo</option>
                    </>
                  )}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
              </div>

              <div className="relative w-full sm:w-32 shrink-0">
                <select
                  value={store.imageAspectRatio || '16:9'}
                  onChange={(e) => store.setImageAspectRatio(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none focus:border-cyan-500 transition-colors cursor-pointer"
                  title="Tỉ lệ khung hình (Aspect Ratio)"
                >
                  <option value="16:9">16:9 (Youtube)</option>
                  <option value="9:16">9:16 (TikTok)</option>
                  <option value="1:1">1:1 (Square)</option>
                  <option value="3:4">3:4 (Portrait)</option>
                  <option value="4:3">4:3 (Classic)</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
              </div>
              {(() => {
                if (store.imageProvider === 'pollinations') {
                  return (
                    <div className="w-full sm:flex-1 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-xs font-semibold text-zinc-500 flex items-center justify-center">
                      Không cần API Key
                    </div>
                  );
                }
                let hasKey = false;
                let providerLabel = '';
                if (store.imageProvider === 'openai') {
                  hasKey = (store.openaiApiKeys && store.openaiApiKeys.length > 0) || !!store.openaiApiKey;
                  providerLabel = 'OpenAI';
                } else if (store.imageProvider === 'falai') {
                  hasKey = (store.falaiApiKeys && store.falaiApiKeys.length > 0) || !!store.falaiApiKey;
                  providerLabel = 'Fal.ai';
                } else if (store.imageProvider === 'gemini') {
                  hasKey = (store.apiKeys && store.apiKeys.length > 0) || !!store.apiKey;
                  providerLabel = 'Gemini';
                }

                return hasKey ? (
                  <div className="w-full sm:flex-1 rounded-lg border border-emerald-500/20 bg-emerald-950/10 px-3 py-2 text-xs font-semibold text-emerald-500 flex items-center justify-center">
                    🟢 Đã có Key ({providerLabel})
                  </div>
                ) : (
                  <div className="w-full sm:flex-1 rounded-lg border border-red-500/20 bg-red-950/10 px-3 py-2 text-xs font-semibold text-red-400 flex items-center justify-center">
                    🔴 Thiếu Key ({providerLabel})
                  </div>
                );
              })()}
            </div>

            {/* Trình Sinh Video */}
            <div className="flex flex-col sm:flex-row items-center gap-3 bg-black/40 p-3 rounded-lg border border-zinc-800/50">
              <span className="text-xs font-bold text-zinc-300 w-24 shrink-0">VIDEO AI:</span>
              
              <div className="relative w-full sm:w-48 shrink-0">
                <select
                  value={store.videoProvider || 'ffmpeg'}
                  onChange={(e) => {
                    const newProvider = e.target.value;
                    store.setVideoProvider(newProvider);
                    if (newProvider === 'luma') store.setVideoModel('luma-dream');
                    else if (newProvider === 'runway') store.setVideoModel('gen3-alpha');
                    else if (newProvider === 'sora') store.setVideoModel('sora');
                    else if (newProvider === 'veo') store.setVideoModel('veo-3.1-low');
                    else store.setVideoModel('ffmpeg-basic');
                  }}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none focus:border-cyan-500 transition-colors cursor-pointer"
                  title="Nhà cung cấp (API Provider)"
                >
                  <option value="ffmpeg">FFmpeg (Miễn phí)</option>
                  <option value="luma">Luma API</option>
                  <option value="runway">Runway API</option>
                  <option value="sora">OpenAI API</option>
                  <option value="veo">Google API</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
              </div>

              <div className="relative w-full sm:w-32 shrink-0">
                <select
                  value={store.videoModel}
                  onChange={(e) => store.setVideoModel(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none focus:border-cyan-500 transition-colors cursor-pointer"
                  title="Mô hình AI (AI Model)"
                >
                  {store.videoProvider === 'luma' ? (
                    <>
                      <option value="luma-dream">Luma Dream Machine</option>
                      <option value="luma-ray">Luma Ray</option>
                    </>
                  ) : store.videoProvider === 'runway' ? (
                    <>
                      <option value="gen3-alpha">Runway Gen-3 Alpha</option>
                      <option value="gen3-turbo">Runway Gen-3 Turbo</option>
                    </>
                  ) : store.videoProvider === 'sora' ? (
                    <>
                      <option value="sora">Sora 1.0</option>
                      <option value="sora-turbo">Sora Turbo</option>
                    </>
                  ) : store.videoProvider === 'veo' ? (
                    <>
                      <option value="veo-3.1-low">Google Veo 3.1 Low</option>
                      <option value="veo-3.1-high">Google Veo 3.1 High</option>
                      <option value="veo-3.1-omni">Google Veo 3.1 Omni</option>
                    </>
                  ) : (
                    <>
                      <option value="ffmpeg-basic">FFmpeg Basic</option>
                      <option value="ffmpeg-pro">FFmpeg Pro</option>
                    </>
                  )}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
              </div>

              <div className="relative w-full sm:w-28 shrink-0">
                <select
                  value={store.videoAspectRatio || '16:9'}
                  onChange={(e) => store.setVideoAspectRatio(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none focus:border-cyan-500 transition-colors cursor-pointer"
                  title="Tỉ lệ khung hình (Aspect Ratio)"
                >
                  <option value="16:9">16:9 (Youtube)</option>
                  <option value="9:16">9:16 (TikTok)</option>
                  <option value="1:1">1:1 (Square)</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
              </div>
              {(() => {
                if (store.videoProvider === 'ffmpeg') {
                  return (
                    <div className="w-full sm:flex-1 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-xs font-semibold text-zinc-500 flex items-center justify-center">
                      Không cần API Key
                    </div>
                  );
                }
                let hasKey = false;
                let providerLabel = '';
                if (store.videoProvider === 'luma') {
                  hasKey = (store.lumaApiKeys && store.lumaApiKeys.length > 0) || !!store.lumaApiKey;
                  providerLabel = 'Luma';
                } else if (store.videoProvider === 'runway') {
                  hasKey = (store.runwayApiKeys && store.runwayApiKeys.length > 0) || !!store.runwayApiKey;
                  providerLabel = 'Runway';
                } else if (store.videoProvider === 'sora') {
                  hasKey = (store.openaiApiKeys && store.openaiApiKeys.length > 0) || !!store.openaiApiKey;
                  providerLabel = 'OpenAI (Sora)';
                } else if (store.videoProvider === 'veo') {
                  hasKey = (store.apiKeys && store.apiKeys.length > 0) || !!store.apiKey;
                  providerLabel = 'Gemini (Veo)';
                }

                return hasKey ? (
                  <div className="w-full sm:flex-1 rounded-lg border border-emerald-500/20 bg-emerald-950/10 px-3 py-2 text-xs font-semibold text-emerald-500 flex items-center justify-center">
                    🟢 Đã có Key ({providerLabel})
                  </div>
                ) : (
                  <div className="w-full sm:flex-1 rounded-lg border border-red-500/20 bg-red-950/10 px-3 py-2 text-xs font-semibold text-red-400 flex items-center justify-center">
                    🔴 Thiếu Key ({providerLabel})
                  </div>
                );
              })()}
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
                  <button className="flex flex-1 items-center justify-center gap-2 rounded bg-[#8b5cf6] px-4 py-2 text-xs font-bold text-white shadow-[0_0_15px_rgba(139,92,246,0.4)] transition-transform hover:scale-[1.02] active:scale-95 cursor-pointer">
                    <Camera className="h-5 w-5 shrink-0" />
                    <div className="flex flex-col items-center leading-tight">
                      <span>QUÉT 6 ẢNH</span>
                      <span className="text-[9px] opacity-90">(CẦN API)</span>
                    </div>
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
