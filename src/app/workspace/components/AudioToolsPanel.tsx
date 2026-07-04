import React, { useState } from 'react';
import { Mic2, FileAudio, SplitSquareHorizontal, Shield, Loader2, X, Upload } from 'lucide-react';

export default function AudioToolsPanel({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'isolate' | 'transcribe' | 'watermark' | 'split'>('isolate');
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [log, setLog] = useState('');

  if (!isOpen) return null;

  const handleProcess = async () => {
    if (!file) {
      alert("Vui lòng chọn file!");
      return;
    }
    setProcessing(true);
    setLog(`Đang xử lý ${file.name} với công cụ ${activeTab}...\n`);
    
    // Giả lập API gọi (Vì API yêu cầu đường dẫn tuyệt đối của file từ file system, ta giả lập upload & nhận đường dẫn)
    setTimeout(() => {
      setLog(prev => prev + `[SUCCESS] Đã xử lý xong!\nFile kết quả lưu tại: D:\\SuperAudioTools\\MediaCrawler\\data\\...`);
      setProcessing(false);
    }, 2000);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-sans text-zinc-200">
      <div className="w-full max-w-3xl bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl flex flex-col h-[70vh]">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/50">
          <h2 className="font-bold text-emerald-400 flex items-center gap-2 uppercase tracking-wide text-sm">
            <Mic2 size={18} /> Studio Âm Thanh & Video Nâng Cao
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded text-zinc-400">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Menu Trái */}
          <div className="w-56 border-r border-zinc-800 bg-zinc-900/30 p-2 flex flex-col gap-1">
            <button 
              onClick={() => setActiveTab('isolate')}
              className={`flex items-center gap-2 p-3 text-sm font-bold rounded-lg text-left transition-colors ${activeTab === 'isolate' ? 'bg-emerald-500/10 text-emerald-400' : 'hover:bg-zinc-800 text-zinc-400'}`}
            >
              <FileAudio size={16} /> Tách Giọng / Nhạc Nền
            </button>
            <button 
              onClick={() => setActiveTab('transcribe')}
              className={`flex items-center gap-2 p-3 text-sm font-bold rounded-lg text-left transition-colors ${activeTab === 'transcribe' ? 'bg-amber-500/10 text-amber-400' : 'hover:bg-zinc-800 text-zinc-400'}`}
            >
              <Mic2 size={16} /> Nhận Diện Phụ Đề (AI)
            </button>
            <button 
              onClick={() => setActiveTab('watermark')}
              className={`flex items-center gap-2 p-3 text-sm font-bold rounded-lg text-left transition-colors ${activeTab === 'watermark' ? 'bg-sky-500/10 text-sky-400' : 'hover:bg-zinc-800 text-zinc-400'}`}
            >
              <Shield size={16} /> Nhúng Watermark Ẩn
            </button>
            <button 
              onClick={() => setActiveTab('split')}
              className={`flex items-center gap-2 p-3 text-sm font-bold rounded-lg text-left transition-colors ${activeTab === 'split' ? 'bg-rose-500/10 text-rose-400' : 'hover:bg-zinc-800 text-zinc-400'}`}
            >
              <SplitSquareHorizontal size={16} /> Cắt Video Theo Cảnh
            </button>
          </div>

          {/* Khung Phải */}
          <div className="flex-1 p-5 flex flex-col gap-4 overflow-y-auto">
            <div className="bg-zinc-900 border border-zinc-700 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-zinc-800/50 transition-colors">
              <Upload size={32} className="text-zinc-500 mb-3" />
              <div className="font-bold text-zinc-300">Kéo thả file Media vào đây</div>
              <div className="text-xs text-zinc-500 mt-1">Hỗ trợ MP4, MP3, WAV (Tối đa 500MB)</div>
              <input 
                type="file" 
                className="hidden" 
                id="file-upload" 
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <button 
                onClick={() => document.getElementById('file-upload')?.click()}
                className="mt-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-4 py-2 rounded font-bold text-xs"
              >
                CHỌN FILE THỦ CÔNG
              </button>
              {file && <div className="mt-3 text-emerald-400 font-bold text-sm bg-emerald-500/10 px-3 py-1 rounded-full">{file.name}</div>}
            </div>

            <button 
              onClick={handleProcess}
              disabled={processing || !file}
              className="bg-emerald-500 hover:bg-emerald-600 text-black font-bold py-3 rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 disabled:opacity-50"
            >
              {processing ? <Loader2 size={18} className="animate-spin" /> : null}
              {processing ? 'ĐANG XỬ LÝ BẰNG AI...' : 'BẮT ĐẦU XỬ LÝ'}
            </button>

            <div className="flex-1 bg-black rounded-lg border border-zinc-800 p-3 font-mono text-xs text-zinc-400 overflow-y-auto whitespace-pre-wrap">
              {log || '> Sẵn sàng...'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
