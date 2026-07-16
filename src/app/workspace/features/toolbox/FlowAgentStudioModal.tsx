'use client';

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { X, Play, Square, Settings, LayoutGrid, TerminalSquare, RefreshCw, CheckCircle, XCircle, Clock, Activity } from 'lucide-react';
import { useNovelStore } from '@/store/useNovelStore';
import { createBatchJob, runBatchJob, cancelJob, type BatchJob, getJob } from '@/lib/jobQueue';
import { generateImageAction } from '../../modules/imageModule';
import { generateVideoAction } from '../../modules/videoModule';

export interface FlowAgentStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function FlowAgentStudioModal({ isOpen, onClose }: FlowAgentStudioModalProps) {
  const store = useNovelStore();
  const [promptList, setPromptList] = useState('');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [log, setLog] = useState('> FLOW AGENT STUDIO SYSTEM INITIALIZED.\n> AWAITING COMMANDS...\n');
  
  // Local state for queue tracking
  const [jobState, setJobState] = useState<BatchJob | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    if (lineNumbersRef.current && textareaRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const lines = useMemo(
    () => promptList.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    [promptList]
  );

  useEffect(() => {
    if (!activeJobId) return;
    const interval = setInterval(() => {
      const job = getJob(activeJobId);
      if (job) {
        setJobState({ ...job }); // force re-render
        if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
          setActiveJobId(null);
          appendLog(`\n[SYSTEM] JOB STATUS TERMINATED: ${job.status.toUpperCase()}`);
          clearInterval(interval);
        }
      }
    }, 500);
    return () => clearInterval(interval);
  }, [activeJobId]);

  if (!isOpen) return null;

  const appendLog = (message: string) => {
    setLog((prev) => {
      const lines = prev.split('\n');
      if (lines.length > 200) lines.splice(0, lines.length - 200);
      return `${lines.join('\n')}${message.endsWith('\n') ? message : `${message}\n`}`;
    });
  };

  const isProcessing = activeJobId !== null;

  const startBatch = async (targetMode: 'image' | 'video') => {
    if (lines.length === 0 || isProcessing) return;
    appendLog(`\n[SYSTEM] INITIATING INDUSTRIAL BATCH PROCESS (${targetMode.toUpperCase()})...`);
    appendLog(`[SYSTEM] DETECTED ${lines.length} VIRTUAL PROMPTS.`);

    try {
      const items = lines.map((p, i) => ({
        label: `Nhiệm vụ #${i + 1}`,
        meta: { prompt: p, index: i }
      }));

      const job = createBatchJob({
        title: 'Flow Agent Studio',
        kind: targetMode,
        items,
        concurrency: 2
      });
      setActiveJobId(job.id);
      setJobState(job);

      runBatchJob(job.id, async (item) => {
        const p = item.meta?.prompt as string;
        const idx = item.meta?.index as number;
        try {
          if (targetMode === 'image') {
            const res = await generateImageAction({
              prompt: p,
              sentence: p,
              chapterNum: 999,
              sceneIndex: 999,
              promptIndex: idx,
              savePathImage: '',
              googleDrivePath: '',
              ten_tac_pham: 'FlowAgent_Gen',
              selectedCookie: store.googleStudioCookies?.[0] || '',
              nhan_vat: [],
              nhan_vat_prompts: {},
              imageAspectRatio: store.imageAspectRatio || '16:9',
              imageCount: 1
            });
            appendLog(`[SUCCESS] Lệnh #${idx + 1} hoàn tất: ${res.imagePath || 'OK'}`);
          } else {
            const res = await generateVideoAction({
              chapterNum: 999,
              sceneIndex: 999,
              promptIndex: idx,
              prompt: p,
              duration: Number(store.videoDuration) || 5,
              videoAspectRatio: store.videoAspectRatio || '16:9',
              videoProvider: store.videoProvider || 'flow',
              model: store.videoModel || 'veo_3_1_t2v_fast_ultra',
              videoApiKey: store.videoApiKey || '',
            });
            appendLog(`[SUCCESS] Lệnh #${idx + 1} hoàn tất: ${res.videoPath || 'OK'}`);
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          appendLog(`[ERROR] Lệnh #${idx + 1}: ${errMsg}`);
          throw e;
        }
      });
    } catch (e) {
      appendLog(`[FATAL] KHỞI TẠO THẤT BẠI: ${(e as Error).message}`);
      setActiveJobId(null);
    }
  };

  const stopBatch = () => {
    if (activeJobId) {
      cancelJob(activeJobId);
      appendLog(`[SYSTEM] ĐÃ PHÁT LỆNH DỪNG KHẨN CẤP THUẬT TOÁN.`);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[100] flex flex-col bg-slate-950 font-sans text-slate-300"
      style={{ paddingTop: 'var(--app-chrome-h, 0px)' }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-emerald-900/50 bg-slate-900 px-6 py-4 shadow-md">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-500">
            <Activity size={24} />
          </div>
          <div>
            <h2 className="text-xl font-black uppercase tracking-widest text-emerald-400">
              Flow Agent Studio
            </h2>
            <p className="text-xs font-medium text-emerald-500/70">
              INDUSTRIAL BATCH & MULTI-ACCOUNT ORCHESTRATOR
            </p>
          </div>
        </div>
        <button onClick={onClose} className="rounded-lg bg-slate-800 p-2 text-slate-400 hover:bg-red-500/20 hover:text-red-400 transition-colors">
          <X size={20} />
        </button>
      </div>

      {/* Main Dashboard Layout */}
      <div className="flex min-h-0 flex-1 grid-cols-1 md:grid-cols-12 grid">
        
        {/* LEFT COLUMN: Control Panel & Accounts */}
        <div className="col-span-12 md:col-span-3 flex flex-col border-r border-slate-800 bg-slate-900/50 overflow-y-auto min-h-0">
          <div className="flex-1 p-4 flex flex-col gap-4 min-h-0">
            {/* Prompt Input */}
            <div className="flex-1 rounded-lg border border-slate-800 bg-slate-950 p-4 shadow-inner flex flex-col min-h-0">
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-emerald-400 shrink-0">
                Lệnh Thực Thi (Mỗi dòng 1 Prompt)
              </label>
              
              <div className="flex-1 flex overflow-hidden rounded border border-slate-700 bg-slate-900 focus-within:border-emerald-500 transition-colors">
                {/* Line Numbers Column */}
                <div 
                  ref={lineNumbersRef}
                  className="flex flex-col items-end py-3 px-2 bg-slate-950/80 border-r border-slate-800 text-slate-500 font-mono text-[11px] overflow-hidden select-none shrink-0"
                >
                  {promptList.split('\n').map((_, i) => (
                    <div key={i} className="leading-snug">{i + 1}</div>
                  ))}
                </div>
                
                <textarea
                  ref={textareaRef}
                  onScroll={handleScroll}
                  value={promptList}
                  onChange={(e) => setPromptList(e.target.value)}
                  placeholder="A cinematic shot of..."
                  wrap="off"
                  className="flex-1 min-h-[150px] w-full resize-none bg-transparent p-3 font-mono text-[11px] text-sky-300 outline-none overflow-auto leading-snug"
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => startBatch('image')}
                disabled={isProcessing || lines.length === 0}
                className="flex items-center justify-center gap-2 rounded bg-emerald-600 py-4 text-xs font-black uppercase tracking-widest text-emerald-50 hover:bg-emerald-500 disabled:opacity-50 transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:shadow-none"
              >
                {isProcessing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" fill="currentColor" />}
                CHẠY ẢNH
              </button>
              <button
                onClick={() => startBatch('video')}
                disabled={isProcessing || lines.length === 0}
                className="flex items-center justify-center gap-2 rounded bg-cyan-600 py-4 text-xs font-black uppercase tracking-widest text-cyan-50 hover:bg-cyan-500 disabled:opacity-50 transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)] disabled:shadow-none"
              >
                {isProcessing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" fill="currentColor" />}
                CHẠY VIDEO
              </button>
              <button
                onClick={stopBatch}
                disabled={!isProcessing}
                className="col-span-2 flex items-center justify-center gap-2 rounded bg-red-600/80 py-4 text-xs font-black uppercase tracking-widest text-red-50 hover:bg-red-500 disabled:opacity-50 transition-all"
              >
                <Square className="h-4 w-4" fill="currentColor" />
                DỪNG KHẨN CẤP
              </button>
            </div>
          </div>
        </div>

        {/* MIDDLE COLUMN: Queue Monitor */}
        <div className="col-span-12 md:col-span-5 flex flex-col border-r border-slate-800 bg-slate-950">
          <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900/80 px-4 py-3 shrink-0">
            <LayoutGrid size={16} className="text-sky-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-sky-400">Tiến Trình (Queue Watcher)</h3>
            
            {jobState && (
               <div className="ml-auto text-[10px] font-mono text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 rounded">
                 TOTAL: {jobState.items.length} | DONE: {jobState.items.filter(i => i.status === 'done').length} | ERR: {jobState.items.filter(i => i.status === 'failed').length}
               </div>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {!jobState ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-600 font-mono">
                [ NO ACTIVE JOBS - IDLE ]
              </div>
            ) : (
              jobState.items.map((item, idx) => {
                let statusColor = 'text-slate-400 border-slate-800';
                let icon = <Clock size={14} className="text-slate-500" />;
                if (item.status === 'running' || item.status === 'queued') {
                  statusColor = 'text-sky-400 border-sky-900/50 bg-sky-950/30';
                  icon = <RefreshCw size={14} className="animate-spin text-sky-400" />;
                } else if (item.status === 'done') {
                  statusColor = 'text-emerald-400 border-emerald-900/50 bg-emerald-950/30';
                  icon = <CheckCircle size={14} className="text-emerald-500" />;
                } else if (item.status === 'failed') {
                  statusColor = 'text-red-400 border-red-900/50 bg-red-950/30';
                  icon = <XCircle size={14} className="text-red-500" />;
                }

                return (
                  <div key={item.id} className={`flex items-start gap-3 rounded border p-3 text-xs transition-colors ${statusColor}`}>
                    <span className="shrink-0 mt-0.5">{icon}</span>
                    <span className="shrink-0 font-mono font-bold mt-0.5">#{String(idx + 1).padStart(3, '0')}</span>
                    <span className="min-w-0 flex-1 opacity-90 leading-relaxed">{item.meta?.prompt as string}</span>
                    <span className="shrink-0 text-[10px] uppercase font-bold tracking-wider opacity-70 mt-0.5">
                      {item.status}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Terminal Log */}
        <div className="col-span-12 md:col-span-4 flex flex-col bg-[#050505]">
          <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900/80 px-4 py-3 shrink-0">
            <TerminalSquare size={16} className="text-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400">Console Log (Hậu Trường)</h3>
          </div>
          <div className="flex-1 relative">
            <div className="absolute inset-0 overflow-y-auto p-4">
              <pre className="font-mono text-[11px] leading-relaxed text-amber-500/80 whitespace-pre-wrap">
                {log}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
