import React, { useEffect, useState } from 'react';
import {
  Download,
  FileAudio,
  FolderOpen,
  Loader2,
  MonitorPlay,
  Scissors,
  Shield,
  Upload,
  X,
  Wrench,
  Mic2
} from 'lucide-react';

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

  const [downloadPlatform, setDownloadPlatform] = useState('yt');
  const [downloadType, setDownloadType] = useState<'search' | 'creator' | 'detail'>('search');
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
      const res = await fetch('/api/self-heal/media', {
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
      await fetch('/api/self-heal/media', {
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
      const endpoint = mode === 'folder' ? '/api/select-folder' : '/api/capassistant/select-file';
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

    return fetch('/api/navtools/select-path', {
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
      alert('Hãy chọn hoặc nhập đường dẫn video.');
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

        const res = await fetch('/api/navtools/subtitle', {
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
      alert('Hãy chọn hoặc nhập đường dẫn file media.');
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
          endpoint = '/api/isolate-vocals';
          payload = {
            audioPath: mPath,
            outputDir: audioOutputDir.trim() || undefined,
          };
        } else if (tool === 'transcribe') {
          endpoint = '/api/transcribe';
          payload = {
            audioPath: mPath,
            language: language.trim() || 'vi',
            outputDir: audioOutputDir.trim() || undefined,
          };
        } else if (tool === 'watermark') {
          endpoint = '/api/watermark-audio';
          payload = {
            audioPath: mPath,
            mode: watermarkMode,
            outputPath: audioOutputDir.trim() || undefined,
          };
        } else {
          endpoint = '/api/split-video';
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
      alert('Nhập link hoặc từ khóa trước.');
      return;
    }
    setProcessing(true);
    setLog(`> Bắt đầu tải video bằng yt-dlp...\n\n`);
    try {
      const res = await fetch('/api/download-video', {
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

              {/* 1. Form Whisper Sub */}
              {activeTool === 'whisper_sub' && (
                <div className="space-y-4 max-w-2xl">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Đường dẫn file video (Mỗi dòng 1 file)</label>
                      <button onClick={handleSelectSubtitleVideo} className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 cursor-pointer">
                        <FolderOpen className="h-4 w-4" /> Chọn file video
                      </button>
                    </div>
                    <textarea
                      value={subtitleVideoPath}
                      onChange={(e) => setSubtitleVideoPath(e.target.value)}
                      placeholder="Ví dụ: D:\Videos\movie.mp4&#10;Chọn 1 hoặc nhiều video để xử lý hàng loạt..."
                      className="h-24 w-full rounded border border-zinc-800 bg-black/60 p-3 text-xs text-zinc-200 outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Thư mục xuất file (.srt)</label>
                      <button onClick={handleSelectSubtitleOutputDir} className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 cursor-pointer">
                        <FolderOpen className="h-4 w-4" /> Chọn thư mục lưu
                      </button>
                    </div>
                    <input
                      value={subtitleOutputPath}
                      onChange={(e) => setSubtitleOutputPath(e.target.value)}
                      placeholder="Mặc định lưu cùng thư mục chứa video gốc..."
                      className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 font-sans">Whisper Model</label>
                      <select
                        value={subtitleModel}
                        onChange={(e) => setSubtitleModel(e.target.value)}
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
                      >
                        <option value="tiny">Tiny (Rất nhanh)</option>
                        <option value="base">Base (Nhanh)</option>
                        <option value="small">Small (Khuyên dùng - Cân bằng)</option>
                        <option value="medium">Medium (Chính xác cao)</option>
                        <option value="large">Large (Chính xác tối đa)</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 font-sans">Ngôn Ngữ</label>
                      <select
                        value={subtitleLanguage}
                        onChange={(e) => setSubtitleLanguage(e.target.value)}
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
                      >
                        <option value="auto">Tự động phát hiện (Auto)</option>
                        <option value="vi">Tiếng Việt (Vietnamese)</option>
                        <option value="en">Tiếng Anh (English)</option>
                        <option value="zh">Tiếng Trung (Chinese)</option>
                      </select>
                    </div>
                  </div>

                  <button onClick={runSubtitle} disabled={processing} className="flex w-full items-center justify-center gap-2 rounded bg-emerald-500 py-3 text-xs font-bold text-black hover:bg-emerald-400 disabled:opacity-50 cursor-pointer shadow-lg shadow-emerald-500/15">
                    {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <MonitorPlay className="h-4 w-4" />}
                    {processing ? 'ĐANG TIẾN HÀNH TRÍCH XUẤT...' : 'BẮT ĐẦU TẠO PHỤ ĐỀ (.SRT)'}
                  </button>
                </div>
              )}

              {/* 2. Form Tách Giọng / Nhạc Nền */}
              {activeTool === 'isolate_vocals' && (
                <div className="space-y-4 max-w-2xl">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Đường dẫn file âm thanh/video (Mỗi dòng 1 file)</label>
                      <button onClick={handleSelectMediaPath} className="flex items-center gap-1.5 text-xs font-semibold text-violet-400 hover:text-violet-300 cursor-pointer">
                        <FolderOpen className="h-4 w-4" /> Chọn file media
                      </button>
                    </div>
                    <textarea
                      value={mediaPath}
                      onChange={(e) => setMediaPath(e.target.value)}
                      placeholder="Ví dụ: D:\Audio\song.mp3&#10;Hỗ trợ xử lý hàng loạt nhiều file..."
                      className="h-24 w-full rounded border border-zinc-800 bg-black/60 p-3 text-xs text-zinc-200 outline-none focus:border-violet-500 font-mono"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Thư mục xuất file kết quả</label>
                      <button onClick={handleSelectAudioOutputDir} className="flex items-center gap-1.5 text-xs font-semibold text-violet-400 hover:text-violet-300 cursor-pointer">
                        <FolderOpen className="h-4 w-4" /> Chọn thư mục lưu
                      </button>
                    </div>
                    <input
                      value={audioOutputDir}
                      onChange={(e) => setAudioOutputDir(e.target.value)}
                      placeholder="Mặc định lưu cùng thư mục chứa file gốc..."
                      className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-violet-500"
                    />
                  </div>

                  <button onClick={runAudioTool('isolate')} disabled={processing} className="flex w-full items-center justify-center gap-2 rounded bg-violet-500 py-3 text-xs font-bold text-black hover:bg-violet-400 disabled:opacity-50 cursor-pointer shadow-lg shadow-violet-500/15">
                    {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileAudio className="h-4 w-4" />}
                    {processing ? 'ĐANG TÁCH GIỌNG BẰNG AI...' : 'BẮT ĐẦU TÁCH GIỌNG & NHẠC NỀN'}
                  </button>
                </div>
              )}

              {/* 3. Form Nhận Diện Phụ Đề */}
              {activeTool === 'transcribe_sub' && (
                <div className="space-y-4 max-w-2xl">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Đường dẫn file âm thanh/video (Mỗi dòng 1 file)</label>
                      <button onClick={handleSelectMediaPath} className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300 cursor-pointer">
                        <FolderOpen className="h-4 w-4" /> Chọn file media
                      </button>
                    </div>
                    <textarea
                      value={mediaPath}
                      onChange={(e) => setMediaPath(e.target.value)}
                      placeholder="Ví dụ: D:\Audio\speech.wav..."
                      className="h-24 w-full rounded border border-zinc-800 bg-black/60 p-3 text-xs text-zinc-200 outline-none focus:border-amber-500 font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400">Ngôn ngữ nguồn</label>
                      <input
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        placeholder="vi, en, zh..."
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-amber-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Thư mục xuất file</label>
                        <button onClick={handleSelectAudioOutputDir} className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300 cursor-pointer">
                          <FolderOpen className="h-4 w-4" /> Chọn thư mục
                        </button>
                      </div>
                      <input
                        value={audioOutputDir}
                        onChange={(e) => setAudioOutputDir(e.target.value)}
                        placeholder="Mặc định lưu cùng thư mục file gốc..."
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  <button onClick={runAudioTool('transcribe')} disabled={processing} className="flex w-full items-center justify-center gap-2 rounded bg-amber-500 py-3 text-xs font-bold text-black hover:bg-amber-400 disabled:opacity-50 cursor-pointer shadow-lg shadow-amber-500/15">
                    {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic2 className="h-4 w-4" />}
                    {processing ? 'ĐANG NHẬN DIỆN VĂN BẢN...' : 'BẮT ĐẦU NHẬN DIỆN PHỤ ĐỀ'}
                  </button>
                </div>
              )}

              {/* 4. Form Nhúng Watermark Ẩn */}
              {activeTool === 'watermark' && (
                <div className="space-y-4 max-w-2xl">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Đường dẫn file âm thanh cần nhúng (Mỗi dòng 1 file)</label>
                      <button onClick={handleSelectMediaPath} className="flex items-center gap-1.5 text-xs font-semibold text-sky-400 hover:text-sky-300 cursor-pointer">
                        <FolderOpen className="h-4 w-4" /> Chọn file audio
                      </button>
                    </div>
                    <textarea
                      value={mediaPath}
                      onChange={(e) => setMediaPath(e.target.value)}
                      placeholder="Ví dụ: D:\Audio\music.wav..."
                      className="h-24 w-full rounded border border-zinc-800 bg-black/60 p-3 text-xs text-zinc-200 outline-none focus:border-sky-500 font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400">Chế độ đóng dấu</label>
                      <select
                        value={watermarkMode}
                        onChange={(e) => setWatermarkMode(e.target.value as 'embed' | 'detect')}
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-sky-500"
                      >
                        <option value="embed">Nhúng bản quyền ẩn (Embed watermark)</option>
                        <option value="detect">Quét/Phát hiện bản quyền ẩn (Detect watermark)</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Thư mục đầu ra</label>
                        <button onClick={handleSelectAudioOutputDir} className="flex items-center gap-1.5 text-xs font-semibold text-sky-400 hover:text-sky-300 cursor-pointer">
                          <FolderOpen className="h-4 w-4" /> Chọn thư mục
                        </button>
                      </div>
                      <input
                        value={audioOutputDir}
                        onChange={(e) => setAudioOutputDir(e.target.value)}
                        placeholder="Mặc định lưu cùng thư mục file gốc..."
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>

                  <button onClick={runAudioTool('watermark')} disabled={processing} className="flex w-full items-center justify-center gap-2 rounded bg-sky-500 py-3 text-xs font-bold text-black hover:bg-sky-400 disabled:opacity-50 cursor-pointer shadow-lg shadow-sky-500/15">
                    {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                    {processing ? 'ĐANG TIẾN HÀNH XỬ LÝ WATERMARK...' : 'BẮT ĐẦU CHẠY WATERMARK'}
                  </button>
                </div>
              )}

              {/* 5. Form Cắt Video Theo Cảnh */}
              {activeTool === 'split_video' && (
                <div className="space-y-4 max-w-2xl">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Đường dẫn video cần cắt (Mỗi dòng 1 file)</label>
                      <button onClick={handleSelectMediaPath} className="flex items-center gap-1.5 text-xs font-semibold text-rose-400 hover:text-rose-300 cursor-pointer">
                        <FolderOpen className="h-4 w-4" /> Chọn file video
                      </button>
                    </div>
                    <textarea
                      value={mediaPath}
                      onChange={(e) => setMediaPath(e.target.value)}
                      placeholder="Ví dụ: D:\Videos\movie.mp4..."
                      className="h-24 w-full rounded border border-zinc-800 bg-black/60 p-3 text-xs text-zinc-200 outline-none focus:border-rose-500 font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400">Thời lượng mỗi đoạn (Giây)</label>
                      <input
                        value={splitDuration}
                        onChange={(e) => setSplitDuration(e.target.value)}
                        placeholder="Ví dụ: 30"
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-rose-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Thư mục đầu ra</label>
                        <button onClick={handleSelectAudioOutputDir} className="flex items-center gap-1.5 text-xs font-semibold text-rose-400 hover:text-rose-300 cursor-pointer">
                          <FolderOpen className="h-4 w-4" /> Chọn thư mục
                        </button>
                      </div>
                      <input
                        value={audioOutputDir}
                        onChange={(e) => setAudioOutputDir(e.target.value)}
                        placeholder="Mặc định lưu cùng thư mục file gốc..."
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-rose-500"
                      />
                    </div>
                  </div>

                  <button onClick={runAudioTool('split')} disabled={processing} className="flex w-full items-center justify-center gap-2 rounded bg-rose-500 py-3 text-xs font-bold text-black hover:bg-rose-400 disabled:opacity-50 cursor-pointer shadow-lg shadow-rose-500/15">
                    {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
                    {processing ? 'ĐANG TIẾN HÀNH CẮT VIDEO...' : 'BẮT ĐẦU CẮT VIDEO'}
                  </button>
                </div>
              )}

              {/* 6. Form Tải Video (Crawler) */}
              {activeTool === 'download_video' && (
                <div className="space-y-4 max-w-2xl">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400">Nền tảng mạng xã hội</label>
                      <select
                        value={downloadPlatform}
                        onChange={(e) => setDownloadPlatform(e.target.value)}
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                      >
                        <option value="yt">YouTube</option>
                        <option value="tt">TikTok</option>
                        <option value="tw">Twitter / X</option>
                        <option value="rd">Reddit</option>
                        <option value="ig">Instagram</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400">Kiểu tải</label>
                      <select
                        value={downloadType}
                        onChange={(e) => setDownloadType(e.target.value as 'search' | 'creator' | 'detail')}
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                      >
                        <option value="search">Theo từ khóa tìm kiếm (Search)</option>
                        <option value="creator">Theo kênh/Người sáng tạo (Creator)</option>
                        <option value="detail">Link trực tiếp (Direct Link)</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Nhập link hoặc từ khóa (mỗi dòng 1 mục)</label>
                      <button onClick={handleImportDownloadInput} className="flex items-center gap-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300 cursor-pointer">
                        <Upload className="h-4 w-4" /> Nhập từ file text
                      </button>
                    </div>
                    <textarea
                      value={downloadInput}
                      onChange={(e) => setDownloadInput(e.target.value)}
                      placeholder="Ví dụ: nhac thien mạt the&#10;https://www.youtube.com/watch?v=...&#10;Hỗ trợ tải hàng loạt..."
                      className="h-24 w-full rounded border border-zinc-800 bg-black/60 p-3 text-xs text-zinc-200 outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400">Số lượng tải tối đa</label>
                      <input
                        value={downloadCount}
                        onChange={(e) => setDownloadCount(e.target.value)}
                        placeholder="Mặc định: 10"
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Thư mục lưu video tải</label>
                        <button onClick={handleSelectDownloadOutputDir} className="flex items-center gap-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300 cursor-pointer">
                          <FolderOpen className="h-4 w-4" /> Chọn thư mục
                        </button>
                      </div>
                      <input
                        value={downloadOutputDir}
                        onChange={(e) => setDownloadOutputDir(e.target.value)}
                        placeholder="Mặc định lưu vào public/downloads..."
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <button onClick={runDownload} disabled={processing} className="flex w-full items-center justify-center gap-2 rounded bg-indigo-500 py-3 text-xs font-bold text-black hover:bg-indigo-400 disabled:opacity-50 cursor-pointer shadow-lg shadow-indigo-500/15">
                    {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {processing ? 'ĐANG TIẾN HÀNH TẢI VIDEO...' : 'BẮT ĐẦU TẢI VIDEO'}
                  </button>
                </div>
              )}

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
