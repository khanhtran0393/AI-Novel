'use client';
import { API } from '@/contracts';

/**
 * Chrome settings dropdown — API Keys / GPU.
 * Tách khỏi Header để Header chỉ còn brand + toolbar orchestration.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  Plus,
  Minus,
  Key,
  Copy,
  Check,
  Settings,
  RefreshCw,
  ExternalLink,
  Download,
  Trash2,
} from 'lucide-react';
import { toast } from '@/lib/toastBus';
import { useProjectActions } from '../../hooks/useProjectActions';
import {
  NVENC_DRIVER_LINKS,
  openNvencDriverUrl,
} from '@/lib/ffmpeg/nvencDriverLinks';
/** Sau khi user tải/cài driver NVIDIA — app tự quét lại khi focus / mở Cài đặt */
const NVENC_PENDING_KEY = 'ainovel.nvencDriverPending';

type NvencPendingState = {
  at: number;
  expectedVersion: string | null;
  baselineDriver: string | null;
  baselineNvenc: boolean;
};

function readNvencPending(): NvencPendingState | null {
  try {
    const raw = localStorage.getItem(NVENC_PENDING_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as NvencPendingState;
    if (!o || typeof o.at !== 'number') return null;
    // Hết hạn sau 7 ngày
    if (Date.now() - o.at > 7 * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(NVENC_PENDING_KEY);
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

function writeNvencPending(p: NvencPendingState) {
  try {
    localStorage.setItem(NVENC_PENDING_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function clearNvencPending() {
  try {
    localStorage.removeItem(NVENC_PENDING_KEY);
  } catch {
    /* ignore */
  }
}

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
  const { handleFactoryResetAll } = useProjectActions('');

  const [open, setOpen] = useState(false);
  const [newApiInput, setNewApiInput] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<Provider>('gemini');
  const [copiedItem, setCopiedItem] = useState<{ type: 'api'; index: number } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [systemInfo, setSystemInfo] = useState<any>(null);
  const [isLoadingSysInfo, setIsLoadingSysInfo] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [installerStatus, setInstallerStatus] = useState<any>({ status: 'idle', progress: 0 });
  const [driverPending, setDriverPending] = useState(false);
  const prevOpenRef = useRef(false);

  /** Sau quét: nếu user đã cài driver (pending) thì so sánh và toast */
  const applyDriverScanSideEffects = useCallback((data: {
    gpu?: { driverVersion?: string };
    ffmpeg?: { nvencSupported?: boolean };
    nvidiaDriver?: { version?: string | null };
  }) => {
    const pending = readNvencPending();
    if (!pending) {
      setDriverPending(false);
      return;
    }
    setDriverPending(true);

    const nowDrv = String(data?.gpu?.driverVersion || '');
    const nowNvenc = Boolean(data?.ffmpeg?.nvencSupported);
    const expected = pending.expectedVersion
      ? String(pending.expectedVersion).replace(/^v/i, '')
      : null;

    const driverChanged =
      Boolean(nowDrv) &&
      Boolean(pending.baselineDriver) &&
      nowDrv !== pending.baselineDriver;
    const versionHint =
      expected &&
      (nowDrv.includes(expected.replace(/\./g, '')) ||
        nowDrv.includes(expected) ||
        String(data?.nvidiaDriver?.version || '').includes(expected));
    const nvencFixed = nowNvenc && !pending.baselineNvenc;

    if (nvencFixed || driverChanged || versionHint) {
      clearNvencPending();
      setDriverPending(false);
      if (nowNvenc) {
        // Bật ưu tiên GPU encode trong store khi probe pass
        try {
          store.setUseGpuAcceleration(true);
        } catch {
          /* store may be mid-hydrate */
        }
        toast.success(
          'Driver / NVENC đã cập nhật',
          `NVENC sẵn sàng.${nowDrv ? ` Driver OS: ${nowDrv}` : ''} GPU encode đã bật.`,
        );
      } else {
        toast.info(
          'Driver đã đổi',
          `Driver OS: ${nowDrv || '?'}. NVENC vẫn chưa sẵn sàng — dùng libx264.`,
        );
      }
    } else if (nowNvenc && !store.useGpuAcceleration) {
      // Quét bình thường mà NVENC đã OK → gợi ý bật store (không ép nếu user tắt)
    }
  }, [store]);

  const fetchSystemInfo = useCallback(
    async (forceRescan = false) => {
      setIsLoadingSysInfo(true);
      try {
        const url = forceRescan ? API.systemInfo : `${API.systemInfo}?cached=1`;
        // Bust browser cache on force
        const res = await fetch(forceRescan ? `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}` : url);
        if (res.ok) {
          const data = await res.json();
          setSystemInfo(data);
          if (data.installStatus) setInstallerStatus(data.installStatus);
          // Auto-enable GPU acceleration checkbox when NVENC probe passes
          if (data?.ffmpeg?.nvencSupported && !store.useGpuAcceleration) {
            store.setUseGpuAcceleration(true);
          }
          if (forceRescan) applyDriverScanSideEffects(data);
          else if (readNvencPending()) setDriverPending(true);
        }
      } catch (err) {
        console.error('Lỗi tải system info:', err);
      } finally {
        setIsLoadingSysInfo(false);
      }
    },
    [applyDriverScanSideEffects, store],
  );

  /** Đánh dấu: user vừa tải .exe — app sẽ tự quét khi quay lại */
  const markDriverDownloadStarted = useCallback(
    (expectedVersion: string | null) => {
      const baselineDriver = systemInfo?.gpu?.driverVersion
        ? String(systemInfo.gpu.driverVersion)
        : null;
      const baselineNvenc = Boolean(systemInfo?.ffmpeg?.nvencSupported);
      writeNvencPending({
        at: Date.now(),
        expectedVersion,
        baselineDriver,
        baselineNvenc,
      });
      setDriverPending(true);
      toast.info(
        'Sau khi cài driver',
        'Chạy file .exe (Admin) → xong (nên restart PC) → quay lại app: tự quét, hoặc bấm «Đã cài xong».',
      );
    },
    [systemInfo],
  );

  /** User báo đã cài xong → force probe NVENC + driver */
  const handleDriverInstalledRefresh = useCallback(async () => {
    toast.info('Đang cập nhật', 'Quét GPU + probe NVENC + làm mới link driver…');
    await fetchSystemInfo(true);
  }, [fetchSystemInfo]);

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
            if (data.status !== 'installing') fetchSystemInfo(true);
          }
        } catch {
          /* ignore poll errors */
        }
      }, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [installerStatus?.status, fetchSystemInfo]);

  // Mở panel Cài đặt → load info; nếu đang chờ cài driver thì force quét
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const pending = readNvencPending();
      setDriverPending(Boolean(pending));
      void fetchSystemInfo(Boolean(pending));
    }
    prevOpenRef.current = open;
  }, [open, fetchSystemInfo]);

  // User quay lại app sau khi cài driver → tự force quét
  useEffect(() => {
    const onFocusOrVisible = () => {
      if (document.visibilityState === 'hidden') return;
      if (!readNvencPending()) return;
      setDriverPending(true);
      void fetchSystemInfo(true);
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    return () => {
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [fetchSystemInfo]);

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
        onClick={() => setOpen((v) => !v)}
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

            {/* License moved to logo click → LicenseModal (features/license) */}

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
                  onClick={() => fetchSystemInfo(true)}
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

                  <div className="flex items-center justify-between p-2 rounded border border-zinc-800 bg-zinc-950/40">
                    <div className="min-w-0 pr-2">
                      <span className="text-xs text-zinc-300 font-semibold block">
                        Tăng tốc encode video (FFmpeg / NVENC)
                      </span>
                      <span
                        className="text-[9px] text-zinc-500 block truncate"
                        title={
                          systemInfo?.ffmpeg?.nvencMessage ||
                          systemInfo?.ffmpeg?.nvencError ||
                          ''
                        }
                      >
                        {systemInfo?.ffmpeg?.nvencSupported
                          ? `NVENC sẵn sàng${
                              systemInfo?.ffmpeg?.nvencBf2Ok ? ' · bf2' : ''
                            }${
                              systemInfo?.ffmpeg?.nvencUsedCompatFfmpeg
                                ? ' · FFmpeg compat'
                                : ''
                            }`
                          : systemInfo?.ffmpeg?.amfSupported
                            ? 'AMF sẵn sàng'
                            : systemInfo?.ffmpeg?.qsvSupported
                              ? 'QSV sẵn sàng'
                              : systemInfo?.ffmpeg?.nvencMessage
                                ? String(systemInfo.ffmpeg.nvencMessage).slice(0, 100)
                                : systemInfo?.ffmpeg?.nvencError
                                  ? String(systemInfo.ffmpeg.nvencError).slice(0, 80)
                                  : 'Chưa encode GPU'}
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
                          systemInfo?.ffmpeg?.qsvSupported
                        )
                      }
                      className="h-4 w-4 accent-emerald-500 cursor-pointer disabled:opacity-40"
                      title={
                        systemInfo?.ffmpeg?.nvencSupported ||
                        systemInfo?.ffmpeg?.amfSupported ||
                        systemInfo?.ffmpeg?.qsvSupported
                          ? 'Bật ưu tiên encode video bằng GPU (NVENC/AMF/QSV)'
                          : 'Encode GPU chưa sẵn sàng — tải driver NVIDIA bên dưới, rồi Quét lại.'
                      }
                    />
                  </div>

                  {/* Link driver đúng card (NVENC) — thu gọn khi NVENC đã sẵn sàng */}
                  {(() => {
                    const nd = systemInfo?.nvidiaDriver as
                      | {
                          ok?: boolean;
                          message?: string;
                          downloadUrl?: string | null;
                          detailsUrl?: string | null;
                          processFindUrl?: string | null;
                          version?: string | null;
                          fileSize?: string | null;
                          isLegacyBranch?: boolean;
                          matched?: {
                            productLabel?: string;
                            seriesLabel?: string;
                            arch?: string;
                            psid?: number;
                            pfid?: number;
                          } | null;
                        }
                      | null
                      | undefined;
                    const isNvidia =
                      systemInfo?.gpu?.vendor === 'nvidia' ||
                      systemInfo?.gpu?.hasNvidia ||
                      /nvidia|geforce/i.test(String(systemInfo?.gpu?.name || ''));
                    const exactUrl = nd?.downloadUrl || null;
                    const product =
                      nd?.matched?.productLabel ||
                      systemInfo?.gpu?.name ||
                      'GPU NVIDIA';
                    const productShort = String(product).replace(/^NVIDIA\s+/i, '');
                    const nvencReady = Boolean(systemInfo?.ffmpeg?.nvencSupported);
                    /** Đã cài xong + NVENC OK → thu gọn (trừ khi đang chờ cài sau lần tải) */
                    const collapsed = nvencReady && !driverPending;

                    const downloadUi = (
                      <>
                        {exactUrl ? (
                          <>
                            <label className="text-[9px] text-zinc-500 block">
                              URL tải .exe (bôi đen / copy):
                            </label>
                            <div className="flex gap-1.5 items-stretch">
                              <input
                                type="text"
                                readOnly
                                value={exactUrl}
                                onFocus={(e) => e.target.select()}
                                className="flex-1 min-w-0 bg-black/50 border border-zinc-700 rounded px-2 py-1.5 text-[10px] font-mono text-sky-200/95 select-all"
                              />
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(exactUrl);
                                    toast.success('Đã copy', 'Link driver đã copy.');
                                  } catch {
                                    toast.info('Copy', 'Bôi đen ô URL rồi Ctrl+C.');
                                  }
                                }}
                                className="shrink-0 rounded border border-zinc-600 bg-zinc-800 hover:bg-zinc-700 px-2.5 text-[10px] font-bold text-zinc-200 cursor-pointer"
                              >
                                Copy
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  markDriverDownloadStarted(
                                    nd?.version ? String(nd.version) : null,
                                  );
                                  openNvencDriverUrl(exactUrl);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-black px-3 py-1.5 text-[11px] font-bold cursor-pointer"
                              >
                                <Download className="h-3.5 w-3.5" />
                                Mở / tải file .exe
                              </button>
                              {nd?.processFindUrl ? (
                                <button
                                  type="button"
                                  onClick={() => openNvencDriverUrl(nd.processFindUrl!)}
                                  className="inline-flex items-center gap-1 rounded border border-zinc-600 bg-zinc-900 px-2.5 py-1.5 text-[10px] font-bold text-zinc-300 hover:text-sky-300 cursor-pointer"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  Advanced Search
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() =>
                                  openNvencDriverUrl(NVENC_DRIVER_LINKS.nvidiaApp.url)
                                }
                                className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2.5 py-1.5 text-[10px] font-bold text-zinc-500 hover:text-sky-300 cursor-pointer"
                              >
                                NVIDIA App
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="space-y-1.5">
                            <p className="text-[10px] text-amber-400/90">
                              Chưa lấy được URL .exe — bấm Quét lại (cần mạng tới NVIDIA).
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  openNvencDriverUrl(
                                    nd?.processFindUrl ||
                                      NVENC_DRIVER_LINKS.driverFinder.url,
                                  )
                                }
                                className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-[10px] font-bold text-sky-300 cursor-pointer"
                              >
                                Find Drivers / Advanced Search
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  openNvencDriverUrl(NVENC_DRIVER_LINKS.nvidiaApp.url)
                                }
                                className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2.5 py-1.5 text-[10px] font-bold text-zinc-400 cursor-pointer"
                              >
                                NVIDIA App
                              </button>
                            </div>
                          </div>
                        )}

                        <div
                          className={`rounded border px-2.5 py-2 space-y-1.5 ${
                            driverPending
                              ? 'border-amber-500/40 bg-amber-500/10'
                              : 'border-zinc-800 bg-zinc-950/40'
                          }`}
                        >
                          <p className="text-[9px] text-zinc-400 leading-relaxed">
                            {driverPending
                              ? 'Đã mở tải .exe — app đang chờ bạn cài xong. Quay lại cửa sổ app sẽ tự quét lại NVENC.'
                              : 'Cài .exe (Admin) → quay lại app / bấm nút dưới để cập nhật.'}
                          </p>
                          <button
                            type="button"
                            onClick={() => void handleDriverInstalledRefresh()}
                            disabled={isLoadingSysInfo}
                            className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black py-2 text-[11px] font-bold cursor-pointer disabled:opacity-50 shadow-md shadow-emerald-900/20"
                          >
                            <RefreshCw
                              className={`h-3.5 w-3.5 ${isLoadingSysInfo ? 'animate-spin' : ''}`}
                            />
                            {isLoadingSysInfo
                              ? 'Đang cập nhật app…'
                              : 'Đã cài xong — cập nhật app (quét NVENC)'}
                          </button>
                        </div>

                        <p className="text-[8px] text-zinc-600 leading-relaxed border-t border-zinc-800/60 pt-1.5">
                          1) Tải .exe → 2) Cài (Admin) → 3) Restart nếu hỏi → 4) Quay lại app
                          hoặc «Đã cài xong».
                        </p>
                      </>
                    );

                    // ── Thu gọn khi NVENC đã OK ────────────────────────────
                    if (collapsed && isNvidia) {
                      return (
                        <details className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 group">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 select-none [&::-webkit-details-marker]:hidden">
                            <div className="min-w-0 flex items-center gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                                Link driver đúng card (NVENC)
                              </span>
                              <span className="text-[9px] font-bold text-emerald-300/90 shrink-0">
                                ✓ Đã sẵn sàng
                              </span>
                            </div>
                            <span className="text-[9px] text-zinc-500 group-open:hidden shrink-0">
                              chi tiết ▾
                            </span>
                            <span className="text-[9px] text-zinc-500 hidden group-open:inline shrink-0">
                              thu gọn ▴
                            </span>
                          </summary>
                          <div className="px-3 pb-2.5 space-y-1.5 border-t border-emerald-900/30 pt-2">
                            <p className="text-[11px] text-zinc-200 font-semibold truncate">
                              {productShort}
                              {systemInfo?.gpu?.driverVersion ? (
                                <span className="text-zinc-500 font-mono text-[9px] ml-1.5">
                                  · driver {systemInfo.gpu.driverVersion}
                                </span>
                              ) : null}
                            </p>
                            {systemInfo?.ffmpeg?.nvencUsedCompatFfmpeg ? (
                              <p className="text-[8px] text-zinc-500 leading-relaxed">
                                NVENC qua FFmpeg tương thích driver (python_core/ffmpeg).
                              </p>
                            ) : null}
                            <p className="text-[8px] text-zinc-600">
                              Phantom-X có thể bật GPU (h264_nvenc). Mở rộng để tải lại driver
                              nếu cần.
                            </p>
                            <div className="pt-1 space-y-2 opacity-90">{downloadUi}</div>
                          </div>
                        </details>
                      );
                    }

                    // ── Mở rộng: chưa NVENC / đang chờ cài / không phải NVIDIA ──
                    return (
                      <div
                        className={`rounded-lg border px-3 py-2.5 space-y-2 ${
                          nvencReady
                            ? 'border-emerald-500/30 bg-emerald-500/5'
                            : isNvidia
                              ? 'border-sky-500/35 bg-sky-500/10'
                              : 'border-zinc-800 bg-zinc-950/30'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-sky-300">
                            Link driver đúng card (NVENC)
                          </div>
                          <button
                            type="button"
                            onClick={() => fetchSystemInfo(true)}
                            disabled={isLoadingSysInfo}
                            className="text-[9px] font-bold text-emerald-400/90 hover:text-emerald-300 cursor-pointer disabled:opacity-50"
                          >
                            {isLoadingSysInfo ? 'Đang quét…' : 'Quét lại'}
                          </button>
                        </div>

                        {isLoadingSysInfo && !systemInfo?.gpu?.name ? (
                          <p className="text-[10px] text-zinc-500">
                            Đang quét GPU + lấy link driver chính xác…
                          </p>
                        ) : isNvidia ? (
                          <>
                            <p className="text-[11px] text-zinc-200 font-semibold">
                              {productShort}
                              {nd?.version ? (
                                <span className="text-emerald-400 font-mono ml-1.5">
                                  v{nd.version}
                                </span>
                              ) : null}
                              {nd?.fileSize ? (
                                <span className="text-zinc-500 font-mono text-[10px] ml-1">
                                  · {nd.fileSize}
                                </span>
                              ) : null}
                            </p>
                            {systemInfo?.gpu?.driverVersion ? (
                              <p className="text-[9px] text-zinc-500 font-mono">
                                Driver đang cài: {systemInfo.gpu.driverVersion}
                                {nvencReady ? ' · NVENC ✓' : ' · NVENC chưa sẵn sàng'}
                              </p>
                            ) : null}
                            {nd?.isLegacyBranch ? (
                              <p className="text-[8px] text-amber-400/85 leading-relaxed">
                                Card Pascal/Maxwell: nhánh legacy (~580.x). App có thể dùng
                                FFmpeg tương thích (python_core) cho NVENC.
                              </p>
                            ) : null}
                            {downloadUi}
                          </>
                        ) : (
                          <p className="text-[10px] text-zinc-600">
                            Chưa quét thấy NVIDIA. Bấm Quét lại hoặc cài driver rồi thử lại.
                          </p>
                        )}
                      </div>
                    );
                  })()}

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
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Factory wipe — app mới tinh, giữ Free/Trial/Pro */}
            <div className="pt-4 mt-4 border-t border-zinc-800 space-y-2">
              <h4 className="text-[10px] font-bold text-red-400/90 uppercase flex items-center gap-1.5 tracking-wider">
                <Trash2 className="h-3 w-3" />
                Dữ liệu ứng dụng
              </h4>
              <p className="text-[9px] text-zinc-500 leading-relaxed">
                Xóa toàn bộ dự án, API key, CUDA/NVENC/GPU, TTS, media và cấu hình về
                mặc định. Gói Free / Trial / Pro hiện tại được giữ nguyên.
              </p>
              <button
                type="button"
                onClick={() => void handleFactoryResetAll()}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-900/50 bg-red-950/30 py-2.5 text-[10px] font-bold uppercase tracking-widest text-red-400/90 transition-colors hover:bg-red-950/50 hover:text-red-300 cursor-pointer"
                title="Xóa toàn bộ dữ liệu & cấu hình. Giữ gói Free/Trial/Pro."
              >
                <Trash2 className="h-3 w-3" />
                Xóa tất cả — App mới tinh
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
