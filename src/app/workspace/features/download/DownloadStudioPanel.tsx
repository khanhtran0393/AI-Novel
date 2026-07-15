'use client';
import { API } from '@/contracts';

import React, { useState } from 'react';
import { Download, Loader2, X, RefreshCw } from 'lucide-react';
import { toast } from '@/lib/toastBus';
import {
  DOWNLOAD_MODES,
  DOWNLOAD_PLATFORMS,
  type DownloadMode,
  type DownloadPlatformId,
} from './downloadRegistry';

export default function DownloadStudioPanel({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [platform, setPlatform] = useState<DownloadPlatformId>('yt');
  const [type, setType] = useState<DownloadMode>('search');
  const [input, setInput] = useState('');
  const [count, setCount] = useState(10);
  const [outputDir, setOutputDir] = useState('');
  const [processing, setProcessing] = useState(false);
  const [log, setLog] = useState('');

  if (!isOpen) return null;

  const appendLog = (msg: string) => setLog((prev) => `${prev}${msg}\n`);

  const handleProcess = async () => {
    if (!input.trim()) {
      toast.info('Notice', 'Vui lòng nhập link hoặc từ khóa!');
      return;
    }
    setProcessing(true);
    setLog(`> NAV download_video [${platform}] · ${type}\n`);
    try {
      const res = await fetch(API.downloadVideo, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          type,
          input: input.trim(),
          count,
          outputDir: outputDir.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      appendLog(`[HTTP ${res.status}] ${res.ok ? 'OK' : 'ERROR'}`);
      appendLog(JSON.stringify(data, null, 2));
    } catch (error) {
      appendLog(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/80 p-4 font-sans text-zinc-200 backdrop-blur-sm">
      <div className="flex h-[80vh] w-full max-w-4xl flex-col rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-sky-400">
            <Download size={18} /> Media Crawler Studio (NAV)
          </h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-800">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex w-72 flex-col gap-4 overflow-y-auto border-r border-zinc-800 bg-zinc-900/30 p-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Nền tảng</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as DownloadPlatformId)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none"
              >
                {DOWNLOAD_PLATFORMS.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Kiểu tải</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as DownloadMode)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none"
              >
                {DOWNLOAD_MODES.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Đầu vào</label>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Từ khóa hoặc URL..."
                className="min-h-[100px] w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Số lượng</label>
              <input
                type="number"
                value={count}
                onChange={(e) => setCount(Number(e.target.value) || 10)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Thư mục lưu (tùy chọn)</label>
              <input
                value={outputDir}
                onChange={(e) => setOutputDir(e.target.value)}
                placeholder="Để trống = public/downloads"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none"
              />
            </div>

            <button
              type="button"
              onClick={handleProcess}
              disabled={processing || !input.trim()}
              className="mt-auto flex items-center justify-center gap-2 rounded-lg bg-sky-500 py-3 font-bold text-black shadow-lg shadow-sky-500/20 hover:bg-sky-600 disabled:opacity-50"
            >
              {processing ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              {processing ? 'ĐANG TẢI...' : 'BẮT ĐẦU TẢI'}
            </button>
          </div>

          <div className="flex flex-1 flex-col bg-[#111]">
            <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 p-2 font-mono text-xs text-zinc-400">
              <RefreshCw size={14} className={processing ? 'animate-spin' : ''} /> Live Log
            </div>
            <div className="flex-1 overflow-y-auto whitespace-pre-wrap p-4 font-mono text-xs text-green-400">
              {log || '> Hệ thống Crawler sẵn sàng qua NAV gateway.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
