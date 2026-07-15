'use client';

/**
 * Cột phải Video Editor — preview canvas + export controls + logs.
 */
import React from 'react';
import { Play, X } from 'lucide-react';
import { API } from '@/contracts';

export type VideoEditorRightCanvasProps = {
  outputPath: string;
  setOutputPath: (v: string) => void;
  isRendering: boolean;
  progress: number;
  renderLog: string;
  panelLog: string;
  lastResultPath: string;
  handlePreviewSource: () => void;
  handleRender: () => void;
  handleAutoMaster: () => void;
  handleStopRender: () => void;
  openLocalPath: (path: string) => void | Promise<void>;
  appendPanelLog: (msg: string) => void;
  // SRT editor overlay
  srtEditor: {
    open: boolean;
    title: string;
    text: string;
  };
  setSrtEditor: React.Dispatch<
    React.SetStateAction<{
      open: boolean;
      title: string;
      target: 'original' | 'translated';
      text: string;
    }>
  >;
  saveSrtEditor: () => void;
  onClose: () => void;
};

export default function VideoEditorRightCanvas({
  outputPath,
  setOutputPath,
  isRendering,
  progress,
  renderLog,
  panelLog,
  lastResultPath,
  handlePreviewSource,
  handleRender,
  handleAutoMaster,
  handleStopRender,
  openLocalPath,
  appendPanelLog,
  srtEditor,
  setSrtEditor,
  saveSrtEditor,
  onClose,
}: VideoEditorRightCanvasProps) {
  return (
    <>
      <div className="flex-1 flex flex-col p-4 bg-[#0a0f1c]">
        <h2 className="text-[20px] font-black text-orange-500 tracking-wider mb-2">
          🖥️ BẢN XEM TRƯỚC (LIVE CANVAS)
        </h2>

        <div className="flex-1 bg-black border-4 border-orange-500 rounded-xl relative overflow-hidden flex items-center justify-center">
          <span className="text-slate-600 font-bold uppercase tracking-widest">
            Không có video
          </span>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handlePreviewSource}
            className="bg-sky-500 hover:bg-sky-400 text-white font-black text-[14px] px-4 py-2.5 rounded-lg flex items-center gap-2"
          >
            <Play fill="currentColor" size={16} /> Play
          </button>
          <input
            type="range"
            className="flex-1 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-500"
          />
          <span className="text-slate-200 font-mono font-bold text-[13px]">
            00:00 / 00:00
          </span>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <span className="text-slate-300 text-[13px] font-bold">Thư mục xuất:</span>
          <input
            type="text"
            value={outputPath}
            onChange={(e) => setOutputPath(e.target.value)}
            className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-[13px] text-slate-300"
          />
          <button
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded font-bold text-[13px]"
            onClick={async () => {
              const res = await fetch(API.selectFolder, { method: 'POST' });
              const data = await res.json();
              if (!data.cancelled && data.path) {
                setOutputPath(data.path);
                appendPanelLog(`[OUTPUT] ${data.path}`);
              }
            }}
          >
            📁 Chọn Folder
          </button>
        </div>

        <div className="flex gap-3 mt-4">
          <button
            onClick={handlePreviewSource}
            className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-black text-[14px] py-3 rounded-lg shadow-lg"
          >
            👀 XEM TRƯỚC
          </button>
          <button
            onClick={handleRender}
            disabled={isRendering}
            className="flex-1 bg-orange-500 hover:bg-orange-400 text-white font-black text-[14px] py-3 rounded-lg shadow-lg disabled:opacity-50"
          >
            🚀 XUẤT
          </button>
          <button
            onClick={handleAutoMaster}
            disabled={isRendering}
            className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-black text-[14px] py-3 rounded-lg shadow-lg disabled:opacity-50"
            title="STT → Dịch → TTS → Render"
          >
            🤖 AUTO
          </button>
          <button
            onClick={handleStopRender}
            disabled={!isRendering}
            className="flex-1 bg-red-600 hover:bg-red-500 text-white font-black text-[14px] py-3 rounded-lg shadow-lg disabled:opacity-50"
          >
            🛑 STOP
          </button>
          <button
            className="flex-1 bg-slate-700 text-slate-200 font-black text-[14px] py-3 rounded-lg shadow-lg disabled:text-slate-500 disabled:opacity-50"
            disabled={!lastResultPath}
            onClick={() => lastResultPath && void openLocalPath(lastResultPath)}
          >
            🎬 XEM KẾT QUẢ
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-1">
          <span className="text-slate-400 font-bold text-[13px]">
            Trạng thái: {isRendering ? 'Đang xuất video...' : 'Sẵn sàng'}
          </span>
          <div className="h-4 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {isRendering && (
          <div className="mt-2 h-24 bg-black border border-slate-800 rounded p-2 text-xs font-mono text-emerald-500 overflow-y-auto whitespace-pre-wrap">
            {renderLog}
          </div>
        )}
        <div className="mt-2 h-20 overflow-y-auto whitespace-pre-wrap rounded border border-slate-800 bg-black p-2 font-mono text-[11px] text-slate-400">
          {panelLog}
        </div>
      </div>

      {srtEditor.open && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/80 p-6">
          <div className="flex h-[72vh] w-full max-w-[820px] flex-col rounded-lg border border-orange-500 bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div className="text-sm font-black uppercase tracking-wider text-orange-400">
                {srtEditor.title}
              </div>
              <button
                onClick={() => setSrtEditor((prev) => ({ ...prev, open: false }))}
                className="rounded bg-slate-800 px-3 py-1 text-xs font-bold text-slate-200 hover:bg-red-600"
              >
                Dong
              </button>
            </div>
            <textarea
              value={srtEditor.text}
              onChange={(e) =>
                setSrtEditor((prev) => ({ ...prev, text: e.target.value }))
              }
              className="min-h-0 flex-1 resize-none bg-black p-4 font-mono text-xs leading-relaxed text-emerald-300 outline-none"
              spellCheck={false}
            />
            <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3">
              <span className="text-xs text-slate-500">{srtEditor.text.length} ky tu</span>
              <button
                onClick={saveSrtEditor}
                className="rounded bg-orange-500 px-5 py-2 text-xs font-black uppercase tracking-wider text-black hover:bg-orange-400"
              >
                Luu SRT
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 hover:bg-red-500 hover:text-white rounded-md text-slate-400 transition-colors z-50 bg-slate-900 border border-slate-700"
      >
        <X size={20} />
      </button>
    </>
  );
}
