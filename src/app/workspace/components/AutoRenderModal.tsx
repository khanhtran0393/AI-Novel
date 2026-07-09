'use client';

import React, { useMemo, useState } from 'react';
import { CheckCircle, Clock, FolderOpen, Play, RefreshCw, X } from 'lucide-react';
import { useNovelStore } from '@/store/useNovelStore';
import { getEdgePresetList } from '@/lib/voiceCatalog';

export interface AutoRenderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type RenderStatus = 'waiting' | 'processing' | 'done' | 'error';
type SrtMode = 'auto' | 'untranslated' | 'translated' | 'none';

const VOICES = getEdgePresetList().map((p) => ({
  name: p.name,
  edge: p.edge,
}));

export default function AutoRenderModal({ isOpen, onClose }: AutoRenderModalProps) {
  const store = useNovelStore();
  const [pathList, setPathList] = useState('');
  const [outputPath, setOutputPath] = useState(() => {
    if (typeof window === 'undefined') return 'D:\\AINovel_Output';
    return window.localStorage.getItem('ainovel_auto_master_outdir') || 'D:\\AINovel_Output';
  });
  const [srtMode, setSrtMode] = useState<SrtMode>('auto');
  const [audioLang, setAudioLang] = useState('zh');
  const [targetLang, setTargetLang] = useState('vi');
  const [enableTts, setEnableTts] = useState(true);
  const [enableRender, setEnableRender] = useState(true);
  const [gpu, setGpu] = useState(true);
  const [voice, setVoice] = useState(VOICES[0].edge);
  const [ttsSpeed, setTtsSpeed] = useState('1.2');
  const [wmText, setWmText] = useState('AI Novel');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<Record<string, RenderStatus>>({});
  const [log, setLog] = useState('> CapAssistant Auto Master (AI Novel independent)\n> Ready.\n');
  const [lastSuccess, setLastSuccess] = useState('');

  const videoPaths = useMemo(
    () => pathList.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    [pathList],
  );

  if (!isOpen) return null;

  const appendLog = (message: string) => {
    setLog((prev) => `${prev}${message.endsWith('\n') ? message : `${message}\n`}`);
  };

  const selectVideos = async () => {
    try {
      const res = await fetch('/api/capassistant/select-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'video', multi: true, title: 'Chon video Auto Master' }),
      });
      const data = await res.json();
      const paths: string[] = data.paths?.length ? data.paths : data.path ? [data.path] : [];
      if (paths.length) {
        setPathList((prev) => {
          const merged = [...prev.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), ...paths];
          return Array.from(new Set(merged)).join('\n');
        });
      }
    } catch (err) {
      alert(`Khong chon duoc file: ${(err as Error).message}`);
    }
  };

  const selectOutputDir = async () => {
    try {
      const res = await fetch('/api/select-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Chon thu muc output Auto Master' }),
      });
      const data = await res.json();
      if (data.path) {
        setOutputPath(data.path);
        window.localStorage.setItem('ainovel_auto_master_outdir', data.path);
      }
    } catch {
      // keep manual path
    }
  };

  const runOne = async (videoPath: string, batchPaths?: string[]) => {
    setProgress((prev) => ({ ...prev, [videoPath]: 'processing' }));
    appendLog(`\n==========\n[START] ${videoPath}`);

    const res = await fetch('/api/capassistant/auto-master', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoPath,
        videoPaths: batchPaths && batchPaths.length > 1 ? batchPaths : undefined,
        outputDir: outputPath,
        srtMode,
        audioLang,
        targetLang,
        enableTts,
        enableRender,
        gpu,
        muteOriginal: enableTts,
        ttsVoice: voice,
        ttsSpeed: Number(ttsSpeed) || 1.2,
        wmText,
        apiKey: store.apiKey,
        apiKeys: store.apiKeys,
        ruleId: 'modern',
        srtStyle: 1,
        srtFont: 'Anton',
        srtSize: 24,
      }),
    });

    if (!res.body) throw new Error('Streaming Auto Master API unavailable');
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let success = false;
    let successPath = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const chunk = decoder.decode(value, { stream: true });
      appendLog(chunk);
      if (chunk.includes('[SUCCESS]')) {
        success = true;
        const m = chunk.match(/\[SUCCESS\]\s+(.*)/);
        if (m) successPath = m[1].trim();
      }
      if (chunk.includes('[ERROR]')) {
        // keep reading to get full error
      }
    }

    if (!success) throw new Error('Auto Master that bai — xem log.');
    if (successPath) setLastSuccess(successPath);
    setProgress((prev) => ({ ...prev, [videoPath]: 'done' }));
    return successPath;
  };

  const startBatchRender = async () => {
    if (videoPaths.length === 0 || isProcessing) return;
    setIsProcessing(true);
    setLog(`> Auto Master queue: ${videoPaths.length} video(s)\n> Engine: /api/capassistant/auto-master\n`);
    window.localStorage.setItem('ainovel_auto_master_outdir', outputPath);

    try {
      // If user wants multi-join: only when srtMode none and multiple? CapAssistant joins playlist then auto master once.
      // Default: process each video independently for safety.
      for (const videoPath of videoPaths) {
        try {
          await runOne(videoPath);
        } catch (error) {
          appendLog(`[ERROR] ${(error as Error).message}`);
          setProgress((prev) => ({ ...prev, [videoPath]: 'error' }));
        }
      }
      appendLog('\n[DONE] Auto Master queue finished.');
    } finally {
      setIsProcessing(false);
    }
  };

  const startJoinThenMaster = async () => {
    if (videoPaths.length < 2 || isProcessing) return;
    setIsProcessing(true);
    setLog(`> Auto Master JOIN+RENDER: ${videoPaths.length} videos\n`);
    try {
      await runOne(videoPaths[0], videoPaths);
      appendLog('\n[DONE] Join+Master finished.');
    } catch (error) {
      appendLog(`[ERROR] ${(error as Error).message}`);
      setProgress((prev) => ({ ...prev, [videoPaths[0]]: 'error' }));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur p-4 font-sans text-white">
      <div className="flex max-h-[90vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 bg-slate-900 px-6 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold uppercase tracking-widest text-amber-500">
              Auto Master (1-Click)
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              STT → Dịch SRT → TTS → FFmpeg Render — engine CapAssistant local, khong can CapAssistant.exe
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-2 text-slate-400 hover:bg-red-500 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[400px_1fr] bg-black">
          <div className="space-y-3 overflow-y-auto border-r border-slate-800 p-5">
            <div className="flex gap-2">
              <button
                onClick={selectVideos}
                className="flex flex-1 items-center justify-center gap-2 rounded bg-blue-600 py-2 text-xs font-bold hover:bg-blue-500"
              >
                <FolderOpen size={14} /> Chon video
              </button>
              <button
                onClick={selectOutputDir}
                className="flex flex-1 items-center justify-center gap-2 rounded bg-slate-700 py-2 text-xs font-bold hover:bg-slate-600"
              >
                Output folder
              </button>
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Danh sach video (moi dong 1 path)
              </label>
              <textarea
                value={pathList}
                onChange={(e) => setPathList(e.target.value)}
                placeholder={'D:\\Videos\\video_001.mp4\nD:\\Videos\\video_002.mp4'}
                className="h-28 w-full resize-none rounded border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-200 outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Thu muc output
              </label>
              <input
                value={outputPath}
                onChange={(e) => setOutputPath(e.target.value)}
                className="w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 outline-none focus:border-amber-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">SRT mode</label>
                <select
                  value={srtMode}
                  onChange={(e) => setSrtMode(e.target.value as SrtMode)}
                  className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs"
                >
                  <option value="auto">Auto STT</option>
                  <option value="none">Khong phu de</option>
                  <option value="untranslated">SRT goc (khong dich)</option>
                  <option value="translated">SRT da dich</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Giong TTS</label>
                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs"
                >
                  {VOICES.map((v) => (
                    <option key={v.edge} value={v.edge}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Audio lang</label>
                <select
                  value={audioLang}
                  onChange={(e) => setAudioLang(e.target.value)}
                  className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs"
                >
                  <option value="zh">Trung (ZH)</option>
                  <option value="vi">Viet (VI)</option>
                  <option value="en">Anh (EN)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Dich sang</label>
                <select
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value)}
                  className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs"
                >
                  <option value="vi">Viet (VI)</option>
                  <option value="en">Anh (EN)</option>
                  <option value="zh">Trung (ZH)</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 text-xs text-slate-300">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={enableTts} onChange={(e) => setEnableTts(e.target.checked)} />
                TTS voiceover
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={enableRender} onChange={(e) => setEnableRender(e.target.checked)} />
                FFmpeg render
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={gpu} onChange={(e) => setGpu(e.target.checked)} />
                GPU encode
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">TTS speed</label>
                <input
                  value={ttsSpeed}
                  onChange={(e) => setTtsSpeed(e.target.value)}
                  className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-500">Watermark</label>
                <input
                  value={wmText}
                  onChange={(e) => setWmText(e.target.value)}
                  className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs"
                />
              </div>
            </div>

            <button
              onClick={startBatchRender}
              disabled={isProcessing || videoPaths.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded bg-amber-500 py-3 text-xs font-bold uppercase tracking-widest text-black hover:bg-amber-400 disabled:opacity-50"
            >
              {isProcessing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" fill="currentColor" />}
              {isProcessing ? 'Dang chay...' : 'Bat dau Auto Master'}
            </button>

            {videoPaths.length > 1 && (
              <button
                onClick={startJoinThenMaster}
                disabled={isProcessing}
                className="flex w-full items-center justify-center gap-2 rounded border border-emerald-500/40 bg-emerald-500/10 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
              >
                Ghep tat ca roi Auto Master 1 lan
              </button>
            )}

            {lastSuccess && (
              <div className="rounded border border-emerald-800 bg-emerald-950/40 p-2 text-[10px] text-emerald-300 break-all">
                Last OK: {lastSuccess}
              </div>
            )}

            <div className="rounded border border-slate-800 bg-slate-950">
              <div className="border-b border-slate-800 px-3 py-2 text-xs font-bold uppercase text-slate-500">
                Hang doi ({videoPaths.length})
              </div>
              <div className="max-h-40 divide-y divide-slate-900 overflow-y-auto">
                {videoPaths.map((videoPath, index) => {
                  const status = progress[videoPath] || 'waiting';
                  return (
                    <div key={videoPath} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                      <span className="min-w-0 truncate text-slate-300" title={videoPath}>
                        {index + 1}. {videoPath}
                      </span>
                      {status === 'done' && <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />}
                      {status === 'processing' && <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-amber-500" />}
                      {status === 'error' && <X className="h-4 w-4 shrink-0 text-red-500" />}
                      {status === 'waiting' && <Clock className="h-4 w-4 shrink-0 text-slate-500" />}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <pre className="min-h-0 overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed text-emerald-400">
            {log}
          </pre>
        </div>
      </div>
    </div>
  );
}
