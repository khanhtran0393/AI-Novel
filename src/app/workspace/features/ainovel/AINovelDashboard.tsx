'use client';
import { API } from '@/contracts';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Settings,
  FileText,
  ChevronRight,
  Download,
  Activity,
  Stethoscope,
} from 'lucide-react';
import { useNovelStore } from '@/store/useNovelStore';
import YoutubePromptModal from '../youtube/YoutubePromptModal';
import { toast } from '@/lib/toastBus';
import EngineToolbar from './EngineToolbar';

type EngineProgress = {
  totalChapters?: number;
  completedChapters?: number[];
  currentChapter?: number;
  phase?: string;
  lastAction?: string;
};

export default function AINovelDashboard() {
  const store = useNovelStore();
  const [status, setStatus] = useState<'stopped' | 'running' | 'checking'>('checking');
  const [logs, setLogs] = useState<{ id: number; text: string; type: 'info' | 'error' | 'success' }[]>([]);
  const [chapters, setChapters] = useState<
    { id: number; title: string; content?: string; status?: string; wordCount?: number }[]
  >([]);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [capsHint, setCapsHint] = useState<string>('');
  const [progress, setProgress] = useState<EngineProgress | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showYoutubeModal, setShowYoutubeModal] = useState(false);
  const [showDiagModal, setShowDiagModal] = useState(false);
  const [diagJson, setDiagJson] = useState('');
  const [configContent, setConfigContent] = useState<{ env: string; config: string }>({
    env: '',
    config: '',
  });
  const [savingConfig, setSavingConfig] = useState(false);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const fetchConfig = async () => {
    try {
      const res = await fetch(API.ainovel.config);
      if (res.ok) {
        const data = await res.json();
        setConfigContent({ env: data.env || '', config: data.config || '' });
      }
    } catch (err) {
      console.error('Lỗi tải cấu hình:', err);
    }
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const res = await fetch(API.ainovel.config, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configContent),
      });
      if (res.ok) {
        toast.info('Notice', 'Lưu cấu hình thành công!');
        setShowConfigModal(false);
      } else {
        toast.info('Notice', 'Lỗi lưu cấu hình.');
      }
    } catch {
      toast.info('Notice', 'Có lỗi xảy ra khi lưu cấu hình.');
    } finally {
      setSavingConfig(false);
    }
  };

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) return;

    const es = new EventSource(API.ainovel.stream);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'log') {
          setLogs((prev) =>
            [
              ...prev,
              {
                id: Date.now() + Math.random(),
                text: data.message,
                type: (data.level === 'error'
                  ? 'error'
                  : data.level === 'success'
                    ? 'success'
                    : 'info') as 'info' | 'error' | 'success',
              },
            ].slice(-500),
          );
        } else if (data.type === 'status') {
          setStatus(data.status === 'running' ? 'running' : 'stopped');
        } else if (data.type === 'chapter_update') {
          void fetchChapters();
          void checkStatus();
        }
      } catch (err) {
        console.error('Lỗi parse SSE:', err);
      }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      setTimeout(connectSSE, 3000);
    };

    eventSourceRef.current = es;
  }, []);

  const checkStatus = async () => {
    try {
      const res = await fetch(API.ainovel.status);
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status === 'running' ? 'running' : 'stopped');
        setProgress(data.progress || null);
        setLastError(data.lastError || null);
      } else {
        setStatus('stopped');
      }
    } catch {
      setStatus('stopped');
    }
  };

  const fetchChapters = async () => {
    try {
      const res = await fetch(API.ainovel.chapters);
      if (res.ok) {
        const data = await res.json();
        if (data.chapters) setChapters(data.chapters);
      }
    } catch (err) {
      console.error('Lỗi tải danh sách chương:', err);
    }
  };

  const fetchChapterDetail = async (id: number) => {
    try {
      const res = await fetch(`${API.ainovel.chapters}/${id}`);
      if (res.ok) {
        const data = await res.json();
        setChapters((prev) =>
          prev.map((ch) => (ch.id === id ? { ...ch, content: data.content } : ch)),
        );
      }
    } catch (err) {
      console.error('Lỗi tải chi tiết chương:', err);
    }
  };

  useEffect(() => {
    void checkStatus();
    void fetchChapters();
    connectSSE();
    void fetch(API.ainovel.capabilities)
      .then((r) => r.json())
      .then((d) => {
        const cap = d?.media?.capcutTts?.available ? 'CapCut OK' : 'CapCut→Edge';
        const py = d?.nav?.pythonCoreGateway ? 'python_core OK' : 'python_core missing';
        setCapsHint(`native · ${cap} · ${py} · no :8080`);
      })
      .catch(() => setCapsHint('native engine'));

    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, [connectSSE]);

  // Poll progress while running
  useEffect(() => {
    if (status !== 'running') return;
    const t = setInterval(() => {
      void checkStatus();
      void fetchChapters();
    }, 4000);
    return () => clearInterval(t);
  }, [status]);

  const handleStartEngine = async (mode: 'start' | 'resume' = 'start') => {
    setBusy(true);
    setLastError(null);
    try {
      const res = await fetch(mode === 'resume' ? API.ainovel.resume : API.ainovel.start, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus('running');
        setLogs((prev) => [
          ...prev,
          {
            id: Date.now(),
            text: mode === 'resume' ? '⏯ Resume engine…' : '🚀 Start engine…',
            type: 'success',
          },
        ]);
      } else {
        const err = data.error || 'Start failed';
        setLastError(err);
        toast.info('Notice', `❌ ${err}`);
      }
    } catch (err) {
      console.error('Lỗi khởi chạy engine:', err);
      toast.info('Notice', 'Lỗi kết nối engine.');
    } finally {
      setBusy(false);
    }
  };

  const handleStopEngine = async () => {
    setBusy(true);
    try {
      const res = await fetch(API.ainovel.stop, { method: 'POST' });
      if (res.ok) setStatus('stopped');
    } catch (err) {
      console.error('Lỗi dừng engine:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadAll = () => {
    window.open(API.ainovel.downloadAll, '_blank');
  };

  const handleOpenDiag = async () => {
    try {
      const res = await fetch(API.ainovel.diag);
      const data = await res.json();
      setDiagJson(JSON.stringify(data, null, 2));
      setShowDiagModal(true);
    } catch {
      toast.info('Notice', 'Không tải được diag.');
    }
  };

  const handleSyncAllToWorkspace = async () => {
    setBusy(true);
    try {
      const listRes = await fetch(API.ainovel.chapters);
      const listData = await listRes.json();
      const ids: number[] = (listData.chapters || []).map((c: { id: number }) => c.id);
      let merged = [...store.danh_sach_chuong];
      for (const id of ids) {
        const res = await fetch(`${API.ainovel.chapters}/${id}`);
        if (!res.ok) continue;
        const ch = await res.json();
        if (!ch.content?.trim()) continue;
        const idx = merged.findIndex((c) => c.so_chuong === id);
        const row = {
          so_chuong: id,
          tieu_de: ch.title || `Chương ${id}`,
          dan_y: ch.dan_y || '',
          noi_dung: ch.content,
          trang_thai: 'ready' as const,
        };
        if (idx >= 0) merged[idx] = { ...merged[idx], ...row };
        else merged.push(row);
      }
      merged = merged.sort((a, b) => a.so_chuong - b.so_chuong);
      store.setDanhSachChuong(merged);
      store.setWorkspaceTab('script');
      store.setTabHienTai('noi_dung');
      toast.info('Notice', `✅ Đã đồng bộ ${ids.length} chương engine → workspace Script.`);
    } catch (err) {
      toast.info('Notice', `Lỗi sync: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const activeChapter = chapters.find((c) => c.id === selectedChapter);
  const total = progress?.totalChapters || store.setup?.so_chuong || chapters.length || 0;
  const done = progress?.completedChapters?.length || 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <div className="flex h-full flex-col bg-black p-6 gap-6 overflow-y-auto">
      <EngineToolbar
        status={status}
        busy={busy}
        capsHint={capsHint}
        lastError={lastError}
        onStart={() => void handleStartEngine('start')}
        onResume={() => void handleStartEngine('resume')}
        onStop={() => void handleStopEngine()}
        onDownloadAll={handleDownloadAll}
        onSyncScript={() => void handleSyncAllToWorkspace()}
        onDiag={() => void handleOpenDiag()}
        onYoutube={() => setShowYoutubeModal(true)}
        onConfig={() => {
          void fetchConfig();
          setShowConfigModal(true);
        }}
      />

      <div className="flex flex-col gap-4 bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800">
        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1.5">
            <span className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-emerald-500" />
              Tiến độ {done}/{total || '?'} chương
              {progress?.currentChapter ? ` · đang ch${progress.currentChapter}` : ''}
              {progress?.phase ? ` · ${progress.phase}` : ''}
            </span>
            <span className="text-emerald-400">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-zinc-900 border border-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          {progress?.lastAction ? (
            <p className="mt-1.5 text-[10px] text-zinc-600 font-mono truncate">{progress.lastAction}</p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-[500px]">
        {/* LOGS */}
        <div className="lg:col-span-2 flex flex-col bg-zinc-950 rounded-2xl border border-zinc-900 overflow-hidden shadow-2xl">
          <div className="flex items-center justify-between bg-zinc-900/60 px-4 py-3 border-b border-zinc-800">
            <div className="flex items-center gap-2 text-xs font-bold text-zinc-400 uppercase tracking-widest">
              <span>Terminal & Logs</span>
              {status === 'running' ? (
                <span className="text-emerald-500 animate-pulse">Running</span>
              ) : status === 'checking' ? (
                <span className="text-amber-500">Checking…</span>
              ) : (
                <span className="text-red-500">Stopped</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setLogs([])}
              className="text-[10px] text-zinc-600 hover:text-zinc-300 uppercase font-bold cursor-pointer"
            >
              Xóa log
            </button>
          </div>

          <div className="flex-1 p-4 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-1.5 custom-scrollbar min-h-[320px]">
            {logs.length === 0 ? (
              <div className="flex h-full items-center justify-center text-zinc-700 italic">
                Chưa có log — bấm START/RESUME để chạy engine native.
              </div>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  className={`flex gap-2 ${
                    log.type === 'error'
                      ? 'text-red-400'
                      : log.type === 'success'
                        ? 'text-emerald-400'
                        : 'text-zinc-300'
                  }`}
                >
                  <span className="text-zinc-600 shrink-0 select-none">
                    [{new Date(log.id).toLocaleTimeString()}]
                  </span>
                  <span className="break-words">{log.text}</span>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* CHAPTERS */}
        <div className="flex flex-col bg-zinc-950 rounded-2xl border border-zinc-900 overflow-hidden shadow-2xl">
          <div className="flex items-center justify-between bg-zinc-900/60 px-4 py-3 border-b border-zinc-800">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-500 uppercase tracking-widest">
              <FileText className="h-4 w-4" />
              Tiểu Thuyết ({chapters.length})
            </div>
            <button
              type="button"
              onClick={() => void fetchChapters()}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 uppercase font-bold cursor-pointer"
            >
              Refresh
            </button>
          </div>

          <div className="flex-1 flex flex-col p-4 overflow-y-auto custom-scrollbar">
            {chapters.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-[11px] text-zinc-600 uppercase tracking-widest font-bold text-center px-4">
                Chưa có chương trên disk engine. START để viết.
              </div>
            ) : selectedChapter === null ? (
              <div className="space-y-2">
                {chapters.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => {
                      setSelectedChapter(ch.id);
                      if (!ch.content) void fetchChapterDetail(ch.id);
                    }}
                    className="w-full flex items-center justify-between bg-zinc-900/40 hover:bg-zinc-800 border border-zinc-800 rounded-lg p-3 text-left transition-colors cursor-pointer group"
                  >
                    <div>
                      <p className="text-xs font-bold text-zinc-200 group-hover:text-amber-500 transition-colors">
                        Chương {ch.id}: {ch.title}
                      </p>
                      <p className="text-[9px] text-zinc-600 mt-0.5 uppercase tracking-wider">
                        {ch.status || '—'}
                        {ch.wordCount ? ` · ${ch.wordCount} từ` : ''}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-zinc-600 group-hover:text-amber-500" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                <button
                  type="button"
                  onClick={() => setSelectedChapter(null)}
                  className="text-[10px] font-bold text-zinc-500 hover:text-zinc-300 uppercase tracking-widest flex items-center gap-1 mb-4 w-fit cursor-pointer"
                >
                  ← Danh sách
                </button>

                {activeChapter && (
                  <div className="flex flex-col flex-1 min-h-0">
                    <div className="flex justify-between items-start mb-4 gap-2">
                      <h3 className="text-sm font-bold text-amber-500">
                        Chương {activeChapter.id}: {activeChapter.title}
                      </h3>
                      <button
                        type="button"
                        title="Gửi chương này sang tab Script"
                        onClick={() => {
                          if (!activeChapter.content) return;
                          const existing = store.danh_sach_chuong.find(
                            (c) => c.so_chuong === activeChapter.id,
                          );
                          if (existing) {
                            store.updateChuong(activeChapter.id, {
                              tieu_de: activeChapter.title,
                              noi_dung: activeChapter.content,
                              trang_thai: 'ready',
                            });
                          } else {
                            store.setDanhSachChuong([
                              ...store.danh_sach_chuong,
                              {
                                so_chuong: activeChapter.id,
                                tieu_de: activeChapter.title,
                                dan_y: '',
                                noi_dung: activeChapter.content,
                                trang_thai: 'ready',
                              },
                            ]);
                          }
                          store.selectChuong(activeChapter.id);
                          store.setTabHienTai('noi_dung');
                          store.setWorkspaceTab('script');
                        }}
                        className="bg-zinc-800 hover:bg-amber-600 text-zinc-300 hover:text-black p-1.5 rounded transition-colors cursor-pointer flex items-center gap-1.5 px-3 shrink-0"
                      >
                        <Download className="h-4 w-4" />
                        <span className="text-[10px] font-bold uppercase tracking-widest hidden sm:inline">
                          → Script
                        </span>
                      </button>
                    </div>
                    <div className="flex-1 bg-zinc-900/30 rounded-lg border border-zinc-800 p-4 text-xs text-zinc-300 leading-relaxed overflow-y-auto whitespace-pre-wrap font-sans min-h-[200px]">
                      {activeChapter.content || 'Đang tải nội dung...'}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* CONFIG MODAL */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="flex w-full max-w-4xl flex-col rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl p-6 h-[80vh]">
            <div className="flex items-center justify-between mb-4 border-b border-zinc-800 pb-3">
              <h3 className="text-lg font-bold text-zinc-100 uppercase tracking-widest flex items-center gap-2">
                <Settings className="h-5 w-5 text-amber-500" />
                Cấu hình Native Engine
              </h3>
              <button
                type="button"
                onClick={() => setShowConfigModal(false)}
                className="text-zinc-500 hover:text-zinc-300 font-bold cursor-pointer"
              >
                ĐÓNG
              </button>
            </div>

            <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-4 custom-scrollbar">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                  config.json (maxChaptersPerRun, …)
                </label>
                <textarea
                  value={configContent.config}
                  onChange={(e) => setConfigContent({ ...configContent, config: e.target.value })}
                  className="flex-1 w-full min-h-[300px] rounded border border-zinc-800 bg-black/60 p-3 text-[11px] font-mono text-zinc-300 outline-none focus:border-amber-500 custom-scrollbar whitespace-pre"
                  spellCheck={false}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                  .env (override keys — ưu tiên Header store)
                </label>
                <textarea
                  value={configContent.env}
                  onChange={(e) => setConfigContent({ ...configContent, env: e.target.value })}
                  className="flex-1 w-full min-h-[300px] rounded border border-zinc-800 bg-black/60 p-3 text-[11px] font-mono text-zinc-300 outline-none focus:border-amber-500 custom-scrollbar whitespace-pre"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-3 pt-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setShowConfigModal(false)}
                className="rounded border border-zinc-700 bg-zinc-800 px-5 py-2 text-xs font-bold uppercase text-zinc-300 hover:bg-zinc-700 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void handleSaveConfig()}
                disabled={savingConfig}
                className="rounded bg-emerald-500 px-5 py-2 text-xs font-bold uppercase text-black hover:bg-emerald-400 disabled:opacity-50 cursor-pointer"
              >
                {savingConfig ? 'Đang lưu...' : 'LƯU'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIAG MODAL */}
      {showDiagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="flex w-full max-w-3xl flex-col rounded-xl border border-rose-900/40 bg-zinc-950 shadow-2xl p-5 max-h-[85vh]">
            <div className="flex items-center justify-between mb-3 border-b border-zinc-800 pb-2">
              <h3 className="text-sm font-bold text-rose-400 uppercase tracking-widest flex items-center gap-2">
                <Stethoscope className="h-4 w-4" />
                Diag (read-only)
              </h3>
              <button
                type="button"
                onClick={() => setShowDiagModal(false)}
                className="text-zinc-500 hover:text-white text-xs font-bold cursor-pointer"
              >
                ĐÓNG
              </button>
            </div>
            <pre className="flex-1 overflow-auto text-[10px] font-mono text-zinc-400 bg-black/50 border border-zinc-900 rounded p-3 custom-scrollbar">
              {diagJson}
            </pre>
          </div>
        </div>
      )}

      <YoutubePromptModal
        isOpen={showYoutubeModal}
        onClose={() => setShowYoutubeModal(false)}
        novelTitle={store.ten_tac_pham}
        apiKey={store.apiKey}
        apiKeys={store.apiKeys}
      />
    </div>
  );
}
