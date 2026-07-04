import React, { useState } from 'react';
import { Upload, Play, CheckCircle, Clock, RefreshCw, X } from 'lucide-react';

export interface AutoRenderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AutoRenderModal({ isOpen, onClose }: AutoRenderModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ [key: string]: string }>({});

  if (!isOpen) return null;

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const startBatchRender = async () => {
    if (files.length === 0) return;
    setIsProcessing(true);
    // Giả lập xử lý hàng loạt
    for (const file of files) {
      setProgress(prev => ({ ...prev, [file.name]: 'processing' }));
      await new Promise(r => setTimeout(r, 2000)); // Fake processing time
      setProgress(prev => ({ ...prev, [file.name]: 'done' }));
    }
    setIsProcessing(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur p-4 font-sans text-white">
      <div className="flex flex-col w-full max-w-[900px] max-h-[85vh] bg-slate-950 rounded-lg shadow-2xl border border-slate-700 overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between bg-slate-900 border-b border-slate-700 px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-amber-500 uppercase tracking-widest flex items-center gap-2">
              🤖 Dây Chuyền Tự Động (Auto Render)
            </h2>
            <p className="text-slate-400 text-xs mt-1">Xử lý hàng loạt video dựa trên cấu hình Video Editor hiện tại.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-red-500 hover:text-white rounded-md text-slate-400 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col flex-1 p-6 bg-[#0a0a0a] overflow-y-auto custom-scrollbar">
          <div className="flex items-center justify-between mb-6 border-b border-zinc-800 pb-4">
            <div className="text-sm text-zinc-400">
              Chức năng này sẽ áp dụng các thông số (Zoom, Speed, Blur, Audio...) đã lưu cuối cùng từ Video Editor cho toàn bộ video trong danh sách.
            </div>
            <button 
              onClick={startBatchRender}
              disabled={isProcessing || files.length === 0}
              className="bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold py-2.5 px-6 rounded shadow-lg shadow-emerald-500/20 uppercase tracking-widest flex items-center gap-2 transition-all disabled:opacity-50"
            >
              {isProcessing ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" fill="currentColor" />}
              {isProcessing ? 'Đang chạy Auto...' : 'Bắt đầu Auto Render'}
            </button>
          </div>

          <div className="border-2 border-dashed border-zinc-700 bg-zinc-900/50 rounded-xl p-10 flex flex-col items-center justify-center text-center cursor-pointer hover:border-amber-500/50 hover:bg-amber-500/5 transition-all mb-6 relative group">
            <Upload className="w-12 h-12 text-zinc-500 mb-4 group-hover:text-amber-500 transition-colors" />
            <h3 className="text-lg font-bold text-zinc-300 mb-2">Kéo thả Video vào đây</h3>
            <p className="text-zinc-500 text-sm mb-4">Hỗ trợ MP4, MOV, MKV (Tối đa 20 video cùng lúc)</p>
            <input 
              type="file" 
              multiple 
              accept="video/*" 
              onChange={handleFiles}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
              title="Chọn file"
            />
            <div className="bg-amber-600 hover:bg-amber-500 text-black font-bold py-2 px-6 rounded cursor-pointer transition-colors shadow-md pointer-events-none">
              Chọn File Từ Máy Tính
            </div>
          </div>

          {files.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden shadow-inner">
              <div className="bg-zinc-950 px-4 py-3 border-b border-zinc-800 font-bold text-zinc-400 text-sm uppercase tracking-wider flex justify-between">
                <span>Danh sách Hàng đợi ({files.length})</span>
                <button onClick={() => setFiles([])} className="text-red-500 hover:text-red-400 text-xs flex items-center gap-1">
                  <X size={12} /> Xóa tất cả
                </button>
              </div>
              <div className="divide-y divide-zinc-800/50 max-h-[300px] overflow-y-auto custom-scrollbar">
                {files.map((file, idx) => (
                  <div key={idx} className="flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-500">
                        {idx + 1}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-zinc-300 truncate max-w-[400px]" title={file.name}>{file.name}</div>
                        <div className="text-xs text-zinc-500">{(file.size / (1024 * 1024)).toFixed(2)} MB</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {progress[file.name] === 'done' ? (
                        <span className="flex items-center gap-1.5 text-emerald-500 text-xs font-bold bg-emerald-500/10 px-2 py-1.5 rounded">
                          <CheckCircle className="w-3.5 h-3.5" /> HOÀN TẤT
                        </span>
                      ) : progress[file.name] === 'processing' ? (
                        <span className="flex items-center gap-1.5 text-amber-500 text-xs font-bold bg-amber-500/10 px-2 py-1.5 rounded animate-pulse">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" /> ĐANG XỬ LÝ...
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-zinc-500 text-xs font-bold bg-zinc-800 px-2 py-1.5 rounded">
                          <Clock className="w-3.5 h-3.5" /> CHỜ XỬ LÝ
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
