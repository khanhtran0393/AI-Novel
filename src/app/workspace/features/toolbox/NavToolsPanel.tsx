import React, { useEffect, useState } from 'react';
import NavToolForms from './forms/NavToolForms';
import {
  Loader2,
  X,
  Wrench,
} from 'lucide-react';
import { API } from '@/contracts';
import { toast } from '@/lib/toastBus';
import type { DownloadMode, DownloadPlatformId } from '../download';

// Định nghĩa 6 công cụ phẳng
type NavToolType = 'whisper_sub' | 'isolate_vocals' | 'transcribe_sub' | 'watermark' | 'split_video' | 'download_video';
type PickerMode = 'file' | 'folder';
type PickerKind = 'media' | 'text';

interface SelectPathResult {
  success?: boolean;
  cancelled?: boolean;
  path?: string;
  paths?: string[];
  content?: string;
  error?: string;
}

interface UiClickDiagnosis {
  logId?: string;
  logPath?: string;
  shouldRetry?: boolean;
  patch?: {
    pickerStrategy?: PickerStrategy;
  };
  issue?: {
    kind?: string;
    message?: string;
  };
  summary?: string;
}

interface NavToolsPanelProps {
  isOpen: boolean;
  initialTool?: NavToolType;
  onClose: () => void;
}

const PICKER_WATCHDOG_MS = 8000;
const PICKER_STRATEGY_KEY = 'ai_novel_navtools_picker_strategy';
const PICKER_PENDING_LOG_KEY = 'ai_novel_navtools_picker_pending_log';
type PickerStrategy = 'windows_dialog' | 'compat_dialog';

export default function NavToolsPanel({ isOpen, initialTool = 'whisper_sub', onClose }: NavToolsPanelProps) {
  const [activeTool, setActiveTool] = useState<NavToolType>(initialTool);
  const [processing, setProcessing] = useState(false);
  const [log, setLog] = useState('> Hệ thống sẵn sàng.\n');

  // Form State
  const [subtitleVideoPath, setSubtitleVideoPath] = useState('');
  const [subtitleOutputPath, setSubtitleOutputPath] = useState('');
  const [subtitleModel, setSubtitleModel] = useState('small');
  const [subtitleLanguage, setSubtitleLanguage] = useState('auto');

  const [mediaPath, setMediaPath] = useState('');
  const [audioOutputDir, setAudioOutputDir] = useState('');
  const [language, setLanguage] = useState('vi');
  const [watermarkMode, setWatermarkMode] = useState<'embed' | 'detect'>('embed');
  const [splitDuration, setSplitDuration] = useState('30');

  const [downloadPlatform, setDownloadPlatform] = useState<DownloadPlatformId>('yt');
  const [downloadType, setDownloadType] = useState<DownloadMode>('search');
  const [downloadInput, setDownloadInput] = useState('');
  const [downloadCount, setDownloadCount] = useState('10');
  const [downloadOutputDir, setDownloadOutputDir] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const frame = window.requestAnimationFrame(() => setActiveTool(initialTool));
    return () => window.cancelAnimationFrame(frame);
  }, [initialTool, isOpen]);

  if (!isOpen) return null;

  const appendLog = (message: string) => {
    setLog(prev => `${prev}${message.endsWith('\n') ? message : `${message}\n`}`);
  };

  const logUiClickIssue = async (
    action: string,
    error: unknown,
    details: Record<string, unknown> = {},
  ): Promise<UiClickDiagnosis> => {
    const errorMessage =
      typeof error === 'string'
        ? error.trim() || 'UI click did not respond'
        : error instanceof Error
          ? error.message.trim() || 'UI click did not respond'
          : String(error || 'UI click did not respond');

    const payload = {
      domain: 'ui_click',
      error: errorMessage,
      config: {
        operation: action,
        activeTool,
        ...details,
      },
      credentials: {},
    };

    try {
      const res = await fetch(API.selfHealMedia, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        const apiError = data?.error || `HTTP ${res.status}`;
        console.warn('[NavTools Self-Heal] API log failed:', apiError);
        return {
          logId: `local_ui_${Date.now()}`,
          issue: { kind: 'unknown', message: errorMessage },
          summary: `Self-heal (local) logged UI click error: ${apiError}`,
        };
      }
      return data.diagnosis || {
        logId: `local_ui_${Date.now()}`,
        issue: { kind: 'unknown', message: errorMessage },
        summary: 'Self-heal logged UI click error.',
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn('[NavTools Self-Heal] Cannot write UI click log:', reason);
      return {
        logId: `local_ui_${Date.now()}`,
        issue: { kind: 'unknown', message: errorMessage },
        summary: `Self-heal (local) UI click log failed: ${reason}`,
      };
    }
  };

  const resolveUiClickLog = async (logId?: string) => {
    if (!logId) return;
    try {
      await fetch(API.selfHealMedia, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', logId }),
      });
    } catch (err) {
      console.warn('[NavTools Self-Heal] Cannot resolve UI click log:', err);
    }
  };

  const getPickerStrategy = (): PickerStrategy => {
    if (typeof window === 'undefined') return 'windows_dialog';
    const saved = window.localStorage.getItem(PICKER_STRATEGY_KEY);
    return saved === 'compat_dialog' ? 'compat_dialog' : 'windows_dialog';
  };

  const setPickerStrategy = (strategy: PickerStrategy, logId?: string) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PICKER_STRATEGY_KEY, strategy);
    if (logId) window.localStorage.setItem(PICKER_PENDING_LOG_KEY, logId);
  };

  const consumePendingPickerLog = () => {
    if (typeof window === 'undefined') return undefined;
    const logId = window.localStorage.getItem(PICKER_PENDING_LOG_KEY) || undefined;
    if (logId) window.localStorage.removeItem(PICKER_PENDING_LOG_KEY);
    return logId;
  };

  const requestUiClickRepairApproval = (
    diagnosis: UiClickDiagnosis | null,
    action: string,
    reason: string,
  ) => {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false;
    const nextStrategy = diagnosis?.patch?.pickerStrategy;
    if (!diagnosis?.shouldRetry || nextStrategy !== 'compat_dialog') return false;

    return window.confirm([
      'AI da ghi log loi click khong phan hoi.',
      `Thao tac: ${action}`,
      `Ly do: ${reason}`,
      `Log: ${diagnosis.logPath || diagnosis.logId || 'chua tao duoc log'}`,
      '',
      'De xuat sua: chuyen bo chon file/thu muc sang compat_dialog.',
      'Bam OK de ap dung. Sau do bam lai nut Chon file/thu muc.',
    ].join('\n'));
  };

  const applyUiClickRepairPatch = (diagnosis: UiClickDiagnosis | null) => {
    const nextStrategy = diagnosis?.patch?.pickerStrategy;
    if (nextStrategy !== 'compat_dialog') return false;
    setPickerStrategy(nextStrategy, diagnosis?.logId);
    appendLog('> Da ap dung sua picker: compat_dialog. Hay bam lai nut chon file/thu muc.');
    return true;
  };

  const callPickerEndpoint = async (
    strategy: PickerStrategy,
    mode: PickerMode,
    type: PickerKind,
    signal?: AbortSignal,
  ) => {
    if (strategy === 'compat_dialog') {
      const endpoint = mode === 'folder' ? API.selectFolder : API.capassistant.selectFile;
      const payload = mode === 'folder'
        ? {}
        : {
            kind: type === 'text' ? 'text' : 'media',
            multi: true,
            readContent: type === 'text',
            title: 'Chon file dau vao',
          };

      return fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });
    }

    return fetch(API.navtools.selectPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, type }),
      signal,
    });
  };

  const normalizePickerResult = (data: SelectPathResult | null): SelectPathResult | null => {
    if (!data || data.cancelled) return data;
    const joinedPaths = Array.isArray(data.paths) && data.paths.length > 0 ? data.paths.join('|') : '';
    const path = joinedPaths || data.path || '';
    if (!path && !data.content) return null;
    return {
      ...data,
      success: data.success ?? true,
      path,
    };
  };

  const selectPath = async (mode: PickerMode, type: PickerKind = 'media') => {
    const action = `navtools.${activeTool}.${mode}.${type}`;
    const initialStrategy = getPickerStrategy();
    appendLog(`> Click: ${action} (${initialStrategy})`);
    const controller = new AbortController();
    let settled = false;
    let timeoutLogId: string | undefined;
    const watchdog = typeof window !== 'undefined'
      ? window.setTimeout(() => {
          void (async () => {
            if (settled) return;
            const reason = `Picker did not return after ${PICKER_WATCHDOG_MS / 1000} seconds.`;
            appendLog(`> Canh bao: ${reason}`);
            const diagnosis = await logUiClickIssue(action, reason, {
              mode,
              type,
              pickerStrategy: initialStrategy,
              watchdogMs: PICKER_WATCHDOG_MS,
            });
            timeoutLogId = diagnosis?.logId;
            appendLog(`> Self-heal da ghi log click: ${diagnosis?.logPath || diagnosis?.logId || 'khong ro duong dan log'}`);
            if (!settled && requestUiClickRepairApproval(diagnosis, action, reason)) {
              applyUiClickRepairPatch(diagnosis);
              controller.abort();
            }
          })();
        }, PICKER_WATCHDOG_MS)
      : undefined;

    try {
      const strategy = getPickerStrategy();
      const res = await callPickerEndpoint(strategy, mode, type, controller.signal);
      settled = true;
      if (watchdog) window.clearTimeout(watchdog);

      const data = await res.json().catch(() => ({} as SelectPathResult));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || `Picker HTTP ${res.status}`);
      }
      if (data.cancelled) {
        appendLog('> Nguoi dung da huy hop chon.');
        await resolveUiClickLog(timeoutLogId);
        return null;
      }

      const normalized = normalizePickerResult(data);
      if (!normalized) {
        throw new Error('Picker khong tra ve duong dan hop le.');
      }

      await resolveUiClickLog(timeoutLogId);
      await resolveUiClickLog(consumePendingPickerLog());
      return normalized;
    } catch (error) {
      settled = true;
      if (watchdog) window.clearTimeout(watchdog);

      if ((error as Error).name === 'AbortError') {
        appendLog('> Da huy thao tac picker dang treo sau khi ap dung sua. Hay bam lai.');
        return null;
      }

      const message = error instanceof Error ? error.message : String(error);
      console.error('Loi khi mo hop thoai:', error);
      appendLog(`[LOI CLICK PICKER] ${message}`);
      const diagnosis = await logUiClickIssue(action, message, { mode, type, pickerStrategy: getPickerStrategy() });
      appendLog(`> Self-heal da ghi log click: ${diagnosis?.logPath || diagnosis?.logId || 'khong ro duong dan log'}`);
      if (requestUiClickRepairApproval(diagnosis, action, message)) {
        applyUiClickRepairPatch(diagnosis);
      } else {
        appendLog('> Chua ap dung sua picker. Giu log loi noi bo.');
      }
      return null;
    }
  };

  const handleSelectSubtitleVideo = async () => {
    const res = await selectPath('file', 'media');
    if (res && res.path) {
      const formatted = res.path.split('|').join('\n');
      setSubtitleVideoPath(formatted);
    }
  };

  const handleSelectSubtitleOutputDir = async () => {
    const res = await selectPath('folder');
    if (res && res.path) {
      setSubtitleOutputPath(res.path);
    }
  };

  const handleSelectMediaPath = async () => {
    const res = await selectPath('file', 'media');
    if (res && res.path) {
      const formatted = res.path.split('|').join('\n');
      setMediaPath(formatted);
    }
  };

  const handleSelectAudioOutputDir = async () => {
    const res = await selectPath('folder');
    if (res && res.path) {
      setAudioOutputDir(res.path);
    }
  };

  const handleImportDownloadInput = async () => {
    const res = await selectPath('file', 'text');
    if (res && res.content) {
      setDownloadInput(res.content);
      appendLog(`> Đã nhập dữ liệu từ file text. Tìm thấy ${res.content.split('\n').filter(Boolean).length} dòng.\n`);
    } else if (res && res.path) {
      setDownloadInput(res.path);
    }
  };

  const handleSelectDownloadOutputDir = async () => {
    const res = await selectPath('folder');
    if (res && res.path) {
      setDownloadOutputDir(res.path);
    }
  };

  // 1. Chạy Làm Sub Whisper
  const runSubtitle = async () => {
    const paths = subtitleVideoPath.split('\n').map(p => p.trim()).filter(Boolean);
    if (paths.length === 0) {
      toast.info('Notice', 'Hãy chọn hoặc nhập đường dẫn video.');
      return;
    }

    setProcessing(true);
    setLog(`> Bắt đầu xử lý ${paths.length} video bằng AI Whisper...\n\n`);
    try {
      for (let i = 0; i < paths.length; i++) {
        const vPath = paths[i];
        appendLog(`[${i + 1}/${paths.length}] Đang xử lý: ${vPath}`);

        let outPath = subtitleOutputPath.trim();
        if (paths.length > 1 || !outPath) {
          outPath = vPath.replace(/\.[^.\\/]+$/, '.srt');
        } else if (paths.length === 1 && outPath) {
          if (!outPath.endsWith('.srt')) {
            const baseName = vPath.replace(/^.*[\\/]/, '').replace(/\.[^.\\/]+$/, '.srt');
            outPath = `${outPath.replace(/[\\/]+$/, '')}\\${baseName}`;
          }
        }

        const res = await fetch(API.navtools.subtitle, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoPath: vPath,
            outPath: outPath,
            model: subtitleModel,
            language: subtitleLanguage,
          }),
        });
        const data = await res.json().catch(() => ({}));
        appendLog(`[Kết quả] ${res.ok ? 'Thành công' : 'Thất bại'}`);
        appendLog(JSON.stringify(data, null, 2));
      }
    } catch (error) {
      appendLog(`[LỖI HỆ THỐNG] ${(error as Error).message}`);
    } finally {
      setProcessing(false);
    }
  };

  // 2. Chạy Audio Tools (Isolate, Transcribe, Watermark, Split)
  const runAudioTool = (tool: 'isolate' | 'transcribe' | 'watermark' | 'split') => async () => {
    const paths = mediaPath.split('\n').map(p => p.trim()).filter(Boolean);
    if (paths.length === 0) {
      toast.info('Notice', 'Hãy chọn hoặc nhập đường dẫn file media.');
      return;
    }

    setProcessing(true);
    setLog(`> Bắt đầu xử lý ${paths.length} file media bằng công cụ: ${tool}...\n\n`);
    try {
      for (let i = 0; i < paths.length; i++) {
        const mPath = paths[i];
        appendLog(`[${i + 1}/${paths.length}] Đang xử lý: ${mPath}`);

        let endpoint = '';
        let payload: Record<string, unknown> = {};

        if (tool === 'isolate') {
          endpoint = API.isolateVocals;
          payload = {
            audioPath: mPath,
            outputDir: audioOutputDir.trim() || undefined,
          };
        } else if (tool === 'transcribe') {
          endpoint = API.transcribe;
          payload = {
            audioPath: mPath,
            language: language.trim() || 'vi',
            outputDir: audioOutputDir.trim() || undefined,
          };
        } else if (tool === 'watermark') {
          endpoint = API.watermarkAudio;
          payload = {
            audioPath: mPath,
            mode: watermarkMode,
            outputPath: audioOutputDir.trim() || undefined,
          };
        } else {
          endpoint = API.splitVideo;
          payload = {
            videoPath: mPath,
            targetDuration: Number(splitDuration) || 30,
            outputDir: audioOutputDir.trim() || undefined,
          };
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        appendLog(`[Kết quả] ${res.ok ? 'Thành công' : 'Thất bại'}`);
        appendLog(JSON.stringify(data, null, 2));
      }
    } catch (error) {
      appendLog(`[LỖI HỆ THỐNG] ${(error as Error).message}`);
    } finally {
      setProcessing(false);
    }
  };

  // 3. Chạy Tải Video
  const runDownload = async () => {
    if (!downloadInput.trim()) {
      toast.info('Notice', 'Nhập link hoặc từ khóa trước.');
      return;
    }
    setProcessing(true);
    setLog(`> Bắt đầu tải video bằng yt-dlp...\n\n`);
    try {
      const res = await fetch(API.downloadVideo, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: downloadPlatform,
          type: downloadType,
          input: downloadInput.trim(),
          count: Number(downloadCount) || 10,
          outputDir: downloadOutputDir.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      appendLog(`[HTTP ${res.status}] ${res.ok ? 'OK' : 'ERROR'}`);
      appendLog(JSON.stringify(data, null, 2));
    } catch (error) {
      appendLog(`[ERROR] ${(error as Error).message}`);
    } finally {
      setProcessing(false);
    }
  };

  // Cấu hình thông tin 6 công cụ phục vụ hiển thị
  const toolsConfig = [
    { id: 'whisper_sub', name: '📄 Làm Sub Whisper (AI)', desc: 'Tự động nhận diện và trích xuất phụ đề SRT từ video bằng AI Whisper.', color: 'text-emerald-400' },
    { id: 'isolate_vocals', name: '🎵 Tách Giọng / Nhạc Nền', desc: 'Tách biệt giọng hát của ca sĩ và nhạc nền từ file âm thanh/video.', color: 'text-violet-400' },
    { id: 'transcribe_sub', name: '🗣️ Nhận Diện Phụ Đề', desc: 'Nhận diện lời thoại và chuyển âm thanh thành văn bản phụ đề.', color: 'text-amber-400' },
    { id: 'watermark', name: '🛡️ Nhúng Watermark Ẩn', desc: 'Nhúng bản quyền/watermark ẩn vào file âm thanh chống sao chép trái phép.', color: 'text-sky-400' },
    { id: 'split_video', name: '✂️ Cắt Video Theo Cảnh', desc: 'Cắt nhỏ video dài thành các cảnh ngắn theo thời lượng cố định.', color: 'text-rose-400' },
    { id: 'download_video', name: '📥 Tải Video (Crawler)', desc: 'Tải hàng loạt video từ YouTube, TikTok, Douyin theo link hoặc từ khóa.', color: 'text-indigo-400' }
  ];

  const currentToolInfo = toolsConfig.find(t => t.id === activeTool);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4 font-sans text-zinc-100 backdrop-blur-sm">
      <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        
        {/* Header Modal */}
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-5 py-4">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-sky-400" />
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-100">
                Studio Công Cụ Media Nâng Cao (6-in-1)
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Hệ thống các công cụ xử lý Audio, Video, Subtitle và Crawler tự động.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Thân Modal: Menu Trái phẳng và Giao diện Phải */}
        <div className="grid min-h-0 flex-1 grid-cols-[290px_1fr]">
          
          {/* Menu Trái phẳng gồm đúng 6 công cụ */}
          <div className="overflow-y-auto border-r border-zinc-900 bg-zinc-950/80 p-3 flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-2.5 mb-2 block">Danh Sách Công Cụ</span>
            {toolsConfig.map((tool) => {
              const isSelected = activeTool === tool.id;
              return (
                <button
                  key={tool.id}
                  onClick={() => {
                    setActiveTool(tool.id as NavToolType);
                    setLog(`> Chuyển sang công cụ: ${tool.name}\n`);
                  }}
                  className={`w-full flex items-center justify-between rounded-lg px-3 py-3 text-xs font-bold text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-sky-500/10 border border-sky-500/30 text-sky-400 shadow-md shadow-sky-500/5'
                      : 'border border-transparent bg-zinc-900/20 hover:bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <span>{tool.name}</span>
                </button>
              );
            })}
          </div>

          {/* Giao diện Phải: Form cấu hình & Live Log split */}
          <div className="grid min-h-0 grid-rows-[1fr_200px] bg-zinc-950">
            
            {/* Form cấu hình của công cụ đang chọn */}
            <div className="overflow-y-auto p-6 space-y-5">
              <div className="border-b border-zinc-900 pb-3">
                <h3 className={`text-sm font-bold uppercase tracking-wider ${currentToolInfo?.color}`}>
                  {currentToolInfo?.name}
                </h3>
                <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                  {currentToolInfo?.desc}
                </p>
              </div>

              <NavToolForms
                activeTool={activeTool}
                processing={processing}
                subtitleVideoPath={subtitleVideoPath}
                setSubtitleVideoPath={setSubtitleVideoPath}
                subtitleOutputPath={subtitleOutputPath}
                setSubtitleOutputPath={setSubtitleOutputPath}
                subtitleModel={subtitleModel}
                setSubtitleModel={setSubtitleModel}
                subtitleLanguage={subtitleLanguage}
                setSubtitleLanguage={setSubtitleLanguage}
                handleSelectSubtitleVideo={handleSelectSubtitleVideo}
                handleSelectSubtitleOutputDir={handleSelectSubtitleOutputDir}
                runSubtitle={runSubtitle}
                mediaPath={mediaPath}
                setMediaPath={setMediaPath}
                audioOutputDir={audioOutputDir}
                setAudioOutputDir={setAudioOutputDir}
                language={language}
                setLanguage={setLanguage}
                handleSelectMediaPath={handleSelectMediaPath}
                handleSelectAudioOutputDir={handleSelectAudioOutputDir}
                runAudioTool={runAudioTool}
                watermarkMode={watermarkMode}
                setWatermarkMode={setWatermarkMode}
                splitDuration={splitDuration}
                setSplitDuration={setSplitDuration}
                downloadPlatform={downloadPlatform}
                setDownloadPlatform={setDownloadPlatform}
                downloadType={downloadType}
                setDownloadType={setDownloadType}
                downloadInput={downloadInput}
                setDownloadInput={setDownloadInput}
                downloadCount={downloadCount}
                setDownloadCount={setDownloadCount}
                downloadOutputDir={downloadOutputDir}
                setDownloadOutputDir={setDownloadOutputDir}
                handleImportDownloadInput={handleImportDownloadInput}
                handleSelectDownloadOutputDir={handleSelectDownloadOutputDir}
                runDownload={runDownload}
              />
            </div>

            {/* Console Log của hệ thống */}
            <div className="flex min-h-0 flex-col bg-black border-t border-zinc-900">
              <div className="bg-zinc-900/60 px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-sky-400 flex items-center justify-between select-none">
                <span>Live System Log Output</span>
                {processing && <Loader2 className="h-3 w-3 animate-spin text-sky-400" />}
              </div>
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-[11px] leading-relaxed text-zinc-300 selection:bg-sky-500/20">
                {log}
              </pre>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
