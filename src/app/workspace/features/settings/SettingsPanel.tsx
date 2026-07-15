'use client';
import { API } from '@/contracts';

/**
 * Chrome settings dropdown — API Keys / GPU.
 * Tách khỏi Header để Header chỉ còn brand + toolbar orchestration.
 */
import React, { useEffect, useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  Plus,
  Minus,
  Key,
  Copy,
  Check,
  Settings,
  RefreshCw,
} from 'lucide-react';
import { toast } from '@/lib/toastBus';

/** 4 nền tảng LLM được hỗ trợ trong Cài đặt chung */
type Provider = 'gemini' | 'openai' | 'grok' | 'claude';

const PROVIDER_LINKS: Record<
  Provider,
  { label: string; url: string; host: string }
> = {
  gemini: {
    label: 'Google Gemini',
    url: 'https://aistudio.google.com/apikey',
    host: 'aistudio.google.com/apikey',
  },
  openai: {
    label: 'OpenAI',
    url: 'https://platform.openai.com/api-keys',
    host: 'platform.openai.com/api-keys',
  },
  grok: {
    label: 'Grok (xAI)',
    url: 'https://console.x.ai/',
    host: 'console.x.ai',
  },
  claude: {
    label: 'Claude (Anthropic)',
    url: 'https://console.anthropic.com/settings/keys',
    host: 'console.anthropic.com/settings/keys',
  },
};

export default function SettingsPanel() {
  const store = useNovelStore();

  const [open, setOpen] = useState(false);
  const [newApiInput, setNewApiInput] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<Provider>('gemini');
  const [copiedItem, setCopiedItem] = useState<{ type: 'api'; index: number } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [systemInfo, setSystemInfo] = useState<any>(null);
  const [isLoadingSysInfo, setIsLoadingSysInfo] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [installerStatus, setInstallerStatus] = useState<any>({ status: 'idle', progress: 0 });

  const fetchSystemInfo = async () => {
    setIsLoadingSysInfo(true);
    try {
      const res = await fetch(API.systemInfo);
      if (res.ok) {
        const data = await res.json();
        setSystemInfo(data);
        if (data.installStatus) setInstallerStatus(data.installStatus);
      }
    } catch (err) {
      console.error('Lỗi tải system info:', err);
    } finally {
      setIsLoadingSysInfo(false);
    }
  };

  const handleStartGpuInstall = async () => {
    try {
      setInstallerStatus({ status: 'installing', progress: 5, message: 'Đang khởi động...' });
      const vendor = systemInfo?.gpu?.vendor || 'nvidia';
      const res = await fetch(API.systemInfoInstallGpu, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.info('Notice', `❌ Lỗi cài đặt: ${data.error}`);
      }
    } catch (err: unknown) {
      toast.info(
        'Notice',
        `❌ Lỗi kết nối: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (installerStatus?.status === 'installing') {
      interval = setInterval(async () => {
        try {
          const res = await fetch(API.systemInfoInstallStatus);
          if (res.ok) {
            const data = await res.json();
            setInstallerStatus(data);
            if (data.status !== 'installing') fetchSystemInfo();
          }
        } catch {
          /* ignore poll errors */
        }
      }, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [installerStatus?.status]);

  const handleCopy = (text: string, type: 'api', index: number) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedItem({ type, index });
      setTimeout(() => setCopiedItem(null), 2000);
    }
  };

  const getProviderConfig = () => {
    switch (selectedProvider) {
      case 'openai':
        return {
          keys: store.openaiApiKeys || [],
          mainKey: store.openaiApiKey || '',
          setKeys: store.setOpenaiApiKeys,
          setMainKey: store.setOpenaiApiKey,
          placeholder: 'Dán mã OpenAI API Key (mỗi key 1 dòng)...',
        };
      case 'grok':
        return {
          keys: store.grokApiKeys || [],
          mainKey: store.grokApiKey || '',
          setKeys: store.setGrokApiKeys,
          setMainKey: store.setGrokApiKey,
          placeholder: 'Dán mã Grok (xAI) API Key (mỗi key 1 dòng)...',
        };
      case 'claude':
        return {
          keys: store.claudeApiKeys || [],
          mainKey: store.claudeApiKey || '',
          setKeys: store.setClaudeApiKeys,
          setMainKey: store.setClaudeApiKey,
          placeholder: 'Dán mã Claude (Anthropic) API Key (mỗi key 1 dòng)...',
        };
      case 'gemini':
      default:
        return {
          keys: store.apiKeys || [],
          mainKey: store.apiKey || '',
          setKeys: store.setApiKeys,
          setMainKey: store.setApiKey,
          placeholder: 'Dán mã Gemini API Key (mỗi key 1 dòng)...',
        };
    }
  };

  const providerKeyCount = (() => {
    switch (selectedProvider) {
      case 'openai':
        return (store.openaiApiKeys?.length || 0) > 0
          ? store.openaiApiKeys.length
          : store.openaiApiKey
            ? 1
            : 0;
      case 'grok':
        return (store.grokApiKeys?.length || 0) > 0
          ? store.grokApiKeys.length
          : store.grokApiKey
            ? 1
            : 0;
      case 'claude':
        return (store.claudeApiKeys?.length || 0) > 0
          ? store.claudeApiKeys.length
          : store.claudeApiKey
            ? 1
            : 0;
      default:
        return (store.apiKeys?.length || 0) > 0 ? store.apiKeys.length : store.apiKey ? 1 : 0;
    }
  })();

  const config = getProviderConfig();
  const providerLink = PROVIDER_LINKS[selectedProvider];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) fetchSystemInfo();
        }}
        className="flex items-center gap-1 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-[clamp(9px,1vw,11px)] font-semibold uppercase tracking-wider text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
      >
        <Settings className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Cài đặt</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default bg-transparent"
            aria-label="Đóng cài đặt"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 max-h-[min(85vh,720px)] w-[min(340px,92vw)] overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-md animate-in slide-in-from-top-2 duration-200">
            <h3 className="mb-4 text-sm font-bold text-zinc-100 uppercase tracking-wide border-b border-zinc-800 pb-2 flex items-center gap-2">
              ⚙️ Cài đặt chung
            </h3>

            {/* API Keys */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[10px] font-bold text-sky-500 uppercase flex items-center gap-1.5 tracking-wider">
                  <Key className="h-3 w-3" />
                  API Keys ({providerKeyCount})
                </h4>
                <select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value as Provider)}
                  className="rounded border border-zinc-800 bg-black px-2 py-0.5 text-[10px] font-bold text-zinc-300 outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="grok">Grok (xAI)</option>
                  <option value="claude">Claude</option>
                </select>
              </div>

              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {config.mainKey && config.keys.length === 0 && (
                  <div className="flex items-center justify-between bg-amber-950/20 rounded border border-amber-900/50 p-2 text-xs">
                    <div className="flex flex-col overflow-hidden">
                      <span className="text-[10px] text-amber-500 font-bold uppercase">Key Chính</span>
                      <span className="text-xs text-zinc-400 truncate w-36" title={config.mainKey}>
                        {config.mainKey.substring(0, 15)}...
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopy(config.mainKey, 'api', 999)}
                        className="text-zinc-400 hover:text-amber-500 transition-colors p-1.5 rounded hover:bg-zinc-800 cursor-pointer"
                      >
                        {copiedItem?.type === 'api' && copiedItem?.index === 999 ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => config.setMainKey('')}
                        className="text-zinc-500 hover:text-red-500 transition-colors p-1.5 rounded hover:bg-zinc-800 cursor-pointer"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {config.keys.map((key, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between bg-zinc-900/50 rounded border border-zinc-800 p-2 text-xs"
                  >
                    <div className="flex flex-col overflow-hidden">
                      <span className="text-[10px] text-emerald-500 font-bold uppercase">
                        Key {idx + 1}
                      </span>
                      <span className="text-xs text-zinc-400 truncate w-36" title={key}>
                        {key.substring(0, 15)}...
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopy(key, 'api', idx)}
                        className="text-zinc-400 hover:text-amber-500 transition-colors p-1.5 rounded hover:bg-zinc-800 cursor-pointer"
                      >
                        {copiedItem?.type === 'api' && copiedItem?.index === idx ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const remaining = config.keys.filter((_, i) => i !== idx);
                          config.setKeys(remaining);
                          if (config.mainKey === key) config.setMainKey(remaining[0] || '');
                        }}
                        className="text-zinc-500 hover:text-red-500 transition-colors p-1.5 rounded hover:bg-zinc-800 cursor-pointer"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {config.keys.length === 0 && !config.mainKey && (
                  <p className="text-xs text-zinc-500 italic text-center py-2">Chưa có API Key nào.</p>
                )}
              </div>

              <div className="mt-2 text-[10px] text-zinc-400 bg-amber-950/10 border border-amber-950/30 rounded p-2 leading-relaxed">
                💡 <strong>Mẹo:</strong> Lấy API Key tại{' '}
                <a
                  href={providerLink.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-400 underline underline-offset-2 hover:text-sky-300 break-all"
                >
                  {providerLink.host}
                </a>
                . Có thể dán nhiều key (mỗi dòng 1 key) để xoay vòng.
              </div>

              <div className="mt-4 pt-3 border-t border-zinc-800 flex items-start gap-2">
                <textarea
                  placeholder={config.placeholder}
                  value={newApiInput}
                  onChange={(e) => setNewApiInput(e.target.value)}
                  className="flex-1 h-16 min-h-[40px] max-h-40 rounded border border-zinc-800 bg-black p-2 text-xs text-zinc-300 outline-none focus:border-amber-500 resize-y font-mono"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!newApiInput.trim()) return;
                    const inputKeys = newApiInput
                      .split('\n')
                      .map((k) => k.trim())
                      .filter(Boolean);
                    const uniqueNew = inputKeys.filter((k) => !config.keys.includes(k));
                    if (uniqueNew.length > 0) {
                      const nextKeys = [...config.keys, ...uniqueNew];
                      config.setKeys(nextKeys);
                      if (!config.mainKey) config.setMainKey(nextKeys[0]);
                    }
                    setNewApiInput('');
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-amber-500 text-black hover:bg-amber-400 transition-colors mt-1"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* GPU — Windows PC: scan + persist + install CUDA/DirectML */}
            <div className="pt-4 mt-4 border-t border-zinc-800">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 className="text-[10px] font-bold text-emerald-500 uppercase flex items-center gap-1.5 tracking-wider">
                  🖥️ Tăng tốc phần cứng (GPU)
                </h4>
                <button
                  type="button"
                  onClick={fetchSystemInfo}
                  disabled={isLoadingSysInfo}
                  className="inline-flex items-center gap-1 rounded border border-zinc-800 px-1.5 py-0.5 text-[9px] font-bold uppercase text-zinc-400 hover:text-emerald-400 hover:border-emerald-800 disabled:opacity-50"
                  title="Quét lại GPU / CUDA / FFmpeg"
                >
                  <RefreshCw className={`h-3 w-3 ${isLoadingSysInfo ? 'animate-spin' : ''}`} />
                  Quét lại
                </button>
              </div>

              {isLoadingSysInfo && !systemInfo ? (
                <div className="flex items-center justify-center gap-2 py-4">
                  <RefreshCw className="h-4 w-4 animate-spin text-emerald-500" />
                  <span className="text-xs text-zinc-400">Đang quét GPU trên PC...</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded border border-emerald-900/40 bg-emerald-950/15 px-2.5 py-1.5 text-[10px] text-emerald-300/90">
                    Hỗ trợ PC Windows · NVIDIA (CUDA) · AMD/Intel (DirectML) · FFmpeg NVENC/AMF/QSV
                  </div>

                  <div className="bg-zinc-900/40 rounded border border-zinc-800 p-2.5 text-xs space-y-1.5">
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-zinc-400 font-medium shrink-0">Card đồ họa:</span>
                      <span
                        className="text-zinc-200 font-bold text-right max-w-[190px] truncate"
                        title={systemInfo?.gpu?.name || 'Chưa quét'}
                      >
                        {systemInfo?.gpu?.name || 'Chưa quét'}
                      </span>
                    </div>
                    {systemInfo?.gpu?.driverVersion ? (
                      <div className="flex justify-between text-[10px] text-zinc-500">
                        <span>Driver</span>
                        <span className="font-mono">{systemInfo.gpu.driverVersion}</span>
                      </div>
                    ) : null}
                    {systemInfo?.gpu?.ram && systemInfo.gpu.ram !== 'N/A' ? (
                      <div className="flex justify-between text-[10px] text-zinc-500">
                        <span>VRAM (báo OS)</span>
                        <span className="font-mono">{systemInfo.gpu.ram}</span>
                      </div>
                    ) : null}
                    {systemInfo?.scannedAt ? (
                      <div className="flex justify-between text-[9px] text-zinc-600">
                        <span>Đã lưu profile</span>
                        <span className="font-mono">
                          {new Date(systemInfo.scannedAt).toLocaleString('vi-VN')}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between text-xs bg-zinc-950/60 p-2 rounded border border-zinc-900">
                    <span className="font-semibold text-zinc-300">AI local (PyTorch / ONNX)</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                        systemInfo?.python?.cudaAvailable ||
                        systemInfo?.python?.directmlAvailable ||
                        systemInfo?.readiness?.ai
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      }`}
                    >
                      {systemInfo?.python?.cudaAvailable
                        ? `CUDA ${systemInfo?.python?.cudaVersion || ''}`.trim()
                        : systemInfo?.python?.directmlAvailable
                          ? 'DirectML'
                          : 'CPU'}
                    </span>
                  </div>

                  {systemInfo?.python?.torchVersion &&
                    systemInfo.python.torchVersion !== 'not_installed' && (
                      <p className="text-[9px] text-zinc-500 px-0.5">
                        Torch {systemInfo.python.torchVersion}
                        {Array.isArray(systemInfo?.python?.onnxProviders) &&
                        systemInfo.python.onnxProviders.length
                          ? ` · ONNX: ${systemInfo.python.onnxProviders
                              .filter((p: string) => p !== 'CPUExecutionProvider')
                              .join(', ') || 'CPU'}`
                          : ''}
                      </p>
                    )}

                  <div className="flex items-center justify-between p-2 rounded border border-zinc-800 bg-zinc-950/40">
                    <div className="min-w-0 pr-2">
                      <span className="text-xs text-zinc-300 font-semibold block">
                        Tăng tốc encode video (FFmpeg)
                      </span>
                      <span className="text-[9px] text-zinc-500 block truncate">
                        {systemInfo?.ffmpeg?.nvencSupported
                          ? 'NVENC sẵn sàng'
                          : systemInfo?.ffmpeg?.amfSupported
                            ? 'AMF sẵn sàng'
                            : systemInfo?.ffmpeg?.qsvSupported
                              ? 'QSV sẵn sàng'
                              : systemInfo?.ffmpeg?.nvencError
                                ? String(systemInfo.ffmpeg.nvencError).slice(0, 80)
                                : 'Chưa encode GPU — vẫn dùng AI CUDA'}
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={store.useGpuAcceleration}
                      onChange={(e) => store.setUseGpuAcceleration(e.target.checked)}
                      disabled={
                        !(
                          systemInfo?.ffmpeg?.nvencSupported ||
                          systemInfo?.ffmpeg?.amfSupported ||
                          systemInfo?.ffmpeg?.qsvSupported ||
                          systemInfo?.python?.cudaAvailable
                        )
                      }
                      className="h-4 w-4 accent-emerald-500 cursor-pointer disabled:opacity-40"
                      title="Bật ưu tiên GPU khi render/encode"
                    />
                  </div>

                  {installerStatus.status === 'installing' ? (
                    <div className="mt-1 p-3 bg-zinc-900/80 rounded border border-zinc-800 space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold text-emerald-400">
                        <span>Đang tải/cài stack GPU...</span>
                        <span className="font-mono">{installerStatus.progress}%</span>
                      </div>
                      <div className="w-full bg-black/60 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
                          style={{ width: `${installerStatus.progress}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-zinc-400 italic">{installerStatus.message}</p>
                    </div>
                  ) : (
                    <>
                      {systemInfo?.readiness?.ai || systemInfo?.python?.cudaAvailable ? (
                        <div className="rounded border border-emerald-800/40 bg-emerald-950/20 px-2.5 py-2 text-[10px] text-emerald-300/90 leading-relaxed">
                          Stack AI GPU đã sẵn sàng trên PC này. Profile lưu tại{' '}
                          <code className="text-zinc-500">python_core/gpu_profile.json</code>.
                        </div>
                      ) : null}

                      {systemInfo?.gpu?.vendor === 'nvidia' &&
                        (!systemInfo?.python?.cudaAvailable ||
                          !systemInfo?.python?.onnxProviders?.includes(
                            'CUDAExecutionProvider',
                          )) && (
                          <button
                            type="button"
                            onClick={handleStartGpuInstall}
                            className="w-full flex items-center justify-center gap-1.5 rounded bg-gradient-to-r from-emerald-500 to-teal-600 py-2.5 text-xs font-bold text-black hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
                          >
                            ⚡ Tự động tải hỗ trợ NVIDIA (CUDA + ONNX GPU)
                          </button>
                        )}
                      {(systemInfo?.gpu?.vendor === 'amd' ||
                        systemInfo?.gpu?.vendor === 'intel') &&
                        (!systemInfo?.python?.directmlAvailable ||
                          !systemInfo?.python?.onnxProviders?.includes(
                            'DmlExecutionProvider',
                          )) && (
                          <button
                            type="button"
                            onClick={handleStartGpuInstall}
                            className="w-full flex items-center justify-center gap-1.5 rounded bg-gradient-to-r from-emerald-500 to-teal-600 py-2.5 text-xs font-bold text-black hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
                          >
                            ⚡ Tự động tải hỗ trợ AMD/Intel (DirectML)
                          </button>
                        )}
                      {installerStatus.status === 'failed' && (
                        <div className="p-2.5 bg-red-950/20 border border-red-900/50 rounded text-xs text-red-400">
                          ❌ {installerStatus.message}
                          <button
                            type="button"
                            onClick={handleStartGpuInstall}
                            className="block mt-1 text-[10px] underline"
                          >
                            Thử lại
                          </button>
                        </div>
                      )}
                      {installerStatus.status === 'success' && !systemInfo?.readiness?.needsInstall && (
                        <p className="text-[9px] text-zinc-500 italic">
                          Lần cài gần nhất: {installerStatus.message}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
