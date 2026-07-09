'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { X, Palette, Camera, Copy, ChevronDown, ImagePlus, Loader2 } from 'lucide-react';

interface MediaConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STYLE_PRESETS = [
  {
    label: 'Cinematic Realism',
    value: 'cinematic natural realism, grounded production design, expressive practical lighting, tactile materials, restrained color grade',
  },
  {
    label: 'Grok Imagine Clean',
    value: 'clean contemporary editorial image style, strong subject clarity, polished commercial lighting, modern social-media composition',
  },
  {
    label: 'Glossy Product Shot',
    value: 'glossy product photography, clean studio background, premium reflections, controlled softbox lighting, crisp material detail',
  },
  {
    label: 'Professional Headshot',
    value: 'professional headshot photography, natural skin texture, soft studio lighting, neutral background, confident expression',
  },
  {
    label: 'Haze Portrait',
    value: 'hazy portrait photography, soft atmospheric light, gentle bloom, intimate framing, muted cinematic palette',
  },
  {
    label: 'Chibi',
    value: 'stylized chibi character art, cute proportions, expressive face, clean colorful shapes, playful lighting',
  },
];

const IMAGE_RATIOS = [
  ['2:3', '2:3 Cao'],
  ['3:2', '3:2 Rong'],
  ['1:1', '1:1 Vuong'],
  ['9:16', '9:16 Doc'],
  ['16:9', '16:9 Wide'],
  ['3:4', '3:4 Portrait'],
  ['4:3', '4:3 Classic'],
  ['4:5', '4:5 Social'],
];

const VIDEO_RATIOS = [
  ['16:9', '16:9 YouTube'],
  ['9:16', '9:16 Shorts'],
  ['1:1', '1:1 Square'],
  ['4:5', '4:5 Social'],
  ['21:9', '21:9 Cinema'],
];

const VIDEO_DURATIONS: Record<string, number[]> = {
  sora: [5, 10, 15],
  veo: [4, 6, 8],
  grok: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15],
};

const IMAGE_PROVIDERS = ['openai', 'gemini', 'grok'];
const VIDEO_PROVIDERS = ['sora', 'veo', 'grok'];

function SelectShell({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      {children}
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
    </div>
  );
}

function readImageFile(file: File): Promise<{ name: string; mimeType: string; data: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Khong the doc file ${file.name}`));
    reader.onload = () => {
      const result = String(reader.result || '');
      const data = result.includes(',') ? result.split(',')[1] : result;
      resolve({ name: file.name, mimeType: file.type || 'image/png', data });
    };
    reader.readAsDataURL(file);
  });
}

export default function MediaConfigModal({ isOpen, onClose }: MediaConfigModalProps) {
  const store = useNovelStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isAnalyzingDna, setIsAnalyzingDna] = useState(false);
  const effectiveImageProvider = IMAGE_PROVIDERS.includes(store.imageProvider) ? store.imageProvider : 'gemini';
  const effectiveVideoProvider = VIDEO_PROVIDERS.includes(store.videoProvider) ? store.videoProvider : 'veo';
  const durationOptions = VIDEO_DURATIONS[effectiveVideoProvider] || VIDEO_DURATIONS.veo;

  useEffect(() => {
    if (!isOpen) return;
    if (store.imageProvider !== effectiveImageProvider) {
      store.setImageProvider(effectiveImageProvider);
      store.setImageModel('banana');
    }
    if (store.videoProvider !== effectiveVideoProvider) {
      store.setVideoProvider(effectiveVideoProvider);
      store.setVideoModel('veo');
    }
    if (!durationOptions.includes(store.videoDuration || 6)) {
      store.setVideoDuration(durationOptions[0]);
    }
  }, [durationOptions, effectiveImageProvider, effectiveVideoProvider, isOpen, store]);

  if (!isOpen) return null;

  const getAnalysisKeys = () => {
    if (store.aiMasterModel === 'gpt4o') {
      return store.openaiApiKeys?.length ? store.openaiApiKeys : (store.openaiApiKey ? [store.openaiApiKey] : []);
    }
    if (store.aiMasterModel === 'llama') {
      return store.grokApiKeys?.length ? store.grokApiKeys : (store.grokApiKey ? [store.grokApiKey] : []);
    }
    return store.apiKeys?.length ? store.apiKeys : (store.apiKey ? [store.apiKey] : []);
  };

  const analyzeVisualDna = async (files: FileList | null) => {
    const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length < 4 || imageFiles.length > 6) {
      alert('Hay chon tu 4 den 6 anh tham chieu de phan tich DNA thi giac.');
      return;
    }

    const apiKeys = getAnalysisKeys();
    if (apiKeys.length === 0) {
      alert('Chua co API key cho AI phan tich DNA thi giac trong Cai dat chung.');
      return;
    }

    setIsAnalyzingDna(true);
    try {
      const images = await Promise.all(imageFiles.map(readImageFile));
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestType: 'ANALYZE_VISUAL_DNA',
          apiKeys,
          model: store.aiMasterModel,
          payload: { images },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Loi phan tich DNA thi giac.');
      }

      const data = await res.json();
      const dna = data.visualDnaPrompt || data.prompt || '';
      if (!dna.trim()) throw new Error('AI khong tra ve DNA thi giac hop le.');
      store.setVisualDnaPrompt(dna.trim());
      alert(`Da phan tich DNA thi giac tu ${imageFiles.length} anh.`);
    } catch (err) {
      alert(`Loi phan tich DNA: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsAnalyzingDna(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const setImageProvider = (provider: string) => {
    store.setImageProvider(provider);
    if (provider === 'openai') store.setImageModel('gpt-image-1');
    else if (provider === 'grok') store.setImageModel('grok-imagine-image-quality');
    else if (!['banana', 'whisk'].includes(store.imageModel)) store.setImageModel('banana');
  };

  const setVideoProvider = (provider: string) => {
    store.setVideoProvider(provider);
    if (provider === 'sora') store.setVideoModel('sora');
    else if (provider === 'grok') store.setVideoModel('grok-imagine-video-1.5');
    else store.setVideoModel('veo');
    const nextDurations = VIDEO_DURATIONS[provider] || VIDEO_DURATIONS.veo;
    if (!nextDurations.includes(store.videoDuration || 6)) {
      store.setVideoDuration(nextDurations[0]);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[90vh] w-full max-w-5xl animate-in flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500 text-black shadow-lg shadow-indigo-500/20">
              <Palette className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-100">Cau hinh dau ra</h2>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-400">Image / Video Generation</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <div className="flex flex-col gap-4 rounded-xl border border-cyan-500/50 bg-cyan-950/10 p-5 shadow-[0_0_15px_rgba(6,182,212,0.05)]">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-cyan-400">
              <Camera className="h-4 w-4" />
              Cau hinh dong co sinh anh & video
            </h3>

            <div className="grid gap-3 rounded-lg border border-zinc-800/50 bg-black/40 p-3 lg:grid-cols-[110px_1fr_150px_120px_120px]">
              <span className="flex items-center text-xs font-bold text-zinc-300">IMAGE AI:</span>
              <SelectShell>
                <select
                  value={effectiveImageProvider}
                  onChange={(e) => setImageProvider(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none transition-colors focus:border-cyan-500"
                >
                  <option value="openai">OpenAI Images</option>
                  <option value="gemini">Google Studio</option>
                  <option value="grok">Grok Imagine</option>
                </select>
              </SelectShell>
              {effectiveImageProvider === 'gemini' ? (
                <SelectShell>
                  <select
                    value={['banana', 'whisk'].includes(store.imageModel) ? store.imageModel : 'banana'}
                    onChange={(e) => store.setImageModel(e.target.value)}
                    className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none transition-colors focus:border-cyan-500"
                  >
                    <option value="banana">Banana API</option>
                    <option value="whisk">Whisk Cookie</option>
                  </select>
                </SelectShell>
              ) : (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-xs font-semibold text-zinc-400">
                  {effectiveImageProvider === 'openai' ? 'OpenAI API' : 'xAI API'}
                </div>
              )}
              <SelectShell>
                <select
                  value={store.imageAspectRatio || '16:9'}
                  onChange={(e) => store.setImageAspectRatio(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none transition-colors focus:border-cyan-500"
                >
                  {IMAGE_RATIOS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </SelectShell>
              <SelectShell>
                <select
                  value={store.imageCount || 1}
                  onChange={(e) => store.setImageCount(Number(e.target.value))}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none transition-colors focus:border-cyan-500"
                >
                  {[1, 2, 3, 4].map((count) => (
                    <option key={count} value={count}>{count} anh</option>
                  ))}
                </select>
              </SelectShell>
            </div>

            <div className="grid gap-3 rounded-lg border border-zinc-800/50 bg-black/40 p-3 lg:grid-cols-[110px_1fr_150px_120px_120px]">
              <span className="flex items-center text-xs font-bold text-zinc-300">VIDEO AI:</span>
              <SelectShell>
                <select
                  value={effectiveVideoProvider}
                  onChange={(e) => setVideoProvider(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none transition-colors focus:border-cyan-500"
                >
                  <option value="sora">OpenAI Sora</option>
                  <option value="veo">Google Studio Flow</option>
                  <option value="grok">Grok Imagine Video</option>
                </select>
              </SelectShell>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-xs font-semibold text-zinc-400">
                {effectiveVideoProvider === 'sora' && 'OpenAI video'}
                {effectiveVideoProvider === 'veo' && 'Flow / Veo'}
                {effectiveVideoProvider === 'grok' && 'Image-to-video'}
              </div>
              <SelectShell>
                <select
                  value={store.videoAspectRatio || '16:9'}
                  onChange={(e) => store.setVideoAspectRatio(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none transition-colors focus:border-cyan-500"
                >
                  {VIDEO_RATIOS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </SelectShell>
              <SelectShell>
                <select
                  value={store.videoDuration || durationOptions[0]}
                  onChange={(e) => store.setVideoDuration(Number(e.target.value))}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none transition-colors focus:border-cyan-500"
                >
                  {durationOptions.map((duration) => (
                    <option key={duration} value={duration}>{duration}s</option>
                  ))}
                </select>
              </SelectShell>
            </div>

            <div className="grid gap-3 rounded-lg border border-zinc-800/50 bg-black/30 p-3 lg:grid-cols-[110px_1fr]">
              <span className="flex items-center text-xs font-bold text-zinc-300">KIEU ANH:</span>
              <SelectShell>
                <select
                  value={store.mediaStylePreset}
                  onChange={(e) => store.setMediaStylePreset(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none transition-colors focus:border-cyan-500"
                >
                  {STYLE_PRESETS.map((preset) => (
                    <option key={preset.label} value={preset.value}>{preset.label}</option>
                  ))}
                </select>
              </SelectShell>
            </div>

            <div className="grid gap-3 rounded-lg border border-zinc-800/50 bg-black/30 p-3 lg:grid-cols-[110px_1fr_1fr]">
              <span className="flex items-center text-xs font-bold text-zinc-300">NHỊP ĐỌC & CẢNH:</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase">Tốc độ đọc (WPM):</span>
                <input
                  type="number"
                  min={100}
                  max={300}
                  value={store.wpm || 140}
                  onChange={(e) => store.setWpm(Math.max(100, Math.min(300, Number(e.target.value) || 140)))}
                  className="w-20 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs font-semibold text-zinc-300 outline-none transition-colors focus:border-cyan-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase">Thời lượng/Cảnh:</span>
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={store.secondsPerBeat || 6}
                  onChange={(e) => store.setSecondsPerBeat(Math.max(3, Math.min(30, Number(e.target.value) || 6)))}
                  className="w-16 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs font-semibold text-zinc-300 outline-none transition-colors focus:border-cyan-500 text-center"
                />
                <span className="text-[10px] font-semibold text-zinc-500">giây</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-rose-500/50 bg-rose-950/10 p-5 shadow-[0_0_15px_rgba(244,63,94,0.05)]">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-rose-500">
              <Palette className="h-4 w-4" />
              DNA thi giac chu dao
            </h3>

            <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
              <div className="space-y-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => analyzeVisualDna(e.target.files)}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isAnalyzingDna}
                  className="flex w-full items-center justify-center gap-2 rounded bg-violet-500 px-4 py-2.5 text-xs font-bold uppercase text-white shadow-[0_0_15px_rgba(139,92,246,0.35)] transition-transform hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isAnalyzingDna ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                  {isAnalyzingDna ? 'Dang phan tich' : 'Quet 4-6 anh'}
                </button>
                <button
                  onClick={() => {
                    if (typeof navigator !== 'undefined' && navigator.clipboard) {
                      navigator.clipboard.writeText(store.visualDnaPrompt || store.mediaStylePreset);
                      alert('Da copy cau hinh phong cach!');
                    }
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded bg-blue-500 px-4 py-2.5 text-xs font-bold uppercase text-white shadow-[0_0_15px_rgba(59,130,246,0.35)] transition-transform hover:scale-[1.02] active:scale-95"
                >
                  <Copy className="h-4 w-4" />
                  Copy prompt
                </button>
                <p className="text-xs font-semibold leading-relaxed text-zinc-400">
                  Neu DNA co noi dung, Gen Prompt Studio se uu tien DNA nay. Neu bo trong, he thong dung kieu anh da chon.
                </p>
              </div>

              <div className="space-y-2">
                <textarea
                  placeholder="Nhap DNA thi giac rieng. Bo trong de dung kieu anh da chon..."
                  value={store.visualDnaPrompt}
                  onChange={(e) => store.setVisualDnaPrompt(e.target.value)}
                  className="min-h-56 w-full resize-y rounded-lg border-2 border-dashed border-cyan-500/50 bg-black/50 p-4 font-mono text-sm leading-relaxed text-amber-500 outline-none transition-colors focus:border-cyan-400 focus:bg-black"
                />
                <div className="text-right text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  {(store.visualDnaPrompt || '').trim().split(/\s+/).filter(Boolean).length} tu DNA
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
