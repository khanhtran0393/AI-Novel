import React, { useMemo, useState } from 'react';
import { CheckCircle, Clock, Play, RefreshCw, X } from 'lucide-react';

export interface AutoRenderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type RenderStatus = 'waiting' | 'processing' | 'done' | 'error';

export default function AutoRenderModal({ isOpen, onClose }: AutoRenderModalProps) {
  const [pathList, setPathList] = useState('');
  const [outputPath, setOutputPath] = useState('C:\\Users\\Khanh\\Downloads');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<Record<string, RenderStatus>>({});
  const [log, setLog] = useState('> Ready.\n');

  const videoPaths = useMemo(
    () => pathList.split(/\r?\n/).map(line => line.trim()).filter(Boolean),
    [pathList],
  );

  if (!isOpen) return null;

  const appendLog = (message: string) => {
    setLog(prev => `${prev}${message.endsWith('\n') ? message : `${message}\n`}`);
  };

  const startBatchRender = async () => {
    if (videoPaths.length === 0 || isProcessing) return;
    setIsProcessing(true);
    setLog(`> Auto Render queue: ${videoPaths.length} video(s)\n`);

    for (const videoPath of videoPaths) {
      setProgress(prev => ({ ...prev, [videoPath]: 'processing' }));
      appendLog(`\n[START] ${videoPath}`);
      try {
        const res = await fetch('/api/video-editor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoPath,
            outputPath,
            video: { zoom: '100%', speed: '100%', mute: false, vocalFilter: false, flip: false, gpu: true, volume: 100 },
            sub: { enableSub: false, useSrt: false, srtContent: '' },
            blur: { items: [] },
            bgm: { items: [] },
            brand: { wmText: 'AI Novel', staticText: '' },
            trim: { enableTrim: false, rems: [] },
            phantom: {},
          }),
        });

        if (!res.body) throw new Error('Streaming render API is not available');
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let success = false;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          const chunk = decoder.decode(value, { stream: true });
          appendLog(chunk);
          if (chunk.includes('[SUCCESS]')) success = true;
          if (chunk.includes('[ERROR]')) throw new Error(chunk.slice(-500));
        }

        setProgress(prev => ({ ...prev, [videoPath]: success ? 'done' : 'error' }));
      } catch (error) {
        appendLog(`[ERROR] ${(error as Error).message}`);
        setProgress(prev => ({ ...prev, [videoPath]: 'error' }));
      }
    }

    setIsProcessing(false);
    appendLog('\n[DONE] Auto Render queue finished.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur p-4 font-sans text-white">
      <div className="flex max-h-[85vh] w-full max-w-[980px] flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 bg-slate-900 px-6 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold uppercase tracking-widest text-amber-500">
              Auto Render Phim
            </h2>
            <p className="mt-1 text-xs text-slate-400">Render hang loat bang route Video Editor, dung duong dan file that tren may.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-2 text-slate-400 hover:bg-red-500 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[360px_1fr] bg-black">
          <div className="space-y-4 overflow-y-auto border-r border-slate-800 p-5">
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">Danh sach video path, moi dong 1 file</label>
              <textarea
                value={pathList}
                onChange={(e) => setPathList(e.target.value)}
                placeholder={"D:\\Videos\\video_001.mp4\nD:\\Videos\\video_002.mp4"}
                className="h-44 w-full resize-none rounded border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-200 outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">Thu muc output</label>
              <input
                value={outputPath}
                onChange={(e) => setOutputPath(e.target.value)}
                className="w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 outline-none focus:border-amber-500"
              />
            </div>
            <button
              onClick={startBatchRender}
              disabled={isProcessing || videoPaths.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded bg-amber-500 py-3 text-xs font-bold uppercase tracking-widest text-black hover:bg-amber-400 disabled:opacity-50"
            >
              {isProcessing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" fill="currentColor" />}
              {isProcessing ? 'Dang chay...' : 'Bat dau Auto Render'}
            </button>

            <div className="rounded border border-slate-800 bg-slate-950">
              <div className="border-b border-slate-800 px-3 py-2 text-xs font-bold uppercase text-slate-500">Hang doi ({videoPaths.length})</div>
              <div className="max-h-56 divide-y divide-slate-900 overflow-y-auto">
                {videoPaths.map((videoPath, index) => {
                  const status = progress[videoPath] || 'waiting';
                  return (
                    <div key={videoPath} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                      <span className="min-w-0 truncate text-slate-300" title={videoPath}>{index + 1}. {videoPath}</span>
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
