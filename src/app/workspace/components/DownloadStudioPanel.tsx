import React, { useState } from 'react';
import { Download, Search, Link as LinkIcon, Loader2, X, RefreshCw } from 'lucide-react';

export default function DownloadStudioPanel({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const [platform, setPlatform] = useState('yt');
  const [type, setType] = useState('search');
  const [input, setInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [log, setLog] = useState('');

  if (!isOpen) return null;

  const handleProcess = async () => {
    if (!input.trim()) {
      alert("Vui lòng nhập link hoặc từ khóa!");
      return;
    }
    setProcessing(true);
    setLog(`Đang khởi tạo Download Studio cho [${platform}] - Loại: ${type}...\n`);
    
    // Giả lập API gọi
    setTimeout(() => {
      setLog(prev => prev + `\n[yt-dlp] Đang tải danh sách metadata...\n[SUCCESS] Tải hoàn tất! File được lưu tại: D:\\SuperAudioTools\\MediaCrawler\\data\\`);
      setProcessing(false);
    }, 2500);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-sans text-zinc-200">
      <div className="w-full max-w-4xl bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl flex flex-col h-[80vh]">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/50">
          <h2 className="font-bold text-sky-400 flex items-center gap-2 uppercase tracking-wide text-sm">
            <Download size={18} /> Media Crawler Studio
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded text-zinc-400">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Menu Cấu Hình Trái */}
          <div className="w-72 border-r border-zinc-800 bg-zinc-900/30 p-4 flex flex-col gap-4 overflow-y-auto">
            
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Nền Tảng</label>
              <select 
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none"
              >
                <option value="yt">YouTube</option>
                <option value="tt">TikTok</option>
                <option value="tw">Twitter / X</option>
                <option value="rd">Reddit</option>
                <option value="ig">Instagram</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Kiểu Tải</label>
              <select 
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none"
              >
                <option value="search">Từ Khóa (Search)</option>
                <option value="creator">Theo Kênh (Creator/User)</option>
                <option value="detail">Link Trực Tiếp (Detail)</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Đầu Vào (Link / Từ khóa)</label>
              <textarea 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ví dụ: Truyện ma, tiktok.com/@user..."
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none min-h-[100px]"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Số lượng (Count)</label>
              <input 
                type="number" 
                defaultValue={10}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none"
              />
            </div>

            <button 
              onClick={handleProcess}
              disabled={processing || !input.trim()}
              className="mt-auto bg-sky-500 hover:bg-sky-600 text-black font-bold py-3 rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20 disabled:opacity-50"
            >
              {processing ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              {processing ? 'ĐANG TẢI...' : 'BẮT ĐẦU TẢI'}
            </button>
          </div>

          {/* Khung Phải */}
          <div className="flex-1 p-0 flex flex-col bg-[#111]">
            <div className="bg-zinc-900 border-b border-zinc-800 p-2 flex items-center gap-2 text-xs font-mono text-zinc-400">
              <RefreshCw size={14} className={processing ? 'animate-spin' : ''} /> Live Log Output
            </div>
            <div className="flex-1 p-4 font-mono text-xs text-green-400 overflow-y-auto whitespace-pre-wrap">
              {log || '> Hệ thống Crawler sẵn sàng. Điền thông tin và bấm Bắt đầu tải.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
