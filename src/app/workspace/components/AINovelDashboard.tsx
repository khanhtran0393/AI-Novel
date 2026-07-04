'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Settings, FileText, ChevronRight, Download, PlaySquare } from 'lucide-react';
import { useNovelStore } from '@/store/useNovelStore';
import YoutubePromptModal from './YoutubePromptModal';

export default function AINovelDashboard() {
  const store = useNovelStore();
  const [status, setStatus] = useState<'stopped' | 'running' | 'checking'>('checking');
  const [logs, setLogs] = useState<{ id: number; text: string; type: 'info' | 'error' | 'success' }[]>([]);
  const [chapters, setChapters] = useState<{ id: number; title: string; content?: string }[]>([]);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  
  // Trạng thái cho Cấu Hình
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showYoutubeModal, setShowYoutubeModal] = useState(false);
  const [configContent, setConfigContent] = useState<{ env: string; config: string }>({ env: '', config: '' });
  const [savingConfig, setSavingConfig] = useState(false);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Cuộn xuống log mới nhất
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Lấy dữ liệu cấu hình
  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/ainovel/config');
      if (res.ok) {
        const data = await res.json();
        setConfigContent({ env: data.env || '', config: data.config || '' });
      }
    } catch (err) {
      console.error('Lỗi tải cấu hình:', err);
    }
  };

  // Lưu cấu hình
  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const res = await fetch('/api/ainovel/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configContent)
      });
      if (res.ok) {
        alert('Lưu cấu hình thành công! Bạn có thể cần khởi động lại Engine nếu đổi API Key.');
        setShowConfigModal(false);
      } else {
        alert('Lỗi lưu cấu hình.');
      }
    } catch (err) {
      console.error(err);
      alert('Có lỗi xảy ra khi lưu cấu hình.');
    } finally {
      setSavingConfig(false);
    }
  };

  // Khởi tạo kết nối SSE cho logs
  const connectSSE = () => {
    if (eventSourceRef.current) return;
    
    // Sử dụng proxy đã cấu hình trong next.config.ts
    const es = new EventSource('/api/ainovel/stream');
    
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'log') {
          setLogs(prev => [...prev, { 
            id: Date.now() + Math.random(), 
            text: data.message, 
            type: (data.level === 'error' ? 'error' : data.level === 'success' ? 'success' : 'info') as 'info' | 'error' | 'success'
          }].slice(-500)); // Giữ 500 dòng log gần nhất
        } else if (data.type === 'status') {
          setStatus(data.status);
        } else if (data.type === 'chapter_update') {
          fetchChapters(); // Cập nhật danh sách chương khi có sự kiện mới
        }
      } catch (err) {
        console.error('Lỗi parse SSE:', err);
      }
    };

    es.onerror = (error) => {
      console.error('SSE Error:', error);
      es.close();
      eventSourceRef.current = null;
      // Thử kết nối lại sau 3 giây
      setTimeout(connectSSE, 3000);
    };

    eventSourceRef.current = es;
  };

  // Kiểm tra trạng thái Engine
  const checkStatus = async () => {
    try {
      const res = await fetch('/api/ainovel/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status);
      } else {
        setStatus('stopped');
      }
    } catch (err) {
      setStatus('stopped');
    }
  };

  // Lấy danh sách chương
  const fetchChapters = async () => {
    try {
      const res = await fetch('/api/ainovel/chapters');
      if (res.ok) {
        const data = await res.json();
        if (data.chapters) {
          setChapters(data.chapters);
        }
      }
    } catch (err) {
      console.error('Lỗi tải danh sách chương:', err);
    }
  };

  // Tải chi tiết một chương
  const fetchChapterDetail = async (id: number) => {
    try {
      const res = await fetch(`/api/ainovel/chapters/${id}`);
      if (res.ok) {
        const data = await res.json();
        setChapters(prev => prev.map(ch => 
          ch.id === id ? { ...ch, content: data.content } : ch
        ));
      }
    } catch (err) {
      console.error('Lỗi tải chi tiết chương:', err);
    }
  };

  useEffect(() => {
    checkStatus();
    fetchChapters();
    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const handleStartEngine = async () => {
    try {
      const res = await fetch('/api/ainovel/start', { method: 'POST' });
      if (res.ok) {
        setStatus('running');
      }
    } catch (err) {
      console.error('Lỗi khởi chạy engine:', err);
    }
  };

  const handleStopEngine = async () => {
    try {
      const res = await fetch('/api/ainovel/stop', { method: 'POST' });
      if (res.ok) {
        setStatus('stopped');
      }
    } catch (err) {
      console.error('Lỗi dừng engine:', err);
    }
  };

  const activeChapter = chapters.find(c => c.id === selectedChapter);

  return (
    <div className="flex h-full flex-col bg-black p-6 gap-6 overflow-y-auto">
      
      {/* HEADER BẢNG ĐIỀU KHIỂN */}
      <div className="flex items-center justify-between bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800">
        <div>
          <h2 className="text-xl font-bold text-zinc-100 uppercase tracking-widest mb-2 flex items-center gap-2">
            🚀 AINovel Core Engine
            {status === 'running' && (
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
            )}
          </h2>
          <p className="text-sm text-zinc-400">
            Hệ thống tự động sáng tác liên tục đa chương bằng mô hình ngôn ngữ lớn, được chạy ngầm bởi Go Backend.
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          {status === 'running' ? (
            <button
              onClick={handleStopEngine}
              className="flex items-center gap-2 rounded-lg bg-red-500/20 px-5 py-2.5 text-sm font-bold text-red-500 border border-red-500/30 hover:bg-red-500 hover:text-black hover:shadow-[0_0_15px_rgba(239,68,68,0.5)] transition-all cursor-pointer"
            >
              <Square className="h-4 w-4 fill-current" />
              DỪNG ENGINE
            </button>
          ) : (
            <button
              onClick={handleStartEngine}
              className="flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-bold text-black hover:bg-emerald-400 hover:shadow-[0_0_15px_rgba(16,185,129,0.5)] transition-all cursor-pointer"
            >
              <Play className="h-4 w-4 fill-current" />
              KHỞI ĐỘNG ENGINE
            </button>
          )}
          
          <button
            onClick={() => setShowYoutubeModal(true)}
            className="flex items-center gap-2 rounded-lg bg-amber-900/40 px-4 py-2.5 text-sm font-bold text-amber-500 border border-amber-800 hover:bg-amber-800 hover:text-amber-300 transition-all cursor-pointer"
            title="Tạo Tiêu đề, Mô tả Youtube (NAVTools)"
          >
            <PlaySquare className="h-4 w-4" />
            Youtube Prompt
          </button>
          
          <button
            onClick={() => {
              fetchConfig();
              setShowConfigModal(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-bold text-zinc-300 border border-zinc-800 hover:bg-zinc-800 hover:text-white transition-all cursor-pointer"
          >
            <Settings className="h-4 w-4" />
            Cấu hình
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-[500px]">
        {/* LOG TERMINAL VIEW */}
        <div className="lg:col-span-2 flex flex-col bg-zinc-950 rounded-2xl border border-zinc-900 overflow-hidden shadow-2xl">
          <div className="flex items-center justify-between bg-zinc-900/60 px-4 py-3 border-b border-zinc-800">
            <div className="flex items-center gap-2 text-xs font-bold text-zinc-400 uppercase tracking-widest">
              <span>Terminal & Logs</span>
              {status === 'running' ? (
                <span className="text-emerald-500 animate-pulse">Running</span>
              ) : (
                <span className="text-red-500">Stopped</span>
              )}
            </div>
            <button 
              onClick={() => setLogs([])}
              className="text-[10px] text-zinc-600 hover:text-zinc-300 uppercase font-bold"
            >
              Xóa log
            </button>
          </div>
          
          <div className="flex-1 p-4 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-1.5 custom-scrollbar">
            {logs.length === 0 ? (
              <div className="flex h-full items-center justify-center text-zinc-700 italic">
                Chưa có dữ liệu log...
              </div>
            ) : (
              logs.map(log => (
                <div key={log.id} className={`flex gap-2 ${
                  log.type === 'error' ? 'text-red-400' :
                  log.type === 'success' ? 'text-emerald-400' :
                  'text-zinc-300'
                }`}>
                  <span className="text-zinc-600 shrink-0 select-none">[{new Date(log.id).toLocaleTimeString()}]</span>
                  <span className="break-words">{log.text}</span>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* THÀNH QUẢ TIỂU THUYẾT */}
        <div className="flex flex-col bg-zinc-950 rounded-2xl border border-zinc-900 overflow-hidden shadow-2xl">
          <div className="flex items-center justify-between bg-zinc-900/60 px-4 py-3 border-b border-zinc-800">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-500 uppercase tracking-widest">
              <FileText className="h-4 w-4" />
              Tiểu Thuyết Tự Động
            </div>
          </div>
          
          <div className="flex-1 flex flex-col p-4 overflow-y-auto custom-scrollbar">
            {chapters.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-[11px] text-zinc-600 uppercase tracking-widest font-bold text-center px-4">
                Engine chưa hoàn thành chương nào. Hãy chờ đợi!
              </div>
            ) : (
              <div className="space-y-4">
                {selectedChapter === null ? (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Danh sách Chương hoàn thành</p>
                    {chapters.map(ch => (
                      <button
                        key={ch.id}
                        onClick={() => {
                          setSelectedChapter(ch.id);
                          if (!ch.content) fetchChapterDetail(ch.id);
                        }}
                        className="w-full flex items-center justify-between bg-zinc-900/40 hover:bg-zinc-800 border border-zinc-800 rounded-lg p-3 text-left transition-colors cursor-pointer group"
                      >
                        <div>
                          <p className="text-xs font-bold text-zinc-200 group-hover:text-amber-500 transition-colors">
                            Chương {ch.id}: {ch.title}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-zinc-600 group-hover:text-amber-500 transition-colors" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col h-full animate-in slide-in-from-right-4 duration-300">
                    <button
                      onClick={() => setSelectedChapter(null)}
                      className="text-[10px] font-bold text-zinc-500 hover:text-zinc-300 uppercase tracking-widest flex items-center gap-1 mb-4 w-fit cursor-pointer"
                    >
                      ← Quay lại danh sách
                    </button>
                    
                    {activeChapter && (
                      <div className="flex flex-col flex-1">
                        <div className="flex justify-between items-start mb-4">
                          <h3 className="text-sm font-bold text-amber-500">Chương {activeChapter.id}: {activeChapter.title}</h3>
                          <button
                            title="Chuyển vào trình biên tập TTS"
                            onClick={() => {
                              // Đồng bộ chương này qua bảng kịch bản TTS
                              if (activeChapter.content) {
                                // Kiểm tra xem chương này đã tồn tại chưa
                                const existingChapter = store.danh_sach_chuong.find(c => c.so_chuong === activeChapter.id);
                                if (existingChapter) {
                                  store.updateChuong(activeChapter.id, {
                                    tieu_de: activeChapter.title,
                                    noi_dung: activeChapter.content,
                                    trang_thai: 'ready'
                                  });
                                } else {
                                  store.setDanhSachChuong([
                                    ...store.danh_sach_chuong,
                                    {
                                      so_chuong: activeChapter.id,
                                      tieu_de: activeChapter.title,
                                      dan_y: '',
                                      noi_dung: activeChapter.content,
                                      trang_thai: 'ready'
                                    }
                                  ]);
                                }
                                store.selectChuong(activeChapter.id);
                                store.setTabHienTai('noi_dung');
                                store.setWorkspaceTab('script');
                              }
                            }}
                            className="bg-zinc-800 hover:bg-amber-600 text-zinc-300 hover:text-black p-1.5 rounded transition-colors cursor-pointer flex items-center gap-1.5 px-3"
                          >
                            <Download className="h-4 w-4" />
                            <span className="text-[10px] font-bold uppercase tracking-widest hidden sm:inline">Gửi sang TTS</span>
                          </button>
                        </div>
                        <div className="flex-1 bg-zinc-900/30 rounded-lg border border-zinc-800 p-4 text-xs text-zinc-300 leading-relaxed overflow-y-auto whitespace-pre-wrap font-sans">
                          {activeChapter.content || 'Đang tải nội dung...'}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* CẤU HÌNH MODAL */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="flex w-full max-w-4xl flex-col rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl p-6 h-[80vh]">
            <div className="flex items-center justify-between mb-4 border-b border-zinc-800 pb-3">
              <h3 className="text-lg font-bold text-zinc-100 uppercase tracking-widest flex items-center gap-2">
                <Settings className="h-5 w-5 text-amber-500" />
                Cấu hình AINovel Engine
              </h3>
              <button
                onClick={() => setShowConfigModal(false)}
                className="text-zinc-500 hover:text-zinc-300 font-bold"
              >
                ĐÓNG
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-4 custom-scrollbar">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                  config.json (AI Providers & Roles)
                </label>
                <textarea
                  value={configContent.config}
                  onChange={(e) => setConfigContent({ ...configContent, config: e.target.value })}
                  className="flex-1 w-full rounded border border-zinc-800 bg-black/60 p-3 text-[11px] font-mono text-zinc-300 outline-none focus:border-amber-500 custom-scrollbar whitespace-pre"
                  spellCheck={false}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                  .env (API Keys)
                </label>
                <textarea
                  value={configContent.env}
                  onChange={(e) => setConfigContent({ ...configContent, env: e.target.value })}
                  className="flex-1 w-full rounded border border-zinc-800 bg-black/60 p-3 text-[11px] font-mono text-zinc-300 outline-none focus:border-amber-500 custom-scrollbar whitespace-pre"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-3 pt-3 border-t border-zinc-800">
              <button
                onClick={() => setShowConfigModal(false)}
                className="rounded border border-zinc-700 bg-zinc-800 px-5 py-2 text-xs font-bold uppercase text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={handleSaveConfig}
                disabled={savingConfig}
                className="rounded bg-emerald-500 px-5 py-2 text-xs font-bold uppercase text-black hover:bg-emerald-400 transition-colors disabled:opacity-50"
              >
                {savingConfig ? 'Đang lưu...' : 'LƯU CẤU HÌNH'}
              </button>
            </div>
          </div>
        </div>
      )}

      <YoutubePromptModal 
        isOpen={showYoutubeModal} 
        onClose={() => setShowYoutubeModal(false)} 
        novelTitle={store.ten_tac_pham}
      />
    </div>
  );
}
