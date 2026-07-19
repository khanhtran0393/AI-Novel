'use client';
import { API } from '@/contracts';

import React, { useRef, useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { X, Palette, Camera, Copy, ChevronDown, ImagePlus, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toastBus';
import FlowAccountsPanel from './FlowAccountsPanel';

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

/** Non-Flow providers may accept extra ratios; Flow video = 16:9 | 9:16 only. */
const VIDEO_RATIOS = [
  ['16:9', '16:9 YouTube / Flow Landscape'],
  ['9:16', '9:16 Shorts / Flow Portrait'],
  ['1:1', '1:1 Square (non-Flow)'],
  ['4:5', '4:5 Social (non-Flow)'],
  ['21:9', '21:9 Cinema (non-Flow)'],
];

const FLOW_VIDEO_RATIOS = [
  ['16:9', '16:9 Landscape (Flow)'],
  ['9:16', '9:16 Portrait (Flow)'],
];

/** Flow Veo clip lengths are 4|6|8 only (labs.google). */
const VIDEO_DURATIONS: Record<string, number[]> = {
  flow: [4, 6, 8],
  sora: [4, 8, 12],
  veo: [4, 6, 8],
  grok: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15],
};

const IMAGE_PROVIDERS = ['flow', 'openai', 'gemini', 'grok'];
const VIDEO_PROVIDERS = ['flow', 'sora', 'veo', 'grok'];

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

type FlowModelOpt = {
  id: string;
  label: string;
  credits?: number;
  creditsUltra?: number;
  note?: string;
  family?: string;
  durationsSec?: number[];
  defaultDurationSec?: number;
  nativeScale?: string;
};

export default function MediaConfigModal({ isOpen, onClose }: MediaConfigModalProps) {
  const store = useNovelStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isAnalyzingDna, setIsAnalyzingDna] = useState(false);
  const [flowImageModels, setFlowImageModels] = useState<FlowModelOpt[]>([]);
  const [flowVideoModels, setFlowVideoModels] = useState<FlowModelOpt[]>([]);
  const [flowVideoDurations, setFlowVideoDurations] = useState<number[]>([4, 6, 8]);
  const [flowQuality, setFlowQuality] = useState('hd');
  const [autoRelogin, setAutoRelogin] = useState(true);
  const [minHealth, setMinHealth] = useState(20);
  const effectiveImageProvider = IMAGE_PROVIDERS.includes(store.imageProvider) ? store.imageProvider : '';
  const effectiveVideoProvider = VIDEO_PROVIDERS.includes(store.videoProvider) ? store.videoProvider : '';

  const selectedFlowVideo = flowVideoModels.find((m) => m.id === store.videoModel);
  const durationOptions = (() => {
    if (effectiveVideoProvider === 'flow') {
      if (selectedFlowVideo?.durationsSec?.length) return selectedFlowVideo.durationsSec;
      return flowVideoDurations.length ? flowVideoDurations : VIDEO_DURATIONS.flow;
    }
    return effectiveVideoProvider ? (VIDEO_DURATIONS[effectiveVideoProvider] || []) : [];
  })();
  const videoRatioOptions =
    effectiveVideoProvider === 'flow' ? FLOW_VIDEO_RATIOS : VIDEO_RATIOS;

  React.useEffect(() => {
    if (!isOpen) return;
    void (async () => {
      try {
        const [modelsRes, opsRes] = await Promise.all([
          fetch(API.flowModels, { cache: 'no-store' }),
          fetch(API.flowOps, { cache: 'no-store' }),
        ]);
        const models = await modelsRes.json().catch(() => ({}));
        const opsData = await opsRes.json().catch(() => ({}));
        if (Array.isArray(models.imageModels)) {
          setFlowImageModels(
            models.imageModels.map((m: FlowModelOpt & { id: string; label: string }) => ({
              id: m.id,
              label: m.label,
              credits: m.credits,
              creditsUltra: m.creditsUltra,
              note: m.note,
              nativeScale: m.nativeScale,
            })),
          );
        }
        if (Array.isArray(models.videoModels)) {
          setFlowVideoModels(
            models.videoModels.map((m: FlowModelOpt & { id: string; label: string }) => ({
              id: m.id,
              label: m.label,
              credits: m.credits,
              creditsUltra: m.creditsUltra,
              note: m.note,
              family: m.family,
              durationsSec: m.durationsSec,
              defaultDurationSec: m.defaultDurationSec,
              nativeScale: m.nativeScale,
            })),
          );
        }
        if (Array.isArray(models.videoDurationsSec) && models.videoDurationsSec.length) {
          setFlowVideoDurations(models.videoDurationsSec.map(Number).filter((n: number) => n > 0));
        }
        if (opsData?.ops?.defaultQuality) setFlowQuality(String(opsData.ops.defaultQuality));
        if (typeof opsData?.ops?.autoRelogin === 'boolean') {
          setAutoRelogin(opsData.ops.autoRelogin);
        }
        if (opsData?.ops?.minHealthScore != null) {
          setMinHealth(Number(opsData.ops.minHealthScore));
        }
      } catch {
        /* offline */
      }
    })();
  }, [isOpen]);

  // Clamp persisted / legacy values to Flow-legal output when provider is flow
  React.useEffect(() => {
    if (effectiveVideoProvider !== 'flow') return;
    // Duration: only 4|6|8
    if (durationOptions.length) {
      const cur = Number(store.videoDuration);
      if (!durationOptions.includes(cur)) {
        const def = selectedFlowVideo?.defaultDurationSec ?? 8;
        store.setVideoDuration(
          durationOptions.includes(def) ? def : durationOptions[durationOptions.length - 1],
        );
      }
    }
    // Aspect: Flow video only 16:9 | 9:16
    const ar = String(store.videoAspectRatio || '').trim();
    if (ar && ar !== '16:9' && ar !== '9:16') {
      store.setVideoAspectRatio('16:9');
    }
    // Legacy ingredients key still works; prefer r2v if user still has blank model after load
    const vm = String(store.videoModel || '').trim();
    if (vm === 'veo_3_1_reference_fast') {
      store.setVideoModel('veo_3_1_r2v_fast');
    }
  }, [effectiveVideoProvider, store.videoModel, store.videoDuration, store.videoAspectRatio, durationOptions.join(',')]);

  const persistFlowOps = async (patch: Record<string, unknown>) => {
    try {
      await fetch(API.flowOps, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch {
      /* ignore */
    }
  };

  const handleClose = () => {
    // Force durable snapshot of all media settings (DNA, ratios, providers, …)
    try {
      const s = useNovelStore.getState();
      // re-touch DNA so persist path runs even if user only typed then closed
      if (typeof s.visualDnaPrompt === 'string') {
        s.setVisualDnaPrompt(s.visualDnaPrompt);
      }
      if (typeof s.mediaStylePreset === 'string') {
        s.setMediaStylePreset(s.mediaStylePreset);
      }
    } catch {
      // ignore
    }
    onClose();
  };

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
      toast.info('Notice', 'Hay chon tu 4 den 6 anh tham chieu de phan tich DNA thi giac.');
      return;
    }

    const apiKeys = getAnalysisKeys();
    if (apiKeys.length === 0) {
      toast.info('Notice', 'Chua co API key cho AI phan tich DNA thi giac trong Cai dat chung.');
      return;
    }

    setIsAnalyzingDna(true);
    try {
      const images = await Promise.all(imageFiles.map(readImageFile));
      const res = await fetch(API.generate, {
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
      toast.info('Notice', `Da phan tich DNA thi giac tu ${imageFiles.length} anh.`);
    } catch (err) {
      toast.info('Notice', `Loi phan tich DNA: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsAnalyzingDna(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const setImageProvider = (provider: string) => {
    store.setImageProvider(provider);
  };

  const setVideoProvider = (provider: string) => {
    store.setVideoProvider(provider);
  };

  // Keep current custom style in the dropdown so it doesn't snap to first option
  const styleOptions = (() => {
    const current = (store.mediaStylePreset || '').trim();
    if (current && !STYLE_PRESETS.some((p) => p.value === current)) {
      return [{ label: 'Custom (đã lưu)', value: current }, ...STYLE_PRESETS];
    }
    return STYLE_PRESETS;
  })();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="relative flex max-h-[90vh] w-full max-w-5xl animate-in flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500 text-black shadow-lg shadow-indigo-500/20">
              <Palette className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-100">Cấu hình đầu ra</h2>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-400">
                Image / Video · DNA thị giác · Tự lưu
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
            title="Đóng và lưu cấu hình"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <FlowAccountsPanel />

          <div className="flex flex-col gap-4 rounded-xl border border-cyan-500/50 bg-cyan-950/10 p-5 shadow-[0_0_15px_rgba(6,182,212,0.05)]">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-cyan-400">
              <Camera className="h-4 w-4" />
              Cau hinh dong co sinh anh & video (Flow-first)
            </h3>

            <div className="grid gap-3 rounded-lg border border-zinc-800/50 bg-black/40 p-3 lg:grid-cols-[110px_1fr_150px_120px]">
              <span className="flex items-center text-xs font-bold text-zinc-300">IMAGE AI:</span>
              <SelectShell>
                <select
                  value={store.imageModel || ''}
                  onChange={(e) => {
                    if (store.imageProvider !== 'flow') store.setImageProvider('flow');
                    store.setImageModel(e.target.value);
                  }}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none transition-colors focus:border-cyan-500"
                >
                  {(flowImageModels.length
                    ? flowImageModels
                    : [
                        { id: 'GEM_PIX_2', label: 'GEM_PIX_2 (Flow default)' },
                        { id: 'NARWHAL', label: 'NARWHAL (Nano Banana 2)' },
                      ]
                  ).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                      {m.credits != null ? ` · ~${m.credits}cr` : ''}
                      {m.nativeScale ? ` · ${m.nativeScale}` : ''}
                    </option>
                  ))}
                </select>
              </SelectShell>
              <SelectShell>
                <select
                  value={store.imageAspectRatio || ''}
                  onChange={(e) => store.setImageAspectRatio(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none transition-colors focus:border-cyan-500"
                >
                  <option value="">Chọn tỷ lệ ảnh</option>
                  {IMAGE_RATIOS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </SelectShell>
              <SelectShell>
                <select
                  value={store.imageCount || ''}
                  onChange={(e) => store.setImageCount(Number(e.target.value))}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none transition-colors focus:border-cyan-500"
                >
                  <option value="">Chọn số ảnh</option>
                  {[1, 2, 3, 4].map((count) => (
                    <option key={count} value={count}>{count} anh</option>
                  ))}
                </select>
              </SelectShell>
            </div>

            {effectiveImageProvider === 'flow' || effectiveVideoProvider === 'flow' ? (
              <div className="space-y-3 rounded-lg border border-indigo-800/40 bg-indigo-950/20 p-3">
                <div className="grid gap-3 lg:grid-cols-[110px_1fr_1fr]">
                  <span className="flex items-center text-xs font-bold text-indigo-300">
                    FLOW QUALITY:
                  </span>
                  <SelectShell>
                    <select
                      value={flowQuality}
                      onChange={(e) => {
                        const v = e.target.value;
                        setFlowQuality(v);
                        try {
                          localStorage.setItem('ainovel_flow_image_quality', v);
                          localStorage.setItem('ainovel_flow_video_quality', v);
                        } catch {
                          /* ignore */
                        }
                        void persistFlowOps({ defaultQuality: v });
                      }}
                      className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none focus:border-indigo-500"
                    >
                      <option value="1k">1K native (không upscale)</option>
                      <option value="hd">HD / 1080 (mặc định P1)</option>
                      <option value="2k">2K image upsample</option>
                      <option value="4k">4K upsample</option>
                    </select>
                  </SelectShell>
                  <div className="flex flex-wrap items-center gap-3 text-[10px] text-zinc-400">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-indigo-500"
                        checked={autoRelogin}
                        onChange={(e) => {
                          setAutoRelogin(e.target.checked);
                          void persistFlowOps({ autoRelogin: e.target.checked });
                        }}
                      />
                      Auto-relogin (P3)
                    </label>
                    <label className="flex items-center gap-1">
                      Min health
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={minHealth}
                        onChange={(e) => {
                          const n = Number(e.target.value) || 0;
                          setMinHealth(n);
                          void persistFlowOps({ minHealthScore: n });
                        }}
                        className="w-14 rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-center text-zinc-300"
                      />
                    </label>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 rounded-lg border border-zinc-800/50 bg-black/40 p-3 lg:grid-cols-[110px_1fr_150px_120px]">
              <span className="flex items-center text-xs font-bold text-zinc-300">VIDEO AI:</span>
              <SelectShell>
                <select
                  value={store.videoModel || ''}
                  onChange={(e) => {
                    if (store.videoProvider !== 'flow') store.setVideoProvider('flow');
                    const id = e.target.value;
                    store.setVideoModel(id);
                    const m = flowVideoModels.find((x) => x.id === id);
                    if (m?.defaultDurationSec && (!store.videoDuration || store.videoProvider === 'flow')) {
                      store.setVideoDuration(m.defaultDurationSec);
                    }
                  }}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none transition-colors focus:border-cyan-500"
                >
                  {(flowVideoModels.length
                    ? flowVideoModels
                    : [
                        { id: 'veo_3_1_t2v_fast', label: 'Veo 3.1 T2V Fast', credits: 20 },
                        { id: 'veo_3_1_i2v_s_fast', label: 'Veo 3.1 I2V Fast', credits: 20 },
                        { id: 'veo_3_1_r2v_fast', label: 'Veo 3.1 R2V / Ingredients', credits: 20 },
                        { id: 'veo_3_1_extend_fast', label: 'Extend Fast', credits: 20 },
                        { id: 'veo_3_1_i2v_lite_low_priority', label: 'I2V Lite Low Priority (0 cr)', credits: 0 },
                      ]
                  ).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                      {m.family ? ` [${m.family}]` : ''}
                      {m.credits != null ? ` · Pro~${m.credits}cr` : ''}
                      {m.creditsUltra != null && m.creditsUltra !== m.credits
                        ? `/Ultra~${m.creditsUltra}`
                        : ''}
                      {m.nativeScale ? ` · ${m.nativeScale}` : ''}
                    </option>
                  ))}
                </select>
              </SelectShell>
              <SelectShell>
                <select
                  value={store.videoAspectRatio || ''}
                  onChange={(e) => store.setVideoAspectRatio(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none transition-colors focus:border-cyan-500"
                >
                  <option value="">Chọn tỷ lệ video</option>
                  {videoRatioOptions.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </SelectShell>
              <SelectShell>
                <select
                  value={store.videoDuration || ''}
                  onChange={(e) => store.setVideoDuration(Number(e.target.value))}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 pr-8 text-xs font-semibold text-zinc-300 outline-none transition-colors focus:border-cyan-500"
                >
                  <option value="">Chọn thời lượng</option>
                  {durationOptions.map((duration) => (
                    <option key={duration} value={duration}>
                      {duration}s{duration === 8 ? ' (Flow default)' : ''}
                    </option>
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
                  {styleOptions.map((preset) => (
                    <option key={preset.label + preset.value.slice(0, 24)} value={preset.value}>
                      {preset.label}
                    </option>
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
                  value={store.wpm || ''}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    if (!raw) {
                      store.setWpm(0);
                      return;
                    }
                    store.setWpm(Math.max(100, Math.min(300, Number(raw))));
                  }}
                  className="w-20 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs font-semibold text-zinc-300 outline-none transition-colors focus:border-cyan-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase">Thời lượng/Cảnh:</span>
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={store.secondsPerBeat || ''}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    if (!raw) {
                      store.setSecondsPerBeat(0);
                      return;
                    }
                    store.setSecondsPerBeat(Math.max(3, Math.min(30, Number(raw))));
                  }}
                  className="w-16 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs font-semibold text-zinc-300 outline-none transition-colors focus:border-cyan-500 text-center"
                />
                <span className="text-[10px] font-semibold text-zinc-500">giây</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-rose-500/50 bg-rose-950/10 p-5 shadow-[0_0_15px_rgba(244,63,94,0.05)]">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-rose-500">
              <Palette className="h-4 w-4" />
              DNA thị giác chủ đạo
              <span className="ml-auto text-[9px] font-semibold normal-case tracking-normal text-emerald-500/90">
                Tự lưu vào store · persist durable
              </span>
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
                      toast.info('Notice', 'Da copy cau hinh phong cach!');
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
                  placeholder="Nhập DNA thị giác riêng. Bỏ trống để dùng kiểu ảnh đã chọn..."
                  value={store.visualDnaPrompt}
                  onChange={(e) => store.setVisualDnaPrompt(e.target.value)}
                  onBlur={() => {
                    // Explicit durable flush when leaving the DNA field
                    store.setVisualDnaPrompt(store.visualDnaPrompt || '');
                  }}
                  className="min-h-56 w-full resize-y rounded-lg border-2 border-dashed border-cyan-500/50 bg-black/50 p-4 font-mono text-sm leading-relaxed text-amber-500 outline-none transition-colors focus:border-cyan-400 focus:bg-black"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
